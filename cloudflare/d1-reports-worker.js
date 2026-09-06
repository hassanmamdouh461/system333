/**
 * Engaz Reports Worker
 * ─────────────────────────────────────────────────────────────
 * Backs the reports portal on reporting.engaz.tech. Bound to its OWN D1 database
 * (engaz-reports-db), fully isolated from the production POS database (engaz-db) so a
 * future project on another subdomain can never touch these reports.
 *
 * Two callers, two credentials, deliberately unequal:
 *
 *   • The desktop POS mirrors its records here. It holds REPORTS_API_KEY, which is the only
 *     credential that can write. It never ships to a browser.
 *   • The portal is a static site, so anything it holds is public. It therefore holds no
 *     key at all: the viewer signs in with a password, and the worker returns a short-lived
 *     signed token that only grants reads.
 *
 * Every SQL statement lives in this file. Clients send data or filters, never queries.
 *
 * Endpoints:
 *   GET  /health                      → liveness
 *   POST /migrate                     → create tables (write key)
 *   POST /auth/login                  { password } → { token, expiresAt }
 *   POST /sync/<table>                { items: [...] } (write key)
 *   POST /read/snapshot               → orders, customers, inventory, menu, stock movements,
 *                                       branches (token or write key)
 *   POST /branches/save               { branch } → upsert one branch (token or write key)
 *
 * The branch registry is the one thing a signed-in viewer may write. It holds no sales figure
 * and no customer detail: only the identity of a till, which is what the manager has to be
 * able to add without a developer. Every other write still needs REPORTS_API_KEY.
 *
 * Secrets: REPORTS_API_KEY (write), REPORTS_VIEWER_PASSWORD, REPORTS_TOKEN_SECRET.
 */

const ALLOWED_ORIGINS = [
  'https://reporting.engaz.tech',
  'https://menu.engaz.tech',
];

const MAX_BATCH = 200;
const READ_LIMIT = 1000;
/**
 * The stock ledger gets several rows per order, one per ingredient, so it needs a higher cap
 * than the row tables or the portal's cost of goods would silently omit older sales.
 */
const MOVEMENT_LIMIT = 5000;
/**
 * Cap on the stored menu configuration, measured on its JSON form. It carries two inline
 * images and is returned on every menu view, so its size is paid by every customer.
 */
const MAX_MENU_CONFIG_CHARS = 900_000;
/** Viewer sessions are short: the portal re-authenticates rather than holding a long token. */
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function corsHeaders(origin, isPublic = false) {
  const allowed = isPublic ? '*' : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    'Access-Control-Max-Age': '86400',
    ...(isPublic ? {} : { 'Vary': 'Origin' }),
  };
}

function json(data, status = 200, origin = '*', isPublic = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, isPublic) },
  });
}

/** Length-independent comparison so a key check does not leak length via timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  return diff === 0;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Fixed window per client IP in isolate memory. Cloudflare may run several isolates per
// colo, so the real ceiling is a multiple of this — a brake on scripted abuse, not a quota.
// The login endpoint gets a much tighter budget because it is the one path where guessing
// pays off.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const LOGIN_MAX_ATTEMPTS = 10;
const rateBuckets = new Map();

export function checkRateLimit(clientId, max = RATE_MAX_REQUESTS, now = Date.now(), buckets = rateBuckets) {
  const bucket = buckets.get(clientId);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (buckets.size > 10_000) {
      for (const [id, b] of buckets) if (now >= b.resetAt) buckets.delete(id);
    }
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

// ─── Viewer tokens ───────────────────────────────────────────────────────────
// A token is `<base64url payload>.<base64url HMAC>`. The signature is what makes it
// unforgeable, so the payload itself can be plain: it carries only a scope and an expiry.

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function issueViewerToken(secret, now = Date.now()) {
  const expiresAt = now + TOKEN_TTL_MS;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ scope: 'read', expiresAt })));
  const signature = await hmac(secret, payload);
  return { token: `${payload}.${signature}`, expiresAt };
}

export async function verifyViewerToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(signature, expected)) return false;

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return claims.scope === 'read' && typeof claims.expiresAt === 'number' && now < claims.expiresAt;
  } catch {
    return false;
  }
}

// ─── Input coercion ──────────────────────────────────────────────────────────
// Values arrive over the network and go straight into bind parameters. D1 rejects undefined
// and objects, and a NaN would be stored as a number that poisons every sum downstream.

function str(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function assertItems(items) {
  if (!Array.isArray(items)) throw new Error('Expected an "items" array');
  if (items.length > MAX_BATCH) throw new Error(`Too many records (max ${MAX_BATCH})`);
  return items;
}

// ─── Branch registry ─────────────────────────────────────────────────────────
// The one table a signed-in viewer may write, so its input is checked here rather than
// trusted. An id becomes the `branch_id` every mirrored row is filtered by, so it is
// restricted to a slug: a stray space or quote would produce a branch whose rows no filter
// can ever match again.

const BRANCH_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BRANCH_NAME_MAX = 60;
/** The branch every install starts with, so a fresh database is never branchless. */
export const DEFAULT_BRANCH = { id: 'main', name: 'الفرع الرئيسي' };

