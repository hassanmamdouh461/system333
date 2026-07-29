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
const FORBIDDEN = /\b(ATTACH|DETACH|PRAGMA|VACUUM|DROP\s+TABLE|ALTER\s+TABLE)\b/i;

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
