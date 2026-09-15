/**
 * Cloudflare D1 Sync Client
 * ─────────────────────────────────────────────────────────────
 * Talks to the Engaz workers over named endpoints. This process sends records and filters;
 * the worker owns every SQL statement. Nothing here builds a query.
 *
 * Two destinations per push: the primary POS database and a durable SQLite outbox for
 * the isolated reports database. A primary acknowledgement is not reports delivery.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const database = require('./database.cjs');
const { reconcileAcknowledgements } = require('./syncAcknowledgement.cjs');
const {
  DEFAULT_WORKER_URL,
  REPORTS_WORKER_URL,
  assertWorkerHostAllowed,
} = require('./workerHostPolicy.cjs');

// Worker URL and key are resolved lazily and re-read after a TTL. This used to run once at
// module load, so rotating the key or URL in the settings UI had no effect until a restart.
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
    // VITE_REPORTS_API_KEY is read here only as a fallback for the desktop process.
    // The name is unfortunate: the portal build treats this exact variable as a sentinel
    // secret and fails if it reaches a bundle (scripts/build-reports.mjs). Prefer
    // ENGAZ_REPORTS_API_KEY, which is not a Vite-visible name and cannot collide.
    const reportsKeyMatch = envContent.match(/^\s*ENGAZ_REPORTS_API_KEY\s*=\s*([^#\r\n]*)/m)
      || envContent.match(/^\s*VITE_REPORTS_API_KEY\s*=\s*([^#\r\n]*)/m);
    if (reportsKeyMatch) result.reportsKey = reportsKeyMatch[1].trim().replace(/^(['"])(.*)\1$/, '$2');
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
  // Main-process environment supports packaged installs; never expose this through VITE.
  // Removing the credential must also clear the cached value after the TTL.
  REPORTS_WORKER_KEY = process.env.ENGAZ_REPORTS_API_KEY || fromEnv.reportsKey || '';
  configLoadedAt = now;

  // Without this key every write is silently dropped: mirrorToReports returns at its first
  // line and flushReportsOutbox reports success having sent nothing — so the manager portal
  // shows an empty day while this till reports "synced". Say so once per config load.
  if (!REPORTS_WORKER_KEY) {
    console.warn(
      '[D1 Sync API] No reports write key configured (ENGAZ_REPORTS_API_KEY or VITE_REPORTS_API_KEY). '
      + 'The manager portal will not receive this device\'s orders, customers or stock.'
    );
  }

  if (WORKER_URL !== previousUrl) {
    console.log('[D1 Sync API] Configured Worker URL:', WORKER_URL);

    // A URL change means the previous one may have been the reason rows were parked, so
    // give them their budget back. Skipped on the first load: an empty previous URL is not
    // a change of destination, and releasing then would retry rows this process never tried.
    if (previousUrl) {
      try {
        const released = database.releaseParkedSyncRows();
        if (released > 0) {
          console.log(`[D1 Sync API] Released ${released} row(s) parked against the previous worker.`);
        }
      } catch (e) {
        console.error('[D1 Sync API] Could not release parked rows:', e.message);
      }
    }
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

    // Checked here, at the one place the credential is attached, rather than where the URL is
    // configured: the URL is a renderer-writable setting, so a check at config time can be
    // bypassed by anything that reaches postJson with a different base. A key that is never
    // readable by the renderer still has to be sent, and this is where it is sent.
    //
    // Unconditional, not gated on the key being present. Requests without a key still carry
    // orders with customer phone numbers, customer records and cashier rows — data worth
    // exfiltrating on its own — and the worker URL is a renderer-writable setting, so gating
    // the check on `apiKey` handed the renderer a working exfiltration channel: clear the key
    // from settings and every subsequent request goes anywhere it likes, unchecked.
    try {
      assertWorkerHostAllowed(parsed);
    } catch (err) {
      console.error('[D1 Sync API]', err.message);
      return reject(err);
    }

    const bodyStr = JSON.stringify(body || {});
    // The transport follows the URL. workerHostPolicy deliberately allows http for
    // explicitly dev-mode local origins, so hard-coding https here made every local
    // worker unreachable: the port was honoured while the protocol was not, and a TLS
    // handshake was attempted against a plaintext port.
    const transport = parsed.protocol === 'http:' ? http : https;
    const defaultPort = parsed.protocol === 'http:' ? 80 : 443;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || defaultPort,
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

  // Reports-only mode: when no central POS worker key is configured, push writes directly
  // to the reports database so the manager portal gets the live data.
  if (!WORKER_API_KEY && REPORTS_WORKER_KEY) {
    if (endpoint.startsWith('/sync/')) {
      return mirrorToReports(endpoint, body);
    }
    // Reports-only mode has no POS database to read from. Returning an empty page made a
    // pull indistinguishable from "no remote changes", so the device looked fully synced
    // while never learning anything another branch did. Refuse instead, so the cycle
    // records a phase error and the operator can see why.
    throw new Error(`Cannot ${endpoint} in reports-only mode: no central POS worker is configured`);
  }

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

  // Persist the reports obligation BEFORE the caller may mark the local record synced.
  // Even without reports credentials the obligation survives restart. Only POS-accepted
  // records enter the reports read model; rejected/stale payloads must not diverge it.
  if (endpoint.startsWith('/sync/')) {
    const target = endpoint.replace(/^\/sync\//, '');
    const { accepted } = reconcileAcknowledgements(body?.items || [], response);
    const acceptedIds = new Set(accepted);
    for (const item of body?.items || []) {
      if (!acceptedIds.has(String(item.id))) continue;
      const version = item.updated_at || item.updatedAt || item.createdAt || new Date().toISOString();
      // A persistence failure throws: the primary record stays unsynced and can replay.
      database.enqueueReportOutbox(target, item.id, item, version);
    }
  }

  return response;
}

/**
 * Flushes pending items from the persistent SQLite reports_outbox to the isolated reports database.
 */
