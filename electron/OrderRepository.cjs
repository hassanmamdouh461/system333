const database = require('./database.cjs');
const { randomUUID } = require('crypto');

class OrderRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  mapRow(row) {
    let items = [];
    try {
      items = JSON.parse(row.items);
    } catch (e) {
      console.error('[OrderRepository] Failed to parse order items json:', e);
    }
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      tableId: row.tableId,
      items,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paymentMethod: row.paymentMethod || undefined,
      totalAmount: row.totalAmount,
      // Tax snapshot fields (Issue 25) — stored at payment time, read as-is everywhere
      subtotal: row.subtotal != null ? row.subtotal : undefined,
      taxRate: row.taxRate != null ? row.taxRate : undefined,
      taxAmount: row.taxAmount != null ? row.taxAmount : undefined,
      grandTotal: row.grandTotal != null ? row.grandTotal : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      paidAt: row.paidAt || undefined,
      customerPhone: row.customerPhone || undefined,
      pointsEarned: row.pointsEarned || 0,
      pointsRedeemed: row.pointsRedeemed || 0,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  getOrders(branchId) {
    const sqlite = this.getDb();
    // Filter in SQL, not in JS (Issue 22); exclude soft-deleted rows (Issue 20)
    let rows;
    if (branchId && branchId !== 'manager') {
      rows = sqlite.prepare('SELECT * FROM orders WHERE deleted_at IS NULL AND branch_id = ? ORDER BY CAST(orderNumber AS INTEGER) ASC').all(branchId);
    } else {
      rows = sqlite.prepare('SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY CAST(orderNumber AS INTEGER) ASC').all();
    }
    return rows.map(row => this.mapRow(row));
  }