/**
 * A branch record built from untrusted input, or an error explaining the rejection.
 *
 * The name is what a manager reads on every screen, so it is trimmed and length-capped but
 * otherwise left alone: it is Arabic text, not an identifier.
 */
export function parseBranch(input) {
  if (!input || typeof input !== 'object') return { error: 'Expected a branch object' };

  const id = String(input.id ?? '').trim().toLowerCase();
  if (!BRANCH_ID_PATTERN.test(id)) {
    return { error: 'Branch id must be 1-40 characters of a-z, 0-9, dash or underscore' };
  }

  const name = String(input.name ?? '').trim();
  if (!name) return { error: 'Branch name is required' };
  if (name.length > BRANCH_NAME_MAX) {
    return { error: `Branch name must be at most ${BRANCH_NAME_MAX} characters` };
  }

  return {
    branch: {
      id,
      name,
      phone: str(input.phone, '').slice(0, 30),
      address: str(input.address, '').slice(0, 120),
      // A closed branch keeps its rows readable; only new sign-ins are meant to stop.
      active: input.active === false ? 0 : 1,
    },
  };
}

async function readBranches(db) {
  const { results } = await db
    .prepare(`SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?`)
    .bind(READ_LIMIT)
    .all();
  return results || [];
}

async function saveBranch(db, branch) {
  await db
    .prepare(
      `INSERT INTO branches (id, name, phone, address, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, phone = excluded.phone, address = excluded.address,
         active = excluded.active, updated_at = excluded.updated_at`
    )
    .bind(branch.id, branch.name, branch.phone, branch.address, branch.active, nowIso(), nowIso())
    .run();
}

// ─── Mirror targets ──────────────────────────────────────────────────────────
// This database is a read model, so every write is an idempotent replace keyed on id.
// There is no last-writer-wins guard: the POS is the single source of truth and a re-sent
// record is simply the newer version of the same row.

