const mockApi = require('./mockApiService.cjs');

/** Base interval between sync cycles when everything is healthy. */
const BASE_INTERVAL_MS = 30_000;
/** Ceiling for the backoff, so a long outage still retries twice an hour. */
const MAX_BACKOFF_MS = 30 * 60_000;
/** Ceiling when only pulls are failing: slow enough to stop hammering, fast enough to notice
 *  the moment the worker starts answering again. */
const PULL_ONLY_MAX_BACKOFF_MS = 2 * 60_000;

async function checkInternet() {
  // Real reachability, not navigator.onLine: can we actually reach our worker?
  return mockApi.checkWorkerHealth();
}

/**
 * Marks a pushed batch as synced — but only the rows the worker actually took.
 *
 * The engine used to mark every id synced whenever the request did not throw. The worker
 * returns `written` as the number of rows it *sent*, so an upsert that lost on `updated_at`,
 * a tombstone older than its target and a ledger row dropped by `INSERT OR IGNORE` all
 * counted as written. A row marked synced is never selected again, so the device and the
 * cloud parted ways permanently and nothing on screen said so.
 *
 * Two different outcomes are handled differently on purpose:
 *
 *  - a record the worker **named** in `failed` never reached the database. It stays unsynced
 *    and takes a failure, so it is retried and the reason is recorded on the row.
 *  - a plain shortfall (`skipped`) means a statement matched nothing. That is usually
 *    correct — the cloud already holds a newer row — so the rows are still marked synced,
 *    but the shortfall is reported instead of being invisible. Holding them back would park
 *    a tombstone-heavy branch on the first cycle and stop it syncing at all.
 *
 * Returns the ids that were held back.
 */
function reconcilePush({ table, ids, records, result, markSynced, markFailure, phaseErrors, label }) {
  const named = new Set(
    ((result && result.failed) || [])
      .map((entry) => entry && entry.id)
      .filter(Boolean)
  );

  const heldBack = ids.filter((id) => named.has(id));
  const accepted = ids.filter((id) => !named.has(id));

  if (accepted.length > 0) {
    const acceptedSet = new Set(accepted);
    // mark*Synced is version-guarded and skips any id it has no snapshot for, so the rows
    // handed to it have to be the same ones the ids name.
    markSynced(accepted, (records || []).filter((row) => acceptedSet.has(row.id)));
  }

  if (heldBack.length > 0) {
    const detail = (result.failed || [])
      .filter((entry) => entry && entry.id)
      .slice(0, 5)
      .map((entry) => `${entry.id}: ${entry.error}`)
      .join('; ');
    const message = `${label}: ${heldBack.length} record(s) rejected by the worker (${detail})`;
    phaseErrors.push(message);
    markFailure(table, heldBack, message);
  }

  // Reported, not suppressed. A shortfall that is never mentioned is how a till comes to
  // disagree with the cloud while reporting a clean sync.
  const skipped = result && typeof result.skipped === 'number' ? result.skipped : 0;
  if (skipped > 0 && typeof result.written === 'number' && typeof result.expected === 'number') {
    phaseErrors.push(
      `${label}: worker wrote ${result.written} of ${result.expected} row(s) (${skipped} matched nothing)`
    );
  }

  return heldBack;
}

class SyncEngine {
  constructor(db, onStatusUpdate) {
    this.db = db;
    this.onStatusUpdate = onStatusUpdate;
    this.intervalId = null;
    this.status = {
      state: 'idle', // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
      lastSyncAt: null,
      pendingCount: 0,
      lastError: null,
    };
    this.isSyncing = false;
    // Consecutive failed cycles, which sets how long to wait before the next attempt.
    this.consecutiveFailures = 0;
    /** Set when the last failed cycle failed only on pulls; see nextDelay(). */
    this.pullOnlyFailures = false;
    this.baseIntervalMs = BASE_INTERVAL_MS;
    this.timeoutId = null;
  }

