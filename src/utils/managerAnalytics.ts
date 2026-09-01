import type { OrderItem } from '../types/order';
import { lineItemTotal, orderRevenue, roundMoney } from './orderTotals';
import { ManagerCustomerRow, ManagerOrderRow } from '../services/managerDataService';

export type AnalyticsPeriod = 'Today' | 'This Week' | 'This Month' | 'This Year';

export interface ChartPoint {
  label: string;
  value: number;
  orders: number;
}

export interface TopItem {
  name: string;
  count: number;
  revenue: number;
}

export const BRANCHES = [
  { id: 'all', labelAr: 'كل الفروع', labelEn: 'All Branches' },
  { id: 'branch_1', labelAr: 'فرع 1 (المعادي)', labelEn: 'Branch 1 (Maadi)' },
  { id: 'branch_2', labelAr: 'فرع 2 (مصر الجديدة)', labelEn: 'Branch 2 (Heliopolis)' },
  { id: 'branch_3', labelAr: 'فرع 3 (الزمالك)', labelEn: 'Branch 3 (Zamalek)' },
];

export const CHART_CONFIG: Record<AnalyticsPeriod, {
  labelsAr: string[];
  labelsEn: string[];
  getBucket: (d: Date) => number;
}> = {
  'Today': {
    labelsAr: ['١٢ص', '٢ص', '٤ص', '٦ص', '٨ص', '١٠ص', '١٢م', '٢م', '٤م', '٦م', '٨م', '١٠م'],
    labelsEn: ['12am', '2am', '4am', '6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm'],
    getBucket: (d) => Math.floor(d.getHours() / 2),
  },
  'This Week': {
    labelsAr: ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
    labelsEn: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    getBucket: (d) => (d.getDay() + 6) % 7,
  },
  'This Month': {
    labelsAr: ['الأسبوع ١', 'الأسبوع ٢', 'الأسبوع ٣', 'الأسبوع ٤'],
    labelsEn: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
    getBucket: (d) => Math.min(Math.floor((d.getDate() - 1) / 7), 3),
  },
  'This Year': {
    labelsAr: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    labelsEn: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    getBucket: (d) => d.getMonth(),
  },
};

export function inPeriod(dateStr: string, period: AnalyticsPeriod): boolean {
  const d = new Date(dateStr);
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

export function matchesBranch(branchId: string | undefined, selectedBranch: string): boolean {
  return selectedBranch === 'all' || branchId === selectedBranch;
}

/** Order items are stored as a JSON string; a malformed row yields no items, not a crash. */
export function parseOrderItems(raw: string): OrderItem[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[ManagerDashboard] Failed to parse order items JSON:', e);
    return [];
  }
}

export interface ManagerAnalytics {
  totalRevenue: number;
  avgOrderValue: number;
  chartData: ChartPoint[];
  topItems: TopItem[];
  takeawayCount: number;
  dineInCount: number;
  totalCount: number;
  paidCount: number;
  unpaidCount: number;
  paidAmount: number;
  unpaidAmount: number;
  cashAmount: number;
  cardAmount: number;
  cashPercentage: number;
  cardPercentage: number;
  recentTransactions: ManagerOrderRow[];
  loyaltyCount: number;
  loyaltyPoints: number;
  /** Points redeem one-for-one, so the liability equals the point balance. */
  loyaltyValue: number;
}

export interface ManagerAnalyticsInput {
  orders: ManagerOrderRow[];
  customers: ManagerCustomerRow[];
  selectedBranch: string;
  period: AnalyticsPeriod;
  language: 'ar' | 'en';
  taxRate: number;
}

/**
 * Everything the analytics tab shows, derived from the central order rows for one branch
 * and one period. Money comes from each order's stored snapshot; the tax rate is only a
 * fallback for rows written before the snapshot columns existed.
 */
