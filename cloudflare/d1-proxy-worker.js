/**
 * BrewMaster Cloud API Worker (v2 — secure)
 * ─────────────────────────────────────────────────────────────
 * Secure API between:
 *   • Desktop POS (Electron branches) → authenticated sync push/pull
 *   • Manager Web Portal              → authenticated analytics reads
 * and the Cloudflare D1 database (brewmaster-db).
 *
 * What changed vs the old raw-SQL proxy:
 *   • No raw SQL from clients. Only explicit endpoints with fixed statements.
 *   • Users authenticate with email/password (PBKDF2-SHA256) → signed JWT.
 *   • Branch POS devices authenticate with per-branch API keys (api_keys table).
 *   • Every data query is force-scoped to the caller's branch (managers see all).
 *   • Rate limiting per identity. CORS rejects unknown origins.
 *
 * Endpoints:
 *   GET  /health                  → liveness (no auth)
 *   POST /auth/login              → { email, password } → { token, user }
 *   POST /auth/change-password    → JWT, { currentPassword, newPassword }
 *   GET  /analytics/orders        → JWT (manager)
 *   GET  /analytics/customers     → JWT (manager)
 *   GET  /analytics/inventory     → JWT (manager)
 *   GET  /menu/public             → public read of menu_items (QR menu)
 *   POST /sync/push               → API key, { table, records[] }  (tables: menu_items, orders, customers, inventory)
 *   POST /sync/pull-orders        → API key, { since? } → orders of THIS branch (updated/created after `since`)
 *   POST /sync/delete-menu-item   → API key, { id } (branch-scoped delete)
 *
 * Secrets (wrangler secret put …):
 *   JWT_SECRET   — HMAC key for session tokens (REQUIRED, no default)
 *
 * D1 schema: see cloudflare/schema.sql (users, api_keys + data tables).
 */

// ─── CORS ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://manager.engaz.tech',
  'https://engaz.tech',
  'https://www.engaz.tech',
  'http://localhost:5173',
  'http://localhost:4173',
];

