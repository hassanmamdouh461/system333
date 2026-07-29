/**
 * BrewMaster D1 Proxy Worker
 * ─────────────────────────────────────────────────────────────
 * Secure SQL proxy between:
 *   • Desktop POS (Electron branches) → pushes unsynced records
 *   • Manager Web Portal (manager.engaz.tech) → reads analytics
 * and the Cloudflare D1 database (brewmaster-db).
 *
 * Endpoints:
 *   POST /        { sql, params? }        → single query
 *   POST /        { batch: [{sql, params}] } → transaction batch
 *   GET  /health  → liveness check
 *
 * Auth: X-API-Key header must match the WORKER_API_KEY secret.
 */

const ALLOWED_ORIGINS = [
  'https://manager.engaz.tech',
  'https://engaz.tech',
  'https://www.engaz.tech',
  'http://localhost:5173',
  'http://localhost:4173',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ─── Basic SQL guardrails ────────────────────────────────────
const FORBIDDEN = /\b(ATTACH|DETACH|PRAGMA|VACUUM|DROP\s+TABLE|DROP\s+INDEX|ALTER\s+TABLE)\b/i;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Liveness
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'brewmaster-d1-proxy', time: new Date().toISOString() }, 200, origin);
    }

    // ─── One-time idempotent schema migration (Issues 18, 20, 25, 26, 27) ───
    // GET or POST /migrate with the API key. Safe to call repeatedly.
    if (url.pathname === '/migrate') {
      const migKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
      if (!env.WORKER_API_KEY || migKey !== env.WORKER_API_KEY) {
        return json({ success: false, error: 'Unauthorized' }, 401, origin);
      }
      const results = [];
      const tryExec = async (label, sql) => {
        try {
          await env.DB.prepare(sql).run();
          results.push({ label, ok: true });
        } catch (e) {
          results.push({ label, ok: false, note: String(e.message || e) });
        }
      };

      // orders: updated_at + tax snapshot + soft delete
      await tryExec('orders.updated_at', "ALTER TABLE orders ADD COLUMN updated_at TEXT");
      await tryExec('orders.subtotal', "ALTER TABLE orders ADD COLUMN subtotal REAL");
      await tryExec('orders.taxRate', "ALTER TABLE orders ADD COLUMN taxRate REAL");
      await tryExec('orders.taxAmount', "ALTER TABLE orders ADD COLUMN taxAmount REAL");
      await tryExec('orders.grandTotal', "ALTER TABLE orders ADD COLUMN grandTotal REAL");
      await tryExec('orders.customerPhone', "ALTER TABLE orders ADD COLUMN customerPhone TEXT");
      await tryExec('orders.pointsEarned', "ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0");
      await tryExec('orders.pointsRedeemed', "ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0");
      await tryExec('orders.deleted_at', "ALTER TABLE orders ADD COLUMN deleted_at TEXT");
      await tryExec('orders.updated_at_backfill', "UPDATE orders SET updated_at = createdAt WHERE updated_at IS NULL");

      // customers / menu_items / inventory: updated_at + soft delete
      await tryExec('customers.updated_at', "ALTER TABLE customers ADD COLUMN updated_at TEXT");
      await tryExec('customers.deleted_at', "ALTER TABLE customers ADD COLUMN deleted_at TEXT");
      await tryExec('customers.updated_at_backfill', "UPDATE customers SET updated_at = createdAt WHERE updated_at IS NULL");
      await tryExec('menu_items.updated_at', "ALTER TABLE menu_items ADD COLUMN updated_at TEXT");
      await tryExec('menu_items.deleted_at', "ALTER TABLE menu_items ADD COLUMN deleted_at TEXT");

      // inventory movements + loyalty ledger tables
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

      // indexes for incremental sync
      await tryExec('idx.orders_updated_at', "CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at)");
      await tryExec('idx.orders_branch', "CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id)");
      await tryExec('idx.inv_tx_item', "CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(itemId)");

      return json({ success: true, migration: '0002_sync_integrity', results }, 200, origin);
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    // ─── Auth ───
    const apiKey = request.headers.get('X-API-Key');
    if (!env.WORKER_API_KEY || apiKey !== env.WORKER_API_KEY) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, 400, origin);
    }

    try {
      // ─── Batch mode (transaction) ───
      if (Array.isArray(payload.batch)) {
        if (payload.batch.length === 0) return json({ success: true, result: [] }, 200, origin);
        if (payload.batch.length > 200) {
          return json({ success: false, error: 'Batch too large (max 200)' }, 400, origin);
        }
        const stmts = payload.batch.map((q) => {
          if (!q.sql || FORBIDDEN.test(q.sql)) throw new Error('Forbidden SQL in batch');
          let stmt = env.DB.prepare(q.sql);
          if (Array.isArray(q.params) && q.params.length) stmt = stmt.bind(...q.params);
          return stmt;
        });
        const result = await env.DB.batch(stmts);
        return json({ success: true, result }, 200, origin);
      }

      // ─── Single query mode ───
      if (payload.sql) {
        if (FORBIDDEN.test(payload.sql)) {
          return json({ success: false, error: 'Forbidden SQL' }, 400, origin);
        }
        let stmt = env.DB.prepare(payload.sql);
        if (Array.isArray(payload.params) && payload.params.length) {
          stmt = stmt.bind(...payload.params);
        }
        const result = await stmt.all();
        // Shape matches what the desktop client expects: result[0].results
        return json({ success: true, result: [result] }, 200, origin);
      }

      return json({ success: false, error: 'Missing sql or batch' }, 400, origin);
    } catch (err) {
      return json({ success: false, error: String(err.message || err) }, 500, origin);
    }
  },
};
