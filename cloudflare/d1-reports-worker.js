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
 *   POST /branches/delete             { id } → soft-delete one branch (token or write key)
 *
 * The branch registry is the one thing a signed-in viewer may write. It holds no sales figure
 * and no customer detail: only the identity of a till, which is what the manager has to be
 * able to add without a developer. Every other write still needs REPORTS_API_KEY.
 *
 * Secrets: REPORTS_API_KEY (write), REPORTS_VIEWER_PASSWORD, REPORTS_TOKEN_SECRET.
 */

import {
  timingSafeEqual,
  checkRateLimit,
  budgetFor,
  RATE_MAX_REQUESTS,
  SYNC_RATE_MAX_REQUESTS,
  str,
  num,
  bool01,
  nowIso,
  capped,
  orderItemsJson,
  rejected,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_JSON_BYTES,
  MAX_BODY_BYTES,
  MAX_PUBLIC_IMAGE_TOTAL_BYTES,
  boundInlineImages,
  omitFields,
  clientError,
  countWritten,
  summariseBatch,
} from './shared/common.js';
import { buildSyncBatch, executeSyncBatch } from './shared/sync.js';

// Re-exported so the test suite and anything else importing from this module keeps working.
export {
  timingSafeEqual,
  checkRateLimit,
  budgetFor,
  RATE_MAX_REQUESTS,
  SYNC_RATE_MAX_REQUESTS,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_JSON_BYTES,
  MAX_BODY_BYTES,
  MAX_PUBLIC_IMAGE_TOTAL_BYTES,
  boundInlineImages,
  omitFields,
};

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
/**
 * Bodies are buffered into the isolate before they are authenticated, so an unauthenticated
 * caller can make the worker pay for a large upload just by sending one. The header check is
 * the only defence that costs nothing — it runs before a single byte is read.
 *
 * Writes here are orders and their line items. A generous order is a few kilobytes, so 2 MB
 * leaves a wide margin while still bounding the isolate. (MAX_BODY_BYTES, shared/common.js.)
 */
/** Viewer sessions are short: the portal re-authenticates rather than holding a long token. */
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * A token that may rewrite the branch registry lives a fraction as long as a read token.
 * Registry edits are a few clicks at the start of a day, not a session-long activity, so the
 * cost of re-authenticating is negligible next to the window it closes.
 */
const WRITE_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Per-isolate rate-limit state. Shared by every request this isolate serves. */
const rateBuckets = new Map();

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

// The login endpoint gets a much tighter budget than reads, because it is the one path
// where guessing pays off.
const LOGIN_MAX_ATTEMPTS = 10;

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

/**
 * Mints a token.
 *
 * `scope` is the point of the exercise. A single `read` scope used to authorise
 * `/branches/save` and `/branches/delete`, so the token the portal holds "for viewing" could
 * rewrite the branch registry — and with no `jti`, no revocation list and an eight-hour life,
 * there was no way to take it back once it leaked.
 *
 * A `jti` is minted on every token so that revocation can be added later against a stored
 * deny-list without changing the token format or invalidating every live session.
 */
export async function issueViewerToken(secret, { scope = 'read', now = Date.now() } = {}) {
  const expiresAt = now + (scope === 'write' ? WRITE_TOKEN_TTL_MS : TOKEN_TTL_MS);
  const claims = {
    scope,
    expiresAt,
    jti: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await hmac(secret, payload);
  return { token: `${payload}.${signature}`, expiresAt };
}

/**
 * Verifies a token and reports the scope it actually carries.
 *
 * Returns the scope string, or `null` when the token is absent, forged, malformed or expired.
 * Callers compare against the scope they need rather than asking a yes/no question: a single
 * `hasViewerToken` boolean is what allowed a read token to satisfy a write check.
 */
export async function verifyViewerToken(secret, token, now = Date.now()) {
  if (typeof secret !== 'string' || !secret || typeof token !== 'string' || token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token) || !Number.isFinite(now)) return null;
  const [payload, signature] = token.split('.');

  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    const scopeOk = claims.scope === 'read' || claims.scope === 'write';
    if (!scopeOk || typeof claims.expiresAt !== 'number' || now >= claims.expiresAt) return null;
    return claims.scope;
  } catch {
    return null;
  }
}