  /**
   * Delay before the next cycle: the base interval while healthy, doubling with each
   * consecutive failure up to the ceiling.
   *
   * A fixed interval meant an unreachable or rate-limiting worker was retried every 30
   * seconds indefinitely, which is exactly the traffic that keeps it rate-limiting.
   */
  nextDelay() {
    if (this.consecutiveFailures === 0) return this.baseIntervalMs;
    const backoff = this.baseIntervalMs * 2 ** Math.min(this.consecutiveFailures, 6);
    // A pull that keeps failing is capped lower than a push that keeps failing. Both need to
    // stop hammering the worker, but a pull-only failure is usually a server contract
    // mismatch: drifting to the full ceiling hides it and the till stops noticing when the
    // server is fixed. Local writes still reach the cloud on the shorter cadence.
    if (this.pullOnlyFailures) return Math.min(backoff, PULL_ONLY_MAX_BACKOFF_MS);
    return Math.min(backoff, MAX_BACKOFF_MS);
  }

  /**
   * Start the sync background loop
   */
  start(intervalMs = BASE_INTERVAL_MS) {
    console.log('[syncEngine] Starting Background Sync Worker...');
    this.baseIntervalMs = intervalMs;
    this.stopped = false;

    this.updatePendingCount();
    // Self-scheduling rather than setInterval: the delay after each cycle depends on
    // whether that cycle succeeded.
    this.scheduleNext(0);
  }

  scheduleNext(delayMs) {
    if (this.stopped) return;
    if (this.timeoutId) clearTimeout(this.timeoutId);

    this.timeoutId = setTimeout(async () => {
      await this.runSyncCycle();
      const delay = this.nextDelay();
      if (this.consecutiveFailures > 0) {
        console.log(`[syncEngine] Next attempt in ${Math.round(delay / 1000)}s after ${this.consecutiveFailures} failed cycle(s).`);
      }
      this.scheduleNext(delay);
    }, delayMs);
  }

