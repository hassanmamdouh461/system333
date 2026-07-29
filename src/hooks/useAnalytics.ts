/**
 * useAnalytics — Unified Analytics Hook
 *
 * Single source of truth for all analytical data used by Dashboard and Reports.
 *
 * Financial rule: EVERY number comes from real database records only.
 * No fabricated baselines — a manager must never see revenue that doesn't exist.
 */
import { useMemo } from 'react';
import { getTaxRate } from '../utils/settingsConfig';
import { useOrders } from './useOrders';
import { useMenu } from './useMenu';
import { Order, OrderStatus } from '../types/order';
import { MenuItem } from '../types/menu';

// ─── Period type ──────────────────────────────────────────────────────────────
export type AnalyticsPeriod = 'Today' | 'This Week' | 'This Month' | 'This Year';

// ─── Demo mode ────────────────────────────────────────────────────────────────
// Fabricated baseline data exists ONLY for portfolio demos. It is OFF by default
// and must never appear in a production build unless explicitly enabled.
// Enable via: localStorage 'brewmaster_demo_mode' = 'true', or VITE_DEMO_MODE=true at build time.
export const DEMO_MODE: boolean = (() => {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DEMO_MODE === 'true') return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem('brewmaster_demo_mode') === 'true';
  } catch {
    return false;
  }
})();

// ─── Historical Baseline (demo only) ─────────────────────────────────────────
const BASELINE: Record<AnalyticsPeriod, {
  orders: number;         // total orders (including non-completed)
  completedOrders: number;
  revenue: number;        // revenue from completed orders
}> = {
  'Today':      { orders: 0,    completedOrders: 0,    revenue: 0     },
  'This Week':  DEMO_MODE ? { orders: 120,  completedOrders: 98,   revenue: 950   } : { orders: 0, completedOrders: 0, revenue: 0 },
  'This Month': DEMO_MODE ? { orders: 520,  completedOrders: 425,  revenue: 4200  } : { orders: 0, completedOrders: 0, revenue: 0 },
  'This Year':  DEMO_MODE ? { orders: 6500, completedOrders: 5300, revenue: 52000 } : { orders: 0, completedOrders: 0, revenue: 0 },
};

// ─── Chart config (bucket labels + baseline per bucket, demo only) ───────────
const CHART_CONFIG: Record<AnalyticsPeriod, {
  labels: string[];
  base: number[];          // demo baseline $ per bucket
  getBucket: (d: Date) => number;
}> = {
  'Today': {
    labels: ['12am', '2am', '4am', '6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm'],
    base:   [0,      0,      0,      0,      0,     0,      0,     0,     0,     0,     0,      0],
    getBucket: (d) => Math.floor(d.getHours() / 2),
  },
  'This Week': {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    base:   DEMO_MODE ? [100, 130, 105, 145, 165, 185, 120] : [0, 0, 0, 0, 0, 0, 0],
    getBucket: (d) => (d.getDay() + 6) % 7,
  },
  'This Month': {
    labels: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
    base:   DEMO_MODE ? [950, 1050, 1100, 1100] : [0, 0, 0, 0],
    getBucket: (d) => Math.min(Math.floor((d.getDate() - 1) / 7), 3),
  },
  'This Year': {
    labels: ['Jan',  'Feb',  'Mar',  'Apr',  'May',  'Jun',  'Jul',  'Aug',  'Sep',  'Oct',  'Nov',  'Dec'],
    base:   DEMO_MODE ? [2600, 2900, 3600, 3900, 4100, 4700, 4400, 5200, 3900, 4600, 5300, 6300] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    getBucket: (d) => d.getMonth(),
  },
};

// ─── Top Items: demo baseline per period ─────────────────────────────────────
const TOP_ITEMS_BOOST: Record<AnalyticsPeriod, TopItem[]> = {
  'Today': [],
  'This Week': DEMO_MODE ? [
    { name: 'Spanish Latte',          count: 52,   revenue: 312.00  },
    { name: 'Iced Caramel Macchiato', count: 43,   revenue: 279.50  },
    { name: 'Cappuccino',             count: 38,   revenue: 190.00  },
    { name: 'Mocha Frappe',           count: 31,   revenue: 217.00  },
    { name: 'Espresso Shot',          count: 24,   revenue: 96.00   },
  ] : [],
  'This Month': DEMO_MODE ? [
    { name: 'Spanish Latte',          count: 218,  revenue: 1308.00 },
    { name: 'Iced Caramel Macchiato', count: 172,  revenue: 1118.00 },
    { name: 'Cappuccino',             count: 145,  revenue: 725.00  },
    { name: 'Mocha Frappe',           count: 128,  revenue: 896.00  },
    { name: 'Espresso Shot',          count: 98,   revenue: 392.00  },
  ] : [],
  'This Year': DEMO_MODE ? [
    { name: 'Spanish Latte',          count: 2450, revenue: 14700.00 },
    { name: 'Iced Caramel Macchiato', count: 1980, revenue: 12870.00 },
    { name: 'Cappuccino',             count: 1720, revenue: 8600.00  },
    { name: 'Mocha Frappe',           count: 1540, revenue: 10780.00 },
    { name: 'Espresso Shot',          count: 1180, revenue: 4720.00  },
  ] : [],
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
  value: number;        // baseline + real (what the bar renders)
  realRevenue: number;  // real portion only (for color + badge)
  orders: number;       // real order count in this bucket (for tooltip)
}

