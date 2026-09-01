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
   * Applies a loyalty points change and writes its ledger entries.
   *
   * Must be called inside an outer transaction; nested calls become savepoints, so the
   * points change commits or rolls back with the order that caused it.
   *
   * A redemption larger than the balance is refused rather than clamped. Clamping made the
   * order believe it had discounted more than the customer actually had, so the till figure
   * and the points ledger disagreed with nothing recording why.
   */
  applyPointsChangeInTx(phone, { pointsEarned = 0, pointsRedeemed = 0, orderId = null, branchId = null, customerName = null }) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    // Points are a whole-unit balance; a fractional point cannot be redeemed.
    const earned = Math.max(0, Math.floor(Number(pointsEarned) || 0));
    const redeemed = Math.max(0, Math.floor(Number(pointsRedeemed) || 0));

    // Upsert by phone: the phone number is the loyalty identity.
    let customer = sqlite.prepare('SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL').get(phone);
    if (!customer) {
      const id = `cust-${randomUUID()}`;
      sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, 0, ?, ?, 0, ?)')
        .run(id, customerName || 'Customer', phone, now, activeBranch, now);
      customer = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    }

    const currentBalance = Math.max(0, Number(customer.points) || 0);
    if (redeemed > currentBalance) {
      throw new Error(`Cannot redeem ${redeemed} points: the balance is ${currentBalance}`);
    }

    const balanceAfterRedeem = currentBalance - redeemed;
    const newBalance = balanceAfterRedeem + earned;

    sqlite.prepare('UPDATE customers SET points = ?, updated_at = ?, is_synced = 0 WHERE id = ?')
      .run(newBalance, now, customer.id);

    const insertLedger = sqlite.prepare(`
      INSERT INTO points_transactions (id, customerId, orderId, type, points, balanceAfter, createdAt, branch_id, is_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    // Recorded in the order the amounts were applied — the discount comes off the bill,
    // then points accrue on what was actually paid — so each entry's running balance is
    // the balance at that moment rather than the final one.
    if (redeemed > 0) {
      insertLedger.run(`ptx-${randomUUID()}`, customer.id, orderId, 'REDEEM', -redeemed, balanceAfterRedeem, now, activeBranch);
    }
    if (earned > 0) {
      insertLedger.run(`ptx-${randomUUID()}`, customer.id, orderId, 'EARN', earned, newBalance, now, activeBranch);
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
    const rows = sqlite.prepare('SELECT * FROM customers WHERE is_synced = 0 AND sync_attempts < 5').all();
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
