const database = require('./database.cjs');
const { randomUUID } = require('crypto');

// Monotonic per-row version: a second edit in the same millisecond still gets a newer
// updated_at, which the sync version guards compare on.
function nextUpdatedAt(previous) {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}

class InventoryRepository {
  getDb() {
    return database.getDb();
  }

  getBranchId() {
    return database.getBranchId();
  }

  // ─── Inventory Items CRUD ───────────────────────────────────────────────────

  /**
   * Resolves the branch scope for a request: the caller may pass its own branch id (used
   * by the renderer, which knows it), but an id that is not this till's own never widens
   * the scope.
   *
   * There is deliberately no "see everything" value. 'manager' and 'default' used to be
   * accepted here, and since the renderer supplies this value straight through
   * `db:get-inventory`, passing one returned the whole chain's stock from an untrusted
   * caller. A till reads its own branch plus the rows shared by every branch (NULL).
   */
  resolveBranch(branchId) {
    const active = this.getBranchId();
    if (branchId === undefined || branchId === null || branchId === '') return active;
    if (branchId === active) return branchId;
    throw new Error('Cannot access another branch');
  }

  getInventory(branchId) {
    const sqlite = this.getDb();
    const activeBranch = this.resolveBranch(branchId);
    // Branch isolation in SQL (Issue 22 + 41): this branch's own stock plus rows shared by
    // every branch (branch_id IS NULL).
    const rows = sqlite.prepare(
      'SELECT * FROM inventory WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)'
    ).all(activeBranch);
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Applies rows pulled from the cloud, including their deleted_at so a deletion made on
   * another branch disappears here too. Only overwrites a local row that is synced or older.
   */
  upsertPulledInventory(rows) {
    if (!rows || rows.length === 0) return;
    const sqlite = this.getDb();
    const insert = sqlite.prepare(`
      INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        unit = excluded.unit,
        stock = excluded.stock,
        minStock = excluded.minStock,
        costPerUnit = excluded.costPerUnit,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_synced = 1
      WHERE inventory.is_synced = 1
        AND (inventory.updated_at IS NULL OR excluded.updated_at IS NULL OR excluded.updated_at >= inventory.updated_at)
    `);
    const runTx = sqlite.transaction((items) => {
      for (const row of items) {
        insert.run(
          row.id,
          row.name || '',
          row.unit || '',
          Number(row.stock) || 0,
          Number(row.minStock) || 0,
          Number(row.costPerUnit) || 0,
          row.branch_id || null,
          row.created_at || row.updated_at,
          row.updated_at || null,
          row.deleted_at || null
        );
      }
    });
    runTx(rows);
  }

  createInventoryItem(item) {
    const sqlite = this.getDb();
    const id = item.id || `inv-${randomUUID()}`;
    const now = new Date().toISOString();
    // A branchId from the caller only sticks when it names this branch: the IPC surface is
    // untrusted, and a foreign id would create stock this till then cannot read back.
    const activeBranch = this.getBranchId();
    const branchId = (item.branchId && item.branchId === activeBranch) ? item.branchId : activeBranch;

    sqlite.prepare(`
      INSERT INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, is_synced, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      item.name,
      item.unit,
      item.stock || 0,
      item.minStock || 0,
      item.costPerUnit || 0,
      branchId,
      now,
      now
    );

    // If initial stock is greater than 0, create an initial 'IN' transaction
    if (item.stock > 0) {
      const txId = `tx-${randomUUID()}`;
      sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, 'IN', ?, 'INITIAL', ?, ?, 0, 'Initial stock setup')
      `).run(
        txId,
        id,
        item.stock,
        now,
        branchId
      );
    }

    return this.getInventoryItem(id);
  }

  updateInventoryItem(id, data) {
    const sqlite = this.getDb();
    const current = this.getInventoryItem(id);
    if (!current) return null;
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.unit !== undefined) { fields.push('unit = ?'); values.push(data.unit); }
    if (data.stock !== undefined) { fields.push('stock = ?'); values.push(Number(data.stock)); }
    if (data.minStock !== undefined) { fields.push('minStock = ?'); values.push(Number(data.minStock)); }
    if (data.costPerUnit !== undefined) { fields.push('costPerUnit = ?'); values.push(Number(data.costPerUnit)); }
    // Moving stock between branches is not an editable field: an update arriving with a
    // foreign branchId used to silently re-scope the row.

