const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

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

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'brewmaster.db');
  console.log('[database] Initializing SQLite database at:', dbPath);
  
  db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency/performance
  db.pragma('journal_mode = WAL');

  // Create menu table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS menu (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image TEXT,
      available INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  // Auto-seed to 40 items if current database has fewer items
  try {
    const count = db.prepare('SELECT COUNT(*) as count FROM menu').get().count;
    if (count < 40) {
      console.log('[database] SQLite menu has fewer than 40 items. Seeding/Updating to 40 items...');
      const seedData = require('./seed_data.cjs');
      const insert = db.prepare(`
        INSERT OR REPLACE INTO menu (id, name, description, price, category, image, available)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        db.prepare('DELETE FROM menu').run();
        for (const item of seedData) {
          insert.run(
            item.id,
            item.name,
            item.description,
            item.price,
            item.category,
            item.image,
            item.available ? 1 : 0
          );
        }
      })();
      console.log('[database] Auto-seeding complete! Total menu items:', db.prepare('SELECT COUNT(*) as count FROM menu').get().count);
    }
  } catch (err) {
    console.error('[database] Auto-seeding SQLite database failed:', err);
  }

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

  // Create settings table for persistence of localStorage settings
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

  // Seed default inventory items if count is 0
  try {
    const invCount = db.prepare('SELECT COUNT(*) as count FROM inventory').get().count;
    if (invCount === 0) {
      console.log('[database] Seeding default inventory items...');
      const now = new Date().toISOString();
      const insertInv = db.prepare(`
        INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'default', 0, ?, ?)
      `);
      
      const seedInventory = [
        { id: 'inv-beans', name: 'Espresso Coffee Beans', unit: 'kg', stock: 15.0, minStock: 3.0, cost: 25.00 },
        { id: 'inv-milk', name: 'Whole Milk', unit: 'liter', stock: 40.0, minStock: 10.0, cost: 1.50 },
        { id: 'inv-sugar', name: 'White Sugar', unit: 'kg', stock: 10.0, minStock: 2.0, cost: 1.10 },
        { id: 'inv-caramel', name: 'Caramel Syrup', unit: 'liter', stock: 5.0, minStock: 1.0, cost: 12.00 },
        { id: 'inv-vanilla', name: 'Vanilla Syrup', unit: 'liter', stock: 5.0, minStock: 1.0, cost: 12.00 },
        { id: 'inv-cups', name: 'Paper Cups (12oz)', unit: 'piece', stock: 500.0, minStock: 100.0, cost: 0.15 },
        { id: 'inv-beef', name: 'Prime Beef Patty (150g)', unit: 'piece', stock: 100.0, minStock: 20.0, cost: 2.50 },
        { id: 'inv-buns', name: 'Burger Buns', unit: 'piece', stock: 100.0, minStock: 20.0, cost: 0.50 },
        { id: 'inv-cheese', name: 'Cheddar Cheese Slices', unit: 'piece', stock: 150.0, minStock: 30.0, cost: 0.30 },
        { id: 'inv-fries', name: 'Potato Fries', unit: 'kg', stock: 20.0, minStock: 5.0, cost: 2.00 }
      ];

      db.transaction(() => {
        for (const item of seedInventory) {
          insertInv.run(item.id, item.name, item.unit, item.stock, item.minStock, item.cost, now, now);
        }
      })();
      console.log('[database] Seeded default inventory items.');
    }
  } catch (err) {
    console.error('[database] Seeding default inventory items failed:', err);
  }

  // Seed default recipes if count is 0
  try {
    const recCount = db.prepare('SELECT COUNT(*) as count FROM menu_recipes').get().count;
    if (recCount === 0) {
      console.log('[database] Seeding default menu recipes...');
      const insertRec = db.prepare(`
        INSERT INTO menu_recipes (menuItemId, inventoryItemId, quantity)
        VALUES (?, ?, ?)
      `);
      
      const seedRecipes = [
        // Espresso (id '1') -> beans: 9g, cups: 1
        { menuItemId: '1', inventoryItemId: 'inv-beans', quantity: 0.009 },
        { menuItemId: '1', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Double Espresso (id '2') -> beans: 18g, cups: 1
        { menuItemId: '2', inventoryItemId: 'inv-beans', quantity: 0.018 },
        { menuItemId: '2', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Cortado (id '3') -> beans: 12g, milk: 0.05L, cups: 1
        { menuItemId: '3', inventoryItemId: 'inv-beans', quantity: 0.012 },
        { menuItemId: '3', inventoryItemId: 'inv-milk', quantity: 0.05 },
        { menuItemId: '3', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Flat White (id '4') -> beans: 18g, milk: 0.12L, cups: 1
        { menuItemId: '4', inventoryItemId: 'inv-beans', quantity: 0.018 },
        { menuItemId: '4', inventoryItemId: 'inv-milk', quantity: 0.12 },
        { menuItemId: '4', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Cafe Latte (id '5') -> beans: 15g, milk: 0.20L, cups: 1
        { menuItemId: '5', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '5', inventoryItemId: 'inv-milk', quantity: 0.2 },
        { menuItemId: '5', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Cappuccino (id '6') -> beans: 15g, milk: 0.18L, cups: 1
        { menuItemId: '6', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '6', inventoryItemId: 'inv-milk', quantity: 0.18 },
        { menuItemId: '6', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // Spanish Latte (id '7') -> beans: 15g, milk: 0.20L, sweet (caramel): 20ml, cups: 1
        { menuItemId: '7', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '7', inventoryItemId: 'inv-milk', quantity: 0.2 },
        { menuItemId: '7', inventoryItemId: 'inv-caramel', quantity: 0.02 },
        { menuItemId: '7', inventoryItemId: 'inv-cups', quantity: 1 }
      ];

      db.transaction(() => {
        for (const rec of seedRecipes) {
          insertRec.run(rec.menuItemId, rec.inventoryItemId, rec.quantity);
        }
      })();
      console.log('[database] Seeded default menu recipes.');
    }
  } catch (err) {
    console.error('[database] Seeding default recipes failed:', err);
  }



  // Migration: Add paidAt column if table already existed without it
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN paidAt TEXT').run();
  } catch (e) {
    // Column already exists or table didn't exist yet
  }

  // Migration: Add customer columns to orders
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN customerPhone TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0').run();
  } catch (e) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 Migration: Add branch_id, is_synced, created_at, updated_at
  // columns to menu, orders, and customers tables for multi-branch sync.
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Menu table: add sync columns ---
  try { db.prepare("ALTER TABLE menu ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN created_at TEXT").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // --- Orders table: add sync columns (createdAt already exists) ---
  try { db.prepare("ALTER TABLE orders ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // --- Customers table: add sync columns (createdAt already exists) ---
  try { db.prepare("ALTER TABLE customers ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE customers ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE customers ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // Backfill: set timestamps on existing rows that have NULL created_at/updated_at
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE menu SET created_at = ? WHERE created_at IS NULL").run(now);
    db.prepare("UPDATE menu SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE orders SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE customers SET updated_at = ? WHERE updated_at IS NULL").run(now);
    console.log('[database] Phase 1 sync columns migration complete.');
  } catch (e) {
    console.error('[database] Failed to backfill sync timestamps:', e);
  }

  // Migration: Update existing mock/legacy orders to Dine-in/Takeaway and reset them as new orders today
  try {
    const legacyCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE tableId LIKE 'Table %'").get().count;
    if (legacyCount > 0) {
      console.log('[database] Migrating legacy orders to Dine-in/Takeaway and resetting status...');
      const rows = db.prepare("SELECT * FROM orders ORDER BY createdAt ASC").all();
      
      const updateStmt = db.prepare(`
        UPDATE orders 
        SET orderNumber = ?, tableId = ?, status = 'New', paymentStatus = 'Unpaid', paymentMethod = NULL, paidAt = NULL, createdAt = ? 
        WHERE id = ?
      `);
      
      const runTx = db.transaction(() => {
        let i = 1;
        const now = new Date();
        for (const row of rows) {
          const tableId = (i % 2 === 1) ? 'Dine-in' : 'Takeaway';
          const orderTime = new Date(now.getTime() - 1000 * 60 * (rows.length - i) * 3).toISOString();
          updateStmt.run(String(i), tableId, orderTime, row.id);
          i++;
        }
      });
      runTx();
    }
  } catch (e) {
    console.error('[database] Failed to run legacy orders migration:', e);
  }

  // Migration: Update categories of existing menu items to Kitchen or Bar
  try {
    db.prepare(`
      UPDATE menu 
      SET category = 'Bar' 
      WHERE category IN ('Hot Coffee', 'Iced Coffee', 'Frappe', 'Milkshakes', 'قهوة ساخنة', 'قهوة باردة', 'فرابيه', 'ميلك شيك')
    `).run();
    db.prepare(`
      UPDATE menu 
      SET category = 'Kitchen' 
      WHERE category IN ('Food', 'Chicken Meals', 'وجبات دجاج', 'مأكولات', 'ساندوتشات')
    `).run();
    console.log('[database] Successfully migrated menu categories to Kitchen / Bar');
  } catch (e) {
    console.error('[database] Failed to run menu categories migration:', e);
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
    const menuCount = sqlite.prepare('SELECT COUNT(*) as count FROM menu WHERE is_synced = 0').get().count;
    const ordersCount = sqlite.prepare('SELECT COUNT(*) as count FROM orders WHERE is_synced = 0').get().count;
    const customersCount = sqlite.prepare('SELECT COUNT(*) as count FROM customers WHERE is_synced = 0').get().count;
    return {
      pendingMenu: menuCount,
      pendingOrders: ordersCount,
      pendingCustomers: customersCount,
      totalPending: menuCount + ordersCount + customersCount
    };
  } catch (e) {
    console.error('[database] Failed to get sync stats:', e);
    return { pendingMenu: 0, pendingOrders: 0, pendingCustomers: 0, totalPending: 0 };
  }
}

module.exports = {
  initDatabase,
  getDb,
  getBranchId,
  getSettings,
  saveSetting,
  deleteSetting,
  getSyncStats
};
