/**
 * Cloudflare D1 Sync Client
 * ─────────────────────────────────────────────────────────────
 * Talks to the Engaz workers over named endpoints. This process sends records and filters;
 * the worker owns every SQL statement. Nothing here builds a query.
 *
 * Two destinations per push: the production database, and — fire and forget — the isolated
 * reports database that backs reporting.engaz.tech.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// Worker URL and key are resolved lazily and re-read after a TTL. This used to run once at
// module load, so rotating the key or URL in the settings UI had no effect until a restart.
const DEFAULT_WORKER_URL = 'https://api.engaz.tech';
const CONFIG_TTL_MS = 30000;
const REQUEST_TIMEOUT_MS = 15000;
const MIRROR_TIMEOUT_MS = 10000;
/** Worker-side cap; batches are split to stay under it. */
const MAX_BATCH = 200;

let WORKER_URL = '';
let WORKER_API_KEY = '';
let configLoadedAt = 0;

// Isolated reports database (the reporting.engaz.tech portal reads from it). The URL is
// fixed; the key is loaded from .env like the production key.
const REPORTS_WORKER_URL = 'https://api-reports.engaz.tech';
let REPORTS_WORKER_KEY = '';

function readEnvFileConfig() {
  const result = { url: '', key: '', reportsKey: '' };
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return result;
    const envContent = fs.readFileSync(envPath, 'utf8');
    // Stop at the first '#' or line break so an inline comment or CR does not become
    // part of the value.
    const urlMatch = envContent.match(/^\s*VITE_CF_WORKER_URL\s*=\s*([^#\r\n]*)/m);
    if (urlMatch) result.url = urlMatch[1].trim();
    const keyMatch = envContent.match(/^\s*VITE_CF_WORKER_API_KEY\s*=\s*([^#\r\n]*)/m);
    if (keyMatch) result.key = keyMatch[1].trim();
    const reportsKeyMatch = envContent.match(/^\s*VITE_REPORTS_API_KEY\s*=\s*([^#\r\n]*)/m);
    if (reportsKeyMatch) result.reportsKey = reportsKeyMatch[1].trim();
  } catch (e) {
    console.error('[D1 Sync API] Failed to load .env file:', e.message);
  }
  return result;
}

function loadConfig(force = false) {
  const now = Date.now();
  if (!force && configLoadedAt && now - configLoadedAt < CONFIG_TTL_MS) return;

  const fromEnv = readEnvFileConfig();
  let url = fromEnv.url;
  let key = fromEnv.key;

  try {
    const settings = database.getSettings();
    if (!url && settings['engaz_d1_worker_url']) url = settings['engaz_d1_worker_url'];
    if (!key && settings['engaz_d1_worker_api_key']) key = settings['engaz_d1_worker_api_key'];
  } catch (e) {
    // Worth reporting: a failure here silently degrades into "offline" behaviour.
    console.error('[D1 Sync API] Could not read worker config from settings:', e.message);
  }

  const previousUrl = WORKER_URL;
  WORKER_URL = url || DEFAULT_WORKER_URL;
  WORKER_API_KEY = key;
  REPORTS_WORKER_KEY = fromEnv.reportsKey || REPORTS_WORKER_KEY;
  configLoadedAt = now;

  if (WORKER_URL !== previousUrl) {
    console.log('[D1 Sync API] Configured Worker URL:', WORKER_URL);
  }
}

/** Joins the configured worker URL with an endpoint path, honouring a sub-path mount. */
function endpointPath(base, endpoint) {
  return `${base.pathname.replace(/\/+$/, '')}${endpoint}`;
}

function postJson({ baseUrl, endpoint, body, apiKey, timeout }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return reject(new Error(`Invalid worker URL: ${baseUrl}`));
    }

    const bodyStr = JSON.stringify(body || {});
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: endpointPath(parsed, endpoint),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse json response: ${data}`));
          }
          return;
        }
        // 429 is worth naming: the caller should back off rather than retry immediately.
        if (res.statusCode === 429) {
          reject(new Error(`Rate limited by worker (retry after ${res.headers['retry-after'] || '?'}s)`));
          return;
        }
        reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });

    req.write(bodyStr);
    req.end();
  });
}

/** Calls the production worker, mirroring writes to the reports database. */
async function callWorker(endpoint, body) {
  loadConfig();
  if (!WORKER_URL || WORKER_URL.includes('your-username')) {
    throw new Error('Cloudflare Worker URL is not configured');
  }

  const response = await postJson({
    baseUrl: WORKER_URL,
    endpoint,
    body,
    apiKey: WORKER_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (response && response.success === false) {
    throw new Error(response.error || `Worker rejected ${endpoint}`);
  }

  // Only writes are mirrored: the reports database is a read model built from them.
  if (endpoint.startsWith('/sync/')) {
    mirrorToReports(endpoint, body).catch(() => {});
  }

  return response;
}

/**
 * Copies a write to the isolated reports database. Fire and forget by design: the reports
 * portal going stale is an inconvenience, but a mirror failure blocking the POS from
 * syncing its own sales is not acceptable.
 */
async function mirrorToReports(endpoint, body) {
  if (!REPORTS_WORKER_KEY) return;
  try {
    const res = await postJson({
      baseUrl: REPORTS_WORKER_URL,
      endpoint,
      body,
      apiKey: REPORTS_WORKER_KEY,
      timeout: MIRROR_TIMEOUT_MS,
    });
    if (res && res.success === false) {
      console.warn('[D1 Sync API] Reports mirror rejected (non-fatal):', res.error);
    }
  } catch (e) {
    console.warn('[D1 Sync API] Reports mirror failed (non-fatal):', e.message);
  }
}

/** Splits a push into worker-sized chunks so a large backlog is not rejected wholesale. */
async function syncRecords(target, records) {
  if (!records || records.length === 0) return { success: true, written: 0 };

  let written = 0;
  for (let i = 0; i < records.length; i += MAX_BATCH) {
    const chunk = records.slice(i, i + MAX_BATCH);
    const res = await callWorker(`/sync/${target}`, { items: chunk });
    written += (res && res.written) || 0;
  }
  return { success: true, written };
}

// ─── Push methods ────────────────────────────────────────────────────────────
// Each one hands its records to the matching endpoint. Field mapping, upsert conflict
// rules and soft-delete handling all live in the worker now, so these are thin.

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} menu items...`);
  return syncRecords('menu-items', items);
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${orders.length} orders...`);
  return syncRecords('orders', orders);
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${customers.length} customers...`);
  return syncRecords('customers', customers);
}

async function pushInventory(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} inventory items...`);
  return syncRecords('inventory', items);
}

async function pushInventoryTransactions(transactions) {
  if (transactions.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${transactions.length} inventory transactions...`);
  return syncRecords('inventory-transactions', transactions);
}

async function pushPointsTransactions(entries) {
  if (entries.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${entries.length} points transactions...`);
  return syncRecords('points-transactions', entries);
}

async function deleteMenuItem(id) {
  console.log(`[D1 Sync API] Deleting menu item ${id}...`);
  const now = new Date().toISOString();
  // Soft delete so the tombstone is visible to incremental pulls on other branches.
  await syncRecords('menu-items', [{ id, deletedAt: now, updatedAt: now }]);
  return { success: true };
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapOrderRow(row) {
  return {
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.updated_at || row.createdAt,
    orderNumber: row.orderNumber,
    tableId: row.tableId,
    status: row.status,
    paymentStatus: row.paymentStatus || 'Unpaid',
    total_amount: Number(row.totalAmount) || 0,
    // The tax snapshot has to travel with the row: without it a reader cannot tell a
    // tax-inclusive total from a pre-tax one and re-applies tax.
    subtotal: toNumberOrNull(row.subtotal),
    taxRate: toNumberOrNull(row.taxRate),
    taxAmount: toNumberOrNull(row.taxAmount),
    grandTotal: toNumberOrNull(row.grandTotal),
    paidAmount: toNumberOrNull(row.paidAmount),
    payment_method: row.paymentMethod || null,
    paidAt: row.paidAt || null,
    customerPhone: row.customerPhone || null,
    pointsEarned: toNumberOrNull(row.pointsEarned),
    pointsRedeemed: toNumberOrNull(row.pointsRedeemed),
    items: row.items, // JSON string
    branch_id: row.branch_id,
    deleted_at: row.deleted_at || null,
  };
}

// ─── Pull and read methods ───────────────────────────────────────────────────

/**
 * Incremental pull: only rows changed since the last pull, scoped to this branch plus
 * shared rows.
 *
 * The high-water mark is inclusive on purpose. It is max(updated_at) of the previous batch,
 * and batch writes share a millisecond timestamp, so a strict comparison skipped any row
 * carrying that exact timestamp but cut off by the limit. The local upsert is idempotent,
 * so re-fetching the boundary rows is harmless.
 */
async function pullOrders(since = null, branchId = null) {
  console.log(`[D1 Sync API] Pulling orders from D1 (since=${since || 'full'}, branch=${branchId || 'all'})...`);

  const res = await callWorker('/pull/orders', {
    since: since || null,
    // The manager view is not a branch; it reads everything.
    branchId: branchId && branchId !== 'manager' ? branchId : null,
  });

  return (res.orders || []).map(mapOrderRow);
}

/** Liveness probe used by the sync engine's connectivity check. */
async function checkWorkerHealth() {
  loadConfig();
  try {
    const parsedUrl = new URL(WORKER_URL);
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: endpointPath(parsedUrl, '/health'),
        method: 'GET',
        timeout: 5000,
      }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    return true;
  } catch (e) {
    // Distinguish "unreachable" from "reachable but unhealthy" in the log; the sync engine
    // only needs the boolean, but a silent false hides DNS and TLS failures.
    console.warn('[D1 Sync API] Worker health check failed:', e.message);
    return false;
  }
}

/** One round trip for the whole manager dashboard instead of three. */
async function getManagerSnapshot() {
  console.log('[D1 Sync API] Manager fetching snapshot...');
  const res = await callWorker('/read/manager-snapshot', {});

  return {
    orders: (res.orders || []).map(mapOrderRow),
    customers: (res.customers || []).map(row => ({
      $id: row.id,
      $createdAt: row.createdAt,
      $updatedAt: row.updated_at || row.createdAt,
      name: row.name,
      phone: row.phone,
      points: Number(row.points) || 0,
      branchId: row.branch_id,
    })),
    inventory: (res.inventory || []).map(row => ({
      $id: row.id,
      name: row.name,
      unit: row.unit,
      stock: Number(row.stock) || 0,
      minStock: Number(row.minStock) || 0,
      costPerUnit: Number(row.costPerUnit) || 0,
      branch_id: row.branch_id,
    })),
  };
}

async function getManagerOrders() {
  return (await getManagerSnapshot()).orders;
}

async function getManagerCustomers() {
  return (await getManagerSnapshot()).customers;
}

async function getManagerInventory() {
  return (await getManagerSnapshot()).inventory;
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pushInventory,
  pushInventoryTransactions,
  pushPointsTransactions,
  pullOrders,
  deleteMenuItem,
  checkWorkerHealth,
  getManagerSnapshot,
  getManagerOrders,
  getManagerCustomers,
  getManagerInventory,
};
