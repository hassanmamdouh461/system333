const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database.cjs');

// ─── File logging (survives silent VBS launches) ─────────────
let logFilePath = null;
function initFileLogging() {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    logFilePath = path.join(logsDir, `brewmaster-${stamp}.log`);
    const stream = fs.createWriteStream(logFilePath, { flags: 'a' });
    const write = (level, args) => {
      const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
      stream.write(line);
    };
    const origLog = console.log, origWarn = console.warn, origErr = console.error;
    console.log = (...a) => { write('INFO', a); origLog(...a); };
    console.warn = (...a) => { write('WARN', a); origWarn(...a); };
    console.error = (...a) => { write('ERROR', a); origErr(...a); };
    // Keep the last 14 log files only
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('brewmaster-') && f.endsWith('.log')).sort();
    while (files.length > 14) {
      fs.unlinkSync(path.join(logsDir, files.shift()));
    }
    console.log('[main] File logging enabled at', logFilePath);
  } catch (e) {
    console.error('[main] Failed to initialize file logging:', e);
  }
}

// ─── SQLite backup (daily copy, keep 7) ──────────────────────
function backupDatabase() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'brewmaster.db');
    if (!fs.existsSync(dbPath)) return;
    const backupDir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(backupDir, `brewmaster-${stamp}.db`);
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(dbPath, backupPath);
      console.log('[main] SQLite backup created:', backupPath);
    }
    // Retain only the newest 7 backups
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('brewmaster-') && f.endsWith('.db')).sort();
    while (files.length > 7) {
      fs.unlinkSync(path.join(backupDir, files.shift()));
    }
  } catch (e) {
    console.error('[main] SQLite backup failed:', e);
  }
}
const SyncEngine = require('./syncEngine.cjs');
const orderRepository = require('./OrderRepository.cjs');
const menuRepository = require('./MenuRepository.cjs');
const customerRepository = require('./CustomerRepository.cjs');
const inventoryRepository = require('./InventoryRepository.cjs');
const mockApi = require('./mockApiService.cjs');
const telegramService = require('./telegramService.cjs');
const authService = require('./authService.cjs');

let mainWindow;
let syncEngine;

// ─── Security guards ─────────────────────────────────────────
// Origins the POS window is allowed to navigate to / open.
function isAllowedAppUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') return true; // packaged build
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true; // dev server
    return false;
  } catch {
    return false;
  }
}

// External hosts that may be opened in the system browser only.
function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return ['api.telegram.org', 'api.qrserver.com', 'images.unsplash.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function hardenWindow(win) {
  // Block navigation away from the app origin
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppUrl(targetUrl)) {
      event.preventDefault();
    }
  });
  // Deny all permission requests (camera, mic, notifications, ...) by default
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
}

