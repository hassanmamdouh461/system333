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
  const dbPath = path.join(app.getPath('userData'), 'engaz.db');
  console.log('[database] Initializing SQLite database at:', dbPath);
  
  db = new Database(dbPath);
  
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

  // Seed default menu ONCE on first install only (Issue 28 — no more destructive auto-reseed)
  try {
    const count = db.prepare('SELECT COUNT(*) as count FROM menu_items').get().count;
    const alreadySeeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded_menu_v1'").get();
    if (count === 0 && !alreadySeeded) {
      console.log('[database] First install: seeding default menu items...');
      const seedData = require('./seed_data.cjs');
      const insert = db.prepare(`
        INSERT OR IGNORE INTO menu_items (id, name, description, price, category, image, available)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
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
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_menu_v1', ?)").run(new Date().toISOString());
      console.log('[database] Menu seeding complete! Total menu items:', db.prepare('SELECT COUNT(*) as count FROM menu_items').get().count);
    }
  } catch (err) {
    console.error('[database] Seeding menu database failed:', err);
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

  // Seed default inventory items ONCE on first install only (Issue 28 — no destructive reseed)
  try {
    const invCount = db.prepare('SELECT COUNT(*) as count FROM inventory').get().count;
    const alreadySeeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded_inventory_v1'").get();
    if (invCount === 0 && !alreadySeeded) {
      console.log('[database] First install: seeding default inventory items for active branch...');
      const now = new Date().toISOString();
      const branchId = getBranchId();

      const insertInv = db.prepare(`
        INSERT OR IGNORE INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      
      const seedInventory = [
        { id: 'inv-beans', name: 'Espresso Coffee Beans', unit: 'kg', stock: 50.0, minStock: 5.0, cost: 25.00 },
        { id: 'inv-milk', name: 'Whole Milk', unit: 'liter', stock: 100.0, minStock: 10.0, cost: 1.50 },
        { id: 'inv-sugar', name: 'White Sugar', unit: 'kg', stock: 50.0, minStock: 5.0, cost: 1.10 },
        { id: 'inv-caramel', name: 'Caramel Syrup', unit: 'liter', stock: 20.0, minStock: 2.0, cost: 12.00 },
        { id: 'inv-vanilla', name: 'Vanilla Syrup', unit: 'liter', stock: 20.0, minStock: 2.0, cost: 12.00 },
        { id: 'inv-cups', name: 'Paper Cups (12oz)', unit: 'piece', stock: 1000.0, minStock: 100.0, cost: 0.15 },
        { id: 'inv-beef', name: 'Prime Beef Patty (150g)', unit: 'piece', stock: 200.0, minStock: 20.0, cost: 2.50 },
        { id: 'inv-buns', name: 'Burger Buns', unit: 'piece', stock: 200.0, minStock: 20.0, cost: 0.50 },
        { id: 'inv-cheese', name: 'Cheddar Cheese Slices', unit: 'piece', stock: 300.0, minStock: 30.0, cost: 0.30 },
        { id: 'inv-fries', name: 'Potato Fries', unit: 'kg', stock: 100.0, minStock: 10.0, cost: 2.00 },
        { id: 'inv-chicken', name: 'Chicken Breast', unit: 'kg', stock: 80.0, minStock: 10.0, cost: 4.50 },
        { id: 'inv-bread', name: 'Bread Toast', unit: 'slice', stock: 500.0, minStock: 5.0, cost: 0.05 },
        { id: 'inv-lettuce', name: 'Lettuce', unit: 'kg', stock: 30.0, minStock: 5.0, cost: 1.20 },
        { id: 'inv-tomato', name: 'Tomato', unit: 'kg', stock: 40.0, minStock: 5.0, cost: 1.00 },
        { id: 'inv-mayo', name: 'Mayonnaise', unit: 'kg', stock: 15.0, minStock: 2.0, cost: 3.00 },
        { id: 'inv-croissant', name: 'Croissant Plain', unit: 'piece', stock: 150.0, minStock: 15.0, cost: 0.80 },
        { id: 'inv-turkey', name: 'Turkey Slice', unit: 'piece', stock: 200.0, minStock: 20.0, cost: 0.40 },
        { id: 'inv-mozzarella', name: 'Mozzarella', unit: 'kg', stock: 25.0, minStock: 3.0, cost: 6.00 },
        { id: 'inv-flour', name: 'Flour', unit: 'kg', stock: 50.0, minStock: 5.0, cost: 0.80 },
        { id: 'inv-chocolate', name: 'Chocolate Fudge', unit: 'kg', stock: 30.0, minStock: 3.0, cost: 5.00 },
        { id: 'inv-tea', name: 'Tea Leaves', unit: 'kg', stock: 15.0, minStock: 2.0, cost: 8.00 },
        { id: 'inv-peach', name: 'Peach Syrup', unit: 'liter', stock: 10.0, minStock: 1.0, cost: 10.00 },
        { id: 'inv-mint', name: 'Mint Leaves', unit: 'kg', stock: 5.0, minStock: 0.5, cost: 3.00 },
        { id: 'inv-lemon', name: 'Lemon', unit: 'piece', stock: 500.0, minStock: 50.0, cost: 0.10 },
        { id: 'inv-soda', name: 'Soda Water', unit: 'liter', stock: 120.0, minStock: 12.0, cost: 0.50 },
        { id: 'inv-passion', name: 'Passion Fruit Syrup', unit: 'liter', stock: 10.0, minStock: 1.0, cost: 15.00 },
        { id: 'inv-oreo', name: 'Oreo Biscuits', unit: 'piece', stock: 800.0, minStock: 50.0, cost: 0.20 },
        { id: 'inv-strawberry', name: 'Strawberry', unit: 'kg', stock: 20.0, minStock: 2.0, cost: 3.50 },
        { id: 'inv-mango', name: 'Mango', unit: 'kg', stock: 25.0, minStock: 2.0, cost: 4.00 },
        { id: 'inv-icecream', name: 'Vanilla Ice Cream', unit: 'kg', stock: 40.0, minStock: 5.0, cost: 6.00 }
      ];

      db.transaction(() => {
        for (const item of seedInventory) {
          insertInv.run(item.id, item.name, item.unit, item.stock, item.minStock, item.cost, branchId, now, now);
        }
      })();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_inventory_v1', ?)").run(now);
      console.log('[database] Seeded default inventory items for active branch successfully.');
    }
  } catch (err) {
    console.error('[database] Seeding default inventory items failed:', err);
  }

  // Seed default recipes ONCE on first install only (Issue 28)
  try {
    const recCount = db.prepare('SELECT COUNT(*) as count FROM menu_recipes').get().count;
    const alreadySeeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded_recipes_v1'").get();
    if (recCount === 0 && !alreadySeeded) {
      console.log('[database] First install: seeding default menu recipes...');

      const insertRec = db.prepare(`
        INSERT OR IGNORE INTO menu_recipes (menuItemId, inventoryItemId, quantity)
        VALUES (?, ?, ?)
      `);
      
      const seedRecipes = [
        // 1. Espresso -> beans: 9g, cups: 1
        { menuItemId: '1', inventoryItemId: 'inv-beans', quantity: 0.009 },
        { menuItemId: '1', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 2. Double Espresso -> beans: 18g, cups: 1
        { menuItemId: '2', inventoryItemId: 'inv-beans', quantity: 0.018 },
        { menuItemId: '2', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 3. Cortado -> beans: 12g, milk: 0.05L, cups: 1
        { menuItemId: '3', inventoryItemId: 'inv-beans', quantity: 0.012 },
        { menuItemId: '3', inventoryItemId: 'inv-milk', quantity: 0.05 },
        { menuItemId: '3', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 4. Flat White -> beans: 18g, milk: 0.12L, cups: 1
        { menuItemId: '4', inventoryItemId: 'inv-beans', quantity: 0.018 },
        { menuItemId: '4', inventoryItemId: 'inv-milk', quantity: 0.12 },
        { menuItemId: '4', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 5. Cafe Latte -> beans: 15g, milk: 0.20L, cups: 1
        { menuItemId: '5', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '5', inventoryItemId: 'inv-milk', quantity: 0.2 },
        { menuItemId: '5', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 6. Cappuccino -> beans: 15g, milk: 0.18L, cups: 1
        { menuItemId: '6', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '6', inventoryItemId: 'inv-milk', quantity: 0.18 },
        { menuItemId: '6', inventoryItemId: 'inv-cups', quantity: 1 },
        
        // 7. Spanish Latte -> beans: 15g, milk: 0.20L, sweet (caramel): 20ml, cups: 1
        { menuItemId: '7', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '7', inventoryItemId: 'inv-milk', quantity: 0.2 },
        { menuItemId: '7', inventoryItemId: 'inv-caramel', quantity: 0.02 },
        { menuItemId: '7', inventoryItemId: 'inv-cups', quantity: 1 },

        // 8. Americano -> beans: 15g, cups: 1
        { menuItemId: '8', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '8', inventoryItemId: 'inv-cups', quantity: 1 },

        // 9. Cafe Mocha -> beans: 15g, milk: 0.20L, chocolate: 20g, cups: 1
        { menuItemId: '9', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '9', inventoryItemId: 'inv-milk', quantity: 0.2 },
        { menuItemId: '9', inventoryItemId: 'inv-chocolate', quantity: 0.02 },
        { menuItemId: '9', inventoryItemId: 'inv-cups', quantity: 1 },

        // 10. Turkish Coffee -> beans: 8g, cups: 1
        { menuItemId: '10', inventoryItemId: 'inv-beans', quantity: 0.008 },
        { menuItemId: '10', inventoryItemId: 'inv-cups', quantity: 1 },

        // 11. French Coffee -> beans: 8g, milk: 0.10L, cups: 1
        { menuItemId: '11', inventoryItemId: 'inv-beans', quantity: 0.008 },
        { menuItemId: '11', inventoryItemId: 'inv-milk', quantity: 0.10 },
        { menuItemId: '11', inventoryItemId: 'inv-cups', quantity: 1 },

        // 12. Iced Americano -> beans: 15g, cups: 1
        { menuItemId: '12', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '12', inventoryItemId: 'inv-cups', quantity: 1 },

        // 13. Iced Latte -> beans: 15g, milk: 0.20L, cups: 1
        { menuItemId: '13', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '13', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '13', inventoryItemId: 'inv-cups', quantity: 1 },

        // 14. Iced Spanish Latte -> beans: 15g, milk: 0.20L, caramel: 20ml, cups: 1
        { menuItemId: '14', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '14', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '14', inventoryItemId: 'inv-caramel', quantity: 0.02 },
        { menuItemId: '14', inventoryItemId: 'inv-cups', quantity: 1 },

        // 15. Iced Caramel Macchiato -> beans: 15g, milk: 0.20L, caramel: 20ml, vanilla: 10ml, cups: 1
        { menuItemId: '15', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '15', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '15', inventoryItemId: 'inv-caramel', quantity: 0.02 },
        { menuItemId: '15', inventoryItemId: 'inv-vanilla', quantity: 0.01 },
        { menuItemId: '15', inventoryItemId: 'inv-cups', quantity: 1 },

        // 16. Iced Mocha -> beans: 15g, milk: 0.20L, chocolate: 20g, cups: 1
        { menuItemId: '16', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '16', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '16', inventoryItemId: 'inv-chocolate', quantity: 0.02 },
        { menuItemId: '16', inventoryItemId: 'inv-cups', quantity: 1 },

        // 17. Cold Brew -> beans: 20g, cups: 1
        { menuItemId: '17', inventoryItemId: 'inv-beans', quantity: 0.020 },
        { menuItemId: '17', inventoryItemId: 'inv-cups', quantity: 1 },

        // 18. Iced Pistachio Latte -> beans: 15g, milk: 0.20L, vanilla: 20ml, cups: 1
        { menuItemId: '18', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '18', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '18', inventoryItemId: 'inv-vanilla', quantity: 0.02 },
        { menuItemId: '18', inventoryItemId: 'inv-cups', quantity: 1 },

        // 19. Mocha Frappe -> beans: 15g, milk: 0.15L, chocolate: 30g, icecream: 50g, cups: 1
        { menuItemId: '19', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '19', inventoryItemId: 'inv-milk', quantity: 0.15 },
        { menuItemId: '19', inventoryItemId: 'inv-chocolate', quantity: 0.03 },
        { menuItemId: '19', inventoryItemId: 'inv-icecream', quantity: 0.05 },
        { menuItemId: '19', inventoryItemId: 'inv-cups', quantity: 1 },

        // 20. Caramel Frappe -> beans: 15g, milk: 0.15L, caramel: 30ml, icecream: 50g, cups: 1
        { menuItemId: '20', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '20', inventoryItemId: 'inv-milk', quantity: 0.15 },
        { menuItemId: '20', inventoryItemId: 'inv-caramel', quantity: 0.03 },
        { menuItemId: '20', inventoryItemId: 'inv-icecream', quantity: 0.05 },
        { menuItemId: '20', inventoryItemId: 'inv-cups', quantity: 1 },

        // 21. Coffee Frappe -> beans: 15g, milk: 0.15L, icecream: 50g, cups: 1
        { menuItemId: '21', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '21', inventoryItemId: 'inv-milk', quantity: 0.15 },
        { menuItemId: '21', inventoryItemId: 'inv-icecream', quantity: 0.05 },
        { menuItemId: '21', inventoryItemId: 'inv-cups', quantity: 1 },

        // 22. Oreo Frappe -> beans: 15g, milk: 0.15L, oreo: 3, cups: 1
        { menuItemId: '22', inventoryItemId: 'inv-beans', quantity: 0.015 },
        { menuItemId: '22', inventoryItemId: 'inv-milk', quantity: 0.15 },
        { menuItemId: '22', inventoryItemId: 'inv-oreo', quantity: 3 },
        { menuItemId: '22', inventoryItemId: 'inv-cups', quantity: 1 },

        // 23. Oreo Milkshake -> milk: 0.25L, oreo: 4, icecream: 100g, cups: 1
        { menuItemId: '23', inventoryItemId: 'inv-milk', quantity: 0.25 },
        { menuItemId: '23', inventoryItemId: 'inv-oreo', quantity: 4 },
        { menuItemId: '23', inventoryItemId: 'inv-icecream', quantity: 0.10 },
        { menuItemId: '23', inventoryItemId: 'inv-cups', quantity: 1 },

        // 24. Strawberry Milkshake -> milk: 0.20L, strawberry: 100g, icecream: 100g, cups: 1
        { menuItemId: '24', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '24', inventoryItemId: 'inv-strawberry', quantity: 0.10 },
        { menuItemId: '24', inventoryItemId: 'inv-icecream', quantity: 0.10 },
        { menuItemId: '24', inventoryItemId: 'inv-cups', quantity: 1 },

        // 25. Chocolate Milkshake -> milk: 0.20L, chocolate: 30g, icecream: 100g, cups: 1
        { menuItemId: '25', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '25', inventoryItemId: 'inv-chocolate', quantity: 0.03 },
        { menuItemId: '25', inventoryItemId: 'inv-icecream', quantity: 0.10 },
        { menuItemId: '25', inventoryItemId: 'inv-cups', quantity: 1 },

        // 26. Vanilla Milkshake -> milk: 0.20L, vanilla: 20ml, icecream: 150g, cups: 1
        { menuItemId: '26', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '26', inventoryItemId: 'inv-vanilla', quantity: 0.02 },
        { menuItemId: '26', inventoryItemId: 'inv-icecream', quantity: 0.15 },
        { menuItemId: '26', inventoryItemId: 'inv-cups', quantity: 1 },

        // 27. Mango Milkshake -> milk: 0.20L, mango: 100g, icecream: 100g, cups: 1
        { menuItemId: '27', inventoryItemId: 'inv-milk', quantity: 0.20 },
        { menuItemId: '27', inventoryItemId: 'inv-mango', quantity: 0.10 },
        { menuItemId: '27', inventoryItemId: 'inv-icecream', quantity: 0.10 },
        { menuItemId: '27', inventoryItemId: 'inv-cups', quantity: 1 },

        // 28. Green Tea -> tea: 5g, cups: 1
        { menuItemId: '28', inventoryItemId: 'inv-tea', quantity: 0.005 },
        { menuItemId: '28', inventoryItemId: 'inv-cups', quantity: 1 },

        // 29. Karak Tea -> tea: 6g, milk: 0.05L, cups: 1
        { menuItemId: '29', inventoryItemId: 'inv-tea', quantity: 0.006 },
        { menuItemId: '29', inventoryItemId: 'inv-milk', quantity: 0.05 },
        { menuItemId: '29', inventoryItemId: 'inv-cups', quantity: 1 },

        // 30. Mint Lemonade -> lemon: 2, mint: 10g, soda: 0.20L, cups: 1
        { menuItemId: '30', inventoryItemId: 'inv-lemon', quantity: 2 },
        { menuItemId: '30', inventoryItemId: 'inv-mint', quantity: 0.01 },
        { menuItemId: '30', inventoryItemId: 'inv-soda', quantity: 0.20 },
        { menuItemId: '30', inventoryItemId: 'inv-cups', quantity: 1 },

        // 31. Peach Iced Tea -> tea: 5g, peach: 30ml, cups: 1
        { menuItemId: '31', inventoryItemId: 'inv-tea', quantity: 0.005 },
        { menuItemId: '31', inventoryItemId: 'inv-peach', quantity: 0.03 },
        { menuItemId: '31', inventoryItemId: 'inv-cups', quantity: 1 },

        // 32. Passion Fruit Mojito -> lemon: 1, mint: 10g, passion: 30ml, soda: 0.25L, cups: 1
        { menuItemId: '32', inventoryItemId: 'inv-lemon', quantity: 1 },
        { menuItemId: '32', inventoryItemId: 'inv-mint', quantity: 0.01 },
        { menuItemId: '32', inventoryItemId: 'inv-passion', quantity: 0.03 },
        { menuItemId: '32', inventoryItemId: 'inv-soda', quantity: 0.25 },
        { menuItemId: '32', inventoryItemId: 'inv-cups', quantity: 1 },

        // 33. Classic Club Sandwich -> bread: 3, chicken: 100g, lettuce: 20g, tomato: 30g, mayo: 10g
        { menuItemId: '33', inventoryItemId: 'inv-bread', quantity: 3 },
        { menuItemId: '33', inventoryItemId: 'inv-chicken', quantity: 0.10 },
        { menuItemId: '33', inventoryItemId: 'inv-lettuce', quantity: 0.02 },
        { menuItemId: '33', inventoryItemId: 'inv-tomato', quantity: 0.03 },
        { menuItemId: '33', inventoryItemId: 'inv-mayo', quantity: 0.01 },

        // 34. Prime Beef Cheeseburger -> beef: 1, buns: 1, cheese: 1, lettuce: 10g, tomato: 20g
        { menuItemId: '34', inventoryItemId: 'inv-beef', quantity: 1 },
        { menuItemId: '34', inventoryItemId: 'inv-buns', quantity: 1 },
        { menuItemId: '34', inventoryItemId: 'inv-cheese', quantity: 1 },
        { menuItemId: '34', inventoryItemId: 'inv-lettuce', quantity: 0.01 },
        { menuItemId: '34', inventoryItemId: 'inv-tomato', quantity: 0.02 },

        // 35. Chicken Pane Sandwich -> chicken: 120g, bread: 2, lettuce: 10g, cheese: 1, mayo: 10g
        { menuItemId: '35', inventoryItemId: 'inv-chicken', quantity: 0.12 },
        { menuItemId: '35', inventoryItemId: 'inv-bread', quantity: 2 },
        { menuItemId: '35', inventoryItemId: 'inv-lettuce', quantity: 0.01 },
        { menuItemId: '35', inventoryItemId: 'inv-cheese', quantity: 1 },
        { menuItemId: '35', inventoryItemId: 'inv-mayo', quantity: 0.01 },

        // 36. Turkey & Cheese Croissant -> croissant: 1, turkey: 2, cheese: 1
        { menuItemId: '36', inventoryItemId: 'inv-croissant', quantity: 1 },
        { menuItemId: '36', inventoryItemId: 'inv-turkey', quantity: 2 },
        { menuItemId: '36', inventoryItemId: 'inv-cheese', quantity: 1 },

        // 37. Grilled Cheese Sandwich -> bread: 2, cheese: 2, mozzarella: 50g
        { menuItemId: '37', inventoryItemId: 'inv-bread', quantity: 2 },
        { menuItemId: '37', inventoryItemId: 'inv-cheese', quantity: 2 },
        { menuItemId: '37', inventoryItemId: 'inv-mozzarella', quantity: 0.05 },

        // 38. Cheese Fries -> fries: 200g, cheese: 1
        { menuItemId: '38', inventoryItemId: 'inv-fries', quantity: 0.20 },
        { menuItemId: '38', inventoryItemId: 'inv-cheese', quantity: 1 },

        // 39. Chocolate Fudge Cake -> flour: 50g, chocolate: 40g, sugar: 30g
        { menuItemId: '39', inventoryItemId: 'inv-flour', quantity: 0.05 },
        { menuItemId: '39', inventoryItemId: 'inv-chocolate', quantity: 0.04 },
        { menuItemId: '39', inventoryItemId: 'inv-sugar', quantity: 0.03 },

        // 40. Warm Chocolate Brownie -> flour: 30g, chocolate: 30g, icecream: 50g
        { menuItemId: '40', inventoryItemId: 'inv-flour', quantity: 0.03 },
        { menuItemId: '40', inventoryItemId: 'inv-chocolate', quantity: 0.03 },
        { menuItemId: '40', inventoryItemId: 'inv-icecream', quantity: 0.05 }
      ];

      db.transaction(() => {
        for (const rec of seedRecipes) {
          insertRec.run(rec.menuItemId, rec.inventoryItemId, rec.quantity);
        }
      })();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_recipes_v1', ?)").run(new Date().toISOString());
      console.log('[database] Seeded default menu recipes.');
    }
  } catch (err) {
    console.error('[database] Seeding default recipes failed:', err);
  }



  // Migration: Add paidAt column if table already existed without it
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN paidAt TEXT');

  // Migration: Add customer columns to orders
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN customerPhone TEXT');
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0');
  addColumnIfMissing(db, 'ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0');

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 Migration: Add branch_id, is_synced, created_at, updated_at
  // columns to menu, orders, and customers tables for multi-branch sync.
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Menu table: add sync columns ---
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN created_at TEXT");
  addColumnIfMissing(db, "ALTER TABLE menu_items ADD COLUMN updated_at TEXT");

  // --- Orders table: add sync columns (createdAt already exists) ---
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN branch_id TEXT DEFAULT NULL");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "ALTER TABLE orders ADD COLUMN updated_at TEXT");

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
    return {
      pendingMenu: menuCount,
      pendingOrders: ordersCount,
      pendingCustomers: customersCount,
      pendingInventory: inventoryCount + invTxCount,
      totalPending: menuCount + ordersCount + customersCount + inventoryCount + invTxCount
    };
  } catch (e) {
    console.error('[database] Failed to get sync stats:', e);
    return { pendingMenu: 0, pendingOrders: 0, pendingCustomers: 0, pendingInventory: 0, totalPending: 0 };
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
const SYNCABLE_TABLES = new Set(['orders', 'customers', 'menu_items', 'inventory', 'inventory_transactions', 'points_transactions']);

// After this many consecutive failures a row is parked instead of retried forever.
// sync_attempts was previously incremented and never read, so one malformed row
// blocked its whole table's batch on every cycle indefinitely.
const MAX_SYNC_ATTEMPTS = 5;

function markSyncFailure(table, ids, errorMessage) {
  if (!SYNCABLE_TABLES.has(table) || !ids || ids.length === 0) return;
  const sqlite = getDb();
  try {
    const stmt = sqlite.prepare(`UPDATE ${table} SET sync_attempts = sync_attempts + 1, last_error = ? WHERE id = ?`);
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) stmt.run(String(errorMessage || 'sync failed').slice(0, 500), id);
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

module.exports = {
  initDatabase,
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
  MAX_SYNC_ATTEMPTS
};
