/**
 * Cloudflare D1 Sync API Service
 *
 * Talks to the secured Cloudflare Worker (worker/index.js) through versioned
 * JSON endpoints — the worker owns all SQL. Raw-SQL-over-HTTP was removed
 * because it let any caller execute arbitrary statements on D1 (problem #1).
 *
 * Every request carries the shared API key in the X-API-Key header. The key is
 * resolved from: CF_API_KEY env var → .env file → SQLite settings table.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// ─── Configuration resolution ────────────────────────────────────────────────

function readEnvFile() {
  try {
    const candidates = [
      path.join(__dirname, '..', '.env'),
      // Packaged builds: allow an .env next to the executable resources dir
      ...(process.resourcesPath ? [path.join(process.resourcesPath, '.env')] : []),
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        return fs.readFileSync(envPath, 'utf8');
      }
    }
  } catch (e) {
    console.error('[D1 Sync API] Failed to load .env file:', e.message);
  }
  return '';
}

const envContent = readEnvFile();

function envVar(name) {
  if (process.env[name]) return process.env[name].trim();
  const match = envContent.match(new RegExp(`${name}\\s*=\\s*(.*)`));
  return match && match[1] ? match[1].trim() : '';
}

function resolveConfig() {
  let workerUrl = envVar('VITE_CF_WORKER_URL') || envVar('CF_WORKER_URL');
  let apiKey = envVar('CF_API_KEY') || envVar('VITE_CF_API_KEY');

  if (!workerUrl || !apiKey) {
    try {
      const settings = database.getSettings();
      if (!workerUrl && settings['brewmaster_d1_worker_url']) {
        workerUrl = settings['brewmaster_d1_worker_url'];
      }
      if (!apiKey && settings['brewmaster_cf_api_key']) {
        apiKey = settings['brewmaster_cf_api_key'];
      }
    } catch (e) { /* settings unavailable early in startup */ }
  }

  if (!workerUrl) {
    workerUrl = 'https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev'; // legacy default
  }

  return { workerUrl: workerUrl.replace(/\/+$/, ''), apiKey };
}

// ─── HTTP transport ──────────────────────────────────────────────────────────

function postEndpoint(endpointPath, payload) {
  return new Promise((resolve, reject) => {
    const { workerUrl, apiKey } = resolveConfig();

    if (!apiKey) {
      return reject(new Error('Cloudflare API key is not configured (set CF_API_KEY or brewmaster_cf_api_key)'));
    }

    const parsedUrl = new URL(`${workerUrl}${endpointPath}`);
    const bodyStr = JSON.stringify(payload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'X-API-Key': apiKey,
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          return reject(new Error(`Failed to parse worker response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && parsed.success !== false) {
          resolve(parsed);
        } else {
          reject(new Error(parsed.error || `HTTP Error ${res.statusCode}`));
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

// ─── Row mapping helpers ─────────────────────────────────────────────────────

function mapOrderRow(row) {
  return {
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.updated_at || row.createdAt,
    orderNumber: row.orderNumber,
    tableId: row.tableId || 'Takeaway',
    items: row.items, // JSON string
    status: row.status || 'New',
    paymentStatus: row.paymentStatus || 'Unpaid',
    payment_method: row.paymentMethod || null,
    total_amount: Number(row.totalAmount),
    paidAt: row.paidAt || null,
    customerPhone: row.customerPhone || null,
    pointsEarned: Number(row.pointsEarned) || 0,
    pointsRedeemed: Number(row.pointsRedeemed) || 0,
    branch_id: row.branch_id,
  };
}

// ─── Push endpoints (branch → cloud) ─────────────────────────────────────────

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} menu items...`);
  await postEndpoint('/sync/push-menu', {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      price: Number(item.price),
      category: item.category,
      image: item.image || '',
      available: item.available ? 1 : 0,
      branchId: item.branchId || item.branch_id || 'branch_1',
    })),
  });
  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${orders.length} orders...`);
  await postEndpoint('/sync/push-orders', {
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      items: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
      status: order.status,
      paymentStatus: order.paymentStatus || 'Unpaid',
      paymentMethod: order.paymentMethod || null,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt || new Date().toISOString(),
      paidAt: order.paidAt || null,
      customerPhone: order.customerPhone || null,
      pointsEarned: order.pointsEarned || 0,
      pointsRedeemed: order.pointsRedeemed || 0,
      branchId: order.branchId || order.branch_id || 'branch_1',
    })),
  });
  return { success: true };
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${customers.length} customers...`);
  await postEndpoint('/sync/push-customers', {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      points: Number(c.points) || 0,
      createdAt: c.createdAt,
      branchId: c.branchId || c.branch_id || 'branch_1',
    })),
  });
  return { success: true };
}

async function pushInventory(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} inventory items...`);
  await postEndpoint('/sync/push-inventory', {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      stock: Number(item.stock) || 0,
      minStock: Number(item.minStock) || 0,
      costPerUnit: Number(item.costPerUnit) || 0,
      branchId: item.branchId || item.branch_id || 'branch_1',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    })),
  });
  return { success: true };
}

// ─── Pull endpoint (cloud → branch) ──────────────────────────────────────────

async function pullOrders() {
  console.log('[D1 Sync API] Pulling orders from D1...');
  const res = await postEndpoint('/sync/pull-orders', {});
  return (res.orders || []).map(mapOrderRow);
}

// ─── Menu deletion ───────────────────────────────────────────────────────────

async function deleteMenuItem(id) {
  console.log(`[D1 Sync API] Deleting menu item ${id}...`);
  try {
    await postEndpoint('/menu/delete', { id });
  } catch (e) {
    console.error(`[D1 Sync API] Failed to delete menu item ${id}:`, e.message);
  }
}

// ─── Manager endpoints (manager portal → cloud) ──────────────────────────────

async function getManagerOrders() {
  console.log('[D1 Sync API] Manager fetching all orders...');
  const res = await postEndpoint('/manager/orders', {});
  return (res.orders || []).map(mapOrderRow);
}

async function getManagerCustomers() {
  console.log('[D1 Sync API] Manager fetching all customers...');
  const res = await postEndpoint('/manager/customers', {});
  return (res.customers || []).map((row) => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt,
    name: row.name,
    phone: row.phone,
    points: Number(row.points),
    branchId: row.branch_id,
  }));
}

async function getManagerInventory() {
  console.log('[D1 Sync API] Manager fetching all inventory...');
  const res = await postEndpoint('/manager/inventory', {});
  return (res.inventory || []).map((row) => ({
    $id: row.id,
    name: row.name,
    unit: row.unit,
    stock: Number(row.stock),
    minStock: Number(row.minStock),
    costPerUnit: Number(row.costPerUnit),
    branch_id: row.branch_id,
  }));
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pushInventory,
  pullOrders,
  deleteMenuItem,
  getManagerOrders,
  getManagerCustomers,
  getManagerInventory,
};