  getOrder(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  createOrder(order) {
    const sqlite = this.getDb();
    const id = order.id || `ord-${randomUUID()}`;
    const createdAt = order.createdAt || new Date().toISOString();
    const now = new Date().toISOString();
    const branchId = order.branchId || this.getBranchId();

    // Tax snapshot: store computed financial fields with the order itself (Issue 25)
    const subtotal = order.subtotal != null ? Number(order.subtotal) : Number(order.totalAmount);
    const taxRate = order.taxRate != null ? Number(order.taxRate) : 0;
    const taxAmount = order.taxAmount != null ? Number(order.taxAmount) : 0;
    const grandTotal = order.grandTotal != null ? Number(order.grandTotal) : subtotal + taxAmount;

    // Atomic daily counter inside the same transaction as the INSERT (Issue 23).
    // Counter is keyed by LOCAL date so it aligns with the local-time daily report (Issue 24).
    const todayLocal = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
    let orderNumber = order.orderNumber;

    const runTx = sqlite.transaction(() => {
      if (!orderNumber) {
        orderNumber = String(database.nextDailyOrderNumber(todayLocal));
      }

      sqlite.prepare(`
        INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, subtotal, taxRate, taxAmount, grandTotal, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, is_synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        orderNumber,
        order.tableId,
        JSON.stringify(order.items),
        order.status,
        order.paymentStatus || 'Unpaid',
        order.paymentMethod || null,
        order.totalAmount,
        subtotal,
        taxRate,
        taxAmount,
        grandTotal,
        createdAt,
        order.paidAt || null,
        order.customerPhone || null,
        order.pointsEarned || 0,
        order.pointsRedeemed || 0,
        branchId,
        now
      );

      // Loyalty points: applied atomically with the order in ONE transaction (Issue 26).
      // Runs for loyalty orders regardless of cancellation status.
      if (order.customerPhone && ((order.pointsEarned || 0) > 0 || (order.pointsRedeemed || 0) > 0)) {
        const customerRepository = require('./CustomerRepository.cjs');
        customerRepository.applyPointsChangeInTx(order.customerPhone, {
          pointsEarned: order.pointsEarned || 0,
          pointsRedeemed: order.pointsRedeemed || 0,
          orderId: id,
          branchId,
          customerName: order.customerName
        });
      }

      // Deduct stock for order items within the same transaction
      if (order.status !== 'Cancelled') {
        const inventoryRepository = require('./InventoryRepository.cjs');
        inventoryRepository.deductInventoryForOrder(id, order.items, branchId);
      }
    });

    try {
      runTx();
    } catch (e) {
      console.error('[OrderRepository] Failed to create order transactionally:', e);
      throw e;
    }

    return {
      ...order,
      id,
      orderNumber,
      createdAt,
      updatedAt: now,
      subtotal,
      taxRate,
      taxAmount,
      grandTotal,
      customerPhone: order.customerPhone || undefined,
      pointsEarned: order.pointsEarned || 0,
      pointsRedeemed: order.pointsRedeemed || 0,
      branchId,
      isSynced: false
    };
  }

  updateOrder(id, data) {
    const sqlite = this.getDb();
    const fields = [];
    const values = [];

    if (data.orderNumber !== undefined) { fields.push('orderNumber = ?'); values.push(data.orderNumber); }
    if (data.tableId !== undefined) { fields.push('tableId = ?'); values.push(data.tableId); }
    if (data.items !== undefined) { fields.push('items = ?'); values.push(JSON.stringify(data.items)); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.paymentStatus !== undefined) { fields.push('paymentStatus = ?'); values.push(data.paymentStatus); }
    if (data.paymentMethod !== undefined) { fields.push('paymentMethod = ?'); values.push(data.paymentMethod); }
    if (data.totalAmount !== undefined) { fields.push('totalAmount = ?'); values.push(data.totalAmount); }
    if (data.subtotal !== undefined) { fields.push('subtotal = ?'); values.push(data.subtotal); }
    if (data.taxRate !== undefined) { fields.push('taxRate = ?'); values.push(data.taxRate); }
    if (data.taxAmount !== undefined) { fields.push('taxAmount = ?'); values.push(data.taxAmount); }
    if (data.grandTotal !== undefined) { fields.push('grandTotal = ?'); values.push(data.grandTotal); }
    if (data.createdAt !== undefined) { fields.push('createdAt = ?'); values.push(data.createdAt); }
    if (data.paidAt !== undefined) { fields.push('paidAt = ?'); values.push(data.paidAt); }
    if (data.customerPhone !== undefined) { fields.push('customerPhone = ?'); values.push(data.customerPhone); }
    if (data.pointsEarned !== undefined) { fields.push('pointsEarned = ?'); values.push(data.pointsEarned); }
    if (data.pointsRedeemed !== undefined) { fields.push('pointsRedeemed = ?'); values.push(data.pointsRedeemed); }
    if (data.branchId !== undefined) { fields.push('branch_id = ?'); values.push(data.branchId); }

    // Always mark as unsynced and update timestamp on mutation
    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');

    if (fields.length === 0) return this.getOrder(id);

    values.push(id);
    sqlite.prepare(`
      UPDATE orders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getOrder(id);
  }

  updateOrderStatus(id, status) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();

    const currentOrder = this.getOrder(id);
    if (!currentOrder) return null;

    const oldStatus = currentOrder.status;

    sqlite.prepare('UPDATE orders SET status = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(status, now, id);

    // Check transitions for stock adjustments
    if (status === 'Cancelled' && oldStatus !== 'Cancelled') {
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        inventoryRepository.restoreInventoryForOrder(id, currentOrder.branchId || this.getBranchId());
      } catch (e) {
        console.error('[OrderRepository] Failed to restore stock on cancellation:', e);
      }
    } else if (oldStatus === 'Cancelled' && status !== 'Cancelled') {
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        inventoryRepository.deductInventoryForOrder(id, currentOrder.items, currentOrder.branchId || this.getBranchId());
      } catch (e) {
        console.error('[OrderRepository] Failed to re-deduct stock on activation:', e);
      }
    }

    return this.getOrder(id);
  }

  completeOrderPayment(id, method) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE orders SET paymentStatus = 'Paid', paymentMethod = ?, paidAt = ?, updated_at = ?, is_synced = 0 WHERE id = ?").run(method, now, now, id);
    return this.getOrder(id);
  }

  deleteOrder(id) {
    const sqlite = this.getDb();
    // Soft delete with tombstone so the deletion syncs to the cloud (Issue 20)
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE orders SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(now, now, id);
  }

  resetOrders(defaults) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const branchId = this.getBranchId();

    const runTransaction = sqlite.transaction((orders) => {
      // Soft-delete existing orders so deletions propagate (Issue 20)
      sqlite.prepare('UPDATE orders SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE deleted_at IS NULL').run(now, now);
      const insert = sqlite.prepare(`
        INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, is_synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          orderNumber = excluded.orderNumber,
          tableId = excluded.tableId,
          items = excluded.items,
          status = excluded.status,
          paymentStatus = excluded.paymentStatus,
          paymentMethod = excluded.paymentMethod,
          totalAmount = excluded.totalAmount,
          paidAt = excluded.paidAt,
          deleted_at = NULL,
          updated_at = excluded.updated_at,
          is_synced = 0
      `);

      const created = [];
      for (const order of orders) {
        const id = order.id || `ord-${randomUUID()}`;
        const createdAt = order.createdAt || now;
        insert.run(
          id,
          order.orderNumber,
          order.tableId,
          JSON.stringify(order.items),
          order.status,
          order.paymentStatus || 'Unpaid',
          order.paymentMethod || null,
          order.totalAmount,
          createdAt,
          order.paidAt || null,
          order.customerPhone || null,
          order.pointsEarned || 0,
          order.pointsRedeemed || 0,
          branchId,
          now
        );
        created.push({ ...order, id, createdAt, updatedAt: now, branchId, isSynced: false });
      }
      return created;
    });

    return runTransaction(defaults);
  }

