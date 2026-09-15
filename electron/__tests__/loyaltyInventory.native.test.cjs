const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const Database = require('better-sqlite3');
const database = require('../database.cjs');
const customers = require('../CustomerRepository.cjs');
const inventory = require('../InventoryRepository.cjs');
const { validateStockMovement, validateCustomer } = require('../validate.cjs');

const FUTURE = '2099-01-01T00:00:00.000Z';
const UUID = /^cust-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let directory;
let sqlite;
let filename;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'engaz-loyalty-inventory-test-'));
  filename = join(directory, 'isolated.sqlite');
  database.initDatabase(filename);
  database.saveSetting('branch_id', 'branch-1');
  sqlite = database.getDb();
});

afterEach(() => {
  database.closeDatabase();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function seedCustomer(id, branchId, phone = '01000000101') {
  sqlite.prepare(`
    INSERT INTO customers (id, name, phone, points, createdAt, branch_id, updated_at, is_synced, sync_attempts, last_error)
    VALUES (?, 'Original', ?, 20, ?, ?, ?, 0, 5, 'parked error')
  `).run(id, phone, FUTURE, branchId, FUTURE);
  return sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function points(phone, changes) {
  return sqlite.transaction(() => customers.applyPointsChangeInTx(phone, changes))();
}

function stockItem(stock = 10) {
  return inventory.createInventoryItem({ name: 'Test beans', unit: 'kg', stock, minStock: 1, costPerUnit: 2 });
}

function stockState(id) {
  return {
    item: sqlite.prepare('SELECT * FROM inventory WHERE id = ?').get(id),
    ledger: sqlite.prepare('SELECT * FROM inventory_transactions WHERE itemId = ? ORDER BY id').all(id),
  };
}

describe('Loyalty tenant and identity regressions with the unchanged schema', () => {
  test('new customers use UUIDs and existing identities survive saves and loyalty changes', () => {
    const saved = customers.saveCustomer({ phone: '01000000101', name: 'Test customer', points: 3 });
    assert.match(saved.id, UUID);
    assert.equal(customers.saveCustomer({ phone: saved.phone, name: 'Renamed' }).id, saved.id);
    assert.equal(points(saved.phone, { pointsEarned: 2 }).customerId, saved.id);
    const earned = points('01000000102', { pointsEarned: 1 });
    assert.match(earned.customerId, UUID);
    assert.notEqual(earned.customerId, saved.id);
  });

  test('the same phone created independently in two branches does not share a hash identity', () => {
    const first = customers.saveCustomer({ phone: '01000000101' });
    database.initDatabase(join(directory, 'second-branch.sqlite'));
    database.saveSetting('branch_id', 'branch-2');
    const second = customers.saveCustomer({ phone: first.phone });
    assert.match(first.id, UUID);
    assert.match(second.id, UUID);
    assert.notEqual(second.id, first.id);
    assert.equal(second.branchId, 'branch-2');
  });

  test('a foreign customer with the same phone cannot be adopted, replaced, or redeemed', () => {
    const foreign = seedCustomer('foreign-customer', 'other-branch');
    assert.equal(customers.getCustomerByPhone(foreign.phone), null);
    for (const mutate of [
      () => customers.saveCustomer({ phone: foreign.phone, name: 'Overwrite', points: 0 }),
      () => points(foreign.phone, { pointsEarned: 5 }),
      () => points(foreign.phone, { pointsRedeemed: 5 }),
    ]) {
      assert.throws(mutate, /unavailable customer/);
      assert.deepEqual(sqlite.prepare('SELECT * FROM customers').all(), [foreign]);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM points_transactions').get().n, 0);
    }
    assert.throws(() => seedCustomer('duplicate', 'branch-1', foreign.phone), /UNIQUE constraint failed: customers.phone/);
  });

  test('NULL-owned customers stay shared and ledger entries use the active branch', () => {
    const shared = seedCustomer('shared-customer', null);
    const renamed = customers.saveCustomer(validateCustomer({ phone: shared.phone, name: 'Shared name' }));
    assert.equal(renamed.id, shared.id);
    assert.equal(renamed.points, 20, 'an omitted points field must not reset the balance');
    assert.ok(renamed.updatedAt > FUTURE);
    const result = points(shared.phone, { pointsRedeemed: 3, pointsEarned: 2, branchId: 'branch-1' });
    assert.deepEqual(result, { customerId: shared.id, newBalance: 19 });
    const row = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(shared.id);
    assert.equal(row.branch_id, null);
    assert.ok(row.updated_at > renamed.updatedAt);
    assert.equal(row.sync_attempts, 0);
    assert.equal(row.last_error, null);
    assert.deepEqual(sqlite.prepare('SELECT type, points, balanceAfter, customerId, branch_id FROM points_transactions ORDER BY rowid').all(), [
      { type: 'REDEEM', points: -3, balanceAfter: 17, customerId: shared.id, branch_id: 'branch-1' },
      { type: 'EARN', points: 2, balanceAfter: 19, customerId: shared.id, branch_id: 'branch-1' },
    ]);
    database.saveSetting('branch_id', 'branch-2');
    assert.equal(points(shared.phone, { pointsEarned: 1 }).newBalance, 20);
    assert.equal(sqlite.prepare('SELECT branch_id FROM customers WHERE id = ?').get(shared.id).branch_id, null);
  });

  test('explicit foreign branches are rejected for both existing and new customers', () => {
    const own = seedCustomer('own-customer', 'branch-1');
    for (const phone of [own.phone, '01000000102']) {
      assert.throws(() => customers.saveCustomer({ phone, branchId: 'other-branch' }), /another branch/);
      assert.throws(() => points(phone, { branchId: 'other-branch', pointsEarned: 1 }), /another branch/);
    }
    assert.deepEqual(sqlite.prepare('SELECT * FROM customers').all(), [own]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM points_transactions').get().n, 0);
  });

  test('loyalty updates only the selected id, advance versions, and clear parked retries', () => {
    const own = seedCustomer('own-customer', 'branch-1');
    const foreign = seedCustomer('foreign-customer', 'other-branch', '01000000102');
    const snapshot = customers.getCustomerByPhone(own.phone);
    const prepare = sqlite.prepare;
    let updates = 0;
    sqlite.prepare = function (sql) {
      if (/UPDATE customers SET (?:name|points)/.test(sql)) {
        assert.match(sql, /WHERE id = \?/);
        updates += 1;
      }
      return prepare.call(this, sql);
    };
    try {
      points(own.phone, { pointsEarned: 2 });
      const afterPoints = customers.getCustomerByPhone(own.phone);
      assert.ok(afterPoints.updatedAt > snapshot.updatedAt);
      customers.saveCustomer({ phone: own.phone, name: 'Renamed again' });
      assert.ok(customers.getCustomerByPhone(own.phone).updatedAt > afterPoints.updatedAt);
    } finally {
      sqlite.prepare = prepare;
    }
    assert.equal(updates, 2);
    customers.markCustomersSynced([own.id], [snapshot]);
    const row = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(own.id);
    assert.equal(row.is_synced, 0);
    assert.equal(row.sync_attempts, 0);
    assert.equal(row.last_error, null);
    assert.deepEqual(sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(foreign.id), foreign);
  });

  test('deletion advances the version and re-arms retries without reusing a tombstoned phone', () => {
    const own = seedCustomer('deleted-customer', 'branch-1');
    customers.deleteCustomer(own.id);
    const deleted = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(own.id);
    assert.ok(deleted.updated_at > FUTURE);
    assert.equal(deleted.deleted_at, deleted.updated_at);
    assert.equal(deleted.sync_attempts, 0);
    assert.equal(deleted.last_error, null);
    assert.throws(() => customers.saveCustomer({ phone: own.phone }), /unavailable customer/);
    assert.throws(() => points(own.phone, { pointsEarned: 2 }), /unavailable customer/);
    assert.deepEqual(sqlite.prepare('SELECT * FROM customers').all(), [deleted]);
  });

  test('rejected loyalty rolls back outer work and a newly inserted customer', () => {
    assert.throws(() => sqlite.transaction(() => {
      sqlite.prepare("INSERT INTO settings (key, value) VALUES ('rollback-test', 'pending')").run();
      customers.applyPointsChangeInTx('01000000101', { pointsRedeemed: 1 });
    })(), /Cannot redeem/);
    assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key = 'rollback-test'").get(), undefined);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM points_transactions').get().n, 0);
  });
});

describe('Atomic stock count and movement regressions', () => {
  test('counting down, up, unchanged, and zero keeps signed ADJUST deltas', () => {
    const item = stockItem();
    for (const [target, delta] of [[4, -6], [12, 8], [12, 0], [0, -12]]) {
      const tx = inventory.createInventoryTransaction(validateStockMovement({ itemId: item.id, type: 'ADJUST', quantity: target }));
      assert.equal(inventory.getInventoryItem(item.id).stock, target);
      assert.equal(tx.type, 'ADJUST');
      assert.equal(tx.quantity, delta);
      const persisted = sqlite.prepare('SELECT * FROM inventory_transactions WHERE id = ?').get(tx.id);
      assert.equal(persisted.type, 'ADJUST');
      assert.equal(persisted.quantity, delta);
      assert.equal(inventory.getUnsyncedTransactions().find(row => row.id === tx.id).quantity, delta);
      const ledgerBalance = sqlite.prepare(`
        SELECT SUM(CASE WHEN type = 'OUT' THEN -quantity ELSE quantity END) AS balance
        FROM inventory_transactions WHERE itemId = ?
      `).get(item.id).balance;
      assert.equal(ledgerBalance, target);
    }
  });

  test('repository and IPC validator reject invalid quantities without any write', () => {
    const item = stockItem();
    const before = stockState(item.id);
    for (const type of ['IN', 'OUT', 'ADJUST']) {
      for (const quantity of [-1, NaN, Infinity, -Infinity, 'Infinity', 'bad', null, undefined, '', false, 100001]) {
        const tx = { itemId: item.id, type, quantity };
        assert.throws(() => validateStockMovement(tx), /quantity/);
        assert.throws(() => inventory.createInventoryTransaction(tx), /quantity/);
        assert.deepEqual(stockState(item.id), before);
      }
    }
    for (const type of ['IN', 'OUT']) {
      assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type, quantity: 0 }), /quantity/);
    }
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'TRANSFER', quantity: 1 }), /type/);
    assert.deepEqual(stockState(item.id), before);
  });

  test('OUT refuses overdraw atomically rather than clamping stock or posting a ledger row', () => {
    const item = stockItem(3);
    const before = stockState(item.id);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 4 }), /more than the current stock/);
    assert.deepEqual(stockState(item.id), before);
    inventory.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 3 });
    assert.equal(inventory.getInventoryItem(item.id).stock, 0);
  });

  test('counts use fresh stored stock, including targets equal to a stale renderer snapshot', () => {
    const item = stockItem(10);
    const second = new Database(filename);
    try {
      second.transaction(() => {
        second.prepare('UPDATE inventory SET stock = 7 WHERE id = ?').run(item.id);
        second.prepare(`INSERT INTO inventory_transactions (id, itemId, type, quantity, createdAt, branch_id)
          VALUES ('concurrent-out', ?, 'OUT', 3, ?, 'branch-1')`).run(item.id, FUTURE);
      })();
      assert.equal(item.stock, 10, 'the renderer snapshot is deliberately stale');
      const tx = inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: item.stock });
      assert.equal(tx.quantity, 3);
      assert.equal(second.prepare('SELECT stock FROM inventory WHERE id = ?').get(item.id).stock, 10);
      inventory.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 7 });
      const before = stockState(item.id);
      assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 4 }), /more than the current stock/);
      assert.deepEqual(stockState(item.id), before);
    } finally {
      second.close();
    }
  });

  test('the fresh stock read and OUT validation hold an immediate SQLite write lock', () => {
    const item = stockItem(5);
    const second = new Database(filename, { timeout: 0 });
    const prepare = sqlite.prepare;
    let reads = 0;
    sqlite.prepare = function (sql) {
      if (/SELECT id, stock, updated_at FROM inventory/.test(sql)) {
        assert.equal(this.inTransaction, true);
        assert.throws(() => second.prepare('UPDATE inventory SET stock = 0 WHERE id = ?').run(item.id), { code: 'SQLITE_BUSY' });
        reads += 1;
      }
      return prepare.call(this, sql);
    };
    try {
      inventory.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 2 });
      inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 1 });
      assert.equal(reads, 2);
      assert.equal(inventory.getInventoryItem(item.id).stock, 1);
    } finally {
      sqlite.prepare = prepare;
      second.close();
    }
  });

  test('ledger insertion rolls back if applying stock fails', () => {
    const item = stockItem();
    const before = stockState(item.id);
    sqlite.exec(`CREATE TEMP TRIGGER reject_stock BEFORE UPDATE OF stock ON inventory
      BEGIN SELECT RAISE(ABORT, 'injected stock failure'); END`);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 2 }), /injected stock failure/);
    assert.deepEqual(stockState(item.id), before);
  });

  test('duplicate ledger ids and an outer rollback leave stock unchanged', () => {
    const item = stockItem();
    inventory.createInventoryTransaction({ id: 'fixed-movement', itemId: item.id, type: 'IN', quantity: 1 });
    const before = stockState(item.id);
    assert.throws(() => inventory.createInventoryTransaction({ id: 'fixed-movement', itemId: item.id, type: 'OUT', quantity: 1 }), /UNIQUE/);
    assert.deepEqual(stockState(item.id), before);
    assert.throws(() => sqlite.transaction(() => {
      inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 0 });
      throw new Error('outer rollback');
    })(), /outer rollback/);
    assert.deepEqual(stockState(item.id), before);
  });

  test('successful movements advance versions and clear parked retries', () => {
    const item = stockItem();
    sqlite.prepare("UPDATE inventory SET updated_at = ?, sync_attempts = 5, last_error = 'parked error', is_synced = 0 WHERE id = ?").run(FUTURE, item.id);
    const snapshot = inventory.getUnsyncedInventory();
    assert.equal(snapshot.length, 0);
    inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 10 });
    const row = stockState(item.id).item;
    assert.ok(row.updated_at > FUTURE);
    assert.equal(row.sync_attempts, 0);
    assert.equal(row.last_error, null);
    inventory.markInventorySynced([item.id], [{ id: item.id, updatedAt: FUTURE }]);
    assert.equal(inventory.getInventoryItem(item.id).isSynced, false);
    assert.equal(inventory.getUnsyncedInventory().length, 1);
  });

  test('missing, deleted, and foreign stock cannot receive movements while NULL stock remains shared', () => {
    const item = stockItem();
    const before = stockState(item.id);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: 'missing', type: 'IN', quantity: 1 }), /not found/);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'IN', quantity: 1, branchId: 'other-branch' }), /another branch/);
    assert.deepEqual(stockState(item.id), before);
    sqlite.prepare("UPDATE inventory SET branch_id = 'other-branch' WHERE id = ?").run(item.id);
    const foreign = stockState(item.id);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'IN', quantity: 1 }), /not found/);
    assert.deepEqual(stockState(item.id), foreign);
    sqlite.prepare('UPDATE inventory SET branch_id = NULL WHERE id = ?').run(item.id);
    inventory.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 0 });
    assert.equal(stockState(item.id).item.branch_id, null);
    sqlite.prepare('UPDATE inventory SET deleted_at = ? WHERE id = ?').run(FUTURE, item.id);
    const deleted = stockState(item.id);
    assert.throws(() => inventory.createInventoryTransaction({ itemId: item.id, type: 'IN', quantity: 1 }), /not found/);
    assert.deepEqual(stockState(item.id), deleted);
  });
});
