/**
 * BrewMaster D1 Proxy Worker — SECURED
 *
 * Replaces the old "execute whatever SQL the client sends" proxy (problem #1).
 * All SQL lives here; clients send structured JSON to versioned endpoints.
 *
 * Security layers:
 *   1. X-API-Key shared secret on every endpoint (wrangler secret put API_KEY).
 *   2. /manager/* and /telegram/send additionally require a valid session JWT
 *      (Authorization: Bearer) issued by /auth/login with role=manager (problem #4).
 *
 * Secrets (set via `wrangler secret put`):
 *   API_KEY            — shared branch/client key
 *   JWT_SECRET         — HMAC key for session tokens
 *   TELEGRAM_BOT_TOKEN — bot token for /telegram/send
 *
 * Binding: env.DB (D1 database)
 */

// ─── Tiny helpers ────────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const err = (message, status = 400) => json({ success: false, error: message }, status);

function constantTimeEqual(a, b) {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// ─── JWT (HS256, Web Crypto) ─────────────────────────────────────────────────

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function signJwt(payload, secret) {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret),
    new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

async function verifyJwt(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret),
      base64urlToBytes(sig), new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(body)));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── PBKDF2 password hashing ─────────────────────────────────────────────────

async function hashPassword(password, saltHex, iterations = 100000) {
  const salt = saltHex ? base64urlToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { hash: base64url(bits), salt: base64url(salt), iterations };
}

// ─── Auth guards ─────────────────────────────────────────────────────────────

function requireApiKey(request, env) {
  if (!env.API_KEY) {
    return err('Server misconfigured: API_KEY secret is not set', 500);
  }
  const provided = request.headers.get('X-API-Key') || '';
  if (!provided || !constantTimeEqual(provided, env.API_KEY)) {
    return err('Unauthorized: invalid or missing API key', 401);
  }
  return null;
}

