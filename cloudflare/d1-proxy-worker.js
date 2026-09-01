/**
 * Engaz D1 Proxy Worker
 * ─────────────────────────────────────────────────────────────
 * Named-endpoint API between:
 *   • Desktop POS (Electron branches) → pushes unsynced records, pulls remote changes
 *   • Manager Web Portal              → reads analytics
 * and the Cloudflare D1 database (engaz-db).
 *
 * Every SQL statement in this file is written here, server side. Clients send data, not
 * queries. The previous shape accepted a SQL string from the client and tried to police it
 * with a regex allowlist — which made a hand-written parser the only thing standing between
 * an API key and the whole database.
 *
 * Endpoints (all POST unless noted, all key-gated except /health):
 *   GET  /health                      → liveness
 *   POST /migrate                     → idempotent schema migration
 *   POST /sync/menu-items             { items: [...] }
 *   POST /sync/orders                 { items: [...] }
 *   POST /sync/customers              { items: [...] }
 *   POST /sync/inventory              { items: [...] }
 *   POST /sync/inventory-transactions { items: [...] }
 *   POST /sync/points-transactions    { items: [...] }
 *   POST /pull/orders                 { since?, branchId? }
 *   POST /read/menu-items             → live menu
 *   POST /read/manager-snapshot       → orders + customers + inventory
 *
 * Auth: X-API-Key header must match the WORKER_API_KEY secret.
 */

const PROD_ORIGINS = [
  'https://manager.engaz.tech',
  'https://pos.engaz.tech',
  'https://engaz.tech',
  'https://www.engaz.tech',
];

// Local dev origins are only allowed when the deployment explicitly opts in via the
// ALLOW_DEV_ORIGINS binding. Leaving them permanently allow-listed meant any page a user
// opened on those ports could make credentialed calls against the production database.
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
];

/** Largest number of records one sync call may carry. */
const MAX_BATCH = 200;
/** Rows returned by a single read endpoint. */
const READ_LIMIT = 1000;

function allowedOrigins(env) {
  return env && String(env.ALLOW_DEV_ORIGINS) === 'true'
    ? [...PROD_ORIGINS, ...DEV_ORIGINS]
    : PROD_ORIGINS;
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allowed = list.includes(origin) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
    // Without Vary an intermediate cache can serve one origin's CORS header to another.
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin = '*', env = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) },
  });
}