function corsHeaders(origin) {
  // FIX(security): unknown origins get NO CORS allowance (previously fell back
  // to the first allowed origin, which handed valid CORS headers to any site).
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
      'Access-Control-Max-Age': '86400',
    };
  }
  return {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ─── Crypto helpers (Web Crypto — no npm deps on Workers) ────
const PBKDF2_ITERATIONS = 100000;

function hexEncode(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexDecode(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return hexEncode(bits);
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  const actual = await hashPassword(password, saltHex);
  return timingSafeEqualHex(actual, expectedHashHex);
}

async function sha256Hex(text) {
  return hexEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// ─── Minimal JWT (HS256) ─────────────────────────────────────
function b64urlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signJwt(payload, secret, ttlSeconds = 12 * 60 * 60) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const unsigned = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(body))}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64urlEncode(signature)}`;
}

async function verifyJwt(token, secret) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[2]), new TextEncoder().encode(unsigned));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Rate limiting (fixed window, in-memory per isolate) ─────
const rateBuckets = new Map();
const RATE_LIMIT = 120;        // requests
const RATE_WINDOW_MS = 60000;  // per minute

function checkRateLimit(identity) {
  const now = Date.now();
  let bucket = rateBuckets.get(identity);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(identity, bucket);
  }
  bucket.count += 1;
  // Opportunistic cleanup so the map doesn't grow forever
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (now - v.start > RATE_WINDOW_MS) rateBuckets.delete(k);
  }
  return bucket.count <= RATE_LIMIT;
}

// ─── Auth helpers ────────────────────────────────────────────
async function requireJwt(request, env, origin) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = await verifyJwt(token, env.JWT_SECRET || '');
  if (!payload) return { error: json({ success: false, error: 'Unauthorized' }, 401, origin) };
  return { payload };
}

async function requireBranchKey(request, env, origin) {
  const apiKey = request.headers.get('X-API-Key') || '';
  if (!apiKey) return { error: json({ success: false, error: 'Missing API key' }, 401, origin) };
  const keyHash = await sha256Hex(apiKey);
  const row = await env.DB.prepare(
    'SELECT branch_id FROM api_keys WHERE key_hash = ? AND (revoked IS NULL OR revoked = 0)'
  ).bind(keyHash).first();
  if (!row) return { error: json({ success: false, error: 'Invalid API key' }, 401, origin) };
  return { branchId: row.branch_id };
}

// ─── Sync table whitelist ────────────────────────────────────
const SYNC_TABLES = {
  menu_items: {
    columns: ['id', 'name', 'description', 'price', 'category', 'image', 'available', 'branch_id'],
    numeric: ['price', 'available'],
    boolean: ['available'],
  },
  orders: {
    columns: ['id', 'orderNumber', 'tableId', 'items', 'status', 'paymentStatus', 'paymentMethod', 'totalAmount', 'createdAt', 'paidAt', 'branch_id'],
    numeric: ['totalAmount'],
    jsonText: ['items'],
  },
  customers: {
    columns: ['id', 'name', 'phone', 'points', 'createdAt', 'branch_id'],
    numeric: ['points'],
  },
  inventory: {
    columns: ['id', 'name', 'unit', 'stock', 'minStock', 'costPerUnit', 'branch_id', 'created_at', 'updated_at'],
    numeric: ['stock', 'minStock', 'costPerUnit'],
  },
};

const MAX_BATCH_RECORDS = 200;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Liveness — no auth, no data
    if (path === '/health') {
      return json({ ok: true, service: 'brewmaster-cloud-api', version: 2, time: new Date().toISOString() }, 200, origin);
    }

    // ─── Public QR menu (read-only, branch-agnostic) ───
    if (path === '/menu/public' && request.method === 'GET') {
      if (!checkRateLimit(`pub:${request.headers.get('CF-Connecting-IP') || 'anon'}`)) {
        return json({ success: false, error: 'Rate limit exceeded' }, 429, origin);
      }
      try {
        const result = await env.DB.prepare(
          'SELECT id, name, description, price, category, image, available FROM menu_items ORDER BY category, name LIMIT 500'
        ).all();
        return json({ success: true, result: result.results || [] }, 200, origin);
      } catch (err) {
        return json({ success: false, error: 'Failed to load menu' }, 500, origin);
      }
    }

    // ─── Auth: login ───
    if (path === '/auth/login' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      if (!checkRateLimit(`login:${ip}`)) {
        return json({ success: false, error: 'Too many attempts — try again later' }, 429, origin);
      }
      let body;
      try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400, origin); }
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return json({ success: false, error: 'Email and password are required' }, 400, origin);

      try {
        const user = await env.DB.prepare(
          'SELECT id, email, name, role, branch_id, branch_name, password_hash, password_salt FROM users WHERE email = ?'
        ).bind(email).first();
        if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
          return json({ success: false, error: 'Invalid credentials' }, 401, origin);
        }
        const token = await signJwt(
          { sub: user.id, role: user.role, branch_id: user.branch_id, branch_name: user.branch_name, name: user.name, email: user.email },
          env.JWT_SECRET || ''
        );
        return json({
          success: true,
          token,
          user: { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branch_id, branchName: user.branch_name },
        }, 200, origin);
      } catch (err) {
        return json({ success: false, error: 'Login failed' }, 500, origin);
      }
    }

    // ─── Auth: change password (JWT required) ───
    if (path === '/auth/change-password' && request.method === 'POST') {
      const { payload, error } = await requireJwt(request, env, origin);
      if (error) return error;
      let body;
      try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400, origin); }
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) {
        return json({ success: false, error: 'New password must be at least 8 characters' }, 400, origin);
      }
      try {
        const user = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').bind(payload.sub).first();
        if (!user || !(await verifyPassword(currentPassword, user.password_salt, user.password_hash))) {
          return json({ success: false, error: 'Current password is incorrect' }, 401, origin);
        }
        const newSalt = hexEncode(crypto.getRandomValues(new Uint8Array(16)));
        const newHash = await hashPassword(newPassword, newSalt);
        await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
          .bind(newHash, newSalt, payload.sub).run();
        return json({ success: true }, 200, origin);
      } catch (err) {
        return json({ success: false, error: 'Password change failed' }, 500, origin);
      }
    }

    // ─── Manager analytics (JWT + manager role) ───
    if (path.startsWith('/analytics/')) {
      const { payload, error } = await requireJwt(request, env, origin);
      if (error) return error;
      if (payload.role !== 'manager') {
        return json({ success: false, error: 'Manager role required' }, 403, origin);
      }
      if (!checkRateLimit(`jwt:${payload.sub}`)) {
        return json({ success: false, error: 'Rate limit exceeded' }, 429, origin);
      }
      try {
        if (path === '/analytics/orders' && request.method === 'GET') {
          const result = await env.DB.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 1000').all();
          return json({ success: true, result: result.results || [] }, 200, origin);
        }
        if (path === '/analytics/customers' && request.method === 'GET') {
          const result = await env.DB.prepare('SELECT * FROM customers ORDER BY createdAt DESC LIMIT 1000').all();
          return json({ success: true, result: result.results || [] }, 200, origin);
        }
        if (path === '/analytics/inventory' && request.method === 'GET') {
          const result = await env.DB.prepare('SELECT * FROM inventory ORDER BY name ASC LIMIT 1000').all();
          return json({ success: true, result: result.results || [] }, 200, origin);
        }
        return json({ success: false, error: 'Unknown analytics endpoint' }, 404, origin);
      } catch (err) {
        return json({ success: false, error: 'Analytics query failed' }, 500, origin);
      }
    }

    // ─── Branch sync (per-branch API key) ───
    if (path.startsWith('/sync/')) {
      const { branchId, error } = await requireBranchKey(request, env, origin);
      if (error) return error;
      if (!checkRateLimit(`key:${branchId}`)) {
        return json({ success: false, error: 'Rate limit exceeded' }, 429, origin);
      }
      if (request.method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
      }
      let body;
      try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400, origin); }

      // Push records — ALWAYS stamped with the key's own branch (client can't spoof another branch)
      if (path === '/sync/push') {
        const table = SYNC_TABLES[body.table];
        if (!table) return json({ success: false, error: 'Unknown sync table' }, 400, origin);
        const records = Array.isArray(body.records) ? body.records : [];
        if (records.length === 0) return json({ success: true, synced: 0 }, 200, origin);
        if (records.length > MAX_BATCH_RECORDS) {
          return json({ success: false, error: `Batch too large (max ${MAX_BATCH_RECORDS})` }, 400, origin);
        }
        try {
          const cols = table.columns;
          const placeholders = cols.map(() => '?').join(', ');
          const sql = `INSERT OR REPLACE INTO ${body.table} (${cols.join(', ')}) VALUES (${placeholders})`;
          const stmts = records.map((rec) => {
            const params = cols.map((col) => {
              if (col === 'branch_id') return branchId; // forced scope
              let v = rec[col];
              if (v === undefined) return null;
              if (table.numeric && table.numeric.includes(col)) return Number(v) || 0;
              if (table.boolean && table.boolean.includes(col)) return v ? 1 : 0;
              if (table.jsonText && table.jsonText.includes(col) && typeof v !== 'string') return JSON.stringify(v);
              return v;
            });
            return env.DB.prepare(sql).bind(...params);
          });
          await env.DB.batch(stmts);
          return json({ success: true, synced: records.length }, 200, origin);
        } catch (err) {
          return json({ success: false, error: 'Push failed' }, 500, origin);
        }
      }

      // Pull orders — only this branch, only newer than `since` when provided
      if (path === '/sync/pull-orders') {
        const since = String(body.since || '').trim();
        try {
          let result;
          if (since) {
            result = await env.DB.prepare(
              'SELECT * FROM orders WHERE branch_id = ? AND createdAt > ? ORDER BY createdAt ASC LIMIT 1000'
            ).bind(branchId, since).all();
          } else {
            result = await env.DB.prepare(
              'SELECT * FROM orders WHERE branch_id = ? ORDER BY createdAt DESC LIMIT 1000'
            ).bind(branchId).all();
          }
          return json({ success: true, result: result.results || [] }, 200, origin);
        } catch (err) {
          return json({ success: false, error: 'Pull failed' }, 500, origin);
        }
      }

      // Branch-scoped menu item delete
      if (path === '/sync/delete-menu-item') {
        const id = String(body.id || '');
        if (!id) return json({ success: false, error: 'Missing id' }, 400, origin);
        try {
          await env.DB.prepare('DELETE FROM menu_items WHERE id = ? AND branch_id = ?').bind(id, branchId).run();
          return json({ success: true }, 200, origin);
        } catch (err) {
          return json({ success: false, error: 'Delete failed' }, 500, origin);
        }
      }

      return json({ success: false, error: 'Unknown sync endpoint' }, 404, origin);
    }

    // Everything else (including the retired raw-SQL proxy) is gone.
    return json({ success: false, error: 'Not found' }, 404, origin);
  },
};
