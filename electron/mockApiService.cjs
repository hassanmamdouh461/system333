/**
 * Cloudflare D1 Sync API Service
 * Replaces the Appwrite REST API with standard HTTP requests to our Cloudflare Worker Proxy.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// 1. Resolve Worker URL + API key from .env file or local database settings
let WORKER_URL = "";
let WORKER_API_KEY = "";
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/VITE_CF_WORKER_URL\s*=\s*(.*)/);
    if (urlMatch && urlMatch[1]) {
      WORKER_URL = urlMatch[1].trim();
    }
    const keyMatch = envContent.match(/VITE_CF_WORKER_API_KEY\s*=\s*(.*)/);
    if (keyMatch && keyMatch[1]) {
      WORKER_API_KEY = keyMatch[1].trim();
    }
  }
} catch (e) {
  console.error('[D1 Sync API] Failed to load .env file:', e.message);
}

try {
  const settings = database.getSettings();
  if (!WORKER_URL && settings['brewmaster_d1_worker_url']) {
    WORKER_URL = settings['brewmaster_d1_worker_url'];
  }
  if (!WORKER_API_KEY && settings['brewmaster_d1_worker_api_key']) {
    WORKER_API_KEY = settings['brewmaster_d1_worker_api_key'];
  }
} catch (e) {}

if (!WORKER_URL) {
  WORKER_URL = "https://api.engaz.tech"; // default: BrewMaster central API
}

console.log('[D1 Sync API] Configured Worker URL:', WORKER_URL);

/**
 * Custom fetch implementation using standard Node.js https module
 */
function fetchWorker(payload) {
  return new Promise((resolve, reject) => {
    if (!WORKER_URL || WORKER_URL.includes('your-username')) {
      return reject(new Error('Cloudflare Worker URL is not configured'));
    }

    const parsedUrl = new URL(WORKER_URL);
    const bodyStr = JSON.stringify(payload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(WORKER_API_KEY ? { 'X-API-Key': WORKER_API_KEY } : {})
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

// ─── API Sync Methods ──────────────────────────────────────────────────────────

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} menu items...`);

  // Split tombstones (deletions) from upserts (Issue 20)
  const deleted = items.filter(i => i.deletedAt);
  const upserts = items.filter(i => !i.deletedAt);

  const batch = [];
  for (const item of upserts) {
    batch.push({
      sql: `INSERT OR REPLACE INTO menu_items (id, name, description, price, category, image, available, branch_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        item.id,
        item.name,
        item.description || "",
        Number(item.price),
        item.category,
        item.image || "",
        item.available ? 1 : 0,
        item.branchId || item.branch_id || null,
        item.updatedAt || new Date().toISOString()
      ]
    });
  }
  for (const item of deleted) {
    batch.push({
      sql: `DELETE FROM menu_items WHERE id = ?`,
      params: [item.id]
    });
  }

  if (batch.length === 0) return { success: true };
  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push menu items to D1');
  }
  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${orders.length} orders...`);

  const batch = [];
  const deleted = orders.filter(o => o.deletedAt);
  const upserts = orders.filter(o => !o.deletedAt);

  for (const order of upserts) {
    // Send updated_at + tax snapshot + soft-delete columns to the cloud (Issue 18 + 25)
    batch.push({
      sql: `INSERT OR REPLACE INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, subtotal, taxRate, taxAmount, grandTotal, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        order.id,
        order.orderNumber,
        order.tableId,
        typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
        order.status,
        order.paymentStatus || 'Unpaid',
        order.paymentMethod || null,
        Number(order.totalAmount),
        order.subtotal != null ? Number(order.subtotal) : null,
        order.taxRate != null ? Number(order.taxRate) : null,
        order.taxAmount != null ? Number(order.taxAmount) : null,
        order.grandTotal != null ? Number(order.grandTotal) : null,
        order.createdAt,
        order.paidAt || null,
        order.customerPhone || null,
        Number(order.pointsEarned) || 0,
        Number(order.pointsRedeemed) || 0,
        order.branchId || order.branch_id || null,
        order.updatedAt || new Date().toISOString()
      ]
    });
  }
  for (const order of deleted) {
    batch.push({
      sql: `DELETE FROM orders WHERE id = ?`,
      params: [order.id]
    });
  }

  if (batch.length === 0) return { success: true };
  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push orders to D1');
  }
  return { success: true };
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${customers.length} customers...`);

  const batch = [];
  const deleted = customers.filter(c => c.deletedAt);
  const upserts = customers.filter(c => !c.deletedAt);

  for (const c of upserts) {
    batch.push({
      sql: `INSERT OR REPLACE INTO customers (id, name, phone, points, createdAt, branch_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        c.id,
        c.name,
        c.phone,
        Number(c.points) || 0,
        c.createdAt,
        c.branchId || c.branch_id || null,
        c.updatedAt || new Date().toISOString()
      ]
    });
  }
  for (const c of deleted) {
    batch.push({
      sql: `DELETE FROM customers WHERE id = ?`,
      params: [c.id]
    });
  }

  if (batch.length === 0) return { success: true };
  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push customers to D1');
  }
  return { success: true };
}

