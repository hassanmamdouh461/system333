const database = require('./database.cjs');
const { randomUUID } = require('crypto');

/**
 * Cashiers are per-branch till operators. The active cashier is stamped on every
 * order created at the POS and printed on the customer receipt.
 */
class CashierRepository {
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
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      avatar: row.avatar || undefined,
      deletedAt: row.deleted_at || undefined
    };
  }

  // All non-deleted cashiers visible at this till: this branch's plus branch-less ones
  getCashiers(branchId) {
    const sqlite = this.getDb();
    const scope = branchId && branchId !== 'manager' ? branchId : this.getBranchId();
    const rows = sqlite.prepare(
      'SELECT * FROM cashiers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) ORDER BY name ASC'
    ).all(scope);
    return rows.map(row => this.mapRow(row));
  }

  createCashier(name, avatar) {
    const sqlite = this.getDb();
    const id = `cashier-${randomUUID()}`;
    const now = new Date().toISOString();
    const branchId = this.getBranchId();
    sqlite.prepare(`
      INSERT INTO cashiers (id, name, branch_id, avatar, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, name, branchId, avatar || null, now, now);
    return this.getCashier(id);
  }

  getCashier(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM cashiers WHERE id = ? AND deleted_at IS NULL').get(id);
    return row ? this.mapRow(row) : null;
  }

  // Soft delete so the tombstone can propagate to the cloud
  deleteCashier(id) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE cashiers SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(now, now, id);
  }

  renameCashier(id, name) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE cashiers SET name = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(name, now, id);
    return this.getCashier(id);
  }

  setCashierAvatar(id, avatar) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE cashiers SET avatar = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(avatar, now, id);
    return this.getCashier(id);
  }
}

module.exports = new CashierRepository();