let outboxFlushInProgress = false;
let reportsRetryAt = 0;
let reportsFailures = 0;
let reportsLastError = null;
async function flushReportsOutbox(limit = 100) {
  loadConfig();
  // Reporting success for a flush that never ran is what hid the missing key for so long:
  // the caller has no way to tell "nothing to send" from "cannot send".
  if (!REPORTS_WORKER_KEY) return { success: false, sent: 0, error: 'reports key not configured' };
  if (outboxFlushInProgress) return { success: false, sent: 0, error: 'reports flush already in progress' };
  if (Date.now() < reportsRetryAt) {
    return { success: false, sent: 0, error: reportsLastError, retryAt: reportsRetryAt };
  }
  outboxFlushInProgress = true;
  let sentCount = 0;
  const failures = [];

  try {
    const pending = database.getPendingReportOutbox(limit);
    if (!pending || pending.length === 0) {
      reportsFailures = 0;
      reportsRetryAt = 0;
      reportsLastError = null;
      return { success: true, sent: 0 };
    }

    const grouped = new Map();
    for (const row of pending) {
      if (!grouped.has(row.target)) grouped.set(row.target, []);
      grouped.get(row.target).push(row);
    }

    for (const [target, rows] of grouped.entries()) {
      try {
        const items = rows.map(r => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));
        for (let i = 0; i < items.length; i += MAX_BATCH) {
          const chunk = items.slice(i, i + MAX_BATCH);
          const chunkRows = rows.slice(i, i + MAX_BATCH);
          const response = await postJson({
            baseUrl: REPORTS_WORKER_URL,
            endpoint: `/sync/${target}`,
            body: { items: chunk },
            apiKey: REPORTS_WORKER_KEY,
            timeout: MIRROR_TIMEOUT_MS,
          });
          const { accepted, failed } = reconcileAcknowledgements(chunk, response);
          const acceptedIds = new Set(accepted);
          for (const r of chunkRows) {
            if (!acceptedIds.has(String(r.record_id))) continue;
            sentCount += database.deleteReportOutbox(target, r.record_id, r.version);
          }
          if (failed.length) failures.push(`${target}: ${failed.length} record(s) not acknowledged`);
        }
      } catch (err) {
        console.warn(`[D1 Sync API] Reports outbox flush failed for ${target}:`, err.message);
        failures.push(`${target}: ${err.message}`);
      }
    }
  } catch (err) {
    failures.push(`Reports queue unavailable: ${err.message}`);
  } finally {
    outboxFlushInProgress = false;
  }

  if (failures.length) {
    reportsFailures++;
    reportsLastError = failures.join('; ');
    reportsRetryAt = Date.now() + Math.min(30_000 * 2 ** Math.min(reportsFailures, 6), 30 * 60_000);
    return { success: false, sent: sentCount, error: reportsLastError, retryAt: reportsRetryAt };
  }
  reportsFailures = 0;
  reportsRetryAt = 0;
  reportsLastError = null;
  return { success: true, sent: sentCount };
}

