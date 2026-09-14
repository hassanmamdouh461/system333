const database = require('./database.cjs');
const { randomUUID } = require('crypto');
const { MAX_SYNC_ATTEMPTS } = database;

// A second edit in the same millisecond must still have a different push version.
function nextUpdatedAt(previous) {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}

/** Per-branch till operators, plus explicitly shared (NULL branch) operators. */
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
      branchId: row.branch_id ?? undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      avatar: row.avatar || undefined,
      deletedAt: row.deleted_at || undefined
    };
  }

  getCashiers(branchId) {
    const scope = this.getBranchId();
    if (branchId && branchId !== scope) throw new Error('Cannot access another branch');
    return this.getDb().prepare(
      'SELECT * FROM cashiers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) ORDER BY name ASC'
    ).all(scope).map(row => this.mapRow(row));
  }

  createCashier(name, avatar) {
    const id = `cashier-${randomUUID()}`;
    const now = nextUpdatedAt();
    this.getDb().prepare(`
      INSERT INTO cashiers (id, name, branch_id, avatar, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, name, this.getBranchId(), avatar || null, now, now);
    return this.getCashier(id);
  }

  getCashier(id) {
    const row = this.getDb().prepare(
      'SELECT * FROM cashiers WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)'
    ).get(id, this.getBranchId());
    return row ? this.mapRow(row) : null;
  }

  // Every local edit re-enables retry of a corrected, previously parked row.
  deleteCashier(id) {
    const current = this.getCashier(id);
    if (!current) return;
    const now = nextUpdatedAt(current.updatedAt);
    this.getDb().prepare(`
      UPDATE cashiers SET deleted_at = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).run(now, now, id, this.getBranchId());
  }

  renameCashier(id, name) {
    const current = this.getCashier(id);
    if (!current) return null;
    this.getDb().prepare(`
      UPDATE cashiers SET name = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).run(name, nextUpdatedAt(current.updatedAt), id, this.getBranchId());
    return this.getCashier(id);
  }

  setCashierAvatar(id, avatar) {
    const current = this.getCashier(id);
    if (!current) return null;
    this.getDb().prepare(`
      UPDATE cashiers SET avatar = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).run(avatar || null, nextUpdatedAt(current.updatedAt), id, this.getBranchId());
    return this.getCashier(id);
  }

  getUnsyncedCashiers() {
    return this.getDb().prepare(`
      SELECT * FROM cashiers WHERE is_synced = 0 AND sync_attempts < ?
        AND (branch_id = ? OR branch_id IS NULL)
    `).all(MAX_SYNC_ATTEMPTS, this.getBranchId()).map(row => ({
      id: row.id,
      name: row.name,
      branch_id: row.branch_id,
      avatar: row.avatar || null,
      deleted_at: row.deleted_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  markCashiersSynced(ids, snapshots) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const versions = snapshots === undefined ? null : new Map((snapshots || []).map(row => [row.id, row.updatedAt ?? row.updated_at ?? null]));
    const stmt = sqlite.prepare(`
      UPDATE cashiers SET is_synced = 1, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND (branch_id = ? OR branch_id IS NULL)${versions ? ' AND (updated_at IS ? OR updated_at IS NULL)' : ''}
    `);
    sqlite.transaction(() => {
      for (const id of ids) {
        if (versions && !versions.has(id)) continue;
        stmt.run(id, this.getBranchId(), ...(versions ? [versions.get(id)] : []));
      }
    })();
  }

  upsertPulledCashiers(rows) {
    if (!rows || rows.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    const insert = sqlite.prepare(`
      INSERT INTO cashiers (id, name, branch_id, avatar, is_synced, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_synced = 1,
        sync_attempts = 0,
        last_error = NULL
      WHERE cashiers.is_synced = 1 AND cashiers.branch_id IS excluded.branch_id
        AND (cashiers.updated_at IS NULL OR excluded.updated_at >= cashiers.updated_at)
    `);
    sqlite.transaction(() => {
      for (const row of rows) {
        const rowBranch = row.branch_id !== undefined ? row.branch_id : (row.branchId ?? branchId);
        if (rowBranch !== branchId && rowBranch !== null) continue;
        const createdAt = row.created_at || row.createdAt || row.$createdAt;
        const updatedAt = row.updated_at || row.updatedAt || row.$updatedAt || createdAt;
        insert.run(row.id || row.$id, row.name || '', rowBranch, row.avatar || null, createdAt, updatedAt, row.deleted_at || row.deletedAt || null);
      }
    })();
  }
}

module.exports = new CashierRepository();
