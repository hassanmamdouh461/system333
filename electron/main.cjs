// Public resolvers are opt-in only. Forcing them process-wide broke name resolution on
// networks with split-horizon DNS or outbound port 53 blocked, which made the worker
// health check report the app as permanently offline. Set ENGAZ_DNS_SERVERS to a
// comma-separated list to override the system resolver deliberately.
if (process.env.ENGAZ_DNS_SERVERS) {
  const dns = require('dns');
  const servers = process.env.ENGAZ_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean);
  if (servers.length > 0) {
    try {
      dns.setServers(servers);
      console.log('[main] DNS servers overridden:', servers.join(', '));
    } catch (e) {
      console.error('[main] Invalid ENGAZ_DNS_SERVERS value; using the system resolver:', e.message);
    }
  }
}

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database.cjs');
const SyncEngine = require('./syncEngine.cjs');
const orderRepository = require('./OrderRepository.cjs');
const menuRepository = require('./MenuRepository.cjs');
const customerRepository = require('./CustomerRepository.cjs');
const inventoryRepository = require('./InventoryRepository.cjs');
const telegramService = require('./telegramService.cjs');
const validate = require('./validate.cjs');

let mainWindow;
let syncEngine;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Prevent white flash on startup
    backgroundColor: '#111827', // Match the application dark background
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // The renderer only ever loads local files and talks to the main process, so it has
      // no need for Node or for reaching outside its sandbox.
      sandbox: true,
      webSecurity: true,
    }
  });

  // Dev mode is explicit (ENGAZ_DEV=1) rather than inferred from app.isPackaged, so the
  // same un-packaged binary can serve the fast production build (dist/) when a Vite dev
  // server is not running. This is what makes the desktop shortcut open almost instantly.
  const isDev = process.env.ENGAZ_DEV === '1' && process.env.ENGAZ_DEV_LOAD_URL;

  if (isDev) {
    mainWindow.loadURL(process.env.ENGAZ_DEV_LOAD_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Nothing in this app should open a second window or navigate away from the bundled app.
  // External links to the manager portal open in the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://reporting.engaz.tech')) {
      const { shell } = require('electron');
      shell.openExternal(url);
    } else {
      console.warn('[main] Blocked window open request:', url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || (isDev && url.startsWith(process.env.ENGAZ_DEV_LOAD_URL));
    if (!isLocal) {
      console.warn('[main] Blocked navigation to:', url);
      event.preventDefault();
    }
  });

  // Show window only when content is ready to paint to prevent white flash, but never
  // hang: if the page is slow to paint (e.g. dev server not answering) force-show after
  // a short grace period so the app never looks frozen.
  const showTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 2000);
  mainWindow.once('ready-to-show', () => {
    clearTimeout(showTimer);
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    clearTimeout(showTimer);
    mainWindow = null;
  });
}

