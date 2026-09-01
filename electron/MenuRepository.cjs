const database = require('./database.cjs');
const { randomUUID } = require('crypto');

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
    const rows = sqlite.prepare('SELECT * FROM menu_items WHERE deleted_at IS NULL').all();
    return rows.map(row => this.mapRow(row));
  }

  createMenuItem(item) {
    const sqlite = this.getDb();
    const id = item.id || `menu-${randomUUID()}`;
    const now = new Date().toISOString();
    const branchId = item.branchId || this.getBranchId();

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
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.price !== undefined) { fields.push('price = ?'); values.push(Number(data.price)); }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category); }
    if (data.image !== undefined) { fields.push('image = ?'); values.push(data.image); }
    if (data.available !== undefined) { fields.push('available = ?'); values.push(data.available ? 1 : 0); }
    if (data.branchId !== undefined) { fields.push('branch_id = ?'); values.push(data.branchId); }

    // Always mark as unsynced and update timestamp on mutation
    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');

    if (fields.length === 0) return this.getMenuItem(id);

    values.push(id);
    sqlite.prepare(`
      UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getMenuItem(id);
  }

  getMenuItem(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM menu_items WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  deleteMenuItem(id) {
    const sqlite = this.getDb();
    // Soft delete: keep the tombstone locally so the sync engine can push the
    // deletion to the cloud, even while offline (Issue 20)
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE menu_items SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(now, now, id);
  }

  resetMenu(defaults) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const branchId = this.getBranchId();

    const runTransaction = sqlite.transaction((items) => {
      // Soft-delete existing items so deletions propagate to the cloud (Issue 20+28)
      sqlite.prepare('UPDATE menu_items SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE deleted_at IS NULL').run(now, now);
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
    const rows = sqlite.prepare('SELECT * FROM menu_items WHERE is_synced = 0 AND sync_attempts < 5').all();
    return rows.map(row => ({
      ...this.mapRow(row),
      deletedAt: row.deleted_at || undefined
    }));
  }

  markMenuSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const stmt = sqlite.prepare('UPDATE menu_items SET is_synced = 1, sync_attempts = 0, last_error = NULL WHERE id = ?');
    const runTx = sqlite.transaction((idList) => {
      for (const id of idList) {
        stmt.run(id);
      }
    });
    runTx(ids);
  }
}

module.exports = new MenuRepository();
