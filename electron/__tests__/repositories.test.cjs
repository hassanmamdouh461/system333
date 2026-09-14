const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../database.cjs');
const cashierRepository = require('../CashierRepository.cjs');
const orderRepository = require('../OrderRepository.cjs');
const menuRepository = require('../MenuRepository.cjs');
const customerRepository = require('../CustomerRepository.cjs');
const inventoryRepository = require('../InventoryRepository.cjs');

describe('Repositories & Outbox Unit Tests (Isolated SQLite)', () => {
  beforeEach(() => {
    // Initialize a fresh isolated in-memory SQLite database for each test
    database.initDatabase(':memory:');
    // Ensure default branch is set
    database.saveSetting('branch_id', 'branch-1');
  });

  afterEach(() => {
    database.closeDatabase();
  });

  describe('CashierRepository', () => {
    test('creates cashier with name, avatar, branch scoping, and unsynced state', () => {
      const cashier = cashierRepository.createCashier('Ahmed POS', 'data:image/png;base64,avatar1');
      assert.ok(cashier);
      assert.ok(cashier.id.startsWith('cashier-'));
      assert.equal(cashier.name, 'Ahmed POS');
      assert.equal(cashier.avatar, 'data:image/png;base64,avatar1');
      assert.equal(cashier.branchId, 'branch-1');
      assert.equal(cashier.isSynced, false);
      assert.ok(cashier.createdAt);
      assert.ok(cashier.updatedAt);
    });

    test('getCashiers returns active cashiers in branch and excludes soft-deleted', () => {
      const c1 = cashierRepository.createCashier('Cashier One');
      const c2 = cashierRepository.createCashier('Cashier Two');

      const all = cashierRepository.getCashiers('branch-1');
      assert.equal(all.length, 2);

      cashierRepository.deleteCashier(c1.id);
      const remaining = cashierRepository.getCashiers('branch-1');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, c2.id);
    });

    test('updates cashier name and avatar with new updatedAt and resets isSynced to 0', () => {
      const c = cashierRepository.createCashier('Original Name', 'avatar-old');
      cashierRepository.markCashiersSynced([c.id]);
      const synced = cashierRepository.getCashier(c.id);
      assert.equal(synced.isSynced, true);

      const renamed = cashierRepository.renameCashier(c.id, 'Updated Name');
      assert.equal(renamed.name, 'Updated Name');
      assert.equal(renamed.isSynced, false);
      assert.ok(renamed.updatedAt >= c.updatedAt);

      const updatedAvatar = cashierRepository.setCashierAvatar(c.id, 'avatar-new');
      assert.equal(updatedAvatar.avatar, 'avatar-new');
      assert.equal(updatedAvatar.isSynced, false);
    });

    test('markCashiersSynced supports version-guarded snapshots', () => {
      const c = cashierRepository.createCashier('Version Guard Test');
      const snapshot = cashierRepository.getCashier(c.id);

      // Mutate cashier locally
      cashierRepository.renameCashier(c.id, 'Mutated Name');

      // Attempt to mark as synced using stale snapshot
      cashierRepository.markCashiersSynced([c.id], [snapshot]);
      const stillUnsynced = cashierRepository.getCashier(c.id);
      assert.equal(stillUnsynced.isSynced, false, 'Stale snapshot must not mark newer revision as synced');

      // Mark with current snapshot
      const current = cashierRepository.getCashier(c.id);
      cashierRepository.markCashiersSynced([c.id], [current]);
      const nowSynced = cashierRepository.getCashier(c.id);
      assert.equal(nowSynced.isSynced, true);
    });

    test('upsertPulledCashiers respects LWW and branch scoping', () => {
      const remoteTime1 = '2026-01-01T10:00:00.000Z';
      const remoteTime2 = '2026-01-02T10:00:00.000Z';

      cashierRepository.upsertPulledCashiers([
        { id: 'remote-c1', name: 'Remote Cashier', branch_id: 'branch-1', created_at: remoteTime1, updated_at: remoteTime1 },
        { id: 'foreign-c', name: 'Other Branch Cashier', branch_id: 'other-branch', created_at: remoteTime1, updated_at: remoteTime1 },
      ]);

      const inBranch = cashierRepository.getCashier('remote-c1');
      assert.ok(inBranch);
      assert.equal(inBranch.name, 'Remote Cashier');
      assert.equal(inBranch.isSynced, true);

      const foreign = cashierRepository.getCashier('foreign-c');
      assert.equal(foreign, null, 'Foreign branch cashier should not be accessible');

      // Newer update applies
      cashierRepository.upsertPulledCashiers([
        { id: 'remote-c1', name: 'Remote Cashier Renamed', branch_id: 'branch-1', created_at: remoteTime1, updated_at: remoteTime2 },
      ]);
      assert.equal(cashierRepository.getCashier('remote-c1').name, 'Remote Cashier Renamed');

      // Older update does not overwrite newer
      cashierRepository.upsertPulledCashiers([
        { id: 'remote-c1', name: 'Stale Overwrite Attempt', branch_id: 'branch-1', created_at: remoteTime1, updated_at: remoteTime1 },
      ]);
      assert.equal(cashierRepository.getCashier('remote-c1').name, 'Remote Cashier Renamed');
    });
  });

  describe('OrderRepository', () => {
    test('creates order and preserves cashier name and avatar snapshot', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 5',
        orderNumber: 'ORD-001',
        items: [{ id: 'item-1', name: 'Coffee', price: 30, quantity: 2 }],
        totalAmount: 60,
        cashierName: 'Fatima',
        cashierAvatar: 'data:image/jpeg;base64,fatima-avatar',
      });

      assert.ok(order);
      assert.equal(order.cashierName, 'Fatima');
      assert.equal(order.cashierAvatar, 'data:image/jpeg;base64,fatima-avatar');
      assert.equal(order.paymentStatus, 'Unpaid');

      const retrieved = orderRepository.getOrder(order.id);
      assert.equal(retrieved.cashierName, 'Fatima');
      assert.equal(retrieved.cashierAvatar, 'data:image/jpeg;base64,fatima-avatar');
    });

    test('completeOrderPayment is idempotent and records paidAmount and paidAt', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 1',
        orderNumber: 'ORD-002',
        items: [{ id: 'item-1', name: 'Tea', price: 20, quantity: 1 }],
        totalAmount: 20,
        subtotal: 20,
        taxAmount: 2.8,
        grandTotal: 22.8,
      });

      const paidOrder = orderRepository.completeOrderPayment(order.id, 'Cash');
      assert.equal(paidOrder.paymentStatus, 'Paid');
      assert.equal(paidOrder.paymentMethod, 'Cash');
      assert.equal(paidOrder.paidAmount, 22.8);
      assert.ok(paidOrder.paidAt);
      assert.equal(paidOrder.isSynced, false);

      const paidAtFirst = paidOrder.paidAt;

      // Call payment again with different method - must be idempotent and return existing without altering
      const secondCall = orderRepository.completeOrderPayment(order.id, 'CreditCard');
      assert.equal(secondCall.paymentMethod, 'Cash', 'Payment method must not be mutated on repeated call');
      assert.equal(secondCall.paidAt, paidAtFirst, 'paidAt timestamp must not be re-stamped');
    });

    test('completeOrderPayment throws error on cancelled order', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 2',
        orderNumber: 'ORD-003',
        items: [{ id: 'item-1', name: 'Juice', price: 25, quantity: 1 }],
        totalAmount: 25,
      });

      orderRepository.updateOrderStatus(order.id, 'Cancelled');
      const cancelled = orderRepository.getOrder(order.id);
      assert.equal(cancelled.status, 'Cancelled');

      assert.throws(() => {
        orderRepository.completeOrderPayment(order.id, 'Cash');
      }, /cancelled order/i);
    });

    test('markOrdersSynced version guarding prevents marking concurrent edits as synced', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 3',
        orderNumber: 'ORD-004',
        items: [{ id: 'item-1', name: 'Water', price: 10, quantity: 1 }],
        totalAmount: 10,
      });

      const pending = orderRepository.getUnsyncedOrders();
      const snapshot = pending.find(o => o.id === order.id);
      assert.ok(snapshot);
      assert.equal(snapshot.isSynced, false);

      // Concurrent local update (e.g. status change)
      orderRepository.updateOrderStatus(order.id, 'Preparing');

      // Stale sync confirmation arrives with older version
      orderRepository.markOrdersSynced([order.id], [snapshot]);

      const afterStaleSync = orderRepository.getOrder(order.id);
      assert.equal(afterStaleSync.isSynced, false, 'Order with newer local revision must remain unsynced');

      // Accurate sync confirmation with matching version
      const currentSnapshot = orderRepository.getOrder(order.id);
      orderRepository.markOrdersSynced([order.id], [currentSnapshot]);

      const afterAccurateSync = orderRepository.getOrder(order.id);
      assert.equal(afterAccurateSync.isSynced, true, 'Order matching version should be marked synced');
    });

    test('deleteOrder soft-deletes order and marks unsynced for cloud sync', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 4',
        orderNumber: 'ORD-005',
        items: [{ id: 'item-1', name: 'Cake', price: 40, quantity: 1 }],
        totalAmount: 40,
      });

      orderRepository.markOrdersSynced([order.id]);
      assert.equal(orderRepository.getOrder(order.id).isSynced, true);

      orderRepository.deleteOrder(order.id);
      // Soft-deleted order is not returned by getOrder / getOrders
      assert.equal(orderRepository.getOrder(order.id), null);

      // But is returned in getUnsyncedOrders with deletedAt so it syncs deletion to cloud
      const unsynced = orderRepository.getUnsyncedOrders();
      const tombstone = unsynced.find(o => o.id === order.id);
      assert.ok(tombstone);
      assert.ok(tombstone.deletedAt);
      assert.equal(tombstone.isSynced, false);
    });
  });

  describe('reports_outbox Persistence', () => {
    test('enqueues, updates with LWW versioning, and flushes from outbox', () => {
      const payload1 = { id: 'ord-100', totalAmount: 100 };
      const payload2 = { id: 'ord-100', totalAmount: 150 };

      database.enqueueReportOutbox('orders', 'ord-100', payload1, '2026-01-01T10:00:00.000Z');

      let pending = database.getPendingReportOutbox(50);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].record_id, 'ord-100');
      assert.equal(JSON.parse(pending[0].payload).totalAmount, 100);

      // Stale version is rejected / ignored
      database.enqueueReportOutbox('orders', 'ord-100', { id: 'ord-100', totalAmount: 80 }, '2025-12-31T10:00:00.000Z');
      pending = database.getPendingReportOutbox(50);
      assert.equal(JSON.parse(pending[0].payload).totalAmount, 100);

      // Newer version overwrites
      database.enqueueReportOutbox('orders', 'ord-100', payload2, '2026-01-02T10:00:00.000Z');
      pending = database.getPendingReportOutbox(50);
      assert.equal(JSON.parse(pending[0].payload).totalAmount, 150);

      // Delete by version
      database.deleteReportOutbox('orders', 'ord-100', '2026-01-02T10:00:00.000Z');
      pending = database.getPendingReportOutbox(50);
      assert.equal(pending.length, 0);
    });
  });

  describe('Branch scoping (menu / customers / inventory)', () => {
    test('getMenu hides another branch items but shows own and shared ones', () => {
      menuRepository.createMenuItem({ name: 'Own Latte', price: 30, category: 'Hot Coffee|Bar' });
      menuRepository.createMenuItem({ name: 'Shared Tea', price: 15, category: 'Hot Coffee|Bar', branchId: null });

      // Simulate a row pulled from the cloud that belongs to another branch
      menuRepository.upsertPulledMenuItems([
        { id: 'menu-foreign', name: 'Foreign Cake', price: 50, category: 'Desserts|Kitchen', branch_id: 'other-branch', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      ]);

      const names = menuRepository.getMenu().map(m => m.name);
      assert.ok(names.includes('Own Latte'), 'own branch item is visible');
      assert.ok(names.includes('Shared Tea'), 'shared (NULL branch) item is visible');
      assert.ok(!names.includes('Foreign Cake'), 'another branch item must not be visible');
    });

    test('getUnsyncedMenu does not push another branch rows', () => {
      menuRepository.upsertPulledMenuItems([
        { id: 'menu-foreign', name: 'Foreign Cake', price: 50, category: 'Desserts|Kitchen', branch_id: 'other-branch', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      ]);
      menuRepository.createMenuItem({ name: 'Own Latte', price: 30, category: 'Hot Coffee|Bar' });

      const unsynced = menuRepository.getUnsyncedMenu();
      // The pulled foreign row is inserted as is_synced = 1, and even if it were not,
      // the push query must exclude it.
      assert.ok(unsynced.every(m => m.branchId === 'branch-1' || m.branchId === undefined || m.branchId === null),
        'push batch must only carry this branch or shared rows');
      assert.ok(unsynced.some(m => m.name === 'Own Latte'));
    });

    test('markMenuSynced with a stale snapshot leaves a concurrent edit unsynced', () => {
      menuRepository.createMenuItem({ name: 'Latte', price: 30, category: 'Hot Coffee|Bar' });
      const pending = menuRepository.getUnsyncedMenu();
      const snapshot = pending.find(m => m.name === 'Latte');

      // Concurrent local edit while the push was in flight
      menuRepository.updateMenuItem(snapshot.id, { price: 35 });

      menuRepository.markMenuSynced([snapshot.id], [snapshot]);
      const after = menuRepository.getMenuItem(snapshot.id);
      assert.equal(after.isSynced, false, 'a row edited mid-push must stay unsynced');
      assert.equal(after.price, 35);
    });

    test('customers: reads, deletion and pushes stay scoped to the branch', () => {
      // A customer pulled from the cloud that belongs to another branch
      customerRepository.upsertPulledCustomers([
        { id: 'cust-foreign', name: 'Foreign Customer', phone: '01000000001', points: 10, createdAt: '2026-01-01T00:00:00.000Z', branch_id: 'other-branch', updated_at: '2026-01-01T00:00:00.000Z' },
      ]);
      customerRepository.saveCustomer({ phone: '01000000002', name: 'Local Customer', points: 5 });

      const visible = customerRepository.getCustomers();
      assert.ok(visible.some(c => c.phone === '01000000002'));
      assert.ok(!visible.some(c => c.phone === '01000000001'), 'another branch customer must not be returned');

      // Same phone on another branch must not be found or overwritten by this till
      assert.equal(customerRepository.getCustomerByPhone('01000000001'), null);

      // Deleting a foreign id must not tombstone it
      customerRepository.deleteCustomer('cust-foreign');
      assert.equal(customerRepository.getUnsyncedCustomers().length, 1, 'only the local customer is pending');
    });

    test('markCustomersSynced with a stale snapshot leaves a concurrent points edit unsynced', () => {
      customerRepository.saveCustomer({ phone: '01000000003', name: 'Loyal Customer', points: 10 });
      const pending = customerRepository.getUnsyncedCustomers();
      const snapshot = pending.find(c => c.phone === '01000000003');

      // Concurrent loyalty edit while the push was in flight
      customerRepository.saveCustomer({ phone: '01000000003', points: 20 });

      customerRepository.markCustomersSynced([snapshot.id], [snapshot]);
      const after = customerRepository.getCustomerByPhone('01000000003');
      assert.equal(after.isSynced, false, 'a customer edited mid-push must stay unsynced');
      assert.equal(after.points, 20);
    });

    test('inventory: getInventory rejects a foreign branch id and never re-scopes a row on update', () => {
      const item = inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 10, minStock: 2, costPerUnit: 100 });
      assert.equal(item.branchId, 'branch-1');

      assert.throws(() => inventoryRepository.getInventory('other-branch'), /another branch/i);

      // An update carrying a foreign branchId must not re-scope the row
      inventoryRepository.updateInventoryItem(item.id, { stock: 8, branchId: 'other-branch' });
      const after = inventoryRepository.getInventoryItem(item.id);
      assert.equal(after.branchId, 'branch-1', 'branch_id is not editable through an item update');
      assert.equal(after.stock, 8);
    });

    test('inventory: ADJUST sets the counted balance instead of adding to it', () => {
      const item = inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 10, minStock: 2, costPerUnit: 100 });

      // A physical count of 4 on a bin that believes it holds 10
      inventoryRepository.createInventoryTransaction({ itemId: item.id, type: 'ADJUST', quantity: 4, referenceId: 'MANUAL' });
      const after = inventoryRepository.getInventoryItem(item.id);
      assert.equal(after.stock, 4, 'ADJUST must set the balance to the counted quantity');

      // IN still adds, OUT still subtracts
      inventoryRepository.createInventoryTransaction({ itemId: item.id, type: 'IN', quantity: 6 });
      assert.equal(inventoryRepository.getInventoryItem(item.id).stock, 10);
      inventoryRepository.createInventoryTransaction({ itemId: item.id, type: 'OUT', quantity: 3 });
      assert.equal(inventoryRepository.getInventoryItem(item.id).stock, 7);
    });

    test('getSyncStats can reach zero when work is parked or belongs to another branch', () => {
      // A count that can never reach zero pins the cycle to 'syncing', which keeps
      // consecutiveFailures at 0 — no backoff, polling forever with nothing to show for it.
      // Stock 0 on purpose: a non-zero opening balance also writes a ledger row, which
      // would keep the inventory total above zero for an unrelated reason.
      const item = inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 0, minStock: 2, costPerUnit: 100 });
      assert.ok(database.getSyncStats().pendingInventory >= 1, 'a fresh row counts as pending work');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        database.markSyncFailure('inventory', [item.id], 'worker rejected the row');
      }
      assert.equal(database.getSyncStats().pendingInventory, 0, 'a parked row is no longer pending work');

      const now = new Date().toISOString();
      database.getDb().prepare(`
        INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run('inv-other-branch', 'Other Bean', 'kg', 5, 0, 10, 'other-branch', now, now);

      assert.equal(
        database.getSyncStats().totalPending,
        0,
        'another branch row is never pushed by this till, so it must not block convergence'
      );
    });

    test('inventory: a "manager" scope from the renderer does not widen to the whole chain', () => {
      inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 10, minStock: 2, costPerUnit: 100 });

      // Simulate a row pulled from the cloud that belongs to another branch.
      inventoryRepository.upsertPulledInventory([
        { id: 'inv-foreign', name: 'Foreign Beans', unit: 'kg', stock: 99, minStock: 1, costPerUnit: 10, branch_id: 'other-branch', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null },
      ]);

      // 'manager' and 'default' used to be accepted and returned every branch's stock.
      assert.throws(() => inventoryRepository.getInventory('manager'), /another branch/i);
      assert.throws(() => inventoryRepository.getInventory('default'), /another branch/i);

      const names = inventoryRepository.getInventory().map(i => i.name);
      assert.ok(names.includes('Beans'));
      assert.ok(!names.includes('Foreign Beans'), 'another branch stock must never reach this till');
    });

    test('menu: a foreign branchId on create cannot file an item under another branch', () => {
      const item = menuRepository.createMenuItem({
        name: 'Smuggled Item', price: 10, category: 'Hot Coffee|Bar', branchId: 'other-branch',
      });
      assert.equal(item.branchId, 'branch-1', 'an untrusted branchId must not be honoured');
      assert.ok(menuRepository.getMenu().some(m => m.id === item.id), 'and the row stays readable here');
    });

    test('menu: update and delete cannot reach another branch row', () => {
      menuRepository.upsertPulledMenuItems([
        { id: 'menu-foreign', name: 'Foreign Cake', price: 50, category: 'Desserts|Kitchen', branch_id: 'other-branch', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      ]);

      // The row is only reachable through the pull path, never through the IPC mutations.
      assert.equal(menuRepository.getMenuItem('menu-foreign'), null);

      const updated = menuRepository.updateMenuItem('menu-foreign', { name: 'Renamed By Stranger' });
      assert.equal(updated, null, 'another branch item must not be editable by id alone');

      menuRepository.deleteMenuItem('menu-foreign');

      const sqlite = database.getDb();
      const row = sqlite.prepare('SELECT deleted_at FROM menu_items WHERE id = ?').get('menu-foreign');
      assert.equal(row.deleted_at, null, 'another branch item must not be tombstoned by id alone');
    });

    test('getDailyReportStats counts only this branch and skips cancelled orders', () => {
      const now = new Date().toISOString();
      orderRepository.createOrder({
        tableId: 'T1', orderNumber: 'D-1', items: [{ id: 'i1', name: 'Coffee', price: 30, quantity: 1 }],
        totalAmount: 30, subtotal: 30, taxAmount: 0, grandTotal: 30, paymentStatus: 'Paid', branchId: 'branch-1',
      });
      orderRepository.createOrder({
        tableId: 'T2', orderNumber: 'D-2', items: [{ id: 'i1', name: 'Coffee', price: 30, quantity: 1 }],
        totalAmount: 30, subtotal: 30, taxAmount: 0, grandTotal: 30, paymentStatus: 'Paid', branchId: 'branch-1',
        status: 'Cancelled',
      });
      orderRepository.upsertPulledOrders([
        {
          $id: 'ord-foreign-paid', $createdAt: now, $updatedAt: now,
          orderNumber: 'F-1', tableId: 'T3', status: 'Completed', paymentStatus: 'Paid',
          total_amount: 500, items: '[]', branch_id: 'other-branch',
        },
      ]);

      const stats = orderRepository.getDailyReportStats();
      assert.equal(stats.totalOrders, 1, 'another branch order and a cancelled order must not be counted');
      assert.equal(stats.totalRevenue, 30, 'revenue is this branch only');
    });

    test('an over-redemption never stores a negative paidAmount', () => {
      const order = orderRepository.createOrder({
        tableId: 'T9', orderNumber: 'P-1', items: [{ id: 'i1', name: 'Tea', price: 20, quantity: 1 }],
        totalAmount: 20, subtotal: 20, taxAmount: 0, grandTotal: 20,
        paymentStatus: 'Paid', pointsRedeemed: 1000,
      });
      assert.equal(order.paidAmount, 0, 'collected cash cannot be negative: it would subtract from revenue');
    });

    test('restoring a cancelled order credits every OUT row, including a repeated item line', () => {
      const beans = inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 20, minStock: 2, costPerUnit: 100 });
      inventoryRepository.saveMenuRecipe('latte', [{ inventoryItemId: beans.id, quantity: 2 }]);

      // One order carrying the same menu item on two separate lines: deduction writes one
      // OUT row per line, so the ledger holds two OUT rows of 2 for the same ingredient.
      inventoryRepository.deductInventoryForOrder('order-1', [
        { menuItemId: 'latte', name: 'Latte', quantity: 1 },
        { menuItemId: 'latte', name: 'Latte', quantity: 1 },
      ]);
      assert.equal(inventoryRepository.getInventoryItem(beans.id).stock, 16, 'two lines of 2 units each consume 4');

      inventoryRepository.restoreInventoryForOrder('order-1');
      assert.equal(
        inventoryRepository.getInventoryItem(beans.id).stock,
        20,
        'cancelling must restore the full 4, not only the first OUT row'
      );

      const ledger = inventoryRepository.getInventoryTransactions(beans.id, 'branch-1');
      const returned = ledger.filter(tx => tx.type === 'IN' && tx.referenceId === 'order-1');
      assert.equal(
        returned.reduce((sum, tx) => sum + (Number(tx.quantity) || 0), 0),
        4,
        'the ledger must record the whole credit, so a later reversal can read it back'
      );
    });

    test('restoring a cancelled order twice does not credit the stock twice', () => {
      const beans = inventoryRepository.createInventoryItem({ name: 'Beans', unit: 'kg', stock: 20, minStock: 2, costPerUnit: 100 });
      inventoryRepository.saveMenuRecipe('latte', [{ inventoryItemId: beans.id, quantity: 2 }]);

      inventoryRepository.deductInventoryForOrder('order-2', [{ menuItemId: 'latte', name: 'Latte', quantity: 1 }]);
      assert.equal(inventoryRepository.getInventoryItem(beans.id).stock, 18);

      inventoryRepository.restoreInventoryForOrder('order-2');
      inventoryRepository.restoreInventoryForOrder('order-2');

      assert.equal(inventoryRepository.getInventoryItem(beans.id).stock, 20, 'a repeated reversal is a no-op');
    });

    test('upsertPulledOrders keeps a branchless cloud row shared (NULL), not owned by default', () => {
      orderRepository.upsertPulledOrders([
        {
          $id: 'ord-shared', $createdAt: '2026-01-01T10:00:00.000Z', $updatedAt: '2026-01-01T10:00:00.000Z',
          orderNumber: 'S-1', tableId: 'Takeaway', status: 'New', paymentStatus: 'Unpaid',
          total_amount: 25, items: '[]', branch_id: null,
        },
        {
          $id: 'ord-foreign', $createdAt: '2026-01-01T10:00:00.000Z', $updatedAt: '2026-01-01T10:00:00.000Z',
          orderNumber: 'F-1', tableId: 'Takeaway', status: 'New', paymentStatus: 'Unpaid',
          total_amount: 25, items: '[]', branch_id: 'other-branch',
        },
      ]);

      const orders = orderRepository.getOrders();
      assert.ok(orders.some(o => o.id === 'ord-shared'), 'a shared (branchless) cloud row stays visible to every branch');
      assert.ok(!orders.some(o => o.id === 'ord-foreign'), 'another branch order must not be pulled into this till');

      const shared = orderRepository.getOrder('ord-shared');
      assert.equal(shared.branchId, undefined, 'a branchless row must stay branchless, not become "default"');
    });
  });

  describe('Parked sync rows', () => {
    /** Parks a row by exhausting its retry budget, the way repeated push failures do. */
    const park = (table, id) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        database.markSyncFailure(table, [id], 'worker rejected the row');
      }
    };

    test('a row that exhausts its budget is parked and stops counting as pending work', () => {
      const cashier = cashierRepository.createCashier('Parked Cashier');
      park('cashiers', cashier.id);

      assert.equal(
        database.getParkedSyncRows().filter(r => r.id === cashier.id).length,
        1,
        'the row is reported as parked so the condition is visible'
      );
      assert.equal(database.getSyncStats().pendingCashiers, 0, 'a parked row leaves the push queue');
    });

    test('releaseParkedSyncRows gives the row its budget back', () => {
      const cashier = cashierRepository.createCashier('Released Cashier');
      park('cashiers', cashier.id);
      assert.equal(database.getSyncStats().pendingCashiers, 0);

      const released = database.releaseParkedSyncRows();

      assert.equal(released, 1, 'exactly the parked row is released');
      assert.equal(database.getSyncStats().pendingCashiers, 1, 'the row is pending work again');
      assert.equal(database.getParkedSyncRows().length, 0);
    });

    test('releasing clears the stored error, so the next failure is reported fresh', () => {
      const cashier = cashierRepository.createCashier('Fresh Error Cashier');
      park('cashiers', cashier.id);
      assert.ok(
        database.getParkedSyncRows().some(r => r.last_error),
        'parked rows carry the error that parked them'
      );

      database.releaseParkedSyncRows();
      database.markSyncFailure('cashiers', [cashier.id], 'a new, different failure');

      // Not parked yet on one attempt, so read the error off the row itself.
      const row = database.getDb().prepare('SELECT last_error FROM cashiers WHERE id = ?').get(cashier.id);
      assert.equal(row.last_error, 'a new, different failure');
    });

    test('only rows that exhausted their budget are touched', () => {
      const pending = cashierRepository.createCashier('Still Trying');
      database.markSyncFailure('cashiers', [pending.id], 'first failure');
      const parked = cashierRepository.createCashier('Given Up');
      park('cashiers', parked.id);

      database.releaseParkedSyncRows();

      const attempts = database.getDb()
        .prepare('SELECT sync_attempts FROM cashiers WHERE id = ?')
        .get(pending.id).sync_attempts;
      assert.equal(attempts, 1, 'a row mid-retry keeps its count instead of starting over');
    });

    test('release is idempotent and safe when nothing is parked', () => {
      cashierRepository.createCashier('Healthy Cashier');
      assert.equal(database.releaseParkedSyncRows(), 0);
      assert.equal(database.releaseParkedSyncRows(), 0, 'releasing twice changes nothing');
    });
  });

  describe('Sync push scoping (transactions) and re-arming parked rows', () => {
    /** Parks a row the way repeated push failures do: its retry budget is exhausted. */
    const parkRow = (table, id) => {
      database.getDb().prepare(`UPDATE ${table} SET sync_attempts = 5, is_synced = 0 WHERE id = ?`).run(id);
    };

    /** Inserts a movement directly, so its branch can be set to something this test needs. */
    const insertMovement = (id, itemId, branchId) => {
      database.getDb().prepare(`
        INSERT INTO inventory_transactions
          (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, sync_attempts)
        VALUES (?, ?, 'IN', 3, 'MANUAL', '2026-01-01T00:00:00.000Z', ?, 0, 0)
      `).run(id, itemId, branchId);
    };

    test('getUnsyncedTransactions does not push another branch movements', () => {
      const own = inventoryRepository.createInventoryItem(
        { name: 'Milk', unit: 'L', stock: 10, minStock: 2, costPerUnit: 5 }
      );
      inventoryRepository.createInventoryTransaction({
        itemId: own.id, type: 'IN', quantity: 5, referenceId: 'MANUAL',
      });
      insertMovement('tx-foreign', own.id, 'other-branch');
      insertMovement('tx-shared', own.id, null);

      const ids = inventoryRepository.getUnsyncedTransactions().map(t => t.id);

      assert.ok(ids.includes('tx-shared'), 'a shared (NULL branch) movement is still pushed');
      assert.ok(!ids.includes('tx-foreign'), 'a sibling branch movement must never be pushed');
    });

    test('the ledger shows shared movements as well as this branch ones', () => {
      const item = inventoryRepository.createInventoryItem(
        { name: 'Sugar', unit: 'kg', stock: 10, minStock: 2, costPerUnit: 5 }
      );
      inventoryRepository.createInventoryTransaction({
        itemId: item.id, type: 'IN', quantity: 4, referenceId: 'MANUAL',
      });
      insertMovement('tx-shared-view', item.id, null);

      const ids = inventoryRepository.getInventoryTransactions(item.id, 'branch-1').map(t => t.id);
      assert.ok(ids.includes('tx-shared-view'), 'a shared movement is visible in the ledger');
    });

    test('an edit re-arms a row that had parked, so it leaves the device again', () => {
      const item = menuRepository.createMenuItem(
        { name: 'Flat White', price: 32, category: 'Hot Coffee|Bar' }
      );
      parkRow('menu_items', item.id);
      assert.equal(menuRepository.getUnsyncedMenu().length, 0, 'the row is parked');

      menuRepository.deleteMenuItem(item.id);

      assert.equal(
        menuRepository.getUnsyncedMenu().length, 1,
        'deleting a parked item must queue it again, or the delete never reaches the cloud'
      );
    });

    test('cancelling an order re-arms it after it parked', () => {
      const order = orderRepository.createOrder({
        tableId: 'Table 5',
        orderNumber: 'ORD-PARKED',
        items: [{ id: 'item-1', name: 'Latte', price: 30, quantity: 1 }],
        totalAmount: 30,
      });
      parkRow('orders', order.id);
      assert.equal(orderRepository.getUnsyncedOrders().length, 0, 'the order is parked');

      orderRepository.updateOrderStatus(order.id, 'Cancelled');

      assert.equal(orderRepository.getUnsyncedOrders().length, 1, 'a cancelled order must sync again');
    });

    test('a stock movement re-arms a parked inventory item', () => {
      const item = inventoryRepository.createInventoryItem(
        { name: 'Beans', unit: 'kg', stock: 8, minStock: 1, costPerUnit: 40 }
      );
      parkRow('inventory', item.id);
      assert.equal(inventoryRepository.getUnsyncedInventory().length, 0, 'the item is parked');

      inventoryRepository.createInventoryTransaction({
        itemId: item.id, type: 'OUT', quantity: 2, referenceId: 'MANUAL',
      });

      assert.equal(
        inventoryRepository.getUnsyncedInventory().length, 1,
        'stock moved, so the item must sync again'
      );
    });
  });
});