    // Always mark as unsynced and update timestamp on mutation. A local edit also
    // re-enables retry of a previously parked row.
    const now = nextUpdatedAt(current.updatedAt);
    fields.push('updated_at = ?'); values.push(now);
    fields.push('is_synced = 0');
    fields.push('sync_attempts = 0');
    fields.push('last_error = NULL');

    values.push(id);
    sqlite.prepare(`
      UPDATE inventory SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getInventoryItem(id);
  }

  getInventoryItem(id) {
    const sqlite = this.getDb();
    const row = sqlite.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  deleteInventoryItem(id) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      // Soft delete with tombstone (Issue 20); recipes are removed with the item
      sqlite.prepare('UPDATE inventory SET deleted_at = ?, updated_at = ?, is_synced = 0 WHERE id = ?').run(now, now, id);
      sqlite.prepare('DELETE FROM menu_recipes WHERE inventoryItemId = ?').run(id);
    })();
  }

  // ─── Inventory Transactions ────────────────────────────────────────────────

  getInventoryTransactions(itemId, branchId) {
    const sqlite = this.getDb();
    const activeBranch = this.resolveBranch(branchId);
    let query = 'SELECT t.*, i.name as itemName, i.unit as itemUnit FROM inventory_transactions t JOIN inventory i ON t.itemId = i.id';
    const params = [];
    const conditions = [];

    if (itemId) {
      conditions.push('t.itemId = ?');
      params.push(itemId);
    }
    // Branch isolation in SQL (Issue 22/42).
    if (activeBranch) {
      conditions.push('t.branch_id = ?');
      params.push(activeBranch);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY t.createdAt DESC';
    if (!itemId) query += ' LIMIT 200';
    const rows = sqlite.prepare(query).all(...params);
    return rows.map(row => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemUnit: row.itemUnit,
      type: row.type,
      quantity: row.quantity,
      referenceId: row.referenceId || undefined,
      createdAt: row.createdAt,
      branchId: row.branch_id || undefined,
      isSynced: Boolean(row.is_synced),
      notes: row.notes || undefined
    }));
  }

  /**
   * Records a stock movement and applies it to the balance.
   *
   * The direction comes from the type, never from the sign of the quantity: an "IN" always
   * adds, an "OUT" always subtracts, and an "ADJUST" is a physical count that sets the
   * balance to the entered quantity — so the ledger and the balance can never disagree
   * about which way stock moved.
   *
   * The item must exist. Without that check an unknown id updated zero rows while the
   * movement was still written, leaving a ledger entry no balance ever reflected.
   */
  createInventoryTransaction(tx) {
    const sqlite = this.getDb();
    const id = tx.id || `tx-${randomUUID()}`;
    const now = new Date().toISOString();
    // Same rule as item creation: a caller-supplied branchId is honoured only when it is
    // this till's own id.
    const activeBranch = this.getBranchId();
    const branchId = (tx.branchId && tx.branchId === activeBranch) ? tx.branchId : activeBranch;
    const quantity = Math.abs(Number(tx.quantity));

    const runTx = sqlite.transaction(() => {
      const item = sqlite.prepare('SELECT id, stock FROM inventory WHERE id = ? AND deleted_at IS NULL').get(tx.itemId);
      if (!item) {
        throw new Error(`Stock item not found: ${tx.itemId}`);
      }

      sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        tx.itemId,
        tx.type,
        quantity,
        tx.referenceId || null,
        now,
        branchId,
        tx.notes || null
      );

      // IN adds, OUT subtracts. ADJUST is a physical count: the entered quantity is the
      // new balance, so the delta is counted from the current stock rather than added to
      // it. Treating a count as an IN meant every stocktake inflated the balance.
      let stockChange;
      if (tx.type === 'OUT') {
        stockChange = -quantity;
      } else if (tx.type === 'ADJUST') {
        stockChange = quantity - item.stock;
      } else {
        stockChange = quantity;
      }

      // Stock is floored at zero: a physical count cannot be negative, and a negative
      // balance propagates into the valuation as negative money.
      sqlite.prepare(`
        UPDATE inventory
        SET stock = MAX(0, stock + ?), updated_at = ?, is_synced = 0
        WHERE id = ?
      `).run(stockChange, now, tx.itemId);
    });

    runTx();
    return { ...tx, id, quantity, createdAt: now, branchId };
  }

  // ─── Menu Recipes (Ingredients Mapping) ────────────────────────────────────

  getMenuItemRecipe(menuItemId) {
    const sqlite = this.getDb();
    const rows = sqlite.prepare(`
      SELECT r.*, i.name as itemName, i.unit as itemUnit, i.costPerUnit
      FROM menu_recipes r
      JOIN inventory i ON r.inventoryItemId = i.id
      WHERE r.menuItemId = ?
    `).all(menuItemId);
    
    return rows.map(row => ({
      menuItemId: row.menuItemId,
      inventoryItemId: row.inventoryItemId,
      itemName: row.itemName,
      itemUnit: row.itemUnit,
      costPerUnit: row.costPerUnit,
      quantity: row.quantity
    }));
  }

  getMenuRecipes() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM menu_recipes').all();
    return rows.map(row => ({
      menuItemId: row.menuItemId,
      inventoryItemId: row.inventoryItemId,
      quantity: row.quantity
    }));
  }

  saveMenuRecipe(menuItemId, ingredients) {
    const sqlite = this.getDb();
    sqlite.transaction(() => {
      // Delete existing ingredients mapping
      sqlite.prepare('DELETE FROM menu_recipes WHERE menuItemId = ?').run(menuItemId);

      // Insert new ingredients
      if (ingredients && ingredients.length > 0) {
        const insert = sqlite.prepare(`
          INSERT INTO menu_recipes (menuItemId, inventoryItemId, quantity)
          VALUES (?, ?, ?)
        `);
        for (const ing of ingredients) {
          insert.run(menuItemId, ing.inventoryItemId, Number(ing.quantity));
        }
      }
    })();

    return this.getMenuItemRecipe(menuItemId);
  }

  getRecipeCost(menuItemId) {
    const sqlite = this.getDb();
    const row = sqlite.prepare(`
      SELECT SUM(r.quantity * i.costPerUnit) as totalCost
      FROM menu_recipes r
      JOIN inventory i ON r.inventoryItemId = i.id
      WHERE r.menuItemId = ?
    `).get(menuItemId);
    return row ? (row.totalCost || 0) : 0;
  }

  // ─── Live Inventory Deduction on Order Create/Cancel ─────────────────────────

  /**
   * Deducts the ingredients an order consumes and logs one movement per ingredient.
   *
   * Called from inside the order-creation transaction, so its own transaction becomes a
   * savepoint rather than a second top-level one — the whole order still commits or rolls
   * back as a unit.
   *
   * Stock is floored at zero: selling an item whose ingredients ran out is a stock-count
   * problem, not a reason to store a negative balance that then reads as negative money in
   * the valuation.
   */
  deductInventoryForOrder(orderId, orderItems, branchId) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    const runTx = sqlite.transaction(() => {
      const recipeFor = sqlite.prepare('SELECT * FROM menu_recipes WHERE menuItemId = ?');
      const deduct = sqlite.prepare(`
        UPDATE inventory
        SET stock = MAX(0, stock - ?), updated_at = ?, is_synced = 0
        WHERE id = ?
      `);
      const logMovement = sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, 'OUT', ?, ?, ?, ?, 0, ?)
      `);