  /**
   * Stop the background loop
   */
  stop() {
    this.stopped = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
      console.log('[syncEngine] Background Sync Worker stopped.');
    }
  }

  /**
   * Query the SQLite database to get current counts of unsynced records
   */
  updatePendingCount() {
    try {
      const stats = this.db.getSyncStats();
      this.status.pendingCount = stats.totalPending;
      this.emitStatus();
      return stats;
    } catch (e) {
      console.error('[syncEngine] Error getting sync stats:', e);
      return { totalPending: this.status.pendingCount };
    }
  }

  /**
   * Return current sync status
   */
  getStatus() {
    // Refresh stats before returning
    this.updatePendingCount();
    return this.status;
  }

  /**
   * Force an immediate sync cycle
   */
  async syncNow() {
    if (this.isSyncing) {
      console.log('[syncEngine] Sync already in progress, skipping manual trigger.');
      return this.status;
    }
    console.log('[syncEngine] Manual sync trigger received.');
    await this.runSyncCycle();
    return this.status;
  }

  /**
   * Broadcast sync status updates to the registered listener (renderer window)
   */
  emitStatus() {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({ ...this.status });
    }
  }

  /**
   * The core sync logic cycle
   */
  async runSyncCycle() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    // Trigger check for daily Telegram report send in background
    this.checkAndSendTelegramReport().catch(err => {
      console.error('[syncEngine] Auto Telegram report failed:', err);
    });

    try {
      // 1. Check for internet connectivity first
      this.status.state = 'syncing';
      this.emitStatus();
      
      const isOnline = await checkInternet();
      if (!isOnline) {
        console.warn('[syncEngine] Offline: Internet connectivity check failed. Postponing sync.');
        this.status.state = 'offline';
        this.consecutiveFailures += 1;
        this.emitStatus();
        this.isSyncing = false;
        return;
      }

      const phaseErrors = [];

      // 1b. Flush persistent reports outbox
      try {
        const flushed = await mockApi.flushReportsOutbox();
        // An unconfigured key is reported as failure now, so this branch is reached. It is a
        // phase error rather than a warning: the manager portal then shows stale figures with
        // no indication that this till has stopped feeding it, which is the one failure a
        // business reads as "no sales today".
        if (flushed && flushed.success === false) {
          phaseErrors.push(`Reports mirror failed: ${flushed.error || 'unknown error'}`);
        }
      } catch (outboxError) {
        console.warn('[syncEngine] Reports outbox flush failed:', outboxError.message);
        phaseErrors.push(`Reports mirror failed: ${outboxError.message}`);
      }

      // 2. Pull updates from the cloud incrementally (Issue 21)
      try {
        const dbModule = require('./database.cjs');
        const branchId = dbModule.getBranchId();
        const lastPulledAt = dbModule.getSettings()['last_pulled_orders_at'] || null;
        console.log(`[syncEngine] Pulling updates from D1 (incremental since ${lastPulledAt || 'full pull'})...`);
        const pulledOrders = await mockApi.pullOrders(lastPulledAt, branchId);
        if (pulledOrders && pulledOrders.length > 0) {
          const tempOrderRepository = require('./OrderRepository.cjs');
          tempOrderRepository.upsertPulledOrders(pulledOrders);
          console.log(`[syncEngine] Successfully integrated ${pulledOrders.length} remote orders into local database.`);
          // Advance the high-water mark only after a successful upsert
          const maxUpdatedAt = pulledOrders.reduce((max, o) => {
            const t = o.$updatedAt || o.$createdAt;
            return t && t > max ? t : max;
          }, lastPulledAt || '');
          if (maxUpdatedAt) {
            dbModule.saveSetting('last_pulled_orders_at', maxUpdatedAt);
          }
        }
      } catch (pullError) {
        console.error('[syncEngine] Failed to pull remote orders:', pullError.message);
        phaseErrors.push(`Failed to pull orders: ${pullError.message}`);
      }

      // 2b. Pull shared tables (menu, customers, inventory, cashiers) so edits and — crucially —
      // deletions made on other branches propagate here. Each table keeps its own
      // high-water mark so a failure in one does not reset the others.
      const sharedPulls = [
        { target: 'menu-items', setting: 'last_pulled_menu_items_at', repo: 'MenuRepository.cjs', apply: 'upsertPulledMenuItems', rowTime: (r) => r.updated_at },
        { target: 'customers', setting: 'last_pulled_customers_at', repo: 'CustomerRepository.cjs', apply: 'upsertPulledCustomers', rowTime: (r) => r.updated_at },
        { target: 'inventory', setting: 'last_pulled_inventory_at', repo: 'InventoryRepository.cjs', apply: 'upsertPulledInventory', rowTime: (r) => r.updated_at },
        { target: 'cashiers', setting: 'last_pulled_cashiers_at', repo: 'CashierRepository.cjs', apply: 'upsertPulledCashiers', rowTime: (r) => r.updated_at },
        // The loyalty ledger has no updated_at — it is append-only and ordered by createdAt,
        // which is also the column the worker cursors on for this table.
        { target: 'points-transactions', setting: 'last_pulled_points_transactions_at', repo: 'CustomerRepository.cjs', apply: 'upsertPulledPointsTransactions', rowTime: (r) => r.createdAt },
      ];
      for (const { target, setting, repo, apply, rowTime } of sharedPulls) {
        try {
          const dbModule = require('./database.cjs');
          const since = dbModule.getSettings()[setting] || null;
          const rows = await mockApi.pullShared(target, since);
          if (rows && rows.length > 0) {
            require(`./${repo}`)[apply](rows);
            console.log(`[syncEngine] Pulled ${rows.length} ${target} rows from D1.`);
            const maxUpdatedAt = rows.reduce((max, r) => {
              const t = rowTime(r);
              return t && t > max ? t : max;
            }, since || '');
            if (maxUpdatedAt) {
              dbModule.saveSetting(setting, maxUpdatedAt);
            }
          }
        } catch (pullError) {
          console.error(`[syncEngine] Failed to pull ${target}:`, pullError.message);
          phaseErrors.push(`Failed to pull ${target}: ${pullError.message}`);
        }
      }

      // 3. Query pending local records to push
      const statsBeforePush = this.updatePendingCount();
      console.log(`[syncEngine] Online: Found ${statsBeforePush.totalPending} pending records before push.`);

      // 4. Query the actual unsynced records from repositories
      const menuRepository = require('./MenuRepository.cjs');
      const customerRepository = require('./CustomerRepository.cjs');
      const orderRepository = require('./OrderRepository.cjs');
      const cashierRepository = require('./CashierRepository.cjs');

      const unsyncedMenu = menuRepository.getUnsyncedMenu();
      const unsyncedCashiers = cashierRepository.getUnsyncedCashiers();
      const unsyncedCustomers = customerRepository.getUnsyncedCustomers();
      const unsyncedOrders = orderRepository.getUnsyncedOrders();
      
      // Sync Menu Items — per-type failure tracking (Issue 19)
      if (unsyncedMenu.length > 0) {
        const ids = unsyncedMenu.map(item => item.id);
        try {
          const result = await mockApi.pushMenuItems(unsyncedMenu);
          const held = reconcilePush({
            table: 'menu_items', ids, records: unsyncedMenu, result,
            markSynced: (okIds, rows) => menuRepository.markMenuSynced(okIds, rows),
            markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg, unsyncedMenu),
            phaseErrors, label: 'Menu push',
          });
          console.log(`[syncEngine] Marked ${ids.length - held.length} menu items as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Menu push failed:', e.message);
          phaseErrors.push(`Menu push failed: ${e.message}`);
          this.db.markSyncFailure('menu_items', ids, e.message, unsyncedMenu);
        }
      }

      // Sync Cashiers
      if (unsyncedCashiers.length > 0) {
        const ids = unsyncedCashiers.map(c => c.id);
        try {
          const result = await mockApi.pushCashiers(unsyncedCashiers);
          const held = reconcilePush({
            table: 'cashiers', ids, records: unsyncedCashiers, result,
            markSynced: (okIds, rows) => cashierRepository.markCashiersSynced(okIds, rows),
            markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg, unsyncedCashiers),
            phaseErrors, label: 'Cashiers push',
          });
          console.log(`[syncEngine] Marked ${ids.length - held.length} cashiers as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Cashiers push failed:', e.message);
          phaseErrors.push(`Cashiers push failed: ${e.message}`);
          this.db.markSyncFailure('cashiers', ids, e.message, unsyncedCashiers);
        }
      }

      // Sync Customers
      if (unsyncedCustomers.length > 0) {
        const ids = unsyncedCustomers.map(c => c.id);
        try {
          const result = await mockApi.pushCustomers(unsyncedCustomers);
          const held = reconcilePush({
            table: 'customers', ids, records: unsyncedCustomers, result,
            markSynced: (okIds, rows) => customerRepository.markCustomersSynced(okIds, rows),
            markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg, unsyncedCustomers),
            phaseErrors, label: 'Customers push',
          });
          console.log(`[syncEngine] Marked ${ids.length - held.length} customers as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Customers push failed:', e.message);
          phaseErrors.push(`Customers push failed: ${e.message}`);
          this.db.markSyncFailure('customers', ids, e.message, unsyncedCustomers);
        }
      }

      // Sync Orders
      if (unsyncedOrders.length > 0) {
        const ids = unsyncedOrders.map(o => o.id);
        try {
          const result = await mockApi.pushOrders(unsyncedOrders);
          const held = reconcilePush({
            table: 'orders', ids, records: unsyncedOrders, result,
            markSynced: (okIds, rows) => orderRepository.markOrdersSynced(okIds, rows),
            markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg, unsyncedOrders),
            phaseErrors, label: 'Orders push',
          });
          console.log(`[syncEngine] Marked ${ids.length - held.length} orders as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Orders push failed:', e.message);
          phaseErrors.push(`Orders push failed: ${e.message}`);
          this.db.markSyncFailure('orders', ids, e.message, unsyncedOrders);
        }
      }

      // Sync Inventory items + movements (Issue 27: transactions carry the audit trail)
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        const unsyncedInventory = inventoryRepository.getUnsyncedInventory();
        if (unsyncedInventory.length > 0) {
          const ids = unsyncedInventory.map(inv => inv.id);
          try {
            const result = await mockApi.pushInventory(unsyncedInventory);
            const held = reconcilePush({
              table: 'inventory', ids, records: unsyncedInventory, result,
              markSynced: (okIds, rows) => inventoryRepository.markInventorySynced(okIds, rows),
              markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg, unsyncedInventory),
              phaseErrors, label: 'Inventory push',
            });
            console.log(`[syncEngine] Marked ${ids.length - held.length} inventory items as synced in local DB.`);
          } catch (e) {
            console.error('[syncEngine] Inventory push failed:', e.message);
            phaseErrors.push(`Inventory push failed: ${e.message}`);
            this.db.markSyncFailure('inventory', ids, e.message, unsyncedInventory);
          }
        }

        const unsyncedTx = inventoryRepository.getUnsyncedTransactions();
        if (unsyncedTx.length > 0) {
          const txIds = unsyncedTx.map(t => t.id);
          try {
            const result = await mockApi.pushInventoryTransactions(unsyncedTx);
            const held = reconcilePush({
              table: 'inventory_transactions', ids: txIds, records: unsyncedTx, result,
              // The ledger is append-only, so there is no version to guard: a movement is
              // never edited after the fact.
              markSynced: (okIds) => inventoryRepository.markTransactionsSynced(okIds),
              markFailure: (t, bad, msg) => this.db.markSyncFailure(t, bad, msg),
              phaseErrors, label: 'Inventory transactions push',
            });
            console.log(`[syncEngine] Marked ${txIds.length - held.length} inventory transactions as synced in local DB.`);
          } catch (e) {
            console.error('[syncEngine] Inventory transactions push failed:', e.message);
            phaseErrors.push(`Inventory transactions push failed: ${e.message}`);
            this.db.markSyncFailure('inventory_transactions', txIds, e.message);
          }
        }

        // Loyalty points ledger (Issue 26).
        //
        // No snapshots are passed for either ledger table. markSyncFailure builds its
        // version guard from `updated_at`, and neither inventory_transactions nor
        // points_transactions has that column — passing records would make every failure
        // update throw "no such column" and silently park nothing at all. Both are
        // append-only, so a row is never edited after the fact and there is nothing to guard.
        const sqlite = this.db.getDb();
        // Same two filters as every other push query: a row parked after repeated failures
        // or belonging to another branch must not be retried on every cycle.
        const { MAX_SYNC_ATTEMPTS } = require('./database.cjs');
        const unsyncedPtx = sqlite.prepare(`
          SELECT * FROM points_transactions
          WHERE is_synced = 0
            AND sync_attempts < ?
            AND (branch_id = ? OR branch_id IS NULL)
        `).all(MAX_SYNC_ATTEMPTS, this.db.getBranchId());
        if (unsyncedPtx.length > 0) {
          const ptxIds = unsyncedPtx.map(p => p.id);
          try {
            const result = await mockApi.pushPointsTransactions(unsyncedPtx);
            const named = new Set(((result && result.failed) || []).map((f) => f && f.id).filter(Boolean));
            const okIds = ptxIds.filter((id) => !named.has(id));
            // Clearing sync_attempts re-arms a row that failed before and has since been
            // queued again; without it a recovered row stays parked for the session.
            const stmt = sqlite.prepare('UPDATE points_transactions SET is_synced = 1, sync_attempts = 0 WHERE id = ?');
            sqlite.transaction(() => { for (const id of okIds) stmt.run(id); })();
            console.log(`[syncEngine] Marked ${okIds.length} points transactions as synced in local DB.`);
            if (named.size > 0) {
              const message = `Points transactions push: ${named.size} record(s) rejected by the worker`;
              phaseErrors.push(message);
              this.db.markSyncFailure('points_transactions', [...named], message);
            }
          } catch (e) {
            console.error('[syncEngine] Points transactions push failed:', e.message);
            phaseErrors.push(`Points transactions push failed: ${e.message}`);
            this.db.markSyncFailure('points_transactions', ptxIds, e.message);
          }
        }
      } catch (invError) {
        // Reported, not bypassed. Swallowing this left the cycle finishing with
        // state 'synced' and lastError null while stock and loyalty points had silently
        // stopped reaching the cloud — the one failure mode a POS most needs to surface.
        console.warn('[syncEngine] Inventory/points sync failed:', invError.message);
        phaseErrors.push(`Inventory/points sync failed: ${invError.message}`);
      }

      // 5. Update final status based on errors and pending count
      const finalStats = this.updatePendingCount();
      if (phaseErrors.length > 0) {
        this.status.state = 'error';
        this.status.lastError = phaseErrors.join('; ');

        // Both directions now earn a wait — a pull that fails every 30 seconds for the life
        // of the app is a hot loop against the worker, not a neutral condition — but a
        // pull-only failure backs off to a shorter ceiling, because it is usually a server
        // contract mismatch and drifting to 30 minutes would hide the moment it is fixed.
        const pushFailed = phaseErrors.some((message) => /push failed|transactions push failed/i.test(message));
        const pullFailed = phaseErrors.some((message) => /failed to pull/i.test(message));
        this.pullOnlyFailures = pullFailed && !pushFailed;
        if (pushFailed || pullFailed) this.consecutiveFailures += 1;

        console.warn(`[syncEngine] Sync cycle completed with ${phaseErrors.length} error(s):`, this.status.lastError);
      } else if (finalStats.totalPending > 0) {
        this.status.state = 'syncing';
        this.status.lastError = null;
        this.status.lastSyncAt = new Date().toISOString();
        this.consecutiveFailures = 0;
        this.pullOnlyFailures = false;
        console.log(`[syncEngine] Sync cycle completed with ${finalStats.totalPending} pending records remaining.`);
      } else {
        this.status.state = 'synced';
        this.status.lastError = null;
        this.status.lastSyncAt = new Date().toISOString();
        this.consecutiveFailures = 0;
        this.pullOnlyFailures = false;
        console.log('[syncEngine] Sync cycle completed successfully.');
      }
      this.emitStatus();
    } catch (error) {
      console.error('[syncEngine] Sync cycle failed with error:', error.message);
      this.status.state = 'error';
      this.status.lastError = error.message || 'Unknown synchronization error';
      this.consecutiveFailures += 1;
      this.updatePendingCount(); // Updates pending count and calls emitStatus()
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Automatically check and send Telegram report if configured and scheduled time is reached
   */
  async checkAndSendTelegramReport() {
    try {
      const db = require('./database.cjs');
      const settings = db.getSettings();
      
      const configRaw = settings['engaz_telegram_config'];
      if (!configRaw) return;

      let config;
      try {
        config = JSON.parse(configRaw);
      } catch (e) {
        return;
      }

      if (!config.enabled || !config.botToken || !config.chatId) return;

      const now = new Date();
      // Compare minutes numerically, not "HH:MM" strings (Issue 36)
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const scheduledTimeStr = config.reportTime || '23:00';
      const [schedH, schedM] = scheduledTimeStr.split(':').map(Number);
      const scheduledMinutes = (schedH || 0) * 60 + (schedM || 0);

      // Format today's date as "YYYY-MM-DD"
      const todayDateStr = now.toLocaleDateString('en-CA');
      const lastReportDate = settings['telegram_last_report_date'] || '';

      // If current local time is at or after scheduled time, and we haven't sent it today.
      // Only window: within 30 minutes after the scheduled time — a device booted hours
      // late must NOT fire the report at a random time; it will send the next day.
      if (currentMinutes >= scheduledMinutes && (currentMinutes - scheduledMinutes) <= 30 && lastReportDate !== todayDateStr) {
        console.log(`[syncEngine] Triggering automatic daily Telegram report (Scheduled: ${scheduledTimeStr})`);

        const telegramService = require('./telegramService.cjs');
        try {
          await telegramService.sendDailyReport();
          // Record the date ONLY after a successful send (Issue 36)
          db.saveSetting('telegram_last_report_date', todayDateStr);
          console.log(`[syncEngine] Automatic daily Telegram report sent successfully for ${todayDateStr}.`);
        } catch (sendErr) {
          // Date is not recorded → next cycle will retry
          console.error('[syncEngine] Telegram report send failed, will retry next cycle:', sendErr.message);
        }
      }
    } catch (error) {
      console.error('[syncEngine] Failed to send automatic Telegram report:', error.message);
    }
  }
}

module.exports = SyncEngine;