  getUnsyncedOrders() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM orders WHERE is_synced = 0').all();
    return rows.map(row => ({
      ...this.mapRow(row),
      deletedAt: row.deleted_at || undefined
    }));
  }

  markOrdersSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE orders SET is_synced = 1, sync_attempts = 0, last_error = NULL WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }

  upsertPulledOrders(pulledOrders) {
    if (!pulledOrders || pulledOrders.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();

    // Issue 16: preserve the cloud record's own fields — never re-number,
    // never force status/paymentStatus/tableId.
    // Issue 17: ON CONFLICT only updates when the local row is synced AND the
    // incoming row is at least as new (last-write-wins by updated_at).
    const insert = sqlite.prepare(`
      INSERT INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, subtotal, taxRate, taxAmount, grandTotal, createdAt, paidAt, customerPhone, pointsEarned, pointsRedeemed, branch_id, is_synced, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        orderNumber = excluded.orderNumber,
        tableId = excluded.tableId,
        status = excluded.status,
        paymentStatus = excluded.paymentStatus,
        paymentMethod = excluded.paymentMethod,
        totalAmount = excluded.totalAmount,
        subtotal = excluded.subtotal,
        taxRate = excluded.taxRate,
        taxAmount = excluded.taxAmount,
        grandTotal = excluded.grandTotal,
        items = excluded.items,
        paidAt = excluded.paidAt,
        customerPhone = excluded.customerPhone,
        pointsEarned = excluded.pointsEarned,
        pointsRedeemed = excluded.pointsRedeemed,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_synced = 1
      WHERE orders.is_synced = 1
        AND (orders.updated_at IS NULL OR excluded.updated_at IS NULL OR excluded.updated_at >= orders.updated_at)
    `);

    const runTx = sqlite.transaction((orders) => {
      for (const order of orders) {
        const orderBranchId = order.branch_id || 'default';
        // Filter by branch_id if we are logged in as a specific branch (manager sees all)
        if (branchId !== 'manager' && orderBranchId !== branchId) {
          continue;
        }

        const id = order.$id;
        const createdAt = order.$createdAt;
        const updatedAt = order.$updatedAt || order.$createdAt;
        const totalAmount = Number(order.total_amount) || 0;
        const items = typeof order.items === 'string' ? order.items : JSON.stringify(order.items || []);

        insert.run(
          id,
          String(order.orderNumber != null ? order.orderNumber : ''),
          order.tableId || 'Takeaway',
          items,
          order.status || 'New',
          order.paymentStatus || 'Unpaid',
          order.payment_method || null,
          totalAmount,
          order.subtotal != null ? Number(order.subtotal) : null,
          order.taxRate != null ? Number(order.taxRate) : null,
          order.taxAmount != null ? Number(order.taxAmount) : null,
          order.grandTotal != null ? Number(order.grandTotal) : null,
          createdAt,
          order.paidAt || null,
          order.customerPhone || null,
          Number(order.pointsEarned) || 0,
          Number(order.pointsRedeemed) || 0,
          orderBranchId,
          updatedAt,
          order.deleted_at || null
        );
      }
    });

    runTx(pulledOrders);
  }

  getDailyReportStats() {
    const sqlite = this.getDb();

    // Daily summary in LOCAL timezone (Issue 24) using stored grandTotal when
    // available so the report matches the cashier screens exactly (Issue 25)
    const summary = sqlite.prepare(`
      SELECT
        COUNT(*) as totalOrders,
        SUM(CASE WHEN paymentStatus = 'Paid' THEN COALESCE(grandTotal, totalAmount) ELSE 0 END) as totalRevenue,
        SUM(CASE WHEN paymentStatus = 'Unpaid' THEN COALESCE(grandTotal, totalAmount) ELSE 0 END) as totalUnpaid,
        SUM(CASE WHEN paymentMethod = 'Cash' AND paymentStatus = 'Paid' THEN COALESCE(grandTotal, totalAmount) ELSE 0 END) as cashRevenue,
        SUM(CASE WHEN paymentMethod = 'Card' AND paymentStatus = 'Paid' THEN COALESCE(grandTotal, totalAmount) ELSE 0 END) as cardRevenue
      FROM orders
      WHERE date(createdAt, 'localtime') = date('now', 'localtime')
        AND deleted_at IS NULL
    `).get();

    // Query items sold in local timezone
    const rows = sqlite.prepare(`
      SELECT items FROM orders
      WHERE date(createdAt, 'localtime') = date('now', 'localtime')
        AND paymentStatus = 'Paid'
        AND deleted_at IS NULL
    `).all();

    const itemsMap = {};
    for (const row of rows) {
      try {
        const items = JSON.parse(row.items);
        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          itemsMap[item.name] = (itemsMap[item.name] || 0) + qty;
        }
      } catch (e) {
        console.error('[OrderRepository] Failed to parse items json in getDailyReportStats:', e);
      }
    }

    const itemsSold = Object.entries(itemsMap).map(([name, quantity]) => ({ name, quantity }));

    return {
      date: new Date().toLocaleDateString('en-CA'),
      totalOrders: summary.totalOrders || 0,
      totalRevenue: summary.totalRevenue || 0,
      totalUnpaid: summary.totalUnpaid || 0,
      cashRevenue: summary.cashRevenue || 0,
      cardRevenue: summary.cardRevenue || 0,
      itemsSold
    };
  }
}

module.exports = new OrderRepository();
