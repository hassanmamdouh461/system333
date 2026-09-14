const database = require('./database.cjs');
const { randomUUID } = require('crypto');
const { MAX_SYNC_ATTEMPTS } = database;

// Monotonic per-row version: a second edit in the same millisecond still gets a newer
// updated_at, which the sync version guards compare on.
function nextUpdatedAt(previous) {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}

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
    const branchId = this.getBranchId();
    // Loyalty members are shared across branches by phone, but a row another branch owns
    // must not be adopted by this till: reads, pushes and deletes all stay scoped.
    const rows = sqlite.prepare(`
      SELECT * FROM customers
      WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
      ORDER BY createdAt DESC
    `).all(branchId);
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Applies rows pulled from the cloud, including their deleted_at so a deletion made on
   * another branch disappears here too. Only overwrites a local row that is synced or older.
   */
  /**
   * `points` is deliberately NOT overwritten on conflict, for the same reason stock is not:
   * it is a running balance this till maintains from its own points_transactions ledger, and
   * the cloud value is whichever branch pushed last. Adopting it let a redemption made here
   * be undone by a sibling's older balance — the customer then spent the same points twice.
   * A newly discovered customer still takes points from the INSERT.
   */
  upsertPulledCustomers(rows) {
    if (!rows || rows.length === 0) return;
    const sqlite = this.getDb();
    const insert = sqlite.prepare(`
      INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_synced = 1
      WHERE customers.is_synced = 1
        AND (customers.updated_at IS NULL OR excluded.updated_at IS NULL OR excluded.updated_at >= customers.updated_at)
    `);
    const runTx = sqlite.transaction((items) => {
      for (const row of items) {
        insert.run(
          row.id,
          row.name || 'Customer',
          row.phone || '',
          Number(row.points) || 0,
          row.createdAt || row.updated_at,
          row.branch_id || null,
          row.updated_at || null,
          row.deleted_at || null
        );
      }
    });
    runTx(rows);
  }

  getCustomerByPhone(phone) {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    const row = sqlite.prepare(`
      SELECT * FROM customers
      WHERE phone = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).get(phone, branchId);
    if (!row) return null;
    return this.mapRow(row);
  }

  saveCustomer(customer) {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    const existing = sqlite.prepare(`
      SELECT * FROM customers
      WHERE phone = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).get(customer.phone, branchId);
    // Monotonic version even for a burst of edits within one millisecond.
    const now = nextUpdatedAt(existing ? existing.updated_at : null);

    if (existing) {
      sqlite.prepare('UPDATE customers SET name = ?, points = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL WHERE phone = ?').run(
        customer.name || existing.name,
        customer.points !== undefined ? customer.points : existing.points,
        now,
        customer.phone
      );
      return this.getCustomerByPhone(customer.phone);
    } else {
      const id = customer.id || `cust-${randomUUID()}`;
      const createdAt = customer.createdAt || now;
      // A branchId from the caller is accepted only when it is this branch's own id; a
      // foreign id would re-scope the row to a branch this till cannot even read back.
      const assignedBranch = (customer.branchId && customer.branchId === branchId)
        ? customer.branchId
        : branchId;
      sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .run(id, customer.name || 'Customer', customer.phone, customer.points || 0, createdAt, assignedBranch, now);
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

    // sync_attempts is cleared for the same reason as the other mutation paths: a row
    // parked at the budget stays parked unless an edit gives it its attempts back.
    sqlite.prepare('UPDATE customers SET points = ?, updated_at = ?, is_synced = 0, sync_attempts = 0 WHERE id = ?')
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
    const branchId = this.getBranchId();
    // Soft delete with tombstone so the deletion syncs (Issue 20).
    // Past orders keep their customerPhone snapshot for reporting context.
    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE customers SET deleted_at = ?, updated_at = ?, is_synced = 0
      WHERE id = ? AND (branch_id = ? OR branch_id IS NULL)
    `).run(now, now, id, branchId);
  }

  getUnsyncedCustomers() {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    const rows = sqlite.prepare(`
      SELECT * FROM customers
      WHERE is_synced = 0 AND sync_attempts < ? AND (branch_id = ? OR branch_id IS NULL)
    `).all(MAX_SYNC_ATTEMPTS, branchId);
    return rows.map(row => ({
      ...this.mapRow(row),
      deletedAt: row.deleted_at || undefined
    }));
  }

  markCustomersSynced(ids, snapshots) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    // Version-guarded like orders: a loyalty edit made while the push was in flight keeps
    // the row unsynced so the edit itself is pushed next cycle.
    const versions = snapshots === undefined ? null : new Map((snapshots || []).map(row => [row.id, row.updatedAt ?? row.updated_at ?? null]));
    const stmt = sqlite.prepare(`
      UPDATE customers SET is_synced = 1, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND (branch_id = ? OR branch_id IS NULL)${versions ? ' AND (updated_at IS ? OR updated_at IS NULL)' : ''}
    `);
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        if (versions && !versions.has(id)) continue;
        stmt.run(id, branchId, ...(versions ? [versions.get(id)] : []));
      }
    });
    runTx(ids);
  }
}

module.exports = new CustomerRepository();