// Deny new windows; allow-list a few external https hosts to open in the system browser
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});

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
      contextIsolation: true
    }
  });

  hardenWindow(mainWindow);

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window only when content is ready to paint to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // File logging first so every later step is captured to disk
  initFileLogging();

  // Initialize the local SQLite database on startup, then take the daily backup
  db.initDatabase();
  backupDatabase();

  // Seed local users (first run only) and migrate legacy plaintext secrets
  authService.ensureSeedUsers();
  db.migrateSecret('brewmaster_telegram_config', 'secure_telegram_config');
  db.migrateSecret('brewmaster_d1_worker_api_key', 'secure_worker_api_key');

  // ─── Auth IPC Handlers ───
  ipcMain.handle('auth:login', (event, email, password) => authService.login(email, password));
  ipcMain.handle('auth:validate-token', (event, token) => authService.validateToken(token));
  ipcMain.handle('auth:change-password', (event, token, currentPassword, newPassword) =>
    authService.changePassword(token, currentPassword, newPassword));

  // ─── Secret settings IPC Handlers (OS-keychain encrypted at rest) ───
  ipcMain.handle('secrets:get', (event, key) => db.getSecret(key));
  ipcMain.handle('secrets:save', (event, key, value) => db.saveSecret(key, value));

  // Initialize the Sync Engine background worker
  syncEngine = new SyncEngine(db, (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status-update', status);
    }
  });

  // Register IPC handlers for renderer database requests
  ipcMain.handle('db:get-menu', () => menuRepository.getMenu());
  ipcMain.handle('db:create-menu-item', (event, item) => menuRepository.createMenuItem(item));
  ipcMain.handle('db:update-menu-item', (event, id, data) => menuRepository.updateMenuItem(id, data));
  ipcMain.handle('db:delete-menu-item', (event, id) => menuRepository.deleteMenuItem(id));
  ipcMain.handle('db:reset-menu', (event, defaults) => menuRepository.resetMenu(defaults));

  ipcMain.handle('db:get-orders', () => orderRepository.getOrders());
  ipcMain.handle('db:create-order', (event, order) => orderRepository.createOrder(order));
  ipcMain.handle('db:update-order-status', (event, id, status) => orderRepository.updateOrderStatus(id, status));
  ipcMain.handle('db:complete-order-payment', (event, id, method) => orderRepository.completeOrderPayment(id, method));
  ipcMain.handle('db:update-order', (event, id, data) => orderRepository.updateOrder(id, data));
  ipcMain.handle('db:delete-order', (event, id) => orderRepository.deleteOrder(id));
  ipcMain.handle('db:reset-orders', (event, defaults) => orderRepository.resetOrders(defaults));

  ipcMain.handle('db:get-customers', () => customerRepository.getCustomers());
  ipcMain.handle('db:get-customer-by-phone', (event, phone) => customerRepository.getCustomerByPhone(phone));
  ipcMain.handle('db:save-customer', (event, customer) => customerRepository.saveCustomer(customer));
  ipcMain.handle('db:delete-customer', (event, id) => customerRepository.deleteCustomer(id));
  
  // Manager Dashboard analytics handlers
  // Desktop: read the local synced SQLite (managers run the same app).
  ipcMain.handle('db:get-manager-orders', () => orderRepository.getOrders());
  ipcMain.handle('db:get-manager-customers', () => customerRepository.getCustomers());

  ipcMain.handle('db:get-settings', () => db.getSettings());
  ipcMain.handle('db:save-setting', (event, key, value) => db.saveSetting(key, value));
  ipcMain.handle('db:delete-setting', (event, key) => db.deleteSetting(key));

  // Inventory & Recipe handlers
  ipcMain.handle('db:get-inventory', (event, branchId) => inventoryRepository.getInventory(branchId));
  ipcMain.handle('db:create-inventory-item', (event, item) => inventoryRepository.createInventoryItem(item));
  ipcMain.handle('db:update-inventory-item', (event, id, data) => inventoryRepository.updateInventoryItem(id, data));
  ipcMain.handle('db:delete-inventory-item', (event, id) => inventoryRepository.deleteInventoryItem(id));
  
  ipcMain.handle('db:get-inventory-transactions', (event, itemId, branchId) => inventoryRepository.getInventoryTransactions(itemId, branchId));
  ipcMain.handle('db:create-inventory-transaction', (event, tx) => inventoryRepository.createInventoryTransaction(tx));
  
  ipcMain.handle('db:get-menu-recipes', () => inventoryRepository.getMenuRecipes());
  ipcMain.handle('db:get-menu-item-recipe', (event, menuItemId) => inventoryRepository.getMenuItemRecipe(menuItemId));
  ipcMain.handle('db:save-menu-recipe', (event, menuItemId, ingredients) => inventoryRepository.saveMenuRecipe(menuItemId, ingredients));
  ipcMain.handle('db:get-recipe-cost', (event, menuItemId) => inventoryRepository.getRecipeCost(menuItemId));

  // Sync IPC Handlers
  ipcMain.handle('sync:get-status', () => syncEngine.getStatus());
  ipcMain.handle('sync:trigger-now', () => syncEngine.syncNow());

  // Telegram IPC Handlers
  ipcMain.handle('db:get-daily-report-stats', () => orderRepository.getDailyReportStats());
  ipcMain.handle('telegram:send-daily-report', () => telegramService.sendDailyReport());

  createWindow();

  // Start background syncing loop after window creation
  syncEngine.start();

  // Automatic updates (packaged builds only — requires publish config + signed artifacts)
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.on('update-downloaded', () => {
        console.log('[updater] Update downloaded; will install on next restart.');
      });
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      console.log('[updater] electron-updater not available; skipping auto-update check.');
    }
  }

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
