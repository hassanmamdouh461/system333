/**
 * BrewMaster Cloud Sync API Service (v2)
 * ─────────────────────────────────────────────────────────────
 * Talks to the secure Cloudflare Worker endpoints (cloudflare/d1-proxy-worker.js):
 *   • /sync/push               — batch upserts scoped to THIS branch's API key
 *   • /sync/pull-orders        — incremental pull of this branch's orders
 *   • /sync/delete-menu-item   — branch-scoped delete
 *   • /analytics/*             — manager reads (JWT; used on the web portal)
 *
 * No raw SQL ever leaves this process. The branch API key is read from the
 * OS-keychain-encrypted settings store (secure_worker_api_key) with a legacy
 * plaintext fallback for upgrades.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// 1. Resolve Worker URL from .env file or local database settings
let WORKER_URL = "";
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/VITE_CF_WORKER_URL\s*=\s*(.*)/);
    if (urlMatch && urlMatch[1]) {
      WORKER_URL = urlMatch[1].trim();
    }
  }
} catch (e) {
  console.error('[Cloud Sync API] Failed to load .env file:', e.message);
}

// Branch API key: encrypted secret store first, then legacy plaintext settings,
// then .env fallback for old installs (to be rotated out).
function getApiKey() {
  try {
    const secure = database.getSecret('secure_worker_api_key');
    if (secure) return secure;
  } catch (e) {}
  try {
    const settings = database.getSettings();
    if (settings['brewmaster_d1_worker_api_key']) {
      return settings['brewmaster_d1_worker_api_key'];
    }
  } catch (e) {}
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const keyMatch = fs.readFileSync(envPath, 'utf8').match(/VITE_CF_WORKER_API_KEY\s*=\s*(.*)/);
      if (keyMatch && keyMatch[1]) return keyMatch[1].trim();
    }
  } catch (e) {}
  return "";
}

try {
  if (!WORKER_URL) {
    const settings = database.getSettings();
    if (settings['brewmaster_d1_worker_url']) {
      WORKER_URL = settings['brewmaster_d1_worker_url'];
    }
  }
} catch (e) {}

if (!WORKER_URL) {
  WORKER_URL = "https://api.engaz.tech"; // default: BrewMaster central API
}

console.log('[Cloud Sync API] Configured Worker URL:', WORKER_URL);

/**
 * Custom fetch implementation using standard Node.js https module
 */
function fetchWorker(endpoint, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (!WORKER_URL || WORKER_URL.includes('your-worker')) {
      return reject(new Error('Cloudflare Worker URL is not configured'));
    }

    const base = WORKER_URL.replace(/\/+$/, '');
    const parsedUrl = new URL(base + endpoint);
    const bodyStr = JSON.stringify(payload || {});

    const apiKey = getApiKey();
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        ...extraHeaders
      },
      timeout: 15000 // 15 seconds
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse json response: ${data}`));
          }
        } else {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ─── Sync push (table-scoped batch upserts) ──────────────────
async function pushTable(table, records, label) {
  if (!records || records.length === 0) return { success: true };
  console.log(`[Cloud Sync API] Pushing ${records.length} ${label}...`);
  const res = await fetchWorker('/sync/push', { table, records });
  if (!res.success) {
    throw new Error(res.error || `Failed to push ${label}`);
  }
  return { success: true };
}

async function pushMenuItems(items) {
  return pushTable('menu_items', items.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description || "",
    price: Number(item.price),
    category: item.category,
    image: item.image || "",
    available: item.available ? 1 : 0
  })), 'menu items');
}

async function pushOrders(orders) {
  return pushTable('orders', orders.map(order => ({
    id: order.id,
    orderNumber: order.orderNumber,
    tableId: order.tableId,
    items: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
    status: order.status,
    paymentStatus: order.paymentStatus || 'Unpaid',
    paymentMethod: order.paymentMethod || null,
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt,
    paidAt: order.paidAt || null
  })), 'orders');
}

async function pushCustomers(customers) {
  return pushTable('customers', customers.map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    points: Number(c.points) || 0,
    createdAt: c.createdAt
  })), 'customers');
}

async function pushInventory(items) {
  return pushTable('inventory', items.map(item => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    stock: Number(item.stock) || 0,
    minStock: Number(item.minStock) || 0,
    costPerUnit: Number(item.costPerUnit) || 0,
    created_at: item.created_at || item.createdAt || new Date().toISOString(),
    updated_at: item.updated_at || item.updatedAt || new Date().toISOString()
  })), 'inventory items');
}

// ─── Incremental pull of this branch's orders ────────────────
async function pullOrders(since) {
  console.log('[Cloud Sync API] Pulling orders from cloud...');
  const res = await fetchWorker('/sync/pull-orders', since ? { since } : {});
  if (!res.success) {
    throw new Error(res.error || 'Failed to pull orders');
  }
  const rows = res.result || [];
  return rows.map(row => ({
    id: row.id,
    orderNumber: row.orderNumber,
    tableId: row.tableId,
    items: row.items,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    totalAmount: Number(row.totalAmount),
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    branch_id: row.branch_id
  }));
}

async function deleteMenuItem(id) {
  console.log(`[Cloud Sync API] Deleting menu item ${id}...`);
  try {
    const res = await fetchWorker('/sync/delete-menu-item', { id });
    if (!res.success) {
      console.error(`[Cloud Sync API] Failed to delete menu item ${id}:`, res.error);
    }
  } catch (e) {
    console.error(`[Cloud Sync API] Delete request failed for ${id}:`, e.message);
  }
}

// ─── Last-pull watermark (incremental sync) ──────────────────
function getLastPullAt() {
  try {
    const settings = database.getSettings();
    return settings['sync_last_pull_at'] || null;
  } catch (e) {
    return null;
  }
}

function setLastPullAt(isoTimestamp) {
  try {
    database.saveSetting('sync_last_pull_at', isoTimestamp);
  } catch (e) {}
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pushInventory,
  pullOrders,
  deleteMenuItem,
  getLastPullAt,
  setLastPullAt
};
