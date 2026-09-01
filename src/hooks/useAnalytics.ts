/**
 * useAnalytics — Unified Analytics Hook
 *
 * Single source of truth for all analytical data used by Dashboard and Reports.
 *
 * Every figure here comes from live database records. There is deliberately no demo or
 * historical baseline: adding invented revenue to real revenue produced totals that no
 * invoice could account for, and the two were indistinguishable once summed.
 */
import { useMemo } from 'react';
import { orderRevenue, lineItemTotal, roundMoney } from '../utils/orderTotals';
import { useOrders } from './useOrders';
import { useMenu } from './useMenu';
import { Order, OrderStatus } from '../types/order';
import { MenuItem } from '../types/menu';

// ─── Period type ──────────────────────────────────────────────────────────────
export type AnalyticsPeriod = 'Today' | 'This Week' | 'This Month' | 'This Year';

// ─── Chart buckets ────────────────────────────────────────────────────────────
const CHART_CONFIG: Record<AnalyticsPeriod, {
  labels: string[];
  getBucket: (d: Date) => number;
}> = {
  'Today': {
    labels: ['12am', '2am', '4am', '6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm'],
    getBucket: (d) => Math.floor(d.getHours() / 2),
  },
  'This Week': {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    getBucket: (d) => (d.getDay() + 6) % 7,
  },
  'This Month': {
    labels: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
    getBucket: (d) => Math.min(Math.floor((d.getDate() - 1) / 7), 3),
  },
  'This Year': {
    labels: ['Jan',  'Feb',  'Mar',  'Apr',  'May',  'Jun',  'Jul',  'Aug',  'Sep',  'Oct',  'Nov',  'Dec'],
    getBucket: (d) => d.getMonth(),
  },
};

// ─── Period filter ────────────────────────────────────────────────────────────
function inPeriod(dateStr: string, period: AnalyticsPeriod): boolean {
  const d   = new Date(dateStr);
  const now = new Date();
  switch (period) {
    case 'Today':
      return d.toDateString() === now.toDateString();
    case 'This Week': {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      start.setHours(0, 0, 0, 0);
      return d >= start;
    }
    case 'This Month':
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    case 'This Year':
      return d.getFullYear() === now.getFullYear();
  }
}

// ─── Exported types ───────────────────────────────────────────────────────────
export interface ChartPoint {
  label: string;
  value: number;        // collected revenue in this bucket
  orders: number;       // paid order count in this bucket (for tooltip)
}

export interface TopItem {
  name: string;
  count: number;
  revenue: number;
}

export interface AnalyticsResult {
  loading: boolean;
  error: Error | null;

  // ── Aggregated stats, all from live records ─────────────────────────────────
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  openOrders: number;

  // ── Menu ────────────────────────────────────────────────────────────────────
  menuItemsCount: number;
  availableMenuItemsCount: number;
  menuItems: MenuItem[];        // raw array (for NewOrderModal etc.)

  // ── Counts in the selected period ───────────────────────────────────────────
  paidOrders: number;

  // ── Chart ───────────────────────────────────────────────────────────────────
  chartData: ChartPoint[];

  // ── Rankings ────────────────────────────────────────────────────────────────
  topItems: TopItem[];

  // ── Status breakdown (real only — it's a live metric) ───────────────────────
  statusBreakdown: Array<{ status: OrderStatus; count: number }>;
  allOrdersTotal: number;       // total ALL real orders (for % denominator in status section)
  // ── Activity / transaction feeds ────────────────────────────────────────────
  recentOrders: Order[];        // newest 5 all-time (Dashboard activity feed)
  recentTransactions: Order[];  // newest 5 completed in period (Reports page)