/** Reports-only delivery: failures propagate; normal POS delivery uses the durable outbox. */
async function mirrorToReports(endpoint, body) {
  loadConfig();
  if (!REPORTS_WORKER_KEY) throw new Error('reports key not configured');
  const res = await postJson({
    baseUrl: REPORTS_WORKER_URL, endpoint, body,
    apiKey: REPORTS_WORKER_KEY, timeout: MIRROR_TIMEOUT_MS,
  });
  if (res?.success !== true) throw new Error(res?.error || 'Reports mirror rejected');
  return res;
}

/** Splits a push into worker-sized chunks so a large backlog is not rejected wholesale. */
async function syncRecords(target, records) {
  if (!records || records.length === 0) return { success: true, written: 0, expected: 0, skipped: 0, acknowledged: [], failed: [] };

  // The counts the caller gets back have to mean something. `written` used to be thrown
  // away and `success` was a constant, so a till marked every row synced whether the worker
  // stored it or silently skipped it — and a row marked synced is never looked at again.
  let written = 0;
  let expected = 0;
  const failed = [];
  const acknowledged = [];

  for (let i = 0; i < records.length; i += MAX_BATCH) {
    const chunk = records.slice(i, i + MAX_BATCH);
    expected += chunk.length;
    try {
      const res = await callWorker(`/sync/${target}`, { items: chunk });
      const receipt = reconcileAcknowledgements(chunk, res);
      if (Number.isFinite(res?.written) && res.written > 0) written += res.written;
      acknowledged.push(...receipt.accepted);
      failed.push(...receipt.failed);
    } catch (err) {
      // Preserve earlier chunk acknowledgements rather than penalizing successful rows.
      failed.push(...chunk.map(row => ({ id: String(row.id), error: String(err.message).slice(0, 500) })));
    }
  }

  return { success: true, written, expected, skipped: failed.length, acknowledged, failed };
}

/**
 * Publishes the public menu's configuration to the reports database, which is what the
 * customer page reads.
 *
 * This runs here rather than in the renderer because it needs the reports write key. The
 * renderer used to hold that key through `import.meta.env`, which inlined it into every
 * bundle built from the same source — including the public menu bundle handed to customers.
 */
