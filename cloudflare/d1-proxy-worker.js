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
 *   POST /pull/menu-items             { since? } → rows (tombstones included)
 *   POST /pull/customers              { since? } → rows (tombstones included)
 *   POST /pull/inventory              { since? } → rows (tombstones included)
 *   POST /read/menu-items             → live menu
 *   POST /read/manager-snapshot       → orders + customers + inventory
 *
 * Auth: X-API-Key header must match the WORKER_API_KEY secret.
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
} from './shared/common.js';

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
};

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
/** Legacy nonincremental reads. */
const READ_LIMIT = 1000;
/** Keep inline cashier avatars from making a pull page unboundedly large. */
const PULL_PAGE_SIZE = 25;
const MAX_AVATAR_CHARS = 400_000;

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

// Rate limiting, the timing-safe comparison, coercion, field bounds and rejections live in
// shared/common.js, alongside the reports worker's copies of the same functions.

/** Per-isolate rate-limit state. Shared by every request this isolate serves. */
const rateBuckets = new Map();

// The branch id is stamped on every row and compared literally in every filter. Its character
// rules are enforced where ids are created (the reports worker registry and the desktop
// identity form) — re-validating them here would strand any branch created before the rule
// existed, because its rows would fail every batch forever. Length is the part that is safe to
// check on the sync path: an oversized id can never belong to a real branch, and it would be
// copied onto every row the branch writes.
const BRANCH_ID_MAX = 40;

function branchIdOf(record) {
  const raw = str(record.branchId ?? record.branch_id);
  if (raw === null) return null;
  const id = raw.trim();
  if (id.length > BRANCH_ID_MAX) {
    throw rejected(`branchId must be at most ${BRANCH_ID_MAX} characters`);
  }
  return id;
}

function assertItems(items) {
  if (!Array.isArray(items)) throw rejected('Expected an "items" array');
  if (items.length > MAX_BATCH) throw rejected(`Too many records (max ${MAX_BATCH})`);
  return items;
}

function cashierName(value, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw rejected('Cashier name must be a string');
  const name = value.trim();
  if ((required && !name) || name.length > 60) throw rejected('Cashier name must be 1-60 characters');
  return name || null;
}

function cashierAvatar(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_AVATAR_CHARS ||
      !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i.test(value) ||
      value.endsWith(',')) {
    throw rejected(`Cashier avatar must be a raster base64 data URI of at most ${MAX_AVATAR_CHARS} characters`);
  }
  return value;
}