const SYNC_TABLES = {
  'menu-items': {
    table: 'menu_items',
    upsert: `INSERT OR REPLACE INTO menu_items
             (id, name, description, price, category, image, available, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (i) => [
      str(i.id), str(i.name, ''), str(i.description, ''), num(i.price, 0), str(i.category, ''),
      str(i.image, ''), i.available ? 1 : 0, str(i.branchId ?? i.branch_id),
      str(i.createdAt ?? i.created_at, nowIso()), str(i.updatedAt ?? i.updated_at, nowIso()),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  orders: {
    table: 'orders',
    upsert: `INSERT OR REPLACE INTO orders
             (id, orderNumber, tableId, status, paymentStatus, paymentMethod, totalAmount,
              grandTotal, subtotal, taxRate, taxAmount, paidAmount, items, branch_id,
              customerPhone, pointsEarned, pointsRedeemed, createdAt, paidAt, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (o) => [
      str(o.id), str(o.orderNumber, ''), str(o.tableId, ''), str(o.status, 'New'),
      str(o.paymentStatus, 'Unpaid'), str(o.paymentMethod), num(o.totalAmount, 0),
      num(o.grandTotal), num(o.subtotal), num(o.taxRate), num(o.taxAmount), num(o.paidAmount),
      typeof o.items === 'string' ? o.items : JSON.stringify(o.items ?? []),
      str(o.branchId ?? o.branch_id), str(o.customerPhone),
      num(o.pointsEarned, 0), num(o.pointsRedeemed, 0),
      str(o.createdAt, nowIso()), str(o.paidAt),
      str(o.updatedAt ?? o.updated_at, nowIso()), str(o.deletedAt ?? o.deleted_at),
    ],
  },

  customers: {
    table: 'customers',
    upsert: `INSERT OR REPLACE INTO customers
             (id, name, phone, points, createdAt, updated_at, deleted_at, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (c) => [
      str(c.id), str(c.name, ''), str(c.phone, ''), num(c.points, 0),
      str(c.createdAt, nowIso()), str(c.updatedAt ?? c.updated_at, nowIso()),
      str(c.deletedAt ?? c.deleted_at), str(c.branchId ?? c.branch_id),
    ],
  },

  inventory: {
    table: 'inventory',
    upsert: `INSERT OR REPLACE INTO inventory
             (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (i) => [
      str(i.id), str(i.name, ''), str(i.unit, ''), num(i.stock, 0), num(i.minStock, 0),
      num(i.costPerUnit, 0), str(i.branchId ?? i.branch_id),
      str(i.createdAt ?? i.created_at, nowIso()), str(i.updatedAt ?? i.updated_at, nowIso()),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  'inventory-transactions': {
    table: 'inventory_transactions',
    upsert: `INSERT OR REPLACE INTO inventory_transactions
             (id, itemId, type, quantity, referenceId, createdAt, branch_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (tx) => [
      str(tx.id), str(tx.itemId, ''), str(tx.type, ''), num(tx.quantity, 0),
      str(tx.referenceId), str(tx.createdAt, nowIso()), str(tx.branchId ?? tx.branch_id), str(tx.notes),
    ],
  },

  'points-transactions': {
    table: 'points_transactions',
    upsert: `INSERT OR REPLACE INTO points_transactions
             (id, customerId, orderId, type, points, balance, createdAt, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (e) => [
      str(e.id), str(e.customerId, ''), str(e.orderId), str(e.type, ''), num(e.points, 0),
      num(e.balanceAfter ?? e.balance), str(e.createdAt, nowIso()), str(e.branchId ?? e.branch_id),
    ],
  },
};

async function readSnapshot(db) {
  const [orders, customers, inventory, menuItems, movements, branches] = await db.batch([
    db.prepare(`SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY createdAt DESC LIMIT ?`).bind(READ_LIMIT),
    db.prepare(`SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY points DESC LIMIT ?`).bind(READ_LIMIT),
    db.prepare(`SELECT * FROM inventory WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?`).bind(READ_LIMIT),
    db.prepare(`SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY category, name LIMIT ?`).bind(READ_LIMIT),
    // Cost of goods comes from this ledger rather than from recipes, so the portal reports
    // what each sale actually consumed even after its recipe is edited.
    db.prepare(`SELECT * FROM inventory_transactions ORDER BY createdAt DESC LIMIT ?`).bind(MOVEMENT_LIMIT),
    // The registry, so the portal can show a branch by name rather than by the id stamped
    // on its rows.
    db.prepare(`SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?`).bind(READ_LIMIT),
  ]);

  return {
    orders: orders.results || [],
    customers: customers.results || [],
    inventory: inventory.results || [],
    menuItems: menuItems.results || [],
    movements: movements.results || [],
    branches: branches.results || [],
    // Lets the portal show the age of what it is displaying rather than the age of its poll.
    serverTime: nowIso(),
  };
}

/**
 * The stored menu configuration, or null when nothing has been published yet.
 *
 * A row that will not parse is treated as absent rather than thrown on: the menu is a
 * customer-facing page, and serving it with default wording beats serving an error because
 * one JSON blob is corrupt.
 */
async function readMenuConfig(db) {
  try {
    const statement = db.prepare(`SELECT data FROM public_menu_config WHERE id = 'current' LIMIT 1`);
    if (!statement || typeof statement.first !== 'function') return null;
    const row = await statement.first();
    if (!row || !row.data) return null;
    const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.warn('[reports] Could not read the menu config:', String(e.message || e));
    return null;
  }
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/** The menu category stored on an item; the column packs `"<category>|<prep area>"`. */
function menuItemCategory(row) {
  const first = String(row.category || '').split('|')[0].trim();
  return first && first !== 'All' ? first : 'أخرى';
}

/**
 * The public menu: the items a customer may see, plus the configuration that describes them.
 *
 * Hiding is applied here and not only in the page, because a hidden item that still travels
 * in the response is visible to anyone who opens the endpoint directly — which is not what
 * the panel promises when it says an item is hidden from customers.
 */
async function readPublicMenu(db) {
  const config = await readMenuConfig(db);

  const statement = db.prepare(
    `SELECT id, name, description, price, category, image, available
     FROM menu_items
     WHERE deleted_at IS NULL AND (available = 1 OR available IS NULL)
     ORDER BY category, name LIMIT ?`
  ).bind(READ_LIMIT);
  const { results } = await statement.all();
  const rows = results || [];

  if (!config) return { menuItems: rows, config: null };

  const hiddenItems = new Set(stringList(config.hiddenItemIds));
  const hiddenCategories = new Set(
    (Array.isArray(config.categories) ? config.categories : [])
      .filter((rule) => rule && typeof rule === 'object' && rule.hidden === true)
      .map((rule) => String(rule.id))
  );

  const menuItems = rows.filter(
    (row) => !hiddenItems.has(String(row.id)) && !hiddenCategories.has(menuItemCategory(row))
  );

  return { menuItems, config };
}

/**
 * Stores the menu configuration under a single row.
 *
 * Capped on the serialised form: the record carries two inline images and is returned on
 * every menu view, so an oversized one is a cost paid by every customer, on every load. A
 * rejection here is marked as the caller's fault so the endpoint can answer 400, and leave
 * 500 to mean the database itself failed.
 */
async function savePublicMenuConfig(db, config) {
  if (!config || typeof config !== 'object') {
    throw rejected('config must be an object');
  }

  const serialized = JSON.stringify(config);
  if (serialized.length > MAX_MENU_CONFIG_CHARS) {
    throw rejected(`config must be at most ${MAX_MENU_CONFIG_CHARS} characters`);
  }

  await db.prepare(
    `INSERT OR REPLACE INTO public_menu_config (id, data, updated_at) VALUES (?, ?, ?)`
  ).bind('current', serialized, nowIso()).run();
}

/** An error caused by what the caller sent, rather than by this worker or its database. */
function rejected(message) {
  const error = new Error(message);
  error.isRejection = true;
  return error;
}

async function runMigration(db) {
  const tryExec = async (label, sql) => {
    try {
      await db.prepare(sql).run();
      return { label, ok: true };
    } catch (e) {
      const note = String(e.message || e);
      // A duplicate-column error means the column is already present, which is success.
      const ok = /duplicate column/i.test(note);
      return { label, ok, ...(ok ? {} : { note }) };
    }
  };

  const results = [];
  results.push(await tryExec('orders', `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, orderNumber TEXT, tableId TEXT, status TEXT,
    paymentStatus TEXT, paymentMethod TEXT, totalAmount REAL, grandTotal REAL, subtotal REAL,
    taxRate REAL, taxAmount REAL, paidAmount REAL, items TEXT, branch_id TEXT,
    customerPhone TEXT, pointsEarned REAL, pointsRedeemed REAL,
    createdAt TEXT, paidAt TEXT, updated_at TEXT, deleted_at TEXT
  )`));

  // CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so a column added
  // after the first deploy needs its own ALTER to reach an already-live database.
  for (const col of [
    'totalAmount REAL', 'paidAmount REAL', 'customerPhone TEXT',
    'pointsEarned REAL', 'pointsRedeemed REAL', 'paidAt TEXT',
  ]) {
    results.push(await tryExec(`orders.${col.split(' ')[0]}`, `ALTER TABLE orders ADD COLUMN ${col}`));
  }

  results.push(await tryExec('customers', `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT, phone TEXT, points REAL,
    createdAt TEXT, updated_at TEXT, deleted_at TEXT, branch_id TEXT
  )`));
  results.push(await tryExec('menu_items', `CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, price REAL, category TEXT,
    image TEXT, available INTEGER, branch_id TEXT, created_at TEXT,
    updated_at TEXT, deleted_at TEXT
  )`));
  results.push(await tryExec('inventory', `CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY, name TEXT, unit TEXT, stock REAL, minStock REAL,
    costPerUnit REAL, branch_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
  )`));
  results.push(await tryExec('inventory_transactions', `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY, itemId TEXT, type TEXT, quantity REAL,
    referenceId TEXT, createdAt TEXT, branch_id TEXT, notes TEXT
  )`));
  results.push(await tryExec('points_transactions', `CREATE TABLE IF NOT EXISTS points_transactions (
    id TEXT PRIMARY KEY, customerId TEXT, orderId TEXT, type TEXT,
    points REAL, balance REAL, createdAt TEXT, branch_id TEXT
  )`));
  results.push(await tryExec('branches', `CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT,
    active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT, deleted_at TEXT
  )`));
  // The public menu's identity and display rules, as one row. Created here rather than on
  // first write, so a publish either succeeds against a migrated database or fails loudly
  // instead of issuing DDL on a request path.
  results.push(await tryExec('public_menu_config', `CREATE TABLE IF NOT EXISTS public_menu_config (
    id TEXT PRIMARY KEY, data TEXT, updated_at TEXT
  )`));

  // One branch, inserted only when the table is empty. `INSERT OR IGNORE` on a fixed id would
  // resurrect the default after a manager renamed or removed it.
  results.push(
    await tryExec(
      'branches.seed',
      `INSERT INTO branches (id, name, active, created_at, updated_at)
       SELECT '${DEFAULT_BRANCH.id}', '${DEFAULT_BRANCH.name}', 1, '${nowIso()}', '${nowIso()}'
       WHERE NOT EXISTS (SELECT 1 FROM branches)`
    )
  );

  const failed = results.filter(r => !r.ok);
  return { results, failed };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'engaz-reports-proxy', time: nowIso() }, 200, origin);
    }

    const clientId = request.headers.get('CF-Connecting-IP') || 'unknown';
    const isLogin = url.pathname === '/auth/login';
    const limit = checkRateLimit(
      isLogin ? `login:${clientId}` : clientId,
      isLogin ? LOGIN_MAX_ATTEMPTS : RATE_MAX_REQUESTS
    );
    if (!limit.allowed) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(limit.retryAfter),
          ...corsHeaders(origin),
        },
      });
    }

    if (url.pathname === '/read/public-menu' || url.pathname === '/public-menu') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin, true);
      }
      try {
        const data = await readPublicMenu(env.DB);
        return json({ success: true, ...data }, 200, origin, true);
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 500, origin, true);
      }
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    let payload = {};
    if (request.headers.get('Content-Length') !== '0') {
      try {
        payload = await request.json();
      } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400, origin);
      }
    }

    // ─── Viewer sign-in ───
    if (isLogin) {
      if (!env.REPORTS_VIEWER_PASSWORD || !env.REPORTS_TOKEN_SECRET) {
        return json({ success: false, error: 'Viewer access is not configured' }, 503, origin);
      }
      if (!timingSafeEqual(String(payload.password || ''), env.REPORTS_VIEWER_PASSWORD)) {
        return json({ success: false, error: 'Invalid password' }, 401, origin);
      }
      const { token, expiresAt } = await issueViewerToken(env.REPORTS_TOKEN_SECRET);
      return json({ success: true, token, expiresAt }, 200, origin);
    }

    const writeKey = request.headers.get('X-API-Key');
    const hasWriteKey = Boolean(env.REPORTS_API_KEY) && timingSafeEqual(writeKey, env.REPORTS_API_KEY);

    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const hasViewerToken = env.REPORTS_TOKEN_SECRET
      ? await verifyViewerToken(env.REPORTS_TOKEN_SECRET, bearer)
      : false;

    // ─── Read: a viewer token is enough, and is all the portal ever holds ───
    if (url.pathname === '/read/snapshot') {
      if (!hasViewerToken && !hasWriteKey) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      try {
        return json({ success: true, ...(await readSnapshot(env.DB)) }, 200, origin);
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 500, origin);
      }
    }

    // ─── Branch registry: the one write a signed-in viewer may perform ───
    // It carries no sales figure and no customer detail, and the manager has to be able to
    // open a branch without a developer. The write key still works, so the desktop POS can
    // register its own till.
    if (url.pathname === '/branches/save') {
      if (!hasViewerToken && !hasWriteKey) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      const { branch, error } = parseBranch(payload.branch ?? payload);
      if (error) return json({ success: false, error }, 400, origin);
      try {
        await saveBranch(env.DB, branch);
        return json({ success: true, branch, branches: await readBranches(env.DB) }, 200, origin);
      } catch (err) {
        return json({ success: false, error: String(err.message || err) }, 500, origin);
      }
    }

    // ─── Everything below writes real data, so it needs the write key ───
    if (!hasWriteKey) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin);
    }

    if (url.pathname === '/public-menu-config' || url.pathname === '/save/public-menu-config') {
      try {
        await savePublicMenuConfig(env.DB, payload.config || payload);
        return json({ success: true }, 200, origin);
      } catch (err) {
        // A rejected configuration is the caller's input; anything else is a server fault
        // that must not be dressed up as a validation message.
        const status = err && err.isRejection ? 400 : 500;
        return json({ success: false, error: String(err.message || err) }, status, origin);
      }
    }

    if (url.pathname === '/migrate') {
      const { results, failed } = await runMigration(env.DB);
      return json({
        success: failed.length === 0,
        failedCount: failed.length,
        migrated: results,
      }, failed.length === 0 ? 200 : 500, origin);
    }

    try {
      const syncMatch = /^\/sync\/([a-z-]+)$/.exec(url.pathname);
      if (syncMatch) {
        const spec = SYNC_TABLES[syncMatch[1]];
        if (!spec) {
          return json({ success: false, error: `Unknown sync target: ${syncMatch[1]}` }, 404, origin);
        }
        const items = assertItems(payload.items);
        if (items.length === 0) return json({ success: true, written: 0 }, 200, origin);

        const statements = items.map((record) => {
          if (!record || !record.id) throw new Error('Every record needs an id');
          return env.DB.prepare(spec.upsert).bind(...spec.params(record));
        });
        await env.DB.batch(statements);
        return json({ success: true, written: statements.length }, 200, origin);
      }

      return json({ success: false, error: `Unknown endpoint: ${url.pathname}` }, 404, origin);
    } catch (err) {
      return json({ success: false, error: String(err.message || err) }, 500, origin);
    }
  },
};

// Exported for the test suite; not part of the HTTP surface.
export const __testing = {
  SYNC_TABLES,
  assertItems,
  MAX_BATCH,
  MOVEMENT_LIMIT,
  TOKEN_TTL_MS,
  LOGIN_MAX_ATTEMPTS,
  readSnapshot,
  readPublicMenu,
  savePublicMenuConfig,
  MAX_MENU_CONFIG_CHARS,
  readBranches,
  saveBranch,
  BRANCH_NAME_MAX,
};