async function publishMenuConfig(config) {
  loadConfig();
  if (!REPORTS_WORKER_KEY) {
    return { success: false, error: 'مفتاح قاعدة التقارير غير مضبوط على هذا الجهاز' };
  }

  try {
    const res = await postJson({
      baseUrl: REPORTS_WORKER_URL,
      endpoint: '/public-menu-config',
      body: { config },
      apiKey: REPORTS_WORKER_KEY,
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (res && res.success === false) {
      return { success: false, error: res.error || 'رفض العامل نشر الإعدادات' };
    }
    return { success: true };
  } catch (e) {
    console.warn('[D1 Sync API] Menu config publish failed:', e.message);
    return { success: false, error: e.message };
  }
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

async function pushCashiers(cashiers) {
  if (cashiers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${cashiers.length} cashiers...`);
  return syncRecords('cashiers', cashiers);
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
  return syncRecords('menu-items', [{ id, deletedAt: now, updatedAt: now }]);
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Incremental pull for a shared table (menu items, customers, inventory, cashiers).
 *
 * Tombstones are included: the caller upserts rows with their deleted_at so a deletion
 * made on another branch disappears locally too, instead of only leaving the cloud.
 * Follows nextCursor pages if available.
 */
async function pullShared(target, since = null) {
  const allRows = [];
  let cursor = null;
  const MAX_PAGES = 50;
  let pageCount = 0;

  do {
    const payload = {
      since: since || null,
      cursor,
    };
    const res = await callWorker(`/pull/${target}`, payload);
    const rows = (res && res.rows) || [];
    allRows.push(...rows);
    cursor = (res && res.nextCursor) || null;
    pageCount++;
  } while (cursor && pageCount < MAX_PAGES);

  return allRows;
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
    cashierName: row.cashierName || null,
    cashierAvatar: row.cashierAvatar || null,
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
 * shared rows. Loops until nextCursor is null or MAX_PAGES is hit.
 *
 * The high-water mark is inclusive on purpose. It is max(updated_at) of the previous batch,
 * and batch writes share a millisecond timestamp, so a strict comparison skipped any row
 * carrying that exact timestamp but cut off by the limit. The local upsert is idempotent,
 * so re-fetching the boundary rows is harmless.
 */
async function pullOrders(since = null, branchId = null) {
  console.log(`[D1 Sync API] Pulling orders from D1 (since=${since || 'full'}, branch=${branchId || 'all'})...`);

  const effectiveBranch = branchId && branchId !== 'manager' ? branchId : null;
  const allOrders = [];
  let cursor = null;
  const MAX_PAGES = 50;
  let pageCount = 0;

  do {
    const payload = {
      since: since || null,
      branchId: effectiveBranch,
      cursor,
    };
    const res = await callWorker('/pull/orders', payload);
    const pageOrders = (res && (res.orders || res.rows)) || [];
    allOrders.push(...pageOrders);
    cursor = (res && res.nextCursor) || null;
    pageCount++;
  } while (cursor && pageCount < MAX_PAGES);

  return allOrders.map(mapOrderRow);
}

async function pullCashiers(since = null, branchId = null) {
  console.log(`[D1 Sync API] Pulling cashiers from D1 (since=${since || 'full'}, branch=${branchId || 'all'})...`);

  const effectiveBranch = branchId && branchId !== 'manager' ? branchId : null;
  const allCashiers = [];
  let cursor = null;
  const MAX_PAGES = 50;
  let pageCount = 0;

  do {
    const payload = {
      since: since || null,
      branchId: effectiveBranch,
      cursor,
    };
    const res = await callWorker('/pull/cashiers', payload);
    const rows = (res && (res.cashiers || res.rows)) || [];
    allCashiers.push(...rows);
    cursor = (res && res.nextCursor) || null;
    pageCount++;
  } while (cursor && pageCount < MAX_PAGES);

  return allCashiers;
}

/** Liveness probe used by the sync engine's connectivity check. */
async function checkWorkerHealth() {
  loadConfig();
  const targetUrl = (!WORKER_API_KEY && REPORTS_WORKER_KEY) ? REPORTS_WORKER_URL : WORKER_URL;
  try {
    // The same allowlist as postJson. This probe builds its own request instead of going
    // through postJson, so it used to be the one path that reached the network unchecked:
    // a renderer that set the worker URL to its own host would be answered here even though
    // every real call was refused.
    const parsedUrl = assertWorkerHostAllowed(targetUrl);
    // Same transport rule as postJson: an http worker must be dialled over http.
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const defaultPort = parsedUrl.protocol === 'http:' ? 80 : 443;
    await new Promise((resolve, reject) => {
      const req = transport.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || defaultPort,
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

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCashiers,
  pushCustomers,
  pushInventory,
  pushInventoryTransactions,
  pushPointsTransactions,
  pullOrders,
  pullCashiers,
  pullShared,
  deleteMenuItem,
  publishMenuConfig,
  checkWorkerHealth,
  flushReportsOutbox,
  mirrorToReports,
};
