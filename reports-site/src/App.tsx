import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthError, clearSession, fetchSnapshot, readSession } from './api';
import { LoginScreen } from './LoginScreen';
import { AnalyticsTab } from './AnalyticsTab';
import { InventoryTab } from './InventoryTab';
import { CustomersTab } from './CustomersTab';
import { MenuTab } from './MenuTab';
import { SettingsTab } from './SettingsTab';
import { Icon } from './ui';
import {
  DEFAULT_SETTINGS,
  readSettings,
  resolveTheme,
  writeSettings,
  type PortalSettings,
} from './settings';
import {
  ALL_BRANCHES,
  PERIOD_LABELS,
  PERIOD_ORDER,
  branchOptions,
  formatCount,
  formatTime,
  inBranch,
  inPeriod,
  isPaid,
  orderLines,
  summarizeSales,
  summarizeStock,
  toNum,
  type CustomerRow,
  type InventoryRow,
  type MenuItemRow,
  type OrderRow,
  type Period,
  type StockMovementRow,
} from './analytics';

type Tab = 'analytics' | 'menu' | 'inventory' | 'customers' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'analytics', label: 'الإحصائيات', icon: 'trend' },
  { id: 'menu', label: 'القائمة', icon: 'menu' },
  { id: 'inventory', label: 'المخزون', icon: 'stock' },
  { id: 'customers', label: 'العملاء', icon: 'users' },
  { id: 'settings', label: 'الإعدادات', icon: 'settings' },
];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export default function App() {
  const [token, setToken] = useState<string | null>(() => readSession()?.token ?? null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);

  const [settings, setSettings] = useState<PortalSettings>(() => readSettings(localStorage));
  const [tab, setTab] = useState<Tab>('analytics');
  const [period, setPeriod] = useState<Period>(settings.defaultPeriod);
  const [branch, setBranch] = useState<string>(settings.defaultBranch);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  // Monotonic token per request: a slow poll must not overwrite a newer manual refresh.
  const requestId = useRef(0);

  const updateSettings = useCallback((patch: Partial<PortalSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      writeSettings(next, localStorage);
      return next;
    });
  }, []);

  /** Follows the scope pickers when the viewer asked for their choice to be remembered. */
  const rememberScope = useCallback(
    (patch: Partial<Pick<PortalSettings, 'defaultBranch' | 'defaultPeriod'>>) => {
      if (settings.rememberScope) updateSettings(patch);
    },
    [settings.rememberScope, updateSettings]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    writeSettings(DEFAULT_SETTINGS, localStorage);
    setBranch(DEFAULT_SETTINGS.defaultBranch);
    setPeriod(DEFAULT_SETTINGS.defaultPeriod);
  }, []);

  const activeTheme = resolveTheme(settings.theme, prefersDark);

  // The palette and row spacing live on the root element so every panel, table and chart
  // inherits them from one place instead of each component knowing about themes.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = activeTheme;
    root.dataset.density = settings.density;
  }, [activeTheme, settings.density]);

  // Only matters while the theme is `system`, but the listener is cheap and unconditional
  // subscription keeps the switch instant when the viewer changes back to it.
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setToken(null);
    setOrders([]);
    setCustomers([]);
    setInventory([]);
    setMenuItems([]);
    setMovements([]);
    setLastUpdated(null);
  }, []);

  const loadData = useCallback(
    async (activeToken: string, options: { silent?: boolean } = {}) => {
      const id = ++requestId.current;
      if (!options.silent) setLoading(true);
      try {
        const snapshot = await fetchSnapshot(activeToken);
        if (id !== requestId.current) return;
        setOrders(snapshot.orders as unknown as OrderRow[]);
        setCustomers(snapshot.customers as unknown as CustomerRow[]);
        setInventory(snapshot.inventory as unknown as InventoryRow[]);
        setMenuItems(snapshot.menuItems as unknown as MenuItemRow[]);
        setMovements(snapshot.movements as unknown as StockMovementRow[]);
        setLastUpdated(new Date(snapshot.serverTime));
        setError(null);
      } catch (e) {
        if (id !== requestId.current) return;
        // An expired token is not an error to display; it means signing in again.
        if (e instanceof AuthError) {
          signOut();
          return;
        }
        setError((e as Error).message || 'تعذر تحميل البيانات');
      } finally {
        if (id === requestId.current && !options.silent) setLoading(false);
      }
    },
    [signOut]
  );

  useEffect(() => {
    if (token) loadData(token);
  }, [token, loadData]);

  // Live polling. A hidden tab is not polled: a portal left open overnight would otherwise
  // keep hitting the worker for a screen nobody is reading.
  useEffect(() => {
    if (!token || !settings.autoRefresh) return;

    const tick = () => {
      if (document.visibilityState === 'visible') loadData(token, { silent: true });
    };
    const timer = window.setInterval(tick, settings.refreshSeconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [token, settings.autoRefresh, settings.refreshSeconds, loadData]);

  const branches = useMemo(
    () => branchOptions(orders, inventory, customers),
    [orders, inventory, customers]
  );

  const scopedOrders = useMemo(
    () => orders.filter((o) => inBranch(o.branch_id, branch) && inPeriod(o.createdAt, period)),
    [orders, branch, period]
  );

  const scopedInventory = useMemo(
    () => inventory.filter((i) => inBranch(i.branch_id, branch)),
    [inventory, branch]
  );

  const scopedMenuItems = useMemo(
    () => menuItems.filter((m) => inBranch(m.branch_id, branch)),
    [menuItems, branch]
  );

  const scopedCustomers = useMemo(
    () => customers.filter((c) => inBranch(c.branch_id, branch)),
    [customers, branch]
  );

  const newCustomerCount = useMemo(
    () => scopedCustomers.filter((c) => inPeriod(c.createdAt, period)).length,
    [scopedCustomers, period]
  );

  const sales = useMemo(
    () => summarizeSales(scopedOrders, movements, inventory),
    [scopedOrders, movements, inventory]
  );

  const stock = useMemo(() => summarizeStock(scopedInventory, sales), [scopedInventory, sales]);

  /** Quantity sold per product name, for the menu tab and the menu export. */
  const soldByName = useMemo(() => {
    const totals = new Map<string, number>();
    for (const order of scopedOrders.filter(isPaid)) {
      for (const line of orderLines(order)) {
        totals.set(line.name, (totals.get(line.name) ?? 0) + line.quantity);
      }
    }
    return totals;
  }, [scopedOrders]);

  const availableCount = scopedMenuItems.filter((item) => toNum(item.available) === 1).length;

  if (!token) {
    return <LoginScreen onAuthenticated={setToken} />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-titles">
          <div className="brand-row">
            <h1>لوحة تحكم المدير العام</h1>
            <span className={`live-pill${settings.autoRefresh ? '' : ' is-paused'}`}>
              <span className="live-dot" aria-hidden="true" />
              {settings.autoRefresh ? 'مباشر' : 'التحديث موقوف'}
            </span>
          </div>
          <p>مراقبة إيرادات ومبيعات كافة الفروع المتصلة بقاعدة البيانات المركزية</p>
        </div>

        <div className="topbar-actions">
          <select
            className="control"
            aria-label="الفرع"
            value={branch}
            onChange={(event) => {
              setBranch(event.target.value);
              rememberScope({ defaultBranch: event.target.value });
            }}
          >
            <option value={ALL_BRANCHES}>كل الفروع</option>
            {branches.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          <select
            className="control"
            aria-label="الفترة الزمنية"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as Period);
              rememberScope({ defaultPeriod: event.target.value as Period });
            }}
          >
            {PERIOD_ORDER.map((option) => (
              <option key={option} value={option}>
                {PERIOD_LABELS[option]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="control"
            onClick={() => updateSettings({ autoRefresh: !settings.autoRefresh })}
            title={settings.autoRefresh ? 'إيقاف التحديث التلقائي' : 'تشغيل التحديث التلقائي'}
            aria-pressed={settings.autoRefresh}
          >
            {settings.autoRefresh ? 'إيقاف التحديث' : 'تشغيل التحديث'}
          </button>

          <button
            type="button"
            className="control"
            onClick={() => token && loadData(token)}
            disabled={loading}
            title="تحديث الآن"
          >
            {loading ? 'جارٍ التحديث…' : 'تحديث'}
          </button>

          <button type="button" className="control primary" onClick={() => window.print()}>
            طباعة
          </button>

          <button type="button" className="control" onClick={signOut}>
            خروج
          </button>
        </div>
      </header>

      <nav className="tabbar" role="tablist" aria-label="أقسام اللوحة">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'tab is-active' : 'tab'}
            onClick={() => setTab(entry.id)}
          >
            <span className="tab-icon" aria-hidden="true">
              <Icon name={entry.icon} />
            </span>
            {entry.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="banner is-error" role="alert">
          تعذر الاتصال بقاعدة البيانات: {error}
        </p>
      )}

      <p className="scope-line">
        <span>
          {branch === ALL_BRANCHES ? 'كل الفروع' : branch} — {PERIOD_LABELS[period]}
        </span>
        <span className="muted">
          {lastUpdated
            ? `آخر تحديث ${formatTime(lastUpdated)} · ${formatCount(scopedOrders.length)} طلب`
            : 'لم يتم التحديث بعد'}
        </span>
      </p>

      {tab === 'analytics' && (
        <AnalyticsTab
          orders={scopedOrders}
          sales={sales}
          stock={stock}
          menuItemCount={scopedMenuItems.length}
          availableCount={availableCount}
          customerCount={scopedCustomers.length}
          newCustomerCount={newCustomerCount}
          periodLabel={PERIOD_LABELS[period]}
        />
      )}

      {tab === 'menu' && <MenuTab menuItems={scopedMenuItems} soldByName={soldByName} />}

      {tab === 'inventory' && <InventoryTab inventory={scopedInventory} stock={stock} />}

      {tab === 'customers' && (
        <CustomersTab
          customers={scopedCustomers}
          orders={scopedOrders.filter(isPaid)}
          newCustomerCount={newCustomerCount}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          settings={settings}
          onChange={updateSettings}
          onReset={resetSettings}
          branches={branches}
          branch={branch}
          period={period}
          lastUpdated={lastUpdated}
          activeTheme={activeTheme}
          onSignOut={signOut}
          scope={{
            orders: scopedOrders,
            menuItems: scopedMenuItems,
            inventory: scopedInventory,
            customers: scopedCustomers,
            soldByName,
          }}
        />
      )}

      <footer className="footer">
        <span className="muted">reporting.engaz.tech</span>
        <span className="muted">قاعدة بيانات مركزية · قراءة فقط</span>
      </footer>
    </div>
  );
}