  // ── Raw period arrays (for components needing full access) ───────────────────
  periodOrders: Order[];
  completedPeriod: Order[];
  period: AnalyticsPeriod;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAnalytics(period: AnalyticsPeriod): AnalyticsResult {
  const { orders, loading: ordersLoading, error: ordersError } = useOrders();
  const { items: menuItems, loading: menuLoading, error: menuError } = useMenu();

  const loading = ordersLoading || menuLoading;
  const error   = ordersError ?? menuError ?? null;

  // All orders that fall inside the requested period
  const periodOrders = useMemo(
    () => (loading ? [] : orders.filter(o => inPeriod(o.createdAt, period))),
    [orders, period, loading],
  );

  // Only paid orders contribute to revenue (paymentStatus set exclusively by Payment.tsx)
  // Financial rule: filter completed orders by the date they were actually PAID (paidAt) rather than created.
  const completedPeriod = useMemo(
    () => orders.filter(o => o.paymentStatus === 'Paid' && inPeriod(o.paidAt || o.createdAt, period)),
    [orders, period],
  );

  // Revenue actually collected in the period. Orders created by the POS already store a
  // tax-inclusive grandTotal; only pre-snapshot rows get taxed here.
  const totalRevenue = useMemo(
    () => roundMoney(completedPeriod.reduce((s, o) => s + orderRevenue(o), 0)),
    [completedPeriod],
  );

  const totalOrders   = periodOrders.length;
  const paidOrders    = completedPeriod.length;
  const avgOrderValue = paidOrders > 0 ? roundMoney(totalRevenue / paidOrders) : 0;
  const openOrders = useMemo(
    () => orders.filter(o => ['New', 'Preparing', 'Ready'].includes(o.status)).length,
    [orders],
  );

  // ── Chart: collected revenue per bucket ─────────────────────────────────────
  const chartData = useMemo<ChartPoint[]>(() => {
    const cfg     = CHART_CONFIG[period];
    const revenue = new Array(cfg.labels.length).fill(0);
    const counts  = new Array(cfg.labels.length).fill(0);

    completedPeriod.forEach(o => {
      const idx = cfg.getBucket(new Date(o.paidAt || o.createdAt));
      if (idx >= 0 && idx < cfg.labels.length) {
        revenue[idx] += orderRevenue(o);
        counts[idx]  += 1;
      }
    });

    return cfg.labels.map((label, i) => ({
      label,
      value:  roundMoney(revenue[i]),
      orders: counts[i],
    }));
  }, [completedPeriod, period]);

  // ── Top items: aggregated from paid orders only ─────────────────────────────
  // Financial rule: an item is "sold" when its order is Paid — never before.
  const topItems = useMemo<TopItem[]>(() => {
    const map: Record<string, TopItem> = {};

    completedPeriod.forEach(order =>
      order.items.forEach(item => {
        if (!map[item.name]) map[item.name] = { name: item.name, count: 0, revenue: 0 };
        map[item.name].count   += item.quantity;
        map[item.name].revenue = roundMoney(map[item.name].revenue + lineItemTotal(item, order));
      }),
    );

    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [completedPeriod]);

  // ── Status breakdown: uses ALL real orders (live kitchen board view) ────────
  // Not period-filtered — represents the current operational state of the kitchen.
  // Percentages are calculated against orders.length, not a baseline total,
  // so they reflect the true split of work happening right now.
  const statusBreakdown = useMemo(
    () =>
      (['New', 'Preparing', 'Ready', 'Completed', 'Cancelled'] as OrderStatus[])
        .map(status => ({ status, count: orders.filter(o => o.status === status).length }))
        .filter(x => x.count > 0),
    [orders],
  );
  const allOrdersTotal = orders.length;

  // ── Activity feed: newest 5 of ALL orders (Dashboard live feed) ────────────
  const recentOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [orders],
  );

  // ── Transactions: newest 5 completed in period (Reports page) ─────────────
  const recentTransactions = useMemo(
    () =>
      [...completedPeriod]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [completedPeriod],
  );

  return {
    loading,
    error,
    totalRevenue,
    totalOrders,
    avgOrderValue,
    openOrders,
    menuItemsCount:          menuItems.length,
    availableMenuItemsCount: menuItems.filter(i => i.available).length,
    menuItems,
    paidOrders,
    chartData,
    topItems,
    statusBreakdown,
    allOrdersTotal,
    recentOrders,
    recentTransactions,
    periodOrders,
    completedPeriod,
    period,
  };
}
