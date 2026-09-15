// Temporary, headless Electron app. This file is copied outside the real app/profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { app, session, net } = require('electron');
const temp = process.env.ENGAZ_SMOKE_TEMP;
assert(temp && fs.realpathSync(process.cwd()) === fs.realpathSync(temp), 'Isolated temp working directory required');
const databasePath = process.env.ENGAZ_SMOKE_DATABASE;
const databaseRequire = createRequire(databasePath);
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
app.setPath('crashDumps', path.join(temp, 'crashes'));
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const denyNetwork = () => { throw new Error('Network is forbidden in SQLite smoke'); };
  session.defaultSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
  global.fetch = denyNetwork;
  net.request = denyNetwork;
  net.fetch = denyNetwork;
  for (const name of ['node:http', 'node:https']) {
    const module = require(name);
    module.request = denyNetwork;
    module.get = denyNetwork;
  }
  require('node:net').Socket.prototype.connect = denyNetwork;
  require('node:dgram').createSocket = denyNetwork;
  assert.equal(process.versions.electron, process.env.ENGAZ_SMOKE_ELECTRON);
  const Database = databaseRequire('better-sqlite3');
  for (const fixture of ['fresh', 'legacy']) {
    const profile = path.join(temp, fixture);
    fs.mkdirSync(profile);
    app.setPath('userData', profile);
    if (fixture === 'legacy') {
      const legacy = new Database(path.join(profile, 'engaz.db'));
      legacy.exec(`CREATE TABLE menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, category TEXT NOT NULL, image TEXT, available INTEGER NOT NULL DEFAULT 1);
        INSERT INTO menu(id,name,price,category) VALUES ('smoke-legacy','Coffee',10,'Bar');
        CREATE TABLE orders (id TEXT PRIMARY KEY, orderNumber TEXT NOT NULL, tableId TEXT NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL, paymentStatus TEXT NOT NULL DEFAULT 'Unpaid', paymentMethod TEXT, totalAmount REAL NOT NULL, createdAt TEXT NOT NULL);`);
      legacy.close();
    }
    const { initDatabase, getDb } = require(databasePath);
    initDatabase();
    const db = getDb();
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    for (const table of ['settings', 'migrations', 'orders', 'menu_items', 'customers', 'inventory', 'cashiers', 'points_transactions', 'inventory_transactions', 'reports_outbox']) {
      assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `Missing ${table}`);
    }
    const columns = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
    for (const name of ['paidAmount', 'grandTotal', 'deleted_at', 'sync_attempts']) assert(columns.includes(name), `Missing orders.${name}`);
    const migrations = db.prepare('SELECT * FROM migrations ORDER BY name').all();
    for (const name of ['0010_menu_categories', '0011_rename_menu_to_menu_items', '0012_phase2_columns', '0013_ledger_retry_tracking', '0014_orders_paid_amount']) {
      assert(migrations.some(row => row.name === name), `Migration failed: ${name}`);
    }
    if (fixture === 'legacy') assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=?').get('smoke-legacy').price, 10);
    initDatabase();
    assert.deepEqual(db.prepare('SELECT * FROM migrations ORDER BY name').all(), migrations);
    db.close();
    delete require.cache[require.resolve(databasePath)];
    // A real reopen verifies migrations are still idempotent, not just the open-db guard.
    const reopened = require(databasePath);
    reopened.initDatabase();
    assert.deepEqual(reopened.getDb().prepare('SELECT * FROM migrations ORDER BY name').all(), migrations);
    reopened.getDb().close();
    delete require.cache[require.resolve(databasePath)];
  }
  console.log(`ENGAZ_NATIVE_SMOKE_OK electron=${process.versions.electron} node=${process.versions.node} abi=${process.versions.modules} fresh+legacy`);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