function recordUpdatedAt(record) {
  return str(record.updatedAt ?? record.updated_at ?? record.deletedAt ?? record.deleted_at,
    str(record.createdAt ?? record.created_at, nowIso()));
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
    upsert: `INSERT INTO menu_items (id, name, description, price, category, image, available, branch_id, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               price = excluded.price,
               category = excluded.category,
               image = excluded.image,
               available = excluded.available,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at,
               deleted_at = COALESCE(menu_items.deleted_at, excluded.deleted_at)
             WHERE excluded.updated_at > menu_items.updated_at OR menu_items.updated_at IS NULL
                OR (excluded.updated_at = menu_items.updated_at AND excluded.deleted_at IS NOT NULL AND menu_items.deleted_at IS NULL)`,
    upsertParams: (i) => [
      str(i.id),
      capped(str(i.name, ''), MAX_TEXT_BYTES),
      capped(str(i.description, ''), MAX_TEXT_BYTES),
      num(i.price, 0),
      capped(str(i.category, ''), MAX_TEXT_BYTES),
      capped(str(i.image, ''), MAX_IMAGE_BYTES),
      bool01(i.available),
      branchIdOf(i),
      recordUpdatedAt(i),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  orders: {
    table: 'orders',
    upsert: `INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, subtotal, taxRate, taxAmount, grandTotal, paidAmount, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, cashierName, cashierAvatar, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
               cashierName = excluded.cashierName,
               cashierAvatar = excluded.cashierAvatar,
               updated_at = excluded.updated_at,
               deleted_at = COALESCE(orders.deleted_at, excluded.deleted_at)
             WHERE excluded.updated_at > orders.updated_at OR orders.updated_at IS NULL
                OR (excluded.updated_at = orders.updated_at AND excluded.deleted_at IS NOT NULL AND orders.deleted_at IS NULL)`,
    upsertParams: (o) => [
      str(o.id),
      capped(str(o.orderNumber, ''), MAX_TEXT_BYTES),
      capped(str(o.tableId, ''), MAX_TEXT_BYTES),
      // The line items are the largest field an order carries and the one most likely to be
      // pathological. Truncating JSON would corrupt the order, so an oversized payload is
      // refused instead and the row stays unsynced rather than storing something unreadable.
      orderItemsJson(o.items),
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
      capped(str(o.customerPhone), MAX_TEXT_BYTES),
      num(o.pointsEarned, 0),
      num(o.pointsRedeemed, 0),
      branchIdOf(o),
      cashierName(o.cashierName),
      cashierAvatar(o.cashierAvatar),
      recordUpdatedAt(o),
      str(o.deletedAt ?? o.deleted_at),
    ],
  },

  customers: {
    table: 'customers',
    upsert: `INSERT INTO customers (id, name, phone, points, createdAt, branch_id, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               phone = excluded.phone,
               points = excluded.points,
               branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > customers.updated_at OR customers.updated_at IS NULL`,
    upsertParams: (c) => [
      str(c.id),
      capped(str(c.name, ''), MAX_TEXT_BYTES),
      capped(str(c.phone, ''), MAX_TEXT_BYTES),
      num(c.points, 0),
      str(c.createdAt, nowIso()),
      branchIdOf(c),
      recordUpdatedAt(c),
      str(c.deletedAt ?? c.deleted_at),
    ],
  },

  inventory: {
    table: 'inventory',
    upsert: `INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      capped(str(i.name, ''), MAX_TEXT_BYTES),
      capped(str(i.unit, ''), MAX_TEXT_BYTES),
      num(i.stock, 0),
      num(i.minStock, 0),
      num(i.costPerUnit, 0),
      branchIdOf(i),
      str(i.createdAt ?? i.created_at, nowIso()),
      recordUpdatedAt(i),
      str(i.deletedAt ?? i.deleted_at),
    ],
  },

  cashiers: {
    table: 'cashiers',
    upsert: `INSERT INTO cashiers (id, name, avatar, branch_id, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, avatar = excluded.avatar, branch_id = excluded.branch_id,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at > cashiers.updated_at OR cashiers.updated_at IS NULL`,
    upsertParams: (c) => [
      str(c.id), cashierName(c.name, true), cashierAvatar(c.avatar), branchIdOf(c),
      str(c.createdAt ?? c.created_at, nowIso()), recordUpdatedAt(c), str(c.deletedAt ?? c.deleted_at),
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
      capped(str(tx.referenceId), MAX_TEXT_BYTES),
      str(tx.createdAt, nowIso()),
      branchIdOf(tx),
      capped(str(tx.notes), MAX_TEXT_BYTES),
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
      capped(str(e.orderId), MAX_TEXT_BYTES),
      str(e.type, ''),
      num(e.points, 0),
      num(e.balanceAfter),
      str(e.createdAt, nowIso()),
      branchIdOf(e),
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
      // The tombstone must obey the same last-writer-wins rule as every upsert. Without the
      // timestamp predicate a branch that was offline, or any client with a skewed clock,
      // re-sending an old delete wipes a row another branch edited more recently.
      const effectiveAt = str(record.updatedAt ?? record.updated_at, deletedAt);
      statements.push(
        db.prepare(
          `UPDATE ${spec.table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR ? > updated_at)`
        ).bind(deletedAt, effectiveAt, str(record.id), effectiveAt)
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
 * Generic keyset-paginated pull.
 *
 * Supports:
 * - request: { since?: string, branchId?: string, cursor?: { updatedAt: string, id: string }, limit?: number }
 * - response: { rows: [...], nextCursor: { updatedAt: string, id: string } | null }
 *
 * Boundary handling:
 * - When no cursor is given and since is provided:
 *   WHERE updated_at >= since (inclusive boundary so same-millisecond rows aren't lost)
 * - When cursor is given ({ updatedAt, id }):
 *   WHERE (updated_at > cursor.updatedAt OR (updated_at = cursor.updatedAt AND id > cursor.id))
 * - Order: COALESCE(updated_at, '') ASC, id ASC
 * - Limit: query limit = pageSize + 1. If results.length > pageSize, nextCursor is taken from row[pageSize - 1], and row[pageSize] is dropped.
 */
export async function pullTableWithCursor(db, table, options = {}, defaultPageSize = PULL_PAGE_SIZE) {
  const { since, branchId, cursor, limit } = options || {};
  const pageSize = Math.min(Number(limit) > 0 ? Number(limit) : defaultPageSize, 100);
  const fetchLimit = pageSize + 1;

  const conditions = [];
  const bindings = [];

  const timeCol = (table === 'inventory_transactions' || table === 'points_transactions') ? 'createdAt' : 'updated_at';

  if (cursor && typeof cursor === 'object' && cursor.updatedAt != null && cursor.id != null) {
    conditions.push(`(${timeCol} > ? OR (${timeCol} = ? AND id > ?))`);
    bindings.push(str(cursor.updatedAt), str(cursor.updatedAt), str(cursor.id));
  } else if (since) {
    conditions.push(`${timeCol} >= ?`);
    bindings.push(str(since));
  }

  if (branchId) {
    conditions.push(`(branch_id = ? OR branch_id IS NULL)`);
    bindings.push(str(branchId));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM ${table} ${whereClause} ORDER BY COALESCE(${timeCol}, '') ASC, id ASC LIMIT ?`;
  bindings.push(fetchLimit);

  const stmt = db.prepare(sql).bind(...bindings);
  const { results } = await stmt.all();
  const rows = results || [];

  let nextCursor = null;
  if (rows.length > pageSize) {
    rows.pop();
    const lastRow = rows[rows.length - 1];
    nextCursor = {
      updatedAt: str(lastRow[timeCol]),
      id: str(lastRow.id),
    };
  }

  return { rows, nextCursor };
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

  // Base tables. The migration has always issued ALTER TABLE for the columns added after the
  // first deploy, and assumed the four core tables already existed -- so a fresh database
  // could not bootstrap itself. Make them idempotent: existing tables match the schema
  // exactly, and a missing table is created. CREATE TABLE IF NOT EXISTS is a no-op when the
  // shape already matches, so this is safe to re-run against a database that came from the
  // original schema.
  await tryExec('orders.table', `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    orderNumber TEXT, tableId TEXT, items TEXT,
    status TEXT DEFAULT 'New', paymentStatus TEXT DEFAULT 'Unpaid', paymentMethod TEXT,
    totalAmount REAL, subtotal REAL, taxRate REAL, taxAmount REAL, grandTotal REAL, paidAmount REAL,
    createdAt TEXT, paidAt TEXT, customerPhone TEXT,
    pointsEarned REAL DEFAULT 0, pointsRedeemed REAL DEFAULT 0,
    branch_id TEXT, cashierName TEXT, cashierAvatar TEXT,
    updated_at TEXT, deleted_at TEXT
  )`);
  await tryExec('customers.table', `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT, phone TEXT, points REAL DEFAULT 0,
    createdAt TEXT, branch_id TEXT,
    updated_at TEXT, deleted_at TEXT
  )`);
  await tryExec('menu_items.table', `CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT, description TEXT, price REAL, category TEXT,
    image TEXT, available INTEGER, branch_id TEXT,
    updated_at TEXT, deleted_at TEXT
  )`);
  await tryExec('inventory.table', `CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT, unit TEXT, stock REAL DEFAULT 0, minStock REAL DEFAULT 0, costPerUnit REAL DEFAULT 0,
    branch_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
  )`);

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
  await tryExec('orders.cashierName', 'ALTER TABLE orders ADD COLUMN cashierName TEXT');
  await tryExec('orders.cashierAvatar', 'ALTER TABLE orders ADD COLUMN cashierAvatar TEXT');
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

  // cashiers table & indexes
  await tryExec('cashiers.table', `CREATE TABLE IF NOT EXISTS cashiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    branch_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`);
  await tryExec('idx.cashiers_updated_at', 'CREATE INDEX IF NOT EXISTS idx_cashiers_updated_at ON cashiers(updated_at)');
  await tryExec('idx.cashiers_branch', 'CREATE INDEX IF NOT EXISTS idx_cashiers_branch ON cashiers(branch_id)');

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
    // Authentication is a synchronous header comparison, so it is settled here rather than
    // after the body is read: an authenticated caller can then be given the sync budget,
    // while traffic that has not identified itself stays on the anonymous one.
    const apiKey = request.headers.get('X-API-Key');
    const authenticated = Boolean(env.WORKER_API_KEY) && timingSafeEqual(apiKey, env.WORKER_API_KEY);

    const limit = checkRateLimit(
      clientId,
      budgetFor(
        env,
        authenticated ? 'SYNC_RATE_MAX_REQUESTS' : 'RATE_MAX_REQUESTS',
        authenticated ? SYNC_RATE_MAX_REQUESTS : RATE_MAX_REQUESTS
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
          ...corsHeaders(origin, env),
        },
      });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
    }

    if (!env.WORKER_API_KEY || !authenticated) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    if (url.pathname === '/migrate') {
      const { results, failed } = await runMigration(env.DB);
      return json({
        success: failed.length === 0,
        migration: '0004_self_bootstrap',
        failedCount: failed.length,
        results,
      }, failed.length === 0 ? 200 : 500, origin, env);
    }

    // Checked before the body is read: an authenticated caller sending a very large body
    // should be refused on the header, not after it has been buffered into the isolate.
    const declaredLength = Number(request.headers.get('Content-Length') || '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ success: false, error: 'Request body too large' }, 413, origin, env);
    }

    // Buffered rather than streamed, which is safe only because the limit above already
    // bounded it. Reading the text first also means a POST with no body — no Content-Length
    // at all when the client chunks — is an empty payload instead of a parse failure.
    const body = await request.text();
    // The header check above is skipped entirely by a chunked request, which declares no
    // Content-Length at all. Enforce the same ceiling on what actually arrived, before it is
    // handed to JSON.parse, so the limit holds whether or not the sender declares one.
    if (body.length > MAX_BODY_BYTES) {
      return json({ success: false, error: 'Request body too large' }, 413, origin, env);
    }

    let payload = {};
    if (body.trim()) {
      try {
        payload = JSON.parse(body);
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
        const { rows, nextCursor } = await pullTableWithCursor(env.DB, 'orders', payload, PULL_PAGE_SIZE);
        return json({ success: true, orders: rows, rows, nextCursor }, 200, origin, env);
      }

      if (url.pathname === '/pull/cashiers') {
        const { rows, nextCursor } = await pullTableWithCursor(env.DB, 'cashiers', payload, PULL_PAGE_SIZE);
        return json({ success: true, cashiers: rows, rows, nextCursor }, 200, origin, env);
      }

      // Pull for shared tables: menu items, customers, inventory. Tombstones included so
      // deletions made on one branch propagate to every other branch.
      const pullSharedMatch = /^\/pull\/(menu-items|customers|inventory)$/.exec(url.pathname);
      if (pullSharedMatch) {
        const table = SYNC_TABLES[pullSharedMatch[1]].table;
        const { rows, nextCursor } = await pullTableWithCursor(env.DB, table, payload, 100);
        return json({ success: true, rows, nextCursor }, 200, origin, env);
      }

      if (url.pathname === '/pull/inventory-transactions') {
        const { rows, nextCursor } = await pullTableWithCursor(env.DB, 'inventory_transactions', payload, 100);
        return json({ success: true, rows, nextCursor }, 200, origin, env);
      }

      if (url.pathname === '/pull/points-transactions') {
        const { rows, nextCursor } = await pullTableWithCursor(env.DB, 'points_transactions', payload, 100);
        return json({ success: true, rows, nextCursor }, 200, origin, env);
      }

      if (url.pathname === '/read/menu-items') {
        return json({ success: true, ...(await readMenuItems(env.DB)) }, 200, origin, env);
      }

      if (url.pathname === '/read/manager-snapshot') {
        return json({ success: true, ...(await readManagerSnapshot(env.DB)) }, 200, origin, env);
      }

      return json({ success: false, error: `Unknown endpoint: ${url.pathname}` }, 404, origin, env);
    } catch (err) {
      const status = (err && (err.isRejection || /rejection|expected|too many|must be/i.test(String(err.message || '')))) ? 400 : 500;
      return json({ success: false, error: String(err.message || err) }, status, origin, env);
    }
  },
};

// Exported for the test suite; not part of the HTTP surface.
export const __testing = {
  SYNC_TABLES, buildSyncStatements, assertItems, MAX_BATCH, RATE_MAX_REQUESTS, PULL_PAGE_SIZE,
  pullTableWithCursor, MAX_TEXT_BYTES, MAX_IMAGE_BYTES, MAX_JSON_BYTES, MAX_BODY_BYTES,
  BRANCH_ID_MAX,
  SYNC_RATE_MAX_REQUESTS, budgetFor,
};
