import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthError, clearSession, fetchSnapshot, readSession } from './api';
import { LoginScreen } from './LoginScreen';

interface Order {
  id: string;
  createdAt: string;
  branch_id: string | null;
  totalAmount: number | null;
  grandTotal: number | null;
  paidAmount: number | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  items: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  points: number | null;
  createdAt: string | null;
}

interface InventoryItem {
  id: string;
  name: string;
  stock: number | null;
  minStock: number | null;
  unit: string | null;
}

type Period = 'today' | 'week' | 'month' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'اليوم',
  week: 'آخر 7 أيام',
  month: 'آخر 30 يوم',
  all: 'الكل',
};

const CHART_DAYS = 7;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the till actually collected for an order.
 *
 * paidAmount is below grandTotal whenever loyalty points paid part of the bill, so revenue
 * must prefer it. totalAmount is the pre-snapshot fallback for older rows.
 */
function orderRevenue(order: Order): number {
  if (order.paidAmount !== null && order.paidAmount !== undefined) return toNum(order.paidAmount);
  if (order.grandTotal !== null && order.grandTotal !== undefined) return toNum(order.grandTotal);
  return toNum(order.totalAmount);
}

/** Unpaid orders are not revenue; they are a receivable. */
function isPaid(order: Order): boolean {
  return order.paymentStatus === 'Paid';
}

function inPeriod(dateStr: string, period: Period): boolean {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return period === 'all';
  if (period === 'all') return true;

  const now = new Date();
  const start = new Date(now);
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else if (period === 'week') start.setDate(now.getDate() - 7);
  else start.setMonth(now.getMonth() - 1);
  return d >= start;
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => readSession()?.token ?? null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    clearSession();
    setToken(null);
    setOrders([]);
    setCustomers([]);
    setInventory([]);
  }, []);

  const loadData = useCallback(async (activeToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchSnapshot(activeToken);
      setOrders(snapshot.orders as unknown as Order[]);
      setCustomers(snapshot.customers as unknown as Customer[]);
      setInventory(snapshot.inventory as unknown as InventoryItem[]);
    } catch (e) {
      // An expired token is not an error to display; it means signing in again.
      if (e instanceof AuthError) {
        signOut();
        return;
      }
      setError((e as Error).message || 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    if (token) loadData(token);
  }, [token, loadData]);

  const paidOrders = useMemo(() => orders.filter(isPaid), [orders]);

  const periodOrders = useMemo(
    () => paidOrders.filter((o) => inPeriod(o.createdAt, period)),
    [paidOrders, period]
  );

  const stats = useMemo(() => {
    const revenue = periodOrders.reduce((s, o) => s + orderRevenue(o), 0);
    const count = periodOrders.length;
    return { revenue, count, avg: count ? revenue / count : 0 };
  }, [periodOrders]);

  const bestSellers = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of periodOrders) {
      if (!o.items) continue;
      try {
        const arr = JSON.parse(o.items);
        if (!Array.isArray(arr)) continue;
        for (const it of arr) {
          const name = it?.name || it?.itemName;
          if (!name) continue;
          map.set(name, (map.get(name) || 0) + toNum(it?.quantity));
        }
      } catch {
        // A malformed items blob contributes nothing rather than breaking the whole list.
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [periodOrders]);

  const lowStock = useMemo(
    () => inventory.filter((i) => toNum(i.stock) <= toNum(i.minStock)).slice(0, 10),
    [inventory]
  );

  const topCustomers = useMemo(
    () => [...customers].sort((a, b) => toNum(b.points) - toNum(a.points)).slice(0, 10),
    [customers]
  );

  const chartData = useMemo(() => {
    const buckets: { label: string; total: number }[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({
        label: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
        total: paidOrders
          .filter((o) => (o.createdAt || '').slice(0, 10) === key)
          .reduce((s, o) => s + orderRevenue(o), 0),
      });
    }
    const max = Math.max(...buckets.map((b) => b.total), 1);
    return buckets.map((b) => ({ ...b, pct: (b.total / max) * 100 }));
  }, [paidOrders]);

  if (!token) {
    return <LoginScreen onAuthenticated={setToken} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Engaz Reports</h1>
          <p>تقارير المبيعات والتشغيل</p>
        </div>
        <div className="period-switch" role="group" aria-label="الفترة الزمنية">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              className={period === p ? 'active' : ''}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="banner error" role="alert">خطأ في الاتصال: {error}</div>}
      {loading && <div className="banner" role="status">جارٍ تحميل البيانات…</div>}

      <section className="stats-grid">
        <StatCard label="إجمالي المبيعات المحصلة" value={formatMoney(stats.revenue)} suffix="ج.م" accent="accent" />
        <StatCard label="عدد الطلبات المدفوعة" value={String(stats.count)} accent="accent-2" />
        <StatCard label="متوسط قيمة الطلب" value={formatMoney(stats.avg)} suffix="ج.م" accent="warn" />
        <StatCard label="العملاء" value={String(customers.length)} accent="danger" />
      </section>

      <div className="main-grid">
        <section className="card">
          <h2>المبيعات آخر 7 أيام</h2>
          <div className="chart">
            {chartData.map((b) => (
              <div className="chart-col" key={b.label} title={`${b.total.toFixed(2)} ج.م`}>
                <div className="bar" style={{ height: `${Math.max(b.pct, 2)}%` }} />
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>الأصناف الأكثر مبيعًا</h2>
          {bestSellers.length === 0 ? (
            <Empty text="لا توجد بيانات" />
          ) : (
            <ul className="rank-list">
              {bestSellers.map(([name, qty], i) => (
                <li key={name}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">{name}</span>
                  <span className="val">{qty} قطعة</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>تنبيهات المخزون</h2>
          {lowStock.length === 0 ? (
            <Empty text="لا توجد أصناف منخفضة المخزون" />
          ) : (
            <ul className="rank-list">
              {lowStock.map((i) => (
                <li key={i.id}>
                  <span className="name">{i.name}</span>
                  <span className="val warn">
                    {toNum(i.stock)} {i.unit || ''} / حد {toNum(i.minStock)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>أعلى العملاء نقاطًا</h2>
          {topCustomers.length === 0 ? (
            <Empty text="لا يوجد عملاء" />
          ) : (
            <ul className="rank-list">
              {topCustomers.map((c, i) => (
                <li key={c.id}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">{c.name}</span>
                  <span className="val">{toNum(c.points)} نقطة</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="footer">
        <button className="refresh" onClick={() => loadData(token)} disabled={loading}>
          {loading ? 'جارٍ التحديث…' : 'تحديث البيانات'}
        </button>
        <button className="refresh" onClick={signOut}>تسجيل الخروج</button>
        <span className="muted">reporting.engaz.tech</span>
      </footer>
    </div>
  );
}

function StatCard({ label, value, suffix, accent }: { label: string; value: string; suffix?: string; accent: string }) {
  return (
    <div className={`stat-card ${accent}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value} {suffix && <small>{suffix}</small>}
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