/** Length-independent comparison so the key check does not leak length via timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return diff === 0;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Fixed window per client IP, held in isolate memory. Cloudflare may run several isolates
// per colo, so the effective ceiling is a multiple of this — it is a brake on scripted
// abuse, not a precise quota. A precise one needs a Durable Object; this needs no binding
// and cannot fail open.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const rateBuckets = new Map();

export function checkRateLimit(clientId, now = Date.now(), buckets = rateBuckets) {
  const bucket = buckets.get(clientId);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Drop expired buckets so a long-lived isolate cannot grow unboundedly.
    if (buckets.size > 10_000) {
      for (const [id, b] of buckets) if (now >= b.resetAt) buckets.delete(id);
    }
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > RATE_MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

// ─── Input coercion ──────────────────────────────────────────────────────────
// Values arrive over the network and go straight into bind parameters. D1 rejects
// undefined and objects, and a NaN would be stored as a number that poisons every sum
// downstream, so each field is coerced to the exact type its column expects.

function str(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool01(value) {
  return value ? 1 : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function assertItems(items) {
  if (!Array.isArray(items)) throw new Error('Expected an "items" array');
  if (items.length > MAX_BATCH) throw new Error(`Too many records (max ${MAX_BATCH})`);
  return items;
}

// ─── Sync statement builders ─────────────────────────────────────────────────
// Upserts are conflict-guarded rather than INSERT OR REPLACE. SQLite implements OR REPLACE
// as delete-then-insert, which wiped cloud-only columns — notably deleted_at, resurrecting
// rows another branch had deleted — and let a stale local row overwrite newer cloud data.
// The WHERE clause makes every write last-writer-wins on updated_at instead.
//
// Deletions are soft. A hard-deleted row can never appear in an incremental
// `updated_at > ?` pull, so sibling branches would never learn about the deletion.

const SYNC_TABLES = {
  'menu-items': {
    table: 'menu_items',
    upsert: `INSERT INTO menu_items (id, name, description, price, category, image, available, branch_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               price = excluded.price,
               category = excluded.category,
               image = excluded.image,
               available = excluded.available,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > menu_items.updated_at OR menu_items.updated_at IS NULL`,
    upsertParams: (i) => [
      str(i.id),
      str(i.name, ''),
      str(i.description, ''),
      num(i.price, 0),
      str(i.category, ''),
      str(i.image, ''),
      bool01(i.available),
      str(i.branchId ?? i.branch_id),
      str(i.updatedAt ?? i.updated_at, nowIso()),
    ],
  },

  orders: {
    table: 'orders',
    upsert: `INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, subtotal, taxRate, taxAmount, grandTotal, paidAmount, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               orderNumber = excluded.orderNumber,
               tableId = excluded.tableId,
               items = excluded.items,
               status = excluded.status,
               paymentStatus = excluded.paymentStatus,
               paymentMethod = excluded.paymentMethod,
               totalAmount = excluded.totalAmount,
               subtotal = excluded.subtotal,
               taxRate = excluded.taxRate,
               taxAmount = excluded.taxAmount,
               grandTotal = excluded.grandTotal,
               paidAmount = excluded.paidAmount,
               paidAt = excluded.paidAt,
               customerPhone = excluded.customerPhone,
               pointsEarned = excluded.pointsEarned,
               pointsRedeemed = excluded.pointsRedeemed,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > orders.updated_at OR orders.updated_at IS NULL`,
    upsertParams: (o) => [
      str(o.id),
      str(o.orderNumber, ''),
      str(o.tableId, ''),
      typeof o.items === 'string' ? o.items : JSON.stringify(o.items ?? []),
      str(o.status, 'New'),
      str(o.paymentStatus, 'Unpaid'),
      str(o.paymentMethod),
      num(o.totalAmount, 0),
      num(o.subtotal),
      num(o.taxRate),
      num(o.taxAmount),
      num(o.grandTotal),
      num(o.paidAmount),
      str(o.createdAt, nowIso()),
      str(o.paidAt),
      str(o.customerPhone),
      num(o.pointsEarned, 0),
      num(o.pointsRedeemed, 0),
      str(o.branchId ?? o.branch_id),
      str(o.updatedAt ?? o.updated_at, nowIso()),
    ],
  },

  customers: {
    table: 'customers',
    upsert: `INSERT INTO customers (id, name, phone, points, createdAt, branch_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               phone = excluded.phone,
               points = excluded.points,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > customers.updated_at OR customers.updated_at IS NULL`,
    upsertParams: (c) => [
      str(c.id),
      str(c.name, ''),
      str(c.phone, ''),
      num(c.points, 0),
      str(c.createdAt, nowIso()),
      str(c.branchId ?? c.branch_id),
      str(c.updatedAt ?? c.updated_at, nowIso()),
    ],
  },

  inventory: {
    table: 'inventory',
    upsert: `INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               unit = excluded.unit,
               stock = excluded.stock,
               minStock = excluded.minStock,
               costPerUnit = excluded.costPerUnit,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > inventory.updated_at OR inventory.updated_at IS NULL`,
    upsertParams: (i) => [
      str(i.id),
      str(i.name, ''),
      str(i.unit, ''),
      num(i.stock, 0),
      num(i.minStock, 0),
      num(i.costPerUnit, 0),
      str(i.branchId ?? i.branch_id),
      str(i.createdAt ?? i.created_at, nowIso()),
      str(i.updatedAt ?? i.updated_at, nowIso()),
    ],
  },

  // Ledger tables are append-only: an entry is immutable once written, so a duplicate id
  // is a re-send and is ignored rather than overwriting the original.
  'inventory-transactions': {
    table: 'inventory_transactions',
    appendOnly: true,
    upsert: `INSERT OR IGNORE INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    upsertParams: (tx) => [
      str(tx.id),
      str(tx.itemId, ''),
      str(tx.type, ''),
      num(tx.quantity, 0),
      str(tx.referenceId),
      str(tx.createdAt, nowIso()),
      str(tx.branchId ?? tx.branch_id),
      str(tx.notes),
    ],
  },

  'points-transactions': {
    table: 'points_transactions',
    appendOnly: true,
    upsert: `INSERT OR IGNORE INTO points_transactions (id, customerId, orderId, type, points, balanceAfter, createdAt, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    upsertParams: (e) => [
      str(e.id),
      str(e.customerId, ''),
      str(e.orderId),
      str(e.type, ''),
      num(e.points, 0),
      num(e.balanceAfter),
      str(e.createdAt, nowIso()),
      str(e.branchId ?? e.branch_id),
    ],
  },
};

function isDeleted(record) {
  return Boolean(record.deletedAt ?? record.deleted_at);
}

/** Builds the prepared statements for one sync call. */
function buildSyncStatements(db, spec, items) {
  const statements = [];

  for (const record of items) {
    if (!record || !record.id) throw new Error('Every record needs an id');

    if (!spec.appendOnly && isDeleted(record)) {
      const deletedAt = str(record.deletedAt ?? record.deleted_at);
      statements.push(
        db.prepare(`UPDATE ${spec.table} SET deleted_at = ?, updated_at = ? WHERE id = ?`)
          .bind(deletedAt, str(record.updatedAt ?? record.updated_at, deletedAt), str(record.id))
      );
      continue;
    }

    statements.push(db.prepare(spec.upsert).bind(...spec.upsertParams(record)));
  }

  return statements;
}