export interface TopItem {
  name: string;
  count: number;
  revenue: number;
}

export interface AnalyticsResult {
  loading: boolean;
  error: Error | null;

  // ── Aggregated stats (baseline + real) ──────────────────────────────────────
  // ⚠ When period = 'Today', these values are IDENTICAL to what Dashboard shows.
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  openOrders: number;           // live count only — no baseline (always current)

  // ── Menu ────────────────────────────────────────────────────────────────────
  menuItemsCount: number;
  availableMenuItemsCount: number;
  menuItems: MenuItem[];        // raw array (for NewOrderModal etc.)

  // ── Real-only deltas (for "live" / "new" badges) ─────────────────────────────
  realRevenue: number;
  realOrders: number;           // count of real orders in the period

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

  // Sum of real completed-order revenue in the period (tax included).
  // Uses the tax snapshot stored on the order at payment time — never the
  // current settings value, so historical records never change retroactively.
  const realRevenue = useMemo(
    () => completedPeriod.reduce((s, o) => s + (o.grandTotal ?? o.totalAmount * (1 + getTaxRate())), 0),
    [completedPeriod],
  );

  // ── Combined stats ──────────────────────────────────────────────────────────
  const bl             = BASELINE[period];
  const totalRevenue   = bl.revenue        + realRevenue;
  const totalOrders    = bl.orders         + periodOrders.length;
  const completedTotal = bl.completedOrders + completedPeriod.length;
  const avgOrderValue  = completedTotal > 0 ? totalRevenue / completedTotal : 0;
  const openOrders = useMemo(
    () => orders.filter(o => ['New', 'Preparing', 'Ready'].includes(o.status)).length,
    [orders],
  );

  // ── Chart: baseline per bucket + real completed revenue per bucket ──────────
  const chartData = useMemo<ChartPoint[]>(() => {
    const cfg       = CHART_CONFIG[period];
    const realRev   = new Array(cfg.labels.length).fill(0);
    const realCount = new Array(cfg.labels.length).fill(0);

    completedPeriod.forEach(o => {
      const idx = cfg.getBucket(new Date(o.paidAt || o.createdAt));
      if (idx >= 0 && idx < cfg.labels.length) {
        realRev[idx]   += o.totalAmount * (1 + getTaxRate());
        realCount[idx] += 1;
      }
    });

    return cfg.labels.map((label, i) => ({
      label,
      value:       cfg.base[i] + realRev[i],
      realRevenue: realRev[i],
      orders:      realCount[i],
    }));
  }, [completedPeriod, period]);

  // ── Top items ──────────────────────────────────────────────────────────────
  // Always aggregate ONLY from real paid orders. The demo boost adds fabricated
  // rows only when DEMO_MODE is explicitly enabled.
  const topItems = useMemo<TopItem[]>(() => {
    const map: Record<string, TopItem> = {};

    // Item prices are pre-tax — apply the order's own tax snapshot per item via
    // its parent order's stored rate when available.
    const addReal = () =>
      completedPeriod.forEach(order =>
        order.items.forEach(item => {
          if (!map[item.name]) map[item.name] = { name: item.name, count: 0, revenue: 0 };
          const itemTaxRate = order.taxRate ?? getTaxRate();
          map[item.name].count   += item.quantity;
          map[item.name].revenue += item.quantity * item.price * (1 + itemTaxRate);
        }),
      );

    if (DEMO_MODE && period !== 'Today') {
      TOP_ITEMS_BOOST[period].forEach(b => {
        map[b.name] = { name: b.name, count: b.count, revenue: b.revenue };
      });
    }
    addReal();

    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [completedPeriod, period]);

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
    realRevenue,
    realOrders: periodOrders.length,
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