/**
 * Registers an IPC handler with logging and error normalisation.
 *
 * An uncaught throw inside `ipcMain.handle` reaches the renderer as "Error invoking remote
 * method …" with the real cause buried, and never appears in the main-process log at all —
 * so failures here were effectively invisible. A validation failure is the caller's fault
 * and is logged at warn level with its message passed through; anything else is logged with
 * its stack.
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err && err.isValidation) {
        console.warn(`[ipc] ${channel} rejected invalid input: ${err.message}`);
      } else {
        console.error(`[ipc] ${channel} failed:`, err);
      }
      throw new Error(err && err.message ? err.message : `${channel} failed`);
    }
  });
}

function registerIpcHandlers() {
  // ─── Menu ──────────────────────────────────────────────────────────────────
  handle('db:get-menu', () => menuRepository.getMenu());
  handle('db:create-menu-item', (item) => menuRepository.createMenuItem(validate.validateMenuItem(item)));
  handle('db:update-menu-item', (id, data) => menuRepository.updateMenuItem(
    validate.requireId(id, 'id'),
    validate.validateMenuItemUpdate(data)
  ));
  handle('db:delete-menu-item', (id) => menuRepository.deleteMenuItem(validate.requireId(id, 'id')));
  handle('db:reset-menu', (defaults) => {
    if (!Array.isArray(defaults)) throw new validate.ValidationError('defaults must be an array');
    return menuRepository.resetMenu(defaults.map(validate.validateMenuItem));
  });

  // ─── Orders ────────────────────────────────────────────────────────────────
  handle('db:get-orders', (branchId) => orderRepository.getOrders(
    validate.optionalString(branchId, 'branchId', { max: 60 }) ?? undefined
  ));
  handle('db:create-order', (order) => orderRepository.createOrder(validate.validateNewOrder(order)));
  handle('db:update-order-status', (id, status) => orderRepository.updateOrderStatus(
    validate.requireId(id, 'id'),
    validate.requireEnum(status, 'status', validate.ORDER_STATUSES)
  ));
  handle('db:complete-order-payment', (id, method) => orderRepository.completeOrderPayment(
    validate.requireId(id, 'id'),
    validate.requireEnum(method, 'paymentMethod', validate.PAYMENT_METHODS)
  ));
  handle('db:update-order', (id, data) => orderRepository.updateOrder(
    validate.requireId(id, 'id'),
    validate.validateOrderUpdate(data)
  ));
  handle('db:delete-order', (id) => orderRepository.deleteOrder(validate.requireId(id, 'id')));
  handle('db:reset-orders', (defaults) => {
    if (!Array.isArray(defaults)) throw new validate.ValidationError('defaults must be an array');
    return orderRepository.resetOrders(defaults.map(validate.validateNewOrder));
  });

  // ─── Customers ─────────────────────────────────────────────────────────────
  handle('db:get-customers', () => customerRepository.getCustomers());
  handle('db:get-customer-by-phone', (phone) => customerRepository.getCustomerByPhone(
    validate.requirePhone(phone)
  ));
  handle('db:save-customer', (customer) => customerRepository.saveCustomer(validate.validateCustomer(customer)));
  handle('db:delete-customer', (id) => customerRepository.deleteCustomer(validate.requireId(id, 'id')));

  // ─── Settings ──────────────────────────────────────────────────────────────
  // Explicit whitelist (Issue 30): only durable settings reach SQLite. Transient UI state
  // such as the register draft stays in the renderer.
  const SETTINGS_WHITELIST = [
    /^engaz_tax_rate$/,
    /^engaz_branch_config$/,
    /^engaz_telegram_config$/,
    /^engaz_store_config$/,
    /^engaz_tables_config$/,
    /^engaz_admin_creds$/,
    /^engaz_d1_worker_url$/,
    /^engaz_d1_worker_api_key$/,
    /^branch_id$/,
  ];
  const isAllowedSettingKey = (key) => typeof key === 'string' && SETTINGS_WHITELIST.some(re => re.test(key));

  handle('db:get-settings', () => {
    const all = db.getSettings();
    const filtered = {};
    for (const [key, value] of Object.entries(all)) {
      if (isAllowedSettingKey(key)) filtered[key] = value;
    }
    return filtered;
  });
  handle('db:save-setting', (key, value) => {
    // A non-whitelisted key is refused rather than thrown on: the renderer caches several
    // keys locally by design and does not treat the refusal as an error.
    if (!isAllowedSettingKey(key)) return false;
    db.saveSetting(key, validate.validateSettingValue(value));
    return true;
  });
  handle('db:delete-setting', (key) => {
    if (!isAllowedSettingKey(key)) return false;
    db.deleteSetting(key);
    return true;
  });

  // ─── Inventory and recipes ─────────────────────────────────────────────────
  handle('db:get-inventory', (branchId) => inventoryRepository.getInventory(
    validate.optionalString(branchId, 'branchId', { max: 60 }) ?? undefined
  ));
  handle('db:create-inventory-item', (item) => inventoryRepository.createInventoryItem(
    validate.validateInventoryItem(item)
  ));
  handle('db:update-inventory-item', (id, data) => inventoryRepository.updateInventoryItem(
    validate.requireId(id, 'id'),
    validate.validateInventoryItemUpdate(data)
  ));
  handle('db:delete-inventory-item', (id) => inventoryRepository.deleteInventoryItem(
    validate.requireId(id, 'id')
  ));

  handle('db:get-inventory-transactions', (itemId, branchId) => inventoryRepository.getInventoryTransactions(
    validate.optionalString(itemId, 'itemId', { max: 100 }) ?? undefined,
    validate.optionalString(branchId, 'branchId', { max: 60 }) ?? undefined
  ));
  handle('db:create-inventory-transaction', (tx) => inventoryRepository.createInventoryTransaction(
    validate.validateStockMovement(tx)
  ));

  handle('db:get-menu-recipes', () => inventoryRepository.getMenuRecipes());
  handle('db:get-menu-item-recipe', (menuItemId) => inventoryRepository.getMenuItemRecipe(
    validate.requireId(menuItemId, 'menuItemId')
  ));
  handle('db:save-menu-recipe', (menuItemId, ingredients) => inventoryRepository.saveMenuRecipe(
    validate.requireId(menuItemId, 'menuItemId'),
    validate.validateRecipe(ingredients)
  ));
  handle('db:get-recipe-cost', (menuItemId) => inventoryRepository.getRecipeCost(
    validate.requireId(menuItemId, 'menuItemId')
  ));

  // ─── Sync ──────────────────────────────────────────────────────────────────
  handle('sync:get-status', () => syncEngine.getStatus());
  handle('sync:trigger-now', () => syncEngine.syncNow());
  // Rows parked after exhausting their retry budget, and a way to release them.
  handle('sync:get-parked-rows', () => db.getParkedSyncRows());
  handle('sync:retry-parked-rows', (table, ids) => {
    if (ids != null && !Array.isArray(ids)) {
      throw new validate.ValidationError('ids must be an array or null');
    }
    return db.resetSyncAttempts(
      validate.requireString(table, 'table', { max: 60 }),
      ids ? ids.map(id => validate.requireId(id, 'id')) : null
    );
  });

  // ─── Telegram ──────────────────────────────────────────────────────────────
  handle('db:get-daily-report-stats', () => orderRepository.getDailyReportStats());
  // The manual trigger deliberately bypasses the 'enabled' toggle: the user pressed the
  // button, which is a stronger signal than the stored preference.
  handle('telegram:send-daily-report', () => telegramService.sendDailyReport({ ignoreEnabledFlag: true }));
}

app.whenReady().then(() => {
  // Initialize the local SQLite database on startup
  db.initDatabase();

  // Initialize the Sync Engine background worker
  syncEngine = new SyncEngine(db, (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status-update', status);
    }
  });

  registerIpcHandlers();
  createWindow();

  // Start background syncing loop after window creation
  syncEngine.start();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (syncEngine) {
    syncEngine.stop();
  }
});