// Coercion, field bounds and rejections live in shared/common.js. This database is a mirror
// of the POS one, so a record the POS worker refuses or trims must be refused or trimmed
// identically here — sharing the functions is what guarantees that, where matching constants
// only promised it.

function assertItems(items) {
  if (!Array.isArray(items)) throw rejected('Expected an "items" array');
  if (items.length > MAX_BATCH) throw rejected(`Too many records (max ${MAX_BATCH})`);
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

/** A branch id parsed from a delete request, or an error explaining the rejection. */
export function parseBranchId(input) {
  // Accept either `{ id }` (the documented shape) or a bare string for clients that post
  // the id directly, the way `parseBranch` accepts either `branch` or a flat object.
  const raw = typeof input === 'string' ? input : input?.id;
  const id = String(raw ?? '').trim().toLowerCase();
  if (!BRANCH_ID_PATTERN.test(id)) {
    return { error: 'Branch id must be 1-40 characters of a-z, 0-9, dash or underscore' };
  }
  return { id };
}

function branchRegistryStatements(db) {
  return [
    db.prepare(`SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY name, id LIMIT ?`).bind(READ_LIMIT + 1),
    db.prepare(`SELECT id FROM branches WHERE deleted_at IS NOT NULL ORDER BY id LIMIT ?`).bind(READ_LIMIT + 1),
  ];
}

function completeBranchRegistry(live, deleted) {
  // Missing results and a full probe page are not an empty/complete registry. Fail rather
  // than let the portal mistake an omitted tombstone for an unregistered till.
  for (const result of [live, deleted]) {
    if (!result || result.success === false || !Array.isArray(result.results)) {
      throw new Error('Branch registry could not be read completely');
    }
    if (result.results.length > READ_LIMIT) {
      throw new Error(`Branch registry exceeds its read cap (${READ_LIMIT}); a complete registry is required`);
    }
  }
  return { branches: live.results, deletedBranchIds: deleted.results.map((row) => row.id) };
}

async function readBranches(db) {
  const [live, deleted] = await db.batch(branchRegistryStatements(db));
  return completeBranchRegistry(live, deleted);
}

async function saveBranch(db, branch) {
  const saved = await db
    .prepare(
      `INSERT INTO branches (id, name, phone, address, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, phone = excluded.phone, address = excluded.address,
         active = excluded.active, updated_at = excluded.updated_at
       WHERE branches.deleted_at IS NULL
       RETURNING id`
    )
    .bind(branch.id, branch.name, branch.phone, branch.address, branch.active, nowIso(), nowIso())
    .first();
  // The conditional write is atomic: a concurrent delete cannot be silently renamed or
  // restored between a separate existence check and the upsert.
  if (!saved) throw rejected('This branch id was deleted and is reserved; choose a new id');
}

/**
 * Hides one registry entry by stamping `deleted_at`. Historical business rows and future
 * POS mirror writes are unchanged: this is not a POS access or synchronization switch.
 */
async function deleteBranch(db, id) {
  const result = await db
    .prepare(`UPDATE branches SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowIso(), nowIso(), id)
    .run();
  // Without a row check the portal reported a deletion that changed nothing: an id from a
  // stale tab, or one someone else already removed, came back as success and hid the fact
  // that the registry never changed. saveBranch already uses RETURNING for the same reason.
  const changes = result?.meta?.changes;
  if (!Number.isSafeInteger(changes) || changes < 1) {
    throw rejected(`No branch with id "${id}"`);
  }
}

// ─── Mirror targets ──────────────────────────────────────────────────────────
// Mirror writes from the POS. Mutable tables use Last-Write-Wins (LWW) conflict
// resolution based on updated_at so delayed or out-of-order writes never overwrite
// newer data, and tombstones (deleted_at) are preserved. Append-only ledger tables
// use INSERT OR IGNORE.

const SYNC_TABLES = {
  'menu-items': {
    table: 'menu_items',
    upsert: `INSERT INTO menu_items
             (id, name, description, price, category, image, available, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               price = excluded.price,
               category = excluded.category,
               image = excluded.image,
               available = excluded.available,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > menu_items.updated_at OR menu_items.updated_at IS NULL
                OR (excluded.updated_at = menu_items.updated_at AND excluded.deleted_at IS NOT NULL AND menu_items.deleted_at IS NULL)`,
    params: (i) => [
      str(i.id), capped(str(i.name, ''), MAX_TEXT_BYTES), capped(str(i.description, ''), MAX_TEXT_BYTES),
      num(i.price, 0), capped(str(i.category, ''), MAX_TEXT_BYTES),
      // Same coercion as the POS worker: the string "false" arrives over form data and
      // replays, and truthiness would store it as available=1 — an item the manager
      // unpublished would reappear on the public menu through the mirror path.
      capped(str(i.image, ''), MAX_IMAGE_BYTES), bool01(i.available), str(i.branchId ?? i.branch_id),
      str(i.createdAt ?? i.created_at, nowIso()), str(i.updatedAt ?? i.updated_at, nowIso()),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  orders: {
    table: 'orders',
    upsert: `INSERT INTO orders
             (id, orderNumber, tableId, status, paymentStatus, paymentMethod, totalAmount,
              grandTotal, subtotal, taxRate, taxAmount, paidAmount, items, branch_id,
              customerPhone, pointsEarned, pointsRedeemed, cashierName, cashierAvatar, createdAt, paidAt, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               orderNumber = excluded.orderNumber,
               tableId = excluded.tableId,
               status = excluded.status,
               paymentStatus = excluded.paymentStatus,
               paymentMethod = excluded.paymentMethod,
               totalAmount = excluded.totalAmount,
               grandTotal = excluded.grandTotal,
               subtotal = excluded.subtotal,
               taxRate = excluded.taxRate,
               taxAmount = excluded.taxAmount,
               paidAmount = excluded.paidAmount,
               items = excluded.items,
               branch_id = excluded.branch_id,
               customerPhone = excluded.customerPhone,
               pointsEarned = excluded.pointsEarned,
               pointsRedeemed = excluded.pointsRedeemed,
               cashierName = excluded.cashierName,
               cashierAvatar = excluded.cashierAvatar,
               paidAt = excluded.paidAt,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > orders.updated_at OR orders.updated_at IS NULL
                OR (excluded.updated_at = orders.updated_at AND excluded.deleted_at IS NOT NULL AND orders.deleted_at IS NULL)`,
    params: (o) => [
      str(o.id), capped(str(o.orderNumber, ''), MAX_TEXT_BYTES), capped(str(o.tableId, ''), MAX_TEXT_BYTES),
      str(o.status, 'New'),
      str(o.paymentStatus, 'Unpaid'), str(o.paymentMethod), num(o.totalAmount, 0),
      num(o.grandTotal), num(o.subtotal), num(o.taxRate), num(o.taxAmount), num(o.paidAmount),
      orderItemsJson(o.items),
      str(o.branchId ?? o.branch_id), capped(str(o.customerPhone), MAX_TEXT_BYTES),
      num(o.pointsEarned, 0), num(o.pointsRedeemed, 0),
      capped(str(o.cashierName), MAX_TEXT_BYTES), capped(str(o.cashierAvatar), MAX_IMAGE_BYTES),
      str(o.createdAt, nowIso()), str(o.paidAt),
      str(o.updatedAt ?? o.updated_at, nowIso()), str(o.deletedAt ?? o.deleted_at),
    ],
  },

  customers: {
    table: 'customers',
    upsert: `INSERT INTO customers
             (id, name, phone, points, createdAt, updated_at, deleted_at, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               phone = excluded.phone,
               points = excluded.points,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > customers.updated_at OR customers.updated_at IS NULL`,
    params: (c) => [
      str(c.id), capped(str(c.name, ''), MAX_TEXT_BYTES), capped(str(c.phone, ''), MAX_TEXT_BYTES),
      num(c.points, 0),
      str(c.createdAt, nowIso()), str(c.updatedAt ?? c.updated_at, nowIso()),
      str(c.deletedAt ?? c.deleted_at), str(c.branchId ?? c.branch_id),
    ],
  },

  inventory: {
    table: 'inventory',
    upsert: `INSERT INTO inventory
             (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               unit = excluded.unit,
               stock = excluded.stock,
               minStock = excluded.minStock,
               costPerUnit = excluded.costPerUnit,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > inventory.updated_at OR inventory.updated_at IS NULL`,
    params: (i) => [
      str(i.id), capped(str(i.name, ''), MAX_TEXT_BYTES), capped(str(i.unit, ''), MAX_TEXT_BYTES),
      num(i.stock, 0), num(i.minStock, 0),
      num(i.costPerUnit, 0), str(i.branchId ?? i.branch_id),
      str(i.createdAt ?? i.created_at, nowIso()), str(i.updatedAt ?? i.updated_at, nowIso()),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  cashiers: {
    table: 'cashiers',
    upsert: `INSERT INTO cashiers
             (id, name, avatar, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               avatar = excluded.avatar,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.updated_at > cashiers.updated_at OR cashiers.updated_at IS NULL`,
    params: (c) => [
      str(c.id), capped(str(c.name, ''), MAX_TEXT_BYTES), capped(str(c.avatar), MAX_IMAGE_BYTES),
      str(c.branchId ?? c.branch_id),
      str(c.createdAt ?? c.created_at, nowIso()), str(c.updatedAt ?? c.updated_at, nowIso()),
      str(c.deletedAt ?? c.deleted_at),
    ],
  },

  'inventory-transactions': {
    table: 'inventory_transactions',
    upsert: `INSERT OR IGNORE INTO inventory_transactions
             (id, itemId, type, quantity, referenceId, createdAt, branch_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (tx) => [
      str(tx.id), str(tx.itemId, ''), str(tx.type, ''), num(tx.quantity, 0),
      capped(str(tx.referenceId), MAX_TEXT_BYTES), str(tx.createdAt, nowIso()),
      str(tx.branchId ?? tx.branch_id), capped(str(tx.notes), MAX_TEXT_BYTES),
    ],
  },

  'points-transactions': {
    table: 'points_transactions',
    upsert: `INSERT OR IGNORE INTO points_transactions
             (id, customerId, orderId, type, points, balance, createdAt, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: (e) => [
      str(e.id), str(e.customerId, ''), capped(str(e.orderId), MAX_TEXT_BYTES), str(e.type, ''),
      num(e.points, 0),
      num(e.balanceAfter ?? e.balance), str(e.createdAt, nowIso()), str(e.branchId ?? e.branch_id),
    ],
  },
};

/**
 * One page of rows, and whether the table held more than the page.
 *
 * Every query asks for one row past its cap. That extra row is the cheapest possible
 * truncation signal: it needs no COUNT to keep in step with the WHERE clause, and no second
 * round trip. Without it a full restaurant's dashboard shows a revenue total computed over a
 * thousand orders, presented with the same confidence as a complete one.
 */
function paged(result, limit) {
  const rows = (result && result.results) || [];
  if (rows.length <= limit) return { rows, truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
}

async function readSnapshot(db) {
  // `limit + 1` is deliberate: the extra row is a probe, never shown.
  const [orders, customers, inventory, menuItems, movements, branches, deletedBranches] = await db.batch([
    db.prepare(`SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY createdAt DESC LIMIT ?`).bind(READ_LIMIT + 1),
    db.prepare(`SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY points DESC LIMIT ?`).bind(READ_LIMIT + 1),
    db.prepare(`SELECT * FROM inventory WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?`).bind(READ_LIMIT + 1),
    db.prepare(`SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY category, name LIMIT ?`).bind(READ_LIMIT + 1),
    // Cost of goods comes from this ledger rather than from recipes, so the portal reports
    // what each sale actually consumed even after its recipe is edited.
    db.prepare(`SELECT * FROM inventory_transactions ORDER BY createdAt DESC LIMIT ?`).bind(MOVEMENT_LIMIT + 1),
    // Read both registry sets in the same batch as the business rows.
    ...branchRegistryStatements(db),
  ]);
  const registry = completeBranchRegistry(branches, deletedBranches);

  const page = {
    orders: paged(orders, READ_LIMIT),
    customers: paged(customers, READ_LIMIT),
    inventory: paged(inventory, READ_LIMIT),
    menuItems: paged(menuItems, READ_LIMIT),
    movements: paged(movements, MOVEMENT_LIMIT),
  };

  // The portal renders tables and charts; it never draws an avatar or a product photo. Both
  // columns are the largest things in the database and `SELECT *` was carrying every one of
  // them on every poll, so they are dropped here rather than at the query — the query stays
  // `SELECT *`, which is what keeps it correct when a column is added later.
  return {
    orders: omitFields(page.orders.rows, ['cashierAvatar']),
    customers: omitFields(page.customers.rows, ['avatar']),
    inventory: page.inventory.rows,
    menuItems: omitFields(page.menuItems.rows, ['image']),
    movements: page.movements.rows,
    ...registry,
    /** Collections that hit their cap, so the portal never presents a partial total as final. */
    truncated: Object.fromEntries(
      Object.entries(page).filter(([, p]) => p.truncated).map(([key]) => [key, true])
    ),
    // Lets the portal show the age of what it is displaying rather than the age of its poll.
    serverTime: nowIso(),
  };
}

/**
 * The stored menu configuration, and whether it is safe to rely on.
 *
 * Three outcomes, and the difference between them is the whole reason this is not a plain
 * `null`:
 *
 * - `empty` — nothing has ever been published, so nothing is hidden and every item may show.
 * - `ok` — the configuration was read and its hidden-item rules can be applied.
 * - `unreadable` — a configuration exists but could not be understood. The hidden set is
 *   unknown, which is *not* the same as empty.
 *
 * Collapsing `unreadable` into `empty` publishes whatever the manager was hiding: a corrupt
 * blob or one failed database read would silently un-hide every hidden item and every hidden
 * category on a page anyone can open.
 */
async function readMenuConfig(db) {
  let row;
  try {
    const statement = db.prepare(`SELECT data FROM public_menu_config WHERE id = 'current' LIMIT 1`);
    if (!statement || typeof statement.first !== 'function') return { status: 'empty' };
    row = await statement.first();
  } catch (e) {
    console.warn('[reports] Could not read the menu config row:', String(e.message || e));
    return { status: 'unreadable' };
  }

  if (!row || !row.data) return { status: 'empty' };

  try {
    const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (!parsed || typeof parsed !== 'object') return { status: 'unreadable' };
    return { status: 'ok', config: parsed };
  } catch (e) {
    console.warn('[reports] Stored menu config is not valid JSON:', String(e.message || e));
    return { status: 'unreadable' };
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
  const stored = await readMenuConfig(db);

  // Fails closed. If the hidden set cannot be read there is no safe subset to serve: showing
  // everything would publish what the manager hid, and there is no way to tell which rows
  // those were. An empty menu is a visible, recoverable outage; a leaked one is silent.
  if (stored.status === 'unreadable') {
    return { menuItems: [], config: null, unavailable: true };
  }

  const statement = db.prepare(
    `SELECT id, name, description, price, category, image, available
     FROM menu_items
     WHERE deleted_at IS NULL AND (available = 1 OR available IS NULL)
     ORDER BY category, name LIMIT ?`
  ).bind(READ_LIMIT);
  const { results } = await statement.all();
  const rows = results || [];

  // No published configuration at all: nothing is hidden yet, so every available item shows.
  if (stored.status === 'empty') return { menuItems: rows, config: null };

  const config = stored.config;
  const hiddenItems = new Set(stringList(config.hiddenItemIds));
  const hiddenCategories = new Set(
    (Array.isArray(config.categories) ? config.categories : [])
      .filter((rule) => rule && typeof rule === 'object' && rule.hidden === true)
      .map((rule) => String(rule.id))
  );

  const visible = rows.filter(
    (row) => !hiddenItems.has(String(row.id)) && !hiddenCategories.has(menuItemCategory(row))
  );

  // This endpoint is unauthenticated, so its response size is chosen by whoever last edited
  // the menu, not by this worker. A thousand items each carrying a 400 kB photo is ~400 MB —
  // far past what an isolate may hold — so the tail of the menu loses its pictures once the
  // budget is spent. The items themselves still appear, which is the side that matters to a
  // customer reading the menu.
  const { rows: menuItems, imagesTruncated } = boundInlineImages(
    visible,
    'image',
    MAX_PUBLIC_IMAGE_TOTAL_BYTES
  );

  return { menuItems, config, imagesTruncated };
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
    cashierName TEXT, cashierAvatar TEXT, createdAt TEXT, paidAt TEXT, updated_at TEXT, deleted_at TEXT
  )`));

  // CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so a column added
  // after the first deploy needs its own ALTER to reach an already-live database.
  for (const col of [
    'totalAmount REAL', 'paidAmount REAL', 'customerPhone TEXT',
    'pointsEarned REAL', 'pointsRedeemed REAL', 'cashierName TEXT', 'cashierAvatar TEXT', 'paidAt TEXT',
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
  results.push(await tryExec('cashiers', `CREATE TABLE IF NOT EXISTS cashiers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, branch_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`));
  results.push(await tryExec('idx.cashiers_updated_at', 'CREATE INDEX IF NOT EXISTS idx_cashiers_updated_at ON cashiers(updated_at)'));
  results.push(await tryExec('idx.cashiers_branch', 'CREATE INDEX IF NOT EXISTS idx_cashiers_branch ON cashiers(branch_id)'));

  // The portal's snapshot query sorts and filters orders by created_at/branch_id, and the
  // mirror's own upserts look rows up by updated_at. These were the only large tables with no
  // index at all, so every poll scanned them.
  results.push(await tryExec('idx.orders_created', 'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(createdAt)'));
  results.push(await tryExec('idx.orders_updated_at', 'CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at)'));
  results.push(await tryExec('idx.orders_branch', 'CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id)'));
  results.push(await tryExec('idx.customers_updated_at', 'CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at)'));
  results.push(await tryExec('idx.customers_branch', 'CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch_id)'));
  results.push(await tryExec('idx.menu_items_updated_at', 'CREATE INDEX IF NOT EXISTS idx_menu_items_updated_at ON menu_items(updated_at)'));
  results.push(await tryExec('idx.menu_items_branch', 'CREATE INDEX IF NOT EXISTS idx_menu_items_branch ON menu_items(branch_id)'));
  results.push(await tryExec('idx.inventory_updated_at', 'CREATE INDEX IF NOT EXISTS idx_inventory_updated_at ON inventory(updated_at)'));
  results.push(await tryExec('idx.inventory_branch', 'CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory(branch_id)'));
  results.push(await tryExec('idx.inv_tx_created', 'CREATE INDEX IF NOT EXISTS idx_inv_tx_created ON inventory_transactions(createdAt)'));
  results.push(await tryExec('idx.inv_tx_branch', 'CREATE INDEX IF NOT EXISTS idx_inv_tx_branch ON inventory_transactions(branch_id)'));
  results.push(await tryExec('idx.points_tx_created', 'CREATE INDEX IF NOT EXISTS idx_points_tx_created ON points_transactions(createdAt)'));
  results.push(await tryExec('idx.points_tx_branch', 'CREATE INDEX IF NOT EXISTS idx_points_tx_branch ON points_transactions(branch_id)'));
  results.push(await tryExec('idx.branches_deleted', 'CREATE INDEX IF NOT EXISTS idx_branches_deleted ON branches(deleted_at)'));
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

    // The write key is a synchronous header comparison, so it can be settled before the
    // limiter runs rather than after the body is read. That lets the budget be chosen by
    // whether the caller has already authenticated, while still metering anonymous traffic.
    const writeKey = request.headers.get('X-API-Key');
    const hasWriteKey = Boolean(env.REPORTS_API_KEY) && timingSafeEqual(writeKey, env.REPORTS_API_KEY);

    const limit = checkRateLimit(
      isLogin ? `login:${clientId}` : clientId,
      isLogin
        ? LOGIN_MAX_ATTEMPTS
        : budgetFor(
            env,
            hasWriteKey ? 'SYNC_RATE_MAX_REQUESTS' : 'RATE_MAX_REQUESTS',
            hasWriteKey ? SYNC_RATE_MAX_REQUESTS : RATE_MAX_REQUESTS
          ),
      Date.now(),
      rateBuckets
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
        // 503, not 200 with an empty list: the menu is momentarily withheld on purpose, and a
        // caller that caches a 200 would keep showing an empty menu after it recovers.
        if (data.unavailable) {
          return json(
            { success: false, error: 'Menu configuration is unavailable', menuItems: [] },
            503, origin, true
          );
        }
        return json({ success: true, ...data }, 200, origin, true);
      } catch (err) {
        return json({ success: false, error: clientError(err, 500) }, 500, origin, true);
      }
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    // Deliberately before authentication: the size of a body is decided by the sender, not by
    // who they claim to be, and refusing on the header costs nothing.
    const declaredLength = Number(request.headers.get('Content-Length') || '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ success: false, error: 'Request body too large' }, 413, origin);
    }

    // Buffered rather than streamed, safe only because the limit above already bounded it.
    // Reading the text first also means a POST with no body — no Content-Length at all when
    // the client chunks — is an empty payload instead of a parse failure.
    const body = await request.text();
    // The header check above is skipped entirely by a chunked request, which declares no
    // Content-Length at all. Enforce the same ceiling on what actually arrived, before it is
    // handed to JSON.parse, so the limit holds whether or not the sender declares one.
    if (body.length > MAX_BODY_BYTES) {
      return json({ success: false, error: 'Request body too large' }, 413, origin);
    }

    let payload = {};
    if (body.trim()) {
      try {
        payload = JSON.parse(body);
      } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400, origin);
      }
    }

    // ─── Viewer sign-in ───
    if (isLogin) {
      if (!env.REPORTS_VIEWER_PASSWORD || !env.REPORTS_TOKEN_SECRET) {
        return json({ success: false, error: 'Viewer access is not configured' }, 503, origin);
      }
      // Two passwords, two scopes. The write one is optional only in the sense that a
      // deployment which has not split them yet keeps handing out write tokens — because
      // until it is configured there is no second secret to present, and refusing would
      // take the branch screen away from every existing portal on deploy. Once it is set,
      // the viewer password buys read-only access and only this one grants registry writes.
      const wantsWrite = Boolean(env.REPORTS_BRANCH_PASSWORD);
      const password = String(payload.password || '');
      const readOk = timingSafeEqual(password, env.REPORTS_VIEWER_PASSWORD);
      const writeOk = wantsWrite
        ? timingSafeEqual(password, env.REPORTS_BRANCH_PASSWORD)
        : readOk;

      if (!readOk && !writeOk) {
        return json({ success: false, error: 'Invalid password' }, 401, origin);
      }

      const { token, expiresAt } = await issueViewerToken(env.REPORTS_TOKEN_SECRET, {
        scope: writeOk ? 'write' : 'read',
      });
      return json({ success: true, token, expiresAt, scope: writeOk ? 'write' : 'read' }, 200, origin);
    }

    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const tokenScope = env.REPORTS_TOKEN_SECRET
      ? await verifyViewerToken(env.REPORTS_TOKEN_SECRET, bearer)
      : null;
    const hasViewerToken = tokenScope !== null;
    // Registry writes need the write scope, not merely a valid token. There is deliberately
    // no fallback to "any valid token when REPORTS_BRANCH_PASSWORD is unset": that made the
    // split optional, so a deployment that never set the secret kept handing a read-only
    // viewer the branch registry, and the one control separating them was whatever the
    // operator happened to configure. The secret is what makes 'write' reachable at all
    // (see the login path above), so requiring it here cannot lock anyone out.
    const canEditBranches = hasWriteKey || tokenScope === 'write';

    // ─── Read: a viewer token is enough, and is all the portal ever holds ───
    if (url.pathname === '/read/snapshot') {
      if (!hasViewerToken && !hasWriteKey) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      try {
        return json({ success: true, ...(await readSnapshot(env.DB)) }, 200, origin);
      } catch (err) {
        return json({ success: false, error: clientError(err, 500) }, 500, origin);
      }
    }

    // ─── Branch registry: the one write a signed-in viewer may perform ───
    // It carries no sales figure and no customer detail, and the manager has to be able to
    // open a branch without a developer. The write key still works, so the desktop POS can
    // register its own till.
    if (url.pathname === '/branches/save') {
      if (!canEditBranches) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      const { branch, error } = parseBranch(payload.branch ?? payload);
      if (error) return json({ success: false, error }, 400, origin);
      try {
        await saveBranch(env.DB, branch);
        return json({ success: true, branch, ...(await readBranches(env.DB)) }, 200, origin);
      } catch (err) {
        return json({ success: false, error: clientError(err, err.isRejection ? 409 : 500) }, err.isRejection ? 409 : 500, origin);
      }
    }

    // Hide a registry entry only. No business rows, POS access, or mirror writes change.
    if (url.pathname === '/branches/delete') {
      if (!canEditBranches) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      const { id, error } = parseBranchId(payload);
      if (error) return json({ success: false, error }, 400, origin);
      try {
        await deleteBranch(env.DB, id);
        return json({ success: true, id, ...(await readBranches(env.DB)) }, 200, origin);
      } catch (err) {
        return json({ success: false, error: clientError(err, 500) }, 500, origin);
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
        return json({ success: false, error: clientError(err, status) }, status, origin);
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

        // Same executor, and therefore the same receipt, as the POS worker. The desktop
        // marks a record synced only when the worker names it in `acknowledged`, so a
        // mirror answering with aggregate counts alone left every record unsynced forever —
        // the reports-only path (no POS key configured) then never made progress at all.
        return json(await executeSyncBatch(env.DB, buildSyncBatch(env.DB, spec, items)), 200, origin);
      }

      return json({ success: false, error: `Unknown endpoint: ${url.pathname}` }, 404, origin);
    } catch (err) {
      // Bad input is the caller's fault, not the server's: answering 500 for it puts
      // ordinary rejections in the same bucket as real outages.
      const status = err && err.isRejection ? 400 : 500;
      return json({ success: false, error: clientError(err, status) }, status, origin);
    }
  },
};

// Exported for the test suite; not part of the HTTP surface.
export const __testing = {
  SYNC_TABLES,
  buildSyncBatch,
  countWritten,
  summariseBatch,
  assertItems,
  MAX_BATCH,
  MOVEMENT_LIMIT,
  TOKEN_TTL_MS,
  LOGIN_MAX_ATTEMPTS,
  readSnapshot,
  readPublicMenu,
  savePublicMenuConfig,
  MAX_MENU_CONFIG_CHARS,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_JSON_BYTES,
  MAX_BODY_BYTES,
  SYNC_RATE_MAX_REQUESTS,
  RATE_MAX_REQUESTS,
  budgetFor,
  readBranches,
  saveBranch,
  deleteBranch,
  BRANCH_NAME_MAX,
};
