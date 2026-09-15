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

  /**
   * Applies loyalty ledger rows pulled from the cloud.
   *
   * `upsertPulledCustomers` deliberately refuses to copy a sibling branch's `points` balance,
   * because that balance is simply whichever branch pushed last. That left loyalty broken
   * across branches: points earned at one till never reached a customer record that already
   * existed at another. The ledger is the only correct source for the *change*, so a pulled
   * transaction is inserted here and its delta applied locally.
   *
   * The ledger is append-only and every row carries a stable id, so a row already present is
   * ignored — this runs on every cycle, and replaying a row would apply its delta twice. Own
   * rows pushed earlier and pulled back are therefore harmless.
   */
  upsertPulledPointsTransactions(rows) {
    if (!rows || rows.length === 0) return;
    const sqlite = this.getDb();
    const insert = sqlite.prepare(`
      INSERT OR IGNORE INTO points_transactions
        (id, customerId, orderId, type, points, balanceAfter, createdAt, branch_id, is_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const applyDelta = sqlite.prepare(`
      UPDATE customers
         SET points = MAX(0, COALESCE(points, 0) + ?),
             updated_at = ?,
             is_synced = 0
       WHERE id = ? AND deleted_at IS NULL
    `);

    const runTx = sqlite.transaction((items) => {
      for (const row of items) {
        if (!row || !row.id || !row.customerId) continue;
        const delta = Number(row.points);
        if (!Number.isFinite(delta) || delta === 0) continue;

        const result = insert.run(
          row.id,
          row.customerId,
          row.orderId || null,
          row.type || 'EARN',
          delta,
          row.balanceAfter != null ? Number(row.balanceAfter) : null,
          row.createdAt || new Date().toISOString(),
          row.branch_id || null
        );

        // INSERT OR IGNORE reports zero changes for a row this till already has, which is
        // what keeps a replay from double-counting it.
        if (result.changes > 0) {
          applyDelta.run(delta, nextUpdatedAt(null), row.customerId);
        }
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
    if (customer.branchId != null && customer.branchId !== '' && customer.branchId !== branchId) {
      throw new Error('Cannot access another branch');
    }
    return sqlite.transaction(() => {
      const existing = sqlite.prepare(`
        SELECT * FROM customers
        WHERE phone = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
      `).get(customer.phone, branchId);
      const now = nextUpdatedAt(existing ? existing.updated_at : null);
      const id = existing ? existing.id : customer.id || `cust-${randomUUID()}`;

      if (existing) {
        sqlite.prepare('UPDATE customers SET name = ?, points = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL WHERE id = ?').run(
          customer.name || existing.name,
          customer.points ?? existing.points,
          now,
          id
        );
      } else {
        // The existing schema makes phone globally unique. Never replace or adopt an
        // inaccessible row to get around that constraint, including a tombstoned row.
        if (sqlite.prepare('SELECT id FROM customers WHERE phone = ?').get(customer.phone)) {
          throw new Error('Phone belongs to an unavailable customer');
        }
        sqlite.prepare('INSERT INTO customers (id, name, phone, points, createdAt, branch_id, is_synced, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
          .run(id, customer.name || 'Customer', customer.phone, customer.points ?? 0, customer.createdAt || now, branchId, now);
      }
      return this.mapRow(sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id));
    }).immediate();
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
    const activeBranch = this.getBranchId();
    if (branchId != null && branchId !== '' && branchId !== activeBranch) {
      throw new Error('Cannot access another branch');
    }

    // Points are a whole-unit balance; a fractional point cannot be redeemed.
    const earned = Math.max(0, Math.floor(Number(pointsEarned) || 0));
    const redeemed = Math.max(0, Math.floor(Number(pointsRedeemed) || 0));

    let customer = sqlite.prepare(`
      SELECT * FROM customers
      WHERE phone = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).get(phone, activeBranch);
    const now = nextUpdatedAt(customer ? customer.updated_at : null);
    if (!customer) {
      if (sqlite.prepare('SELECT id FROM customers WHERE phone = ?').get(phone)) {
        throw new Error('Phone belongs to an unavailable customer');
      }
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
    sqlite.prepare('UPDATE customers SET points = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL WHERE id = ?')
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
    sqlite.transaction(() => {
      const customer = sqlite.prepare(`
        SELECT updated_at FROM customers
        WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
      `).get(id, branchId);
      if (!customer) return;
      const now = nextUpdatedAt(customer.updated_at);
      sqlite.prepare(`
        UPDATE customers SET deleted_at = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL
        WHERE id = ?
      `).run(now, now, id);
    }).immediate();
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