export function computeManagerAnalytics({
  orders,
  customers,
  selectedBranch,
  period,
  language,
  taxRate,
}: ManagerAnalyticsInput): ManagerAnalytics {
  const periodOrders = orders.filter(
    order => matchesBranch(order.branch_id, selectedBranch) && inPeriod(order.$createdAt, period)
  );

  const paidOrders = periodOrders.filter(order => order.paymentStatus !== 'Unpaid');
  const unpaidOrders = periodOrders.filter(order => order.paymentStatus === 'Unpaid');

  const paidAmount = roundMoney(
    paidOrders.reduce((sum, order) => sum + orderRevenue(order, taxRate), 0)
  );
  const unpaidAmount = roundMoney(
    unpaidOrders.reduce((sum, order) => sum + orderRevenue(order, taxRate), 0)
  );

  const cfg = CHART_CONFIG[period];
  const labels = language === 'ar' ? cfg.labelsAr : cfg.labelsEn;
  const bucketRevenue = new Array(labels.length).fill(0);
  const bucketCounts = new Array(labels.length).fill(0);

  for (const order of paidOrders) {
    const idx = cfg.getBucket(new Date(order.$createdAt));
    if (idx >= 0 && idx < labels.length) {
      bucketRevenue[idx] += orderRevenue(order, taxRate);
      bucketCounts[idx] += 1;
    }
  }

  const chartData: ChartPoint[] = labels.map((label, idx) => ({
    label,
    value: roundMoney(bucketRevenue[idx]),
    orders: bucketCounts[idx],
  }));

  const topItemMap: Record<string, TopItem> = {};
  for (const order of paidOrders) {
    for (const item of parseOrderItems(order.items)) {
      if (!topItemMap[item.name]) {
        topItemMap[item.name] = { name: item.name, count: 0, revenue: 0 };
      }
      topItemMap[item.name].count += item.quantity;
      topItemMap[item.name].revenue += lineItemTotal(item, order, taxRate);
    }
  }
  const topItems = Object.values(topItemMap).sort((a, b) => b.count - a.count).slice(0, 5);

  // tableId travels with the row from both the desktop and browser paths, so the mode is
  // read rather than guessed. Rows without one are excluded instead of being assigned to
  // whichever side happens to be the default.
  let takeawayCount = 0;
  let dineInCount = 0;
  let unknownModeCount = 0;
  for (const order of periodOrders) {
    if (!order.tableId) unknownModeCount++;
    else if (order.tableId === 'Takeaway') takeawayCount++;
    else dineInCount++;
  }
  if (unknownModeCount > 0) {
    console.warn(`[ManagerDashboard] ${unknownModeCount} order(s) have no tableId; excluded from the dine-in/takeaway split.`);
  }

  let cashAmount = 0;
  let cardAmount = 0;
  for (const order of paidOrders) {
    const amount = orderRevenue(order, taxRate);
    if (order.payment_method?.toLowerCase() === 'card') cardAmount += amount;
    else cashAmount += amount;
  }
  cashAmount = roundMoney(cashAmount);
  cardAmount = roundMoney(cardAmount);
  const totalPaid = cashAmount + cardAmount;

  const recentTransactions = [...paidOrders]
    .sort((a, b) => new Date(b.$createdAt).getTime() - new Date(a.$createdAt).getTime())
    .slice(0, 5);

  const branchCustomers = customers.filter(c => matchesBranch(c.branchId, selectedBranch));
  const loyaltyPoints = branchCustomers.reduce((sum, c) => sum + (Number(c.points) || 0), 0);

  return {
    totalRevenue: paidAmount,
    avgOrderValue: paidOrders.length > 0 ? roundMoney(paidAmount / paidOrders.length) : 0,
    chartData,
    topItems,
    takeawayCount,
    dineInCount,
    totalCount: periodOrders.length,
    paidCount: paidOrders.length,
    unpaidCount: unpaidOrders.length,
    paidAmount,
    unpaidAmount,
    cashAmount,
    cardAmount,
    cashPercentage: totalPaid > 0 ? Math.round((cashAmount / totalPaid) * 100) : 0,
    cardPercentage: totalPaid > 0 ? Math.round((cardAmount / totalPaid) * 100) : 0,
    recentTransactions,
    loyaltyCount: branchCustomers.length,
    loyaltyPoints,
    loyaltyValue: loyaltyPoints,
  };
}