      for (const item of orderItems) {
        // A line may carry either a menu item id or the item's own id, depending on which
        // screen created it.
        const menuItemId = item.menuItemId || item.id;

        for (const ingredient of recipeFor.all(menuItemId)) {
          const quantityUsed = ingredient.quantity * item.quantity;
          deduct.run(quantityUsed, now, ingredient.inventoryItemId);
          logMovement.run(
            `tx-${randomUUID()}`,
            ingredient.inventoryItemId,
            quantityUsed,
            orderId,
            now,
            activeBranch,
            `Order item: ${item.name} ×${item.quantity}`
          );
        }
      }
    });

    runTx();
  }

  /**
   * Returns the ingredients an order consumed, by reversing its recorded movements.
   *
   * Reversal reads the ledger rather than recomputing from the recipe, so a recipe edited
   * after the sale cannot restore a different quantity than was taken. Movements already
   * reversed are skipped, which makes a repeated cancellation a no-op instead of crediting
   * the stock twice.
   *
   * The outstanding amount is computed per item across all of the order's OUT rows, then
   * credited across them: an item ordered on two lines produces two OUT rows, and treating
   * each row independently would restore only the first and leave the second deducted.
   */
  restoreInventoryForOrder(orderId, branchId) {
    const sqlite = this.getDb();
    const now = new Date().toISOString();
    const activeBranch = branchId || this.getBranchId();

    const runTx = sqlite.transaction(() => {
      const taken = sqlite.prepare(`
        SELECT * FROM inventory_transactions
        WHERE referenceId = ? AND type = 'OUT'
      `).all(orderId);

      const alreadyReturned = sqlite.prepare(`
        SELECT itemId, SUM(quantity) AS total FROM inventory_transactions
        WHERE referenceId = ? AND type = 'IN'
        GROUP BY itemId
      `).all(orderId);

      const returnedByItem = new Map(alreadyReturned.map(r => [r.itemId, r.total || 0]));

      // One OUT row is written per order line, so an item that appears on two lines of the
      // same order has two rows here. The credit is therefore tracked against the item's
      // *combined* OUT total, not per row: subtracting the already-returned amount from
      // each row individually would credit only the first row and silently leak the rest.
      const takenByItem = new Map();
      for (const movement of taken) {
        if (!takenByItem.has(movement.itemId)) takenByItem.set(movement.itemId, []);
        takenByItem.get(movement.itemId).push(movement);
      }

      const restore = sqlite.prepare(`
        UPDATE inventory
        SET stock = stock + ?, updated_at = ?, is_synced = 0
        WHERE id = ?
      `);
      const logMovement = sqlite.prepare(`
        INSERT INTO inventory_transactions (id, itemId, type, quantity, referenceId, createdAt, branch_id, is_synced, notes)
        VALUES (?, ?, 'IN', ?, ?, ?, ?, 0, ?)
      `);

      for (const [itemId, movements] of takenByItem) {
        const totalTaken = movements.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
        const totalReturned = returnedByItem.get(itemId) || 0;
        let remaining = totalTaken - totalReturned;
        if (remaining <= 0) continue;

        for (const movement of movements) {
          const take = Math.min(Number(movement.quantity) || 0, remaining);
          if (take <= 0) break;
          remaining -= take;

          restore.run(take, now, itemId);
          logMovement.run(
            `tx-${randomUUID()}`,
            itemId,
            take,
            orderId,
            now,
            activeBranch,
            'Reverted cancelled order'
          );
        }
      }
    });

    runTx();
  }

  getUnsyncedInventory() {
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    const rows = sqlite.prepare(`
      SELECT * FROM inventory
      WHERE is_synced = 0 AND sync_attempts < 5 AND (branch_id = ? OR branch_id IS NULL)
    `).all(branchId);
    // No silent 'branch_1' fallback (Issue 22): branchless (NULL) rows are shared
    // stock and must stay branchless in the cloud too.
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      minStock: row.minStock,
      costPerUnit: row.costPerUnit,
      branch_id: row.branch_id || null,
      deleted_at: row.deleted_at || null,
      is_synced: row.is_synced,
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Snapshot consumers (markInventorySynced) read either casing.
      updatedAt: row.updated_at || null
    }));
  }

  // ─── Inventory transaction sync (Issue 27): push movements, not just balances ─

  getUnsyncedTransactions() {
    const sqlite = this.getDb();
    const rows = sqlite.prepare('SELECT * FROM inventory_transactions WHERE is_synced = 0 AND sync_attempts < 5').all();
    return rows.map(row => ({
      id: row.id,
      itemId: row.itemId,
      type: row.type,
      quantity: row.quantity,
      referenceId: row.referenceId || null,
      createdAt: row.createdAt,
      branch_id: row.branch_id || null,
      notes: row.notes || null
    }));
  }

  markTransactionsSynced(ids) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    // Same reset as the other tables: without it a ledger row that succeeded after a few
    // failed attempts keeps its old count and parks earlier next time.
    const stmt = sqlite.prepare('UPDATE inventory_transactions SET is_synced = 1, sync_attempts = 0, last_error = NULL WHERE id = ?');
    sqlite.transaction(() => {
      for (const id of ids) {
        stmt.run(id);
      }
    })();
  }

  markInventorySynced(ids, snapshots) {
    if (!ids || ids.length === 0) return;
    const sqlite = this.getDb();
    const branchId = this.getBranchId();
    // Version-guarded like the other tables: a row edited while its push was in flight
    // stays unsynced so the edit is pushed next cycle.
    const versions = snapshots === undefined ? null : new Map((snapshots || []).map(row => [row.id, row.updatedAt ?? row.updated_at ?? null]));
    const stmt = sqlite.prepare(`
      UPDATE inventory SET is_synced = 1, sync_attempts = 0, last_error = NULL
      WHERE id = ? AND (branch_id = ? OR branch_id IS NULL)${versions ? ' AND (updated_at IS ? OR updated_at IS NULL)' : ''}
    `);
    sqlite.transaction(() => {
      for (const id of ids) {
        if (versions && !versions.has(id)) continue;
        stmt.run(id, branchId, ...(versions ? [versions.get(id)] : []));
      }
    })();
  }
}

module.exports = new InventoryRepository();
