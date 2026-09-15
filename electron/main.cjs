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
const cashierRepository = require('./CashierRepository.cjs');
const telegramService = require('./telegramService.cjs');
const validate = require('./validate.cjs');
const syncApi = require('./mockApiService.cjs');
const printManager = require('./printManager.cjs');
const { installFatalHandlers } = require('./processSafety.cjs');

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

  /**
   * A prefix test on the URL string accepts `https://reporting.engaz.tech.attacker.tld` — a
   * different site that merely begins with the same characters, and one that a crafted link
   * could hand to shell.openExternal. Compare the parsed hostname, and require https so a
   * `javascript:` or `data:` URL cannot reach the handler at all.
   */
  const EXTERNAL_LINK_HOSTS = new Set(['reporting.engaz.tech']);

  function isAllowedExternalUrl(raw) {
    try {
      const parsed = new URL(String(raw));
      return parsed.protocol === 'https:' && EXTERNAL_LINK_HOSTS.has(parsed.hostname);
    } catch {
      return false;
    }
  }

  // Dev-server navigation is allowed only for the origin we were told to load, for the same
  // reason: `http://localhost:5173.attacker.tld` is not the dev server.
  function isDevServerUrl(raw) {
    try {
      return new URL(String(raw)).origin === new URL(String(process.env.ENGAZ_DEV_LOAD_URL)).origin;
    } catch {
      return false;
    }
  }

  // Nothing in this app should open a second window or navigate away from the bundled app.
  // External links to the manager portal open in the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      const { shell } = require('electron');
      shell.openExternal(url);
    } else {
      console.warn('[main] Blocked window open request:', url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || (isDev && isDevServerUrl(url));
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
    validate.optionalString(branchId, 'branchId', { max: validate.BRANCH_ID_MAX }) ?? undefined
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

  // ─── Cashiers ──────────────────────────────────────────────────────────────
  handle('db:get-cashiers', (branchId) => cashierRepository.getCashiers(
    validate.optionalString(branchId, 'branchId', { max: validate.BRANCH_ID_MAX }) ?? undefined
  ));
  handle('db:create-cashier', (name, avatar) => cashierRepository.createCashier(
    validate.requireString(name, 'name'),
    validate.optionalString(avatar, 'avatar', { max: 400000 })
  ));
  handle('db:delete-cashier', (id) => cashierRepository.deleteCashier(validate.requireId(id, 'id')));
  handle('db:rename-cashier', (id, name) => cashierRepository.renameCashier(
    validate.requireId(id, 'id'),
    validate.requireString(name, 'name')
  ));
  handle('db:set-cashier-avatar', (id, avatar) => cashierRepository.setCashierAvatar(
    validate.requireId(id, 'id'),
    validate.optionalString(avatar, 'avatar', { max: 400000 })
  ));

  // ─── Settings ──────────────────────────────────────────────────────────────
  // Explicit whitelist (Issue 30): only durable settings reach SQLite. Transient UI state
  // such as the register draft stays in the renderer.
  const SETTINGS_WHITELIST = [
    /^engaz_tax_rate$/,
    /^engaz_branch_config$/,
    /^engaz_telegram_config$/,
    /^engaz_store_config$/,
    /^engaz_tables_config$/,
    /^engaz_d1_worker_url$/,
    /^engaz_d1_worker_api_key$/,
    /^branch_id$/,
  ];

  // Credentials the renderer may still save, but must never read back. The renderer is an
  // untrusted caller: it is the same bundle published publicly at menu.engaz.tech, and it
  // mirrors every value returned here into localStorage on startup. Handing it the worker
  // key (or the admin digest) defeats the whole "the key lives in the main process only"
  // rule, and together with the writable worker URL it would let injected renderer code
  // point the sync — key included — at any host.
  const SETTINGS_WRITE_ONLY = [
    /^engaz_d1_worker_api_key$/,
    // A Telegram bot token is fully capabilities-bearing: whoever holds it can read every
    // message the bot can and post as it. The renderer keeps its own copy in localStorage for
    // the settings form, so withholding it here costs nothing and stops a compromised
    // renderer from reading the token out of SQLite over IPC.
    /^engaz_telegram_config$/,
  ];

  const isAllowedSettingKey = (key) => typeof key === 'string' && SETTINGS_WHITELIST.some(re => re.test(key));
  const isWriteOnlySettingKey = (key) => typeof key === 'string' && SETTINGS_WRITE_ONLY.some(re => re.test(key));

  handle('db:get-settings', () => {
    const all = db.getSettings();
    const filtered = {};
    for (const [key, value] of Object.entries(all)) {
      if (isAllowedSettingKey(key) && !isWriteOnlySettingKey(key)) filtered[key] = value;
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
    validate.optionalString(branchId, 'branchId', { max: validate.BRANCH_ID_MAX }) ?? undefined
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
    validate.optionalString(branchId, 'branchId', { max: validate.BRANCH_ID_MAX }) ?? undefined
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

  // ─── Public menu ───────────────────────────────────────────────────────────
  // Publishing needs the reports write key, which lives in this process. The renderer sends
  // the configuration and gets back whether it reached the customer-facing database. The
  // renderer keeps its own copy for the panel, so nothing is cached here.
  handle('menu:publish-config', (config) => syncApi.publishMenuConfig(
    validate.validateMenuConfig(config)
  ));

  // ─── Printing ──────────────────────────────────────────────────────────────
  handle('app:print-receipt', (html) => printManager.printReceiptHtml(html));
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

/**
 * Last line of defence.
 *
 * A till runs unattended for a whole shift, so this does fail safe rather than fail silent:
 * the fault is logged with its stack, the sync loop is stopped so no further writes leave a
 * process whose state is unknown, the operator is told instead of being left with a
 * frozen-looking till, and the process exits non-zero so it can be restarted into a known
 * state.
 *
 * It deliberately does NOT continue. Continuing after an *unknown* exception means taking
 * more money on top of a state nobody has analysed — and the only symptom is a till that
 * reports "synced" while drifting away from the cloud. Recoverable failures are handled at
 * their own call site; anything reaching this handler is unhandled by definition.
 */
installFatalHandlers({
  stopSync: () => {
    // Only after the engine exists: a fault during startup must not be made worse by
    // reaching for it. `will-quit` also stops it on a normal shutdown.
    if (syncEngine) syncEngine.stop();
  },
  notify: (detail) => {
    const { dialog } = require('electron');
    // Shown before the window is torn down, so the cashier is never left guessing. The
    // detail goes to the log, not the dialog: a stack trace on a till screen helps nobody.
    dialog.showErrorBox(
      'Engaz POS — تم إيقاف التطبيق',
      'حدث خطأ غير متوقع وتم إيقاف التطبيق لحماية البيانات. سيتم إعادة التشغيل تلقائياً إن كان مُعدّاً لذلك.\n'
      + 'راجع ملف السجل لمعرفة السبب.'
    );
    void detail;
  },
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (syncEngine) {
    syncEngine.stop();
  }
});
