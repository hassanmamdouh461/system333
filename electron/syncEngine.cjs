const mockApi = require('./mockApiService.cjs');

/** Base interval between sync cycles when everything is healthy. */
const BASE_INTERVAL_MS = 30_000;
/** Ceiling for the backoff, so a long outage still retries twice an hour. */
const MAX_BACKOFF_MS = 30 * 60_000;

async function checkInternet() {
  // Real reachability, not navigator.onLine: can we actually reach our worker?
  return mockApi.checkWorkerHealth();
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
      }

      // 3. Update the lastSyncAt timestamp since we successfully reached the server and pulled
      this.status.lastSyncAt = new Date().toISOString();

      // 4. Get current stats of pending local records to push
      const stats = this.updatePendingCount();
      
      if (stats.totalPending === 0) {
        // Nothing to push, sync is complete!
        this.status.state = 'synced';
        this.status.lastError = null;
        this.consecutiveFailures = 0;
        this.emitStatus();
        this.isSyncing = false;
        return;
      }

      console.log(`[syncEngine] Online: Found ${stats.totalPending} pending records to push/sync.`);
      
      // 5. Query the actual unsynced records from repositories
      const menuRepository = require('./MenuRepository.cjs');
      const customerRepository = require('./CustomerRepository.cjs');
      const orderRepository = require('./OrderRepository.cjs');

      const unsyncedMenu = menuRepository.getUnsyncedMenu();
      const unsyncedCustomers = customerRepository.getUnsyncedCustomers();
      const unsyncedOrders = orderRepository.getUnsyncedOrders();
      
      // Sync Menu Items — per-type failure tracking (Issue 19)
      if (unsyncedMenu.length > 0) {
        const ids = unsyncedMenu.map(item => item.id);
        try {
          await mockApi.pushMenuItems(unsyncedMenu);
          menuRepository.markMenuSynced(ids);
          console.log(`[syncEngine] Marked ${ids.length} menu items as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Menu push failed:', e.message);
          this.db.markSyncFailure('menu_items', ids, e.message);
        }
      }

      // Sync Customers
      if (unsyncedCustomers.length > 0) {
        const ids = unsyncedCustomers.map(c => c.id);
        try {
          await mockApi.pushCustomers(unsyncedCustomers);
          customerRepository.markCustomersSynced(ids);
          console.log(`[syncEngine] Marked ${ids.length} customers as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Customers push failed:', e.message);
          this.db.markSyncFailure('customers', ids, e.message);
        }
      }

      // Sync Orders
      if (unsyncedOrders.length > 0) {
        const ids = unsyncedOrders.map(o => o.id);
        try {
          await mockApi.pushOrders(unsyncedOrders);
          orderRepository.markOrdersSynced(ids);
          console.log(`[syncEngine] Marked ${ids.length} orders as synced in local DB.`);
        } catch (e) {
          console.error('[syncEngine] Orders push failed:', e.message);
          this.db.markSyncFailure('orders', ids, e.message);
        }
      }

      // Sync Inventory items + movements (Issue 27: transactions carry the audit trail)
      try {
        const inventoryRepository = require('./InventoryRepository.cjs');
        const unsyncedInventory = inventoryRepository.getUnsyncedInventory();
        if (unsyncedInventory.length > 0) {
          const ids = unsyncedInventory.map(inv => inv.id);
          try {
            await mockApi.pushInventory(unsyncedInventory);
            inventoryRepository.markInventorySynced(ids);
            console.log(`[syncEngine] Marked ${ids.length} inventory items as synced in local DB.`);
          } catch (e) {
            console.error('[syncEngine] Inventory push failed:', e.message);
            this.db.markSyncFailure('inventory', ids, e.message);
          }
        }

        const unsyncedTx = inventoryRepository.getUnsyncedTransactions();
        if (unsyncedTx.length > 0) {
          const txIds = unsyncedTx.map(t => t.id);
          try {
            await mockApi.pushInventoryTransactions(unsyncedTx);
            inventoryRepository.markTransactionsSynced(txIds);
            console.log(`[syncEngine] Marked ${txIds.length} inventory transactions as synced in local DB.`);
          } catch (e) {
            console.error('[syncEngine] Inventory transactions push failed:', e.message);
            this.db.markSyncFailure('inventory_transactions', txIds, e.message);
          }
        }

        // Loyalty points ledger (Issue 26)
        const sqlite = this.db.getDb();
        const unsyncedPtx = sqlite.prepare('SELECT * FROM points_transactions WHERE is_synced = 0').all();
        if (unsyncedPtx.length > 0) {
          const ptxIds = unsyncedPtx.map(p => p.id);
          try {
            await mockApi.pushPointsTransactions(unsyncedPtx);
            const stmt = sqlite.prepare('UPDATE points_transactions SET is_synced = 1 WHERE id = ?');
            sqlite.transaction(() => { for (const id of ptxIds) stmt.run(id); })();
            console.log(`[syncEngine] Marked ${ptxIds.length} points transactions as synced in local DB.`);
          } catch (e) {
            console.error('[syncEngine] Points transactions push failed:', e.message);
            this.db.markSyncFailure('points_transactions', ptxIds, e.message);
          }
        }
      } catch (invError) {
        console.warn('[syncEngine] Inventory/points sync bypassed:', invError.message);
      }

      // 6. Update success status
      this.status.state = 'synced';
      this.status.lastError = null;
      this.consecutiveFailures = 0;
      this.updatePendingCount(); // Updates pending count and calls emitStatus()
      
      console.log('[syncEngine] Sync cycle completed successfully.');
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
