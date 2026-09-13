const Database = require('better-sqlite3');
const path = require('path');

let electronApp;
try {
  electronApp = require('electron').app;
} catch {
  electronApp = null;
}

let db;

// ─── Helper: get current branch ID from settings (default: 'default') ────────
function getBranchId() {
  try {
    const sqlite = getDb();
    const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'branch_id'").get();
    return row ? row.value : 'default';
  } catch (e) {
    return 'default';
  }
}

function initDatabase(customPathOrDb = null) {
  if (customPathOrDb) {
    if (db && db.open) db.close();
    if (typeof customPathOrDb === 'string') {
      db = new Database(customPathOrDb);
    } else {
      db = customPathOrDb;
    }
  } else {
    if (db && db.open) return db;
    const userDataPath = (electronApp && typeof electronApp.getPath === 'function')
      ? electronApp.getPath('userData')
      : path.join(process.cwd(), '.tmp-user-data');
    const dbPath = path.join(userDataPath, 'engaz.db');
    console.log('[database] Initializing SQLite database at:', dbPath);
    db = new Database(dbPath);
  }
  
  // Enable WAL mode for better concurrency/performance
  db.pragma('journal_mode = WAL');
  // Under WAL a second instance upgrading to a write lock fails immediately with
  // SQLITE_BUSY instead of waiting. Wait up to 5s so concurrent writes serialize
  // rather than throwing — this is what protects the daily order counter.
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Settings table must exist before anything that reads/writes flags (seeded_*)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS reports_outbox (
      target TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      version TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      PRIMARY KEY (target, record_id)
    )
  `).run();

  // Migration bookkeeping: every migration runs exactly once (Issue 29)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    )
  `).run();

  // One-time rename of the legacy `menu` table to `menu_items` (Issue 15).
  // Must run BEFORE CREATE TABLE menu_items so existing installs keep their data.
  if (!isMigrationApplied('0011_rename_menu_to_menu_items')) {
    try {
      const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu'").get();
      if (legacy) {
        db.prepare('ALTER TABLE menu RENAME TO menu_items').run();
        console.log('[database] Renamed legacy table "menu" to "menu_items".');
      }
      markMigrationApplied('0011_rename_menu_to_menu_items');
    } catch (e) {
      console.error('[database] Failed to rename menu table:', e);
    }
  }

  // Create menu table (canonical local name: menu_items, unified with cloud D1 — Issue 15)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image TEXT,
      available INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  // Create orders table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      orderNumber TEXT NOT NULL,
      tableId TEXT NOT NULL,
      items TEXT NOT NULL, -- JSON string
      status TEXT NOT NULL,
      paymentStatus TEXT NOT NULL DEFAULT 'Unpaid',
      paymentMethod TEXT,
      totalAmount REAL NOT NULL,
      subtotal REAL,
      taxRate REAL,
      taxAmount REAL,
      grandTotal REAL,
      paidAmount REAL,
      createdAt TEXT NOT NULL,
      paidAt TEXT
    )
  `).run();
  
  // Create customers table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `).run();

  // Create inventory tables
  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      minStock REAL NOT NULL DEFAULT 0,
      costPerUnit REAL NOT NULL DEFAULT 0,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS menu_recipes (
      menuItemId TEXT NOT NULL,
      inventoryItemId TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (menuItemId, inventoryItemId)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      referenceId TEXT,
      createdAt TEXT NOT NULL,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )
  `).run();




  // Create cashiers table (per-branch list of till operators)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS cashiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `).run();
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN created_at TEXT");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN updated_at TEXT");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN deleted_at TEXT");
  // Cashier photo stored as a small base64 data URL (resized in the renderer before upload)
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN avatar TEXT");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE cashiers ADD COLUMN last_error TEXT");

  // Migration: Add paidAt column if table already existed without it
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN paidAt TEXT');

  // Migration: Add customer columns to orders
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN customerPhone TEXT');
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0');
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0');

  // Cashier snapshot attached to each order; printed on later reprints too
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN cashierName TEXT');
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN cashierAvatar TEXT');

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 Migration: Add branch_id, is_synced, created_at, updated_at
  // columns to menu, orders, and customers tables for multi-branch sync.
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Menu table: add sync columns ---
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN created_at TEXT");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN updated_at TEXT");

  // --- Orders table: add sync and payment snapshot columns ---
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN updated_at TEXT");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN subtotal REAL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN taxRate REAL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN taxAmount REAL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN grandTotal REAL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN paidAmount REAL");

  // --- Customers table: add sync columns (createdAt already exists) ---
  addColumnIfMissing(db, "ALTER TABLE customers ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE customers ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE customers ADD COLUMN updated_at TEXT");

  // Backfill: set timestamps on existing rows that have NULL created_at/updated_at
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE menu_items SET created_at = ? WHERE created_at IS NULL").run(now);
    db.prepare("UPDATE menu_items SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE orders SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE customers SET updated_at = ? WHERE updated_at IS NULL").run(now);
    console.log('[database] Phase 1 sync columns migration complete.');
  } catch (e) {
    console.error('[database] Failed to backfill sync timestamps:', e);
  }



  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2 Migrations: soft delete, retry tracking, tax snapshot, loyalty ledger,
  // inventory transaction sync, indexes. Each runs exactly once (Issue 29).
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMigrationApplied('0012_phase2_columns')) {
    try {
      const alter = (sql) => addColumnIfMissing(db, sql);

      // Soft delete tombstones (Issue 20)
      alter("ALTER TABLE orders ADD COLUMN deleted_at TEXT");
      alter("ALTER TABLE customers ADD COLUMN deleted_at TEXT");
      alter("ALTER TABLE menu_items ADD COLUMN deleted_at TEXT");
      alter("ALTER TABLE inventory ADD COLUMN deleted_at TEXT");

      // Sync retry tracking (Issue 19)
      alter("ALTER TABLE orders ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0");
      alter("ALTER TABLE orders ADD COLUMN last_error TEXT");
      alter("ALTER TABLE customers ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0");
      alter("ALTER TABLE customers ADD COLUMN last_error TEXT");
      alter("ALTER TABLE menu_items ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0");
      alter("ALTER TABLE menu_items ADD COLUMN last_error TEXT");
      alter("ALTER TABLE inventory ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0");
      alter("ALTER TABLE inventory ADD COLUMN last_error TEXT");

      // Tax snapshot fields on orders (Issue 25)
      alter("ALTER TABLE orders ADD COLUMN subtotal REAL");
      alter("ALTER TABLE orders ADD COLUMN taxRate REAL");
      alter("ALTER TABLE orders ADD COLUMN taxAmount REAL");
      alter("ALTER TABLE orders ADD COLUMN grandTotal REAL");

      // What the till actually collected. Differs from grandTotal whenever loyalty points
      // were redeemed; without it every discounted order reported its full total as revenue.
      alter("ALTER TABLE orders ADD COLUMN paidAmount REAL");

      // Inventory transactions: sync column naming (Issue 27) — add updated_at for tombstone sync
      alter("ALTER TABLE inventory_transactions ADD COLUMN deleted_at TEXT");

      db.transaction(() => {
        // Loyalty points ledger (Issue 26)
        db.prepare(`
          CREATE TABLE IF NOT EXISTS points_transactions (
            id TEXT PRIMARY KEY,
            customerId TEXT NOT NULL,
            orderId TEXT,
            type TEXT NOT NULL,
            points REAL NOT NULL,
            balanceAfter REAL,
            createdAt TEXT NOT NULL,
            branch_id TEXT DEFAULT NULL,
            is_synced INTEGER NOT NULL DEFAULT 0
          )
        `).run();

        // Indexes on hot query columns (Issue 66 support)
        const idx = (sql) => createIndexIfPossible(db, sql);
        idx("CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt)");
        idx("CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id)");
        idx("CREATE INDEX IF NOT EXISTS idx_orders_synced ON orders(is_synced)");
        idx("CREATE INDEX IF NOT EXISTS idx_orders_deleted ON orders(deleted_at)");
        idx("CREATE INDEX IF NOT EXISTS idx_inv_tx_ref ON inventory_transactions(referenceId)");
        idx("CREATE INDEX IF NOT EXISTS idx_inv_tx_synced ON inventory_transactions(is_synced)");
        idx("CREATE INDEX IF NOT EXISTS idx_menu_synced ON menu_items(is_synced)");
        idx("CREATE INDEX IF NOT EXISTS idx_customers_synced ON customers(is_synced)");
        idx("CREATE INDEX IF NOT EXISTS idx_points_tx_customer ON points_transactions(customerId)");
      })();

      markMigrationApplied('0012_phase2_columns');
      console.log('[database] Phase 2 migration complete (soft delete, retry tracking, tax snapshot, loyalty ledger).');
    } catch (e) {
      // Do NOT mark the migration applied here. Recording a failed migration as done
      // leaves columns permanently missing while all downstream code assumes they exist.
      console.error('[database] Phase 2 migration failed and was NOT recorded; it will retry on next start:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 0013: retry tracking on the two ledger tables. markSyncFailure and the
  // getUnsynced* queries reference sync_attempts for every syncable table, but
  // 0012 only added the column to four of the six.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMigrationApplied('0013_ledger_retry_tracking')) {
    try {
      const columnExists = (table, column) => {
        try {
          return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
        } catch (e) {
          return false;
        }
      };
      const addColumn = (table, column, definition) => {
        if (columnExists(table, column)) return;
        // No try/catch swallow: a real failure must propagate so the migration is not
        // recorded as applied.
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      };

      for (const table of ['inventory_transactions', 'points_transactions']) {
        addColumn(table, 'sync_attempts', 'INTEGER NOT NULL DEFAULT 0');
        addColumn(table, 'last_error', 'TEXT');
      }

      markMigrationApplied('0013_ledger_retry_tracking');
      console.log('[database] Migration 0013 complete (retry tracking on ledger tables).');
    } catch (e) {
      console.error('[database] Migration 0013 failed and was NOT recorded; it will retry on next start:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 0014: paidAmount on orders table. Ensures databases that applied 0012 before
  // paidAmount was added receive the column.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMigrationApplied('0014_orders_paid_amount')) {
    try {
      addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN paidAmount REAL");
      markMigrationApplied('0014_orders_paid_amount');
      console.log('[database] Migration 0014 complete (paidAmount on orders).');
    } catch (e) {
      console.error('[database] Migration 0014 failed and was NOT recorded; it will retry on next start:', e);
    }
  }

  // Migration: Smart re-categorize all menu items to MenuCategory|PrepDestination format
  // This uses item names to determine the correct menu category for QR menu display
  // Runs exactly once — never re-touches live menu data (Issue 29)
  if (!isMigrationApplied('0010_menu_categories')) {
  try {
    const allItems = db.prepare('SELECT id, name, category FROM menu_items').all();
    const updateStmt = db.prepare('UPDATE menu_items SET category = ? WHERE id = ?');
    
    db.transaction(() => {
      for (const item of allItems) {
        const nameLower = (item.name || '').toLowerCase();
        const currentCat = item.category || '';
        
        // Skip items already in correct new format with proper menu category (not just Hot Coffee|Bar for everything)
        // We re-run this to fix items that were incorrectly all set to Hot Coffee|Bar
        
        let menuCategory = '';
        let prepDest = '';
        
        // Determine preparation destination
        // If already has a pipe, extract existing prep destination
        if (currentCat.includes('|')) {
          prepDest = currentCat.split('|')[1] || 'Bar';
        } else if (currentCat === 'Kitchen' || currentCat === 'Food' || currentCat === 'Chicken Meals') {
          prepDest = 'Kitchen';
        } else {
          prepDest = 'Bar';
        }
        
        // If prep destination is Kitchen, map to specific menu sub-categories
        if (prepDest === 'Kitchen') {
          const friesKeywords = ['fries', 'بطاطس', 'مقبلات', 'سناكس'];
          const dessertKeywords = ['cake', 'brownie', 'كيك', 'براوني', 'حلويات', 'fudge', 'فادج'];
          
          if (dessertKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'حلويات';
          } else if (friesKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'مقبلات';
          } else {
            menuCategory = 'ساندوتشات';
          }
        } else {
          // Determine menu category from item name for bar items
          const icedKeywords = ['iced', 'cold brew', 'cold', 'mint lemonade', 'peach iced', 'passion fruit', 'mojito', 'lemonade', 'بارد', 'مثلج', 'نعناع', 'خوخ', 'موهيتو', 'ليمون', 'عصير', 'أيس', 'ايس'];
          const frappeKeywords = ['frappe', 'frappé', 'فرابيه'];
          const milkshakeKeywords = ['milkshake', 'milk shake', 'ميلك شيك', 'شيك'];
          
          if (frappeKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Frappe';
          } else if (milkshakeKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Milkshakes';
          } else if (icedKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Iced Coffee';
          } else {
            menuCategory = 'Hot Coffee';
          }
        }
        
        const newCategory = `${menuCategory}|${prepDest}`;
        if (newCategory !== currentCat) {
          updateStmt.run(newCategory, item.id);
        }
      }
    })();
    
    markMigrationApplied('0010_menu_categories');
    console.log('[database] Successfully migrated menu categories to MenuCategory|PrepDestination format');
  } catch (e) {
    console.error('[database] Failed to run menu categories migration:', e);
  }
  }
}

// ─── Schema helpers ──────────────────────────────────────────────────────────

/** True when a table already has the named column. */
function columnExists(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  } catch (e) {
    // The table itself does not exist yet, so the column certainly does not.
    return false;
  }
}

/**
 * Adds a column only when it is missing.
 *
 * ALTER TABLE ADD COLUMN fails when the column is already there, which is the normal case
 * on an upgraded database. Checking first means a genuine failure — a locked database, a
 * full disk — still surfaces instead of being indistinguishable from "already applied".
 */
function addColumnIfMissing(db, sql) {
  const match = /ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(sql);
  if (match && columnExists(db, match[1], match[2])) return;
  db.prepare(sql).run();
}

/** Creates an index, tolerating a table that does not exist on an older schema. */
function createIndexIfPossible(db, sql) {
  try {
    db.prepare(sql).run();
  } catch (e) {
    console.warn('[database] Skipped index (table not present yet):', e.message);
  }
}

// ─── Migration bookkeeping helpers (Issue 29) ────────────────────────────────
function isMigrationApplied(name) {
  // Fail closed. Returning false on a transient read error used to re-run data-mutating
  // migrations — including 0010_menu_categories, which rewrites the category column of
  // every live menu item. Treating an unreadable ledger as "already applied" is the safe
  // direction: a skipped migration is recoverable, a repeated bulk UPDATE is not.
  if (!db) return true;
  try {
    const row = db.prepare('SELECT name FROM migrations WHERE name = ?').get(name);
    return !!row;
  } catch (e) {
    console.error('[database] Could not read the migrations ledger; skipping', name, '-', e.message);
    return true;
  }
}

function markMigrationApplied(name) {
  try {
    db.prepare('INSERT OR REPLACE INTO migrations (name, appliedAt) VALUES (?, ?)').run(name, new Date().toISOString());
  } catch (e) {
    console.error('[database] Failed to mark migration applied:', name, e);
  }
}

// Ensure database is initialized
function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

// --- Settings & Metadata Persistence ---

function getSettings() {
  const sqlite = getDb();
  try {
    const rows = sqlite.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  } catch (e) {
    console.error('[database] Failed to get settings:', e);
    return {};
  }
}

function saveSetting(key, value) {
  const sqlite = getDb();
  try {
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  } catch (e) {
    console.error('[database] Failed to save setting:', e);
    throw e;
  }
}

function deleteSetting(key) {
  const sqlite = getDb();
  try {
    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } catch (e) {
    console.error('[database] Failed to delete setting:', e);
  }
}

function getSyncStats() {
  const sqlite = getDb();
  try {
    // Tombstones (deleted_at IS NOT NULL, is_synced = 0) are exactly what still needs
    // pushing. Excluding them made totalPending 0 whenever the only pending change was
    // a deletion, and syncEngine returns early on 0 — so deletions never left the device.
    const menuCount = sqlite.prepare('SELECT COUNT(*) as count FROM menu_items WHERE is_synced = 0').get().count;
    const ordersCount = sqlite.prepare('SELECT COUNT(*) as count FROM orders WHERE is_synced = 0').get().count;
    const customersCount = sqlite.prepare('SELECT COUNT(*) as count FROM customers WHERE is_synced = 0').get().count;
    const inventoryCount = sqlite.prepare('SELECT COUNT(*) as count FROM inventory WHERE is_synced = 0').get().count;
    const invTxCount = sqlite.prepare('SELECT COUNT(*) as count FROM inventory_transactions WHERE is_synced = 0').get().count;
    const cashiersCount = sqlite.prepare('SELECT COUNT(*) as count FROM cashiers WHERE is_synced = 0').get().count;
    const pointsCount = sqlite.prepare('SELECT COUNT(*) as count FROM points_transactions WHERE is_synced = 0').get().count;
    const reportsCount = sqlite.prepare('SELECT COUNT(*) as count FROM reports_outbox').get().count;
    return {
      pendingMenu: menuCount,
      pendingOrders: ordersCount,
      pendingCustomers: customersCount,
      pendingInventory: inventoryCount + invTxCount,
      pendingCashiers: cashiersCount,
      pendingPoints: pointsCount,
      pendingReports: reportsCount,
      totalPending: menuCount + ordersCount + customersCount + inventoryCount + invTxCount + cashiersCount + pointsCount + reportsCount
    };
  } catch (e) {
    console.error('[database] Failed to get sync stats:', e);
    throw e;
  }
}

// ─── Atomic daily order counter (Issue 23) ───────────────────────────────────
// Counter lives in the settings table as daily_counter:YYYY-MM-DD (local date)
// and is incremented atomically inside the order-creation transaction.
function nextDailyOrderNumber(localDateStr) {
  const sqlite = getDb();
  const key = `daily_counter:${localDateStr}`;
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const next = (row ? parseInt(row.value, 10) || 0 : 0) + 1;
  sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(next));
  return next;
}

/**
 * The number the next order will receive, without consuming it. The POS screen used to show
 * the count of all loaded orders plus one, which is a different measure entirely from this
 * counter — the counter resets each local day.
 */
function peekDailyOrderNumber(localDateStr) {
  const sqlite = getDb();
  const date = localDateStr || new Date().toLocaleDateString('en-CA');
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(`daily_counter:${date}`);
  return (row ? parseInt(row.value, 10) || 0 : 0) + 1;
}

// ─── Sync metadata helpers (Issue 19) ────────────────────────────────────────
const SYNCABLE_TABLES = new Set(['orders', 'customers', 'menu_items', 'inventory', 'inventory_transactions', 'points_transactions', 'cashiers']);

// After this many consecutive failures a row is parked instead of retried forever.
// sync_attempts was previously incremented and never read, so one malformed row
// blocked its whole table's batch on every cycle indefinitely.
const MAX_SYNC_ATTEMPTS = 5;

function markSyncFailure(table, ids, errorMessage, snapshots) {
  if (!SYNCABLE_TABLES.has(table) || !ids || ids.length === 0) return;
  const sqlite = getDb();
  try {
    const versions = snapshots ? new Map((snapshots || []).map(row => [row.id, row.updatedAt ?? row.updated_at ?? null])) : null;
    const stmt = versions
      ? sqlite.prepare(`UPDATE ${table} SET sync_attempts = sync_attempts + 1, last_error = ? WHERE id = ? AND (updated_at IS ? OR updated_at IS NULL)`)
      : sqlite.prepare(`UPDATE ${table} SET sync_attempts = sync_attempts + 1, last_error = ? WHERE id = ?`);
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        if (versions) {
          if (!versions.has(id)) continue;
          stmt.run(String(errorMessage || 'sync failed').slice(0, 500), id, versions.get(id));
        } else {
          stmt.run(String(errorMessage || 'sync failed').slice(0, 500), id);
        }
      }
    });
    runTx(ids);

    const parked = sqlite
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE is_synced = 0 AND sync_attempts >= ?`)
      .get(MAX_SYNC_ATTEMPTS).count;
    if (parked > 0) {
      console.warn(`[database] ${parked} row(s) in ${table} parked after ${MAX_SYNC_ATTEMPTS} failed attempts; they need manual attention.`);
    }
  } catch (e) {
    console.error(`[database] Failed to record sync failure for ${table}:`, e);
  }
}

/** Rows that have exhausted their retry budget and are excluded from push batches. */
function getParkedSyncRows() {
  const sqlite = getDb();
  const parked = [];
  for (const table of SYNCABLE_TABLES) {
    try {
      const rows = sqlite
        .prepare(`SELECT id, sync_attempts, last_error FROM ${table} WHERE is_synced = 0 AND sync_attempts >= ?`)
        .all(MAX_SYNC_ATTEMPTS);
      for (const row of rows) parked.push({ table, ...row });
    } catch (e) {
      // A table may not exist yet on an older schema; that is not an error here.
    }
  }
  return parked;
}

/** Clear the retry budget so parked rows are attempted again. */
function resetSyncAttempts(table, ids = null) {
  if (!SYNCABLE_TABLES.has(table)) return 0;
  const sqlite = getDb();
  try {
    if (ids && ids.length > 0) {
      const stmt = sqlite.prepare(`UPDATE ${table} SET sync_attempts = 0, last_error = NULL WHERE id = ?`);
      const runTx = sqlite.transaction((idList) => {
        for (const id of idList) stmt.run(id);
      });
      runTx(ids);
      return ids.length;
    }
    const info = sqlite.prepare(`UPDATE ${table} SET sync_attempts = 0, last_error = NULL WHERE is_synced = 0`).run();
    return info.changes;
  } catch (e) {
    console.error(`[database] Failed to reset sync attempts for ${table}:`, e);
    return 0;
  }
}

/** Enqueues or updates an item in the persistent SQLite outbox for reports mirror. */
function enqueueReportOutbox(target, recordId, payload, version = null) {
  const sqlite = getDb();
  const now = new Date().toISOString();
  const v = version || now;
  const rawPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    sqlite.prepare(`
      INSERT INTO reports_outbox (target, record_id, payload, version, queued_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target, record_id) DO UPDATE SET
        payload = excluded.payload,
        version = excluded.version,
        queued_at = excluded.queued_at
      WHERE excluded.version >= reports_outbox.version OR reports_outbox.version IS NULL
    `).run(target, recordId, rawPayload, v, now);
  } catch (e) {
    console.error(`[database] Failed to enqueue reports_outbox for ${target}/${recordId}:`, e);
  }
}

/** Fetches pending outbox records ordered chronologically. */
function getPendingReportOutbox(limit = 100) {
  const sqlite = getDb();
  try {
    return sqlite.prepare(`
      SELECT target, record_id, payload, version, queued_at
      FROM reports_outbox
      ORDER BY queued_at ASC
      LIMIT ?
    `).all(limit);
  } catch (e) {
    console.error('[database] Failed to read reports_outbox:', e);
    return [];
  }
}

/** Deletes a record from the outbox if its version hasn't been updated. */
function deleteReportOutbox(target, recordId, version = null) {
  const sqlite = getDb();
  try {
    if (version) {
      sqlite.prepare(`
        DELETE FROM reports_outbox
        WHERE target = ? AND record_id = ? AND version <= ?
      `).run(target, recordId, version);
    } else {
      sqlite.prepare(`
        DELETE FROM reports_outbox
        WHERE target = ? AND record_id = ?
      `).run(target, recordId);
    }
  } catch (e) {
    console.error('[database] Failed to delete from reports_outbox:', e);
  }
}

function closeDatabase() {
  if (db && db.open) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDb,
  getBranchId,
  getSettings,
  saveSetting,
  deleteSetting,
  getSyncStats,
  nextDailyOrderNumber,
  peekDailyOrderNumber,
  markSyncFailure,
  getParkedSyncRows,
  resetSyncAttempts,
  enqueueReportOutbox,
  getPendingReportOutbox,
  deleteReportOutbox,
  MAX_SYNC_ATTEMPTS
};
