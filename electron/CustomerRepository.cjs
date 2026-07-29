const database = require('./database.cjs');
const { randomUUID } = require('crypto');

class CustomerRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  mapRow(row) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      points: row.points,
      createdAt: row.createdAt,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  getCustomers() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY createdAt DESC').all();
    return rows.map(row => this.mapRow(row));
  }

  getCustomerByPhone(phone) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL').get(phone);
    if (!row) return null;
    return this.mapRow(row);
  }

  saveCustomer(customer) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const existing = sqlite.prepare('SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL').get(customer.phone);

    if (existing) {
      sqlite.prepare('UPDATE customers SET name = ?, points = ?, updated_at = ?, is_synced = 0 WHERE phone = ?').run(
        customer.name || existing.name,
        customer.points !== undefined ? customer.points : existing.points,
        now,
        customer.phone
      );
      return this.getCustomerByPhone(customer.phone);
    } else {
      const id = customer.id || `cust-${randomUUID()}`;
      const createdAt = customer.createdAt || now;
      const branchId = customer.branchId || this.getBranchId();
      sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .run(id, customer.name || 'Customer', customer.phone, customer.points || 0, createdAt, branchId, now);
      return this.getCustomerByPhone(customer.phone);
    }
  }

  /**
   * Apply a loyalty points change atomically. MUST be called inside an outer
   * better-sqlite3 transaction (nested calls become savepoints).
   * Writes ledger entries to points_transactions for audit (Issue 26).
   */
  applyPointsChangeInTx(phone, { pointsEarned = 0, pointsRedeemed = 0, orderId = null, branchId = null, customerName = null }) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    // Ensure the customer exists (upsert by phone)
    let customer = sqlite.prepare('SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL').get(phone);
    if (!customer) {
      const id = `cust-${randomUUID()}`;
      sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, 0, ?, ?, 0, ?)')
        .run(id, customerName || 'Customer', phone, now, activeBranch, now);
      customer = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    }

    const delta = Number(pointsEarned) - Number(pointsRedeemed);
    const newBalance = Math.max(0, (Number(customer.points) || 0) + delta);

    sqlite.prepare('UPDATE customers SET points = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(newBalance, now, customer.id);

    const insertLedger = sqlite.prepare(`
      INSERT INTO points_transactions (id, customerId, orderId, type, points, balanceAfter, createdAt, branch_id, is_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    if (Number(pointsRedeemed) > 0) {
      insertLedger.run(`ptx-${randomUUID()}`, customer.id, orderId, 'REDEEM', -Number(pointsRedeemed), newBalance, now, activeBranch);
    }
    if (Number(pointsEarned) > 0) {
      insertLedger.run(`ptx-${randomUUID()}`, customer.id, orderId, 'EARN', Number(pointsEarned), newBalance, now, activeBranch);
    }

    return { customerId: customer.id, newBalance };
  }

  deleteCustomer(id) {
    const sqlite = this.getDb();
    // Soft delete with tombstone so the deletion syncs (Issue 20).
    // Past orders keep their customerPhone snapshot for reporting context.
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE customers SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(now, now, id);
  }

  getUnsyncedCustomers() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM customers WHERE is_synced = 0').all();
    return rows.map(row => ({
      ...this.mapRow(row),
      deletedAt: row.deleted_at || undefined
    }));
  }

  markCustomersSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE customers SET is_synced = 1, sync_attempts = 0, last_error = NULL WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }
}

module.exports = new CustomerRepository();