async function requireManager(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { error: err('Unauthorized: missing session token', 401) };
  const payload = await verifyJwt(token, env.JWT_SECRET || '');
  if (!payload) return { error: err('Unauthorized: invalid or expired session token', 401) };
  if (payload.role !== 'manager') return { error: err('Forbidden: manager role required', 403) };
  return { payload };
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

const ORDER_COLUMNS = `id, orderNumber, tableId, items, status, paymentStatus, paymentMethod,
  totalAmount, createdAt, updated_at, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id`;

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleLogin(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return err('email and password are required');

  const user = await env.DB.prepare(
    'SELECT id, email, branch_id, role, password_hash, password_salt, iterations FROM users WHERE email = ?'
  ).bind(String(email).toLowerCase().trim()).first();

  if (!user) return err('Invalid email or password', 401);

  const { hash } = await hashPassword(String(password), user.password_salt, user.iterations || 100000);
  if (!constantTimeEqual(hash, user.password_hash)) {
    return err('Invalid email or password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    sub: user.id, branchId: user.branch_id, role: user.role,
    iat: now, exp: now + 12 * 3600, // 12-hour sessions
  }, env.JWT_SECRET);

  return json({ success: true, token, branchId: user.branch_id, role: user.role });
}

async function handlePushOrders(request, env) {
  const { orders } = await request.json().catch(() => ({}));
  if (!Array.isArray(orders) || orders.length === 0) return json({ success: true, count: 0 });

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO orders (id, orderNumber, tableId, items, status, paymentStatus,
      paymentMethod, totalAmount, createdAt, updated_at, paidAt, customerPhone, pointsEarned,
      pointsRedeemed, branch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batch = orders.map((o) => stmt.bind(
    o.id, o.orderNumber ?? '', o.tableId ?? 'Takeaway', o.items ?? '[]',
    o.status ?? 'New', o.paymentStatus ?? 'Unpaid', o.paymentMethod ?? null,
    Number(o.totalAmount) || 0, o.createdAt ?? new Date().toISOString(),
    o.updatedAt ?? new Date().toISOString(), o.paidAt ?? null,
    o.customerPhone ?? null, o.pointsEarned ?? 0, o.pointsRedeemed ?? 0,
    o.branchId ?? 'branch_1',
  ));

  await env.DB.batch(batch);
  return json({ success: true, count: batch.length });
}

async function handlePullOrders(request, env) {
  const { branchId } = await request.json().catch(() => ({}));
  let result;
  if (branchId && branchId !== 'manager') {
    result = await env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE branch_id = ? ORDER BY createdAt DESC LIMIT 1000`
    ).bind(branchId).all();
  } else {
    result = await env.DB.prepare(
      `SELECT ${ORDER_COLUMNS} FROM orders ORDER BY createdAt DESC LIMIT 1000`
    ).all();
  }
  return json({ success: true, orders: result.results || [] });
}

async function handlePushMenu(request, env) {
  const { items } = await request.json().catch(() => ({}));
  if (!Array.isArray(items) || items.length === 0) return json({ success: true, count: 0 });

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO menu_items (id, name, description, price, category, image, available, branch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = items.map((i) => stmt.bind(
    i.id, i.name, i.description ?? '', Number(i.price) || 0, i.category ?? '',
    i.image ?? '', i.available ? 1 : 0, i.branchId ?? 'branch_1',
  ));
  await env.DB.batch(batch);
  return json({ success: true, count: batch.length });
}

async function handleListMenu(request, env) {
  const result = await env.DB.prepare(
    'SELECT id, name, description, price, category, image, available, branch_id FROM menu_items ORDER BY category, name'
  ).all();
  return json({ success: true, items: result.results || [] });
}

async function handleDeleteMenu(request, env) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return err('id is required');
  await env.DB.prepare('DELETE FROM menu_items WHERE id = ?').bind(id).run();
  return json({ success: true });
}

async function handlePushCustomers(request, env) {
  const { customers } = await request.json().catch(() => ({}));
  if (!Array.isArray(customers) || customers.length === 0) return json({ success: true, count: 0 });

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO customers (id, name, phone, points, createdAt, branch_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const batch = customers.map((c) => stmt.bind(
    c.id, c.name ?? '', c.phone ?? '', Number(c.points) || 0,
    c.createdAt ?? new Date().toISOString(), c.branchId ?? 'branch_1',
  ));
  await env.DB.batch(batch);
  return json({ success: true, count: batch.length });
}

async function handlePushInventory(request, env) {
  const { items } = await request.json().catch(() => ({}));
  if (!Array.isArray(items) || items.length === 0) return json({ success: true, count: 0 });

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = items.map((i) => stmt.bind(
    i.id, i.name ?? '', i.unit ?? '', Number(i.stock) || 0, Number(i.minStock) || 0,
    Number(i.costPerUnit) || 0, i.branchId ?? 'branch_1',
    i.createdAt ?? new Date().toISOString(), i.updatedAt ?? new Date().toISOString(),
  ));
  await env.DB.batch(batch);
  return json({ success: true, count: batch.length });
}

async function handleManagerOrders(request, env) {
  const result = await env.DB.prepare(
    `SELECT ${ORDER_COLUMNS} FROM orders ORDER BY createdAt DESC LIMIT 1000`
  ).all();
  return json({ success: true, orders: result.results || [] });
}

async function handleManagerCustomers(request, env) {
  const result = await env.DB.prepare(
    'SELECT id, name, phone, points, createdAt, branch_id FROM customers ORDER BY createdAt DESC LIMIT 1000'
  ).all();
  return json({ success: true, customers: result.results || [] });
}

async function handleManagerInventory(request, env) {
  const result = await env.DB.prepare(
    'SELECT id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at FROM inventory ORDER BY name ASC LIMIT 1000'
  ).all();
  return json({ success: true, inventory: result.results || [] });
}

async function handleTelegramSend(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return err('Telegram is not configured on the server (TELEGRAM_BOT_TOKEN missing)', 500);
  }
  const { chatId, text } = await request.json().catch(() => ({}));
  if (!chatId || !text) return err('chatId and text are required');

  const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const tgData = await tgRes.json();
  if (!tgData.ok) return err(tgData.description || 'Telegram send failed', 502);
  return json({ success: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
        },
      });
    }
    if (request.method !== 'POST') return err('Method not allowed', 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Health check — unauthenticated, no DB access
    if (path === '/health') return json({ success: true, status: 'ok' });

    // Everything below requires the API key
    const apiKeyError = requireApiKey(request, env);
    if (apiKeyError) return apiKeyError;

    // Auth login (API key required; issues JWT)
    if (path === '/auth/login') return handleLogin(request, env);

    // Manager routes — API key + manager JWT
    if (path.startsWith('/manager/') || path === '/telegram/send') {
      const { error: authError } = await requireManager(request, env);
      if (authError) return authError;
      switch (path) {
        case '/manager/orders': return handleManagerOrders(request, env);
        case '/manager/customers': return handleManagerCustomers(request, env);
        case '/manager/inventory': return handleManagerInventory(request, env);
        case '/telegram/send': return handleTelegramSend(request, env);
      }
    }

    // Branch sync routes — API key only
    switch (path) {
      case '/sync/push-orders': return handlePushOrders(request, env);
      case '/sync/pull-orders': return handlePullOrders(request, env);
      case '/sync/push-menu': return handlePushMenu(request, env);
      case '/sync/push-customers': return handlePushCustomers(request, env);
      case '/sync/push-inventory': return handlePushInventory(request, env);
      case '/menu/list': return handleListMenu(request, env);
      case '/menu/delete': return handleDeleteMenu(request, env);
      default: return err(`Unknown endpoint: ${path}`, 404);
    }
  },
};