async function pushInventory(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} inventory items...`);

  const batch = [];
  const deleted = items.filter(i => i.deleted_at);
  const upserts = items.filter(i => !i.deleted_at);

  for (const item of upserts) {
    batch.push({
      sql: `INSERT OR REPLACE INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        item.id,
        item.name,
        item.unit,
        Number(item.stock) || 0,
        Number(item.minStock) || 0,
        Number(item.costPerUnit) || 0,
        item.branchId || item.branch_id || null,
        item.createdAt || item.created_at || new Date().toISOString(),
        item.updatedAt || item.updated_at || new Date().toISOString()
      ]
    });
  }
  for (const item of deleted) {
    batch.push({
      sql: `DELETE FROM inventory WHERE id = ?`,
      params: [item.id]
    });
  }

  if (batch.length === 0) return { success: true };
  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push inventory to D1');
  }
  return { success: true };
}

// Push stock MOVEMENTS (transactions) so the cloud keeps the full audit trail
// and balances can be recomputed instead of last-write-wins overwrites (Issue 27)
async function pushInventoryTransactions(transactions) {
  if (transactions.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${transactions.length} inventory transactions...`);

  const batch = transactions.map(tx => ({
    sql: `INSERT OR IGNORE INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      tx.id,
      tx.itemId,
      tx.type,
      Number(tx.quantity),
      tx.referenceId || null,
      tx.createdAt,
      tx.branch_id || null,
      tx.notes || null
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push inventory transactions to D1');
  }
  return { success: true };
}

// Push loyalty points ledger entries (Issue 26)
async function pushPointsTransactions(entries) {
  if (entries.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${entries.length} points transactions...`);

  const batch = entries.map(e => ({
    sql: `INSERT OR IGNORE INTO points_transactions (id, customerId, orderId, type, points, balanceAfter, createdAt, branch_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      e.id,
      e.customerId,
      e.orderId || null,
      e.type,
      Number(e.points),
      e.balanceAfter != null ? Number(e.balanceAfter) : null,
      e.createdAt,
      e.branch_id || null
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push points transactions to D1');
  }
  return { success: true };
}

// Incremental pull (Issue 21): only fetch rows changed since the last pull,
// scoped to this branch (+ shared/branchless rows).
async function pullOrders(since = null, branchId = null) {
  console.log(`[D1 Sync API] Pulling orders from D1 (since=${since || 'full'}, branch=${branchId || 'all'})...`);

  let sql;
  const params = [];
  if (since && branchId && branchId !== 'manager') {
    sql = "SELECT * FROM orders WHERE updated_at > ? AND (branch_id = ? OR branch_id IS NULL) ORDER BY updated_at ASC LIMIT 500";
    params.push(since, branchId);
  } else if (since) {
    sql = "SELECT * FROM orders WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500";
    params.push(since);
  } else if (branchId && branchId !== 'manager') {
    sql = "SELECT * FROM orders WHERE (branch_id = ? OR branch_id IS NULL) ORDER BY createdAt DESC LIMIT 1000";
    params.push(branchId);
  } else {
    sql = "SELECT * FROM orders ORDER BY createdAt DESC LIMIT 1000";
  }

  const res = await fetchWorker(params.length ? { sql, params } : { sql });

  if (!res.success) {
    throw new Error(res.error || 'Failed to pull orders from D1');
  }

  // D1 query response: results is under res.result[0].results
  const rows = res.result[0]?.results || [];

  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.updated_at || row.createdAt,
    orderNumber: row.orderNumber,
    tableId: row.tableId,
    status: row.status,
    paymentStatus: row.paymentStatus,
    total_amount: Number(row.totalAmount),
    subtotal: row.subtotal,
    taxRate: row.taxRate,
    taxAmount: row.taxAmount,
    grandTotal: row.grandTotal,
    payment_method: row.paymentMethod || null,
    paidAt: row.paidAt || null,
    customerPhone: row.customerPhone || null,
    pointsEarned: row.pointsEarned,
    pointsRedeemed: row.pointsRedeemed,
    items: row.items, // JSON string
    branch_id: row.branch_id,
    deleted_at: row.deleted_at || null
  }));
}

async function deleteMenuItem(id) {
  console.log(`[D1 Sync API] Deleting menu item ${id}...`);
  const res = await fetchWorker({
    sql: "DELETE FROM menu_items WHERE id = ?",
    params: [id]
  });
  if (!res.success) {
    console.error(`[D1 Sync API] Failed to delete menu item ${id}:`, res.error);
  }
}

// Liveness probe used by the sync engine's connectivity check (Issue 34)
async function checkWorkerHealth() {
  try {
    const parsedUrl = new URL(WORKER_URL);
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: '/health',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        res.resume();
        res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function getManagerOrders() {
  console.log('[D1 Sync API] Manager fetching all orders...');
  const res = await fetchWorker({
    sql: "SELECT * FROM orders ORDER BY createdAt DESC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager orders');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt,
    total_amount: Number(row.totalAmount),
    payment_method: row.paymentMethod || 'Cash',
    items: row.items,
    branch_id: row.branch_id
  }));
}

async function getManagerCustomers() {
  console.log('[D1 Sync API] Manager fetching all customers...');
  const res = await fetchWorker({
    sql: "SELECT * FROM customers ORDER BY createdAt DESC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager customers');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt,
    name: row.name,
    phone: row.phone,
    points: Number(row.points),
    branchId: row.branch_id
  }));
}

async function getManagerInventory() {
  console.log('[D1 Sync API] Manager fetching all inventory...');
  const res = await fetchWorker({
    sql: "SELECT * FROM inventory ORDER BY name ASC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager inventory');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    name: row.name,
    unit: row.unit,
    stock: Number(row.stock),
    minStock: Number(row.minStock),
    costPerUnit: Number(row.costPerUnit),
    branch_id: row.branch_id
  }));
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
  getManagerOrders,
  getManagerCustomers,
  getManagerInventory
};
