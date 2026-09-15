const database = require('./database.cjs');
const { randomUUID } = require('crypto');
const { MAX_SYNC_ATTEMPTS } = database;

// Monotonic per-row version: a second edit in the same millisecond still gets a newer
// updated_at, which the sync version guards compare on.
// The monotonic-step rule lives in database.cjs: five copies of it meant a fix
// had to be made five times, and missing one silently reintroduces a timestamp tie —
// which is a lost write under last-writer-wins.
const { nextUpdatedAt } = database;

class MenuRepository {
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
      description: row.description,
      price: row.price,
      category: row.category,
      image: row.image,
      available: Boolean(row.available),
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced)
    };
  }

  getMenu() {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    // Same scoping as orders: this till sees its own items plus explicitly shared ones
    // (NULL branch). A menu pull from the cloud can carry another branch's item, so
    // filtering here — not only in the pull filter — is what keeps it off this till.
    const rows = sqlite.prepare(`
      SELECT * FROM menu_items
      WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).all(branchId);
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Applies rows pulled from the cloud. A pulled row carries its deleted_at, so a deletion
   * made on another branch disappears here too. Only overwrites a local row that is already
   * synced or older, so an un-pushed local edit is never clobbered by a stale cloud copy.
   */
  upsertPulledMenuItems(rows) {
    if (!rows || rows.length === 0) return;
    const sqlite = this.getDb();
    const insert = sqlite.prepare(`
      INSERT INTO menu_items (id, name, description, price, category, image, available, branch_id, is_synced, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        price = excluded.price,
        category = excluded.category,
        image = excluded.image,
        available = excluded.available,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_synced = 1
      WHERE menu_items.is_synced = 1
        AND (menu_items.updated_at IS NULL OR excluded.updated_at IS NULL OR excluded.updated_at >= menu_items.updated_at)
    `);
    const runTx = sqlite.transaction((items) => {
      for (const row of items) {
        insert.run(
          row.id,
          row.name || '',
          row.description || '',
          Number(row.price) || 0,
          row.category || '',
          row.image || '',
          row.available ? 1 : 0,
          row.branch_id || null,
          row.created_at || row.updated_at,
          row.updated_at || null,
          row.deleted_at || null
        );
      }
    });
    runTx(rows);
  }

  createMenuItem(item) {
    const sqlite = this.getDb();
    const id = item.id || `menu-${randomUUID()}`;
    const now = new Date().toISOString();
    // A branchId from the caller only sticks when it names this branch. The IPC surface is
    // untrusted: accepting any value let the renderer file an item under another branch, or
    // under a shared (NULL) scope this till has no business writing to.
    const activeBranch = this.getBranchId();
    const branchId = (item.branchId && item.branchId === activeBranch) ? item.branchId : activeBranch;

    sqlite.prepare(`
      INSERT INTO menu_items (id, name, description, price, category, image, available, branch_id, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      item.name,
      item.description || '',
      item.price,
      item.category,
      item.image || '',
      item.available ? 1 : 0,
      branchId,
      now,
      now
    );
    return { ...item, id, branchId, isSynced: false, createdAt: now, updatedAt: now };
  }

  updateMenuItem(id, data) {
    const sqlite = this.getDb();
    const current = this.getMenuItem(id);
    if (!current) return null;
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.price !== undefined) { fields.push('price = ?'); values.push(Number(data.price)); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.image !== undefined) { fields.push('image = ?'); values.push(data.image); }
    if (data.available !== undefined) { fields.push('available = ?'); values.push(data.available ? 1 : 0); }
    // branch_id is not editable here: an update carrying a foreign branch id used to
    // silently re-scope the row to another branch.

    // Always mark as unsynced and update timestamp on mutation. A local edit also
    // re-enables retry of a previously parked row.
    const now = nextUpdatedAt(current.updatedAt);
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');
    fields.push('sync_attempts = 0');
    fields.push('last_error = NULL');

    // Scope the write to this branch: an id alone is not authority to edit another
    // branch's row.
    values.push(id);
    values.push(this.getBranchId());
    sqlite.prepare(`
      UPDATE menu_items SET ${fields.join(', ')}
      WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).run(...values);

    return this.getMenuItem(id);
  }

  getMenuItem(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare(
      `SELECT * FROM menu_items
       WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)`
    ).get(id, this.getBranchId());
    if (!row) return null;
    return this.mapRow(row);
  }

  deleteMenuItem(id) {
    const sqlite = this.getDb();
    // Soft delete: keep the tombstone locally so the sync engine can push the
    // deletion to the cloud, even while offline (Issue 20)
    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE menu_items SET deleted_at = ?, updated_at = ?, is_synced = 0, sync_attempts = 0
      WHERE id = ? AND deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
    `).run(now, now, id, this.getBranchId());
  }

  resetMenu(defaults) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const branchId = this.getBranchId();

    const runTransaction = sqlite.transaction((items) => {
      // Soft-delete existing items so deletions propagate to the cloud (Issue 20+28).
      //
      // Scoped to this branch and shared rows, and the retry budget is cleared: a parked row
      // was excluded from every push, so without this the tombstone never left the device.
      sqlite.prepare(`
        UPDATE menu_items
        SET deleted_at = ?, updated_at = ?, is_synced = 0, sync_attempts = 0, last_error = NULL
        WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)
      `).run(now, now, branchId);
      const insert = sqlite.prepare(`
        INSERT INTO menu_items (id, name, description, price, category, image, available, branch_id, is_synced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          price = excluded.price,
          category = excluded.category,
          image = excluded.image,
          available = excluded.available,
          deleted_at = NULL,
          updated_at = excluded.updated_at,
          is_synced = 0
      `);

      const created = [];
      for (const item of items) {
        const id = item.id || `menu-${randomUUID()}`;
        insert.run(
          id,
          item.name,
          item.description || '',
          item.price,
          item.category,
          item.image || '',
          item.available ? 1 : 0,
          branchId,
          now,
          now
        );
        created.push({ ...item, id, branchId, isSynced: false, createdAt: now, updatedAt: now });
      }
      return created;
    });

    return runTransaction(defaults);
  }

  getUnsyncedMenu() {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    // Scoped like orders: this till pushes only its own rows and shared ones. Without the
    // filter, a row pulled from another branch would be re-pushed by this till with its own
    // sync state, adopting another branch's data.
    const rows = sqlite.prepare(`
      SELECT * FROM menu_items
      WHERE is_synced = 0 AND sync_attempts < ? AND (branch_id = ? OR branch_id IS NULL)
    `).all(MAX_SYNC_ATTEMPTS, branchId);
    return rows.map(row => ({
      ...this.mapRow(row),
      deletedAt: row.deleted_at || undefined
    }));
  }

  markMenuSynced(ids, snapshots) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    // Version-guarded like orders: an edit made while the push was in flight keeps the row
    // unsynced so the edit itself is pushed next cycle.
    const versions = snapshots === undefined ? null : new Map((snapshots || []).map(row => [row.id, row.updatedAt ?? row.updated_at ?? null]));
    const stmt = sqlite.prepare(`
      UPDATE menu_items SET is_synced = 1, sync_attempts = 0, last_error = NULL
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

module.exports = new MenuRepository();