// ─── Read handlers ───────────────────────────────────────────────────────────

async function readMenuItems(db) {
  const { results } = await db
    .prepare(`SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY category, name LIMIT ?`)
    .bind(READ_LIMIT)
    .all();
  return { menuItems: results || [] };
}

async function readManagerSnapshot(db) {
  // Soft-deleted rows are tombstones, not live records; they must not be counted in
  // revenue or stock.
  const [orders, customers, inventory] = await db.batch([
    db.prepare(`SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY createdAt DESC LIMIT ?`).bind(READ_LIMIT),
    db.prepare(`SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY createdAt DESC LIMIT ?`).bind(READ_LIMIT),
    db.prepare(`SELECT * FROM inventory WHERE deleted_at IS NULL ORDER BY name ASC LIMIT ?`).bind(READ_LIMIT),
  ]);

  return {
    orders: orders.results || [],
    customers: customers.results || [],
    inventory: inventory.results || [],
  };
}

/**
 * Incremental pull: only rows changed since the caller's high-water mark, scoped to its
 * branch plus rows with no branch (shared records).
 */
async function pullOrders(db, { since, branchId }) {
  const sinceValue = str(since);
  const branchValue = str(branchId);

  let stmt;
  if (sinceValue && branchValue) {
    stmt = db.prepare(
      `SELECT * FROM orders WHERE updated_at > ? AND (branch_id = ? OR branch_id IS NULL)
       ORDER BY updated_at ASC LIMIT ?`
    ).bind(sinceValue, branchValue, READ_LIMIT);
  } else if (sinceValue) {
    stmt = db.prepare(
      `SELECT * FROM orders WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`
    ).bind(sinceValue, READ_LIMIT);
  } else if (branchValue) {
    stmt = db.prepare(
      `SELECT * FROM orders WHERE branch_id = ? OR branch_id IS NULL
       ORDER BY updated_at ASC LIMIT ?`
    ).bind(branchValue, READ_LIMIT);
  } else {
    stmt = db.prepare(`SELECT * FROM orders ORDER BY updated_at ASC LIMIT ?`).bind(READ_LIMIT);
  }

  const { results } = await stmt.all();
  return { orders: results || [] };
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function runMigration(db) {
  const results = [];
  const tryExec = async (label, sql) => {
    try {
      await db.prepare(sql).run();
      results.push({ label, ok: true });
    } catch (e) {
      const note = String(e.message || e);
      // A duplicate-column error means the column is already there, which is the goal.
      const ok = /duplicate column/i.test(note);
      results.push({ label, ok, ...(ok ? {} : { note }) });
    }
  };

  // orders: tax snapshot + collected amount + loyalty + soft delete
  await tryExec('orders.updated_at', 'ALTER TABLE orders ADD COLUMN updated_at TEXT');
  await tryExec('orders.subtotal', 'ALTER TABLE orders ADD COLUMN subtotal REAL');
  await tryExec('orders.taxRate', 'ALTER TABLE orders ADD COLUMN taxRate REAL');
  await tryExec('orders.taxAmount', 'ALTER TABLE orders ADD COLUMN taxAmount REAL');
  await tryExec('orders.grandTotal', 'ALTER TABLE orders ADD COLUMN grandTotal REAL');
  // What the till collected, which is below grandTotal when loyalty points paid part of it.
  await tryExec('orders.paidAmount', 'ALTER TABLE orders ADD COLUMN paidAmount REAL');
  await tryExec('orders.customerPhone', 'ALTER TABLE orders ADD COLUMN customerPhone TEXT');
  await tryExec('orders.pointsEarned', 'ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0');
  await tryExec('orders.pointsRedeemed', 'ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0');
  await tryExec('orders.deleted_at', 'ALTER TABLE orders ADD COLUMN deleted_at TEXT');
  await tryExec('orders.updated_at_backfill', 'UPDATE orders SET updated_at = createdAt WHERE updated_at IS NULL');

  // customers / menu_items / inventory: updated_at + soft delete
  await tryExec('customers.updated_at', 'ALTER TABLE customers ADD COLUMN updated_at TEXT');
  await tryExec('customers.deleted_at', 'ALTER TABLE customers ADD COLUMN deleted_at TEXT');
  await tryExec('customers.updated_at_backfill', 'UPDATE customers SET updated_at = createdAt WHERE updated_at IS NULL');
  await tryExec('menu_items.updated_at', 'ALTER TABLE menu_items ADD COLUMN updated_at TEXT');
  await tryExec('menu_items.deleted_at', 'ALTER TABLE menu_items ADD COLUMN deleted_at TEXT');
  await tryExec('inventory.deleted_at', 'ALTER TABLE inventory ADD COLUMN deleted_at TEXT');

  await tryExec('inventory_transactions.table', `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    referenceId TEXT,
    createdAt TEXT NOT NULL,
    branch_id TEXT,
    notes TEXT
  )`);
  await tryExec('points_transactions.table', `CREATE TABLE IF NOT EXISTS points_transactions (
    id TEXT PRIMARY KEY,
    customerId TEXT NOT NULL,
    orderId TEXT,
    type TEXT NOT NULL,
    points REAL NOT NULL,
    balanceAfter REAL,
    createdAt TEXT NOT NULL,
    branch_id TEXT
  )`);

  await tryExec('idx.orders_updated_at', 'CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at)');
  await tryExec('idx.orders_branch', 'CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id)');
  await tryExec('idx.inv_tx_item', 'CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(itemId)');

  const failed = results.filter(r => !r.ok);
  return { results, failed };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'engaz-d1-proxy', time: nowIso() }, 200, origin, env);
    }

    const clientId = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limit = checkRateLimit(clientId);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(limit.retryAfter),
          ...corsHeaders(origin, env),
        },
      });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
    }

    const apiKey = request.headers.get('X-API-Key');
    if (!env.WORKER_API_KEY || !timingSafeEqual(apiKey, env.WORKER_API_KEY)) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    if (url.pathname === '/migrate') {
      const { results, failed } = await runMigration(env.DB);
      return json({
        success: failed.length === 0,
        migration: '0003_named_endpoints',
        failedCount: failed.length,
        results,
      }, failed.length === 0 ? 200 : 500, origin, env);
    }

    let payload = {};
    if (request.headers.get('Content-Length') !== '0') {
      try {
        payload = await request.json();
      } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400, origin, env);
      }
    }

    try {
      const syncMatch = /^\/sync\/([a-z-]+)$/.exec(url.pathname);
      if (syncMatch) {
        const spec = SYNC_TABLES[syncMatch[1]];
        if (!spec) {
          return json({ success: false, error: `Unknown sync target: ${syncMatch[1]}` }, 404, origin, env);
        }
        const items = assertItems(payload.items);
        if (items.length === 0) return json({ success: true, written: 0 }, 200, origin, env);

        const statements = buildSyncStatements(env.DB, spec, items);
        await env.DB.batch(statements);
        return json({ success: true, written: statements.length }, 200, origin, env);
      }

      if (url.pathname === '/pull/orders') {
        return json({ success: true, ...(await pullOrders(env.DB, payload)) }, 200, origin, env);
      }

      if (url.pathname === '/read/menu-items') {
        return json({ success: true, ...(await readMenuItems(env.DB)) }, 200, origin, env);
      }

      if (url.pathname === '/read/manager-snapshot') {
        return json({ success: true, ...(await readManagerSnapshot(env.DB)) }, 200, origin, env);
      }

      return json({ success: false, error: `Unknown endpoint: ${url.pathname}` }, 404, origin, env);
    } catch (err) {
      return json({ success: false, error: String(err.message || err) }, 500, origin, env);
    }
  },
};

// Exported for the test suite; not part of the HTTP surface.
export const __testing = { SYNC_TABLES, buildSyncStatements, assertItems, MAX_BATCH, RATE_MAX_REQUESTS };
