/**
 * Portal analytics.
 *
 * Every figure here is derived from rows the point-of-sale mirrors to the reports database.
 * The portal holds no business logic beyond this file so the numbers can be tested without
 * a browser.
 *
 * Cost of goods is read from the stock ledger rather than recomputed from recipes: the ledger
 * records the quantity each order actually consumed, so a recipe edited after the sale cannot
 * retroactively change what that sale cost.
 */

export interface OrderRow {
  id: string;
  orderNumber: string | null;
  createdAt: string;
  branch_id: string | null;
  totalAmount: number | null;
  grandTotal: number | null;
  subtotal: number | null;
  taxAmount: number | null;
  paidAmount: number | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  customerPhone: string | null;
  items: string | null;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  points: number | null;
  createdAt: string | null;
  branch_id: string | null;
}

export interface InventoryRow {
  id: string;
  name: string;
  unit: string | null;
  stock: number | null;
  minStock: number | null;
  costPerUnit: number | null;
  branch_id: string | null;
}

export interface MenuItemRow {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  available: number | null;
  branch_id: string | null;
}

export interface StockMovementRow {
  id: string;
  itemId: string;
  type: string | null;
  quantity: number | null;
  referenceId: string | null;
  createdAt: string;
  branch_id: string | null;
}

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  year: 'هذه السنة',
  all: 'كل الفترات',
};

export const PERIOD_ORDER: Period[] = ['today', 'week', 'month', 'year', 'all'];

export const ALL_BRANCHES = 'all';

export function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the till collected for an order.
 *
 * `paidAmount` sits below `grandTotal` whenever loyalty points covered part of the bill, so
 * revenue must prefer it. The other two are fallbacks for rows written before those columns
 * existed.
 */
export function orderRevenue(order: OrderRow): number {
  if (order.paidAmount !== null && order.paidAmount !== undefined) return toNum(order.paidAmount);
  if (order.grandTotal !== null && order.grandTotal !== undefined) return toNum(order.grandTotal);
  return toNum(order.totalAmount);
}

/** What an order is billed at, before any loyalty discount. */
export function orderBilled(order: OrderRow): number {
  if (order.grandTotal !== null && order.grandTotal !== undefined) return toNum(order.grandTotal);
  return toNum(order.totalAmount);
}

export function isPaid(order: OrderRow): boolean {
  return order.paymentStatus === 'Paid';
}

/** Start of the window a period covers, or null when it covers everything. */
export function periodStart(period: Period, now = new Date()): Date | null {
  if (period === 'all') return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === 'month') start.setDate(start.getDate() - 29);
  else if (period === 'year') start.setMonth(0, 1);
  return start;
}

export function inPeriod(dateStr: string | null, period: Period, now = new Date()): boolean {
  if (period === 'all') return true;
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const start = periodStart(period, now);
  return start === null || date >= start;
}

export function inBranch(rowBranch: string | null, branch: string): boolean {
  if (branch === ALL_BRANCHES) return true;
  return (rowBranch || '') === branch;
}

export interface OrderLine {
  name: string;
  quantity: number;
  price: number;
}

/** Line items of an order; a malformed blob yields nothing rather than throwing. */
export function orderLines(order: OrderRow): OrderLine[] {
  if (!order.items) return [];
  try {
    const parsed = JSON.parse(order.items);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((line) => ({
        name: String(line?.name ?? line?.itemName ?? '').trim(),
        quantity: toNum(line?.quantity),
        price: toNum(line?.price),
      }))
      .filter((line) => line.name !== '');
  } catch {
    return [];
  }
}

export interface SalesTotals {
  /** Collected from paid orders, tax included. */
  revenue: number;
  /** Tax contained in that revenue. */
  tax: number;
  /** Raw material cost of what those orders consumed. */
  cogs: number;
  /** Revenue minus tax minus material cost. */
  netProfit: number;
  /** Billed but not yet collected, across unpaid orders. */
  outstanding: number;
  paidCount: number;
  unpaidCount: number;
  averageOrder: number;
  /** Net profit as a percentage of revenue; zero when there is no revenue. */
  marginPercent: number;
}

/**
 * Material cost of the orders in `orderIds`, from the stock ledger.
 *
 * An `OUT` row is stock consumed; an `IN` row against the same order is stock given back when
 * the order was cancelled. Netting them means a cancelled order contributes nothing, and the
 * result is floored at zero so a double-reversal cannot read as negative cost.
 */
export function costOfGoodsSold(
  movements: StockMovementRow[],
  inventory: InventoryRow[],
  orderIds: Set<string>
): number {
  const costById = new Map(inventory.map((item) => [item.id, toNum(item.costPerUnit)]));
  let total = 0;

  for (const movement of movements) {
    if (!movement.referenceId || !orderIds.has(movement.referenceId)) continue;
    const unitCost = costById.get(movement.itemId);
    if (unitCost === undefined) continue;

    const value = toNum(movement.quantity) * unitCost;
    if (movement.type === 'OUT') total += value;
    else if (movement.type === 'IN') total -= value;
  }

  return Math.max(total, 0);
}

export function summarizeSales(
  orders: OrderRow[],
  movements: StockMovementRow[],
  inventory: InventoryRow[]
): SalesTotals {
  const paid = orders.filter(isPaid);
  const unpaid = orders.filter((order) => !isPaid(order));

  const revenue = paid.reduce((sum, order) => sum + orderRevenue(order), 0);
  const tax = paid.reduce((sum, order) => sum + toNum(order.taxAmount), 0);
  const cogs = costOfGoodsSold(movements, inventory, new Set(paid.map((order) => order.id)));
  const outstanding = unpaid.reduce(
    (sum, order) => sum + Math.max(orderBilled(order) - toNum(order.paidAmount), 0),
    0
  );

  const netProfit = revenue - tax - cogs;
  return {
    revenue,
    tax,
    cogs,
    netProfit,
    outstanding,
    paidCount: paid.length,
    unpaidCount: unpaid.length,
    averageOrder: paid.length > 0 ? revenue / paid.length : 0,
    marginPercent: revenue > 0 ? (netProfit / revenue) * 100 : 0,
  };
}

export interface StockTotals {
  itemCount: number;
  lowStockCount: number;
  /** What the quantity on hand cost to buy. */
  costValue: number;
  /**
   * Profit the stock on hand is expected to yield, valued at the margin actually achieved in
   * the selected period. Null when that period sold nothing, because there is no observed
   * margin to apply and a guess would read as fact.
   */
  expectedProfit: number | null;
}

export function summarizeStock(inventory: InventoryRow[], sales: SalesTotals): StockTotals {
  let costValue = 0;
  let lowStockCount = 0;

  for (const item of inventory) {
    costValue += toNum(item.stock) * toNum(item.costPerUnit);
    if (toNum(item.stock) <= toNum(item.minStock)) lowStockCount++;
  }

  // Revenue per pound of material cost, from the period's own trading.
  const observedMultiple = sales.cogs > 0 ? (sales.revenue - sales.tax) / sales.cogs : null;

  return {
    itemCount: inventory.length,
    lowStockCount,
    costValue,
    expectedProfit: observedMultiple === null ? null : costValue * (observedMultiple - 1),
  };
}

export interface RankedItem {
  name: string;
  quantity: number;
  revenue: number;
}

export function bestSellers(orders: OrderRow[], limit = 8): RankedItem[] {
  const totals = new Map<string, RankedItem>();

  for (const order of orders) {
    for (const line of orderLines(order)) {
      const existing = totals.get(line.name);
      if (existing) {
        existing.quantity += line.quantity;
        existing.revenue += line.quantity * line.price;
      } else {
        totals.set(line.name, {
          name: line.name,
          quantity: line.quantity,
          revenue: line.quantity * line.price,
        });
      }
    }
  }

  return [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

export interface DayBucket {
  /** Calendar day, as an ISO date. */
  day: string;
  label: string;
  revenue: number;
  orders: number;
  /** Height relative to the tallest bar, as a percentage. */
  percent: number;
}

/** Revenue per day over the trailing `days`, oldest first. */
export function dailyRevenue(orders: OrderRow[], days = 7, now = new Date()): DayBucket[] {
  // Orders are stored as UTC timestamps, so the day each one belongs to has to be derived
  // from the parsed date. Slicing the ISO string instead would file a late-evening sale under
  // the next day for any positive offset, which is where the bars stopped matching the totals.
  const dayOf = new Map<string, { revenue: number; count: number }>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = toLocalDay(date);
    const bucket = dayOf.get(key);
    if (bucket) {
      bucket.revenue += orderRevenue(order);
      bucket.count++;
    } else {
      dayOf.set(key, { revenue: orderRevenue(order), count: 1 });
    }
  }

  const buckets: DayBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const day = toLocalDay(date);
    const totals = dayOf.get(day);
    buckets.push({
      day,
      label: date.toLocaleDateString('ar-EG', { weekday: 'short' }),
      revenue: totals?.revenue ?? 0,
      orders: totals?.count ?? 0,
      percent: 0,
    });
  }

  const peak = Math.max(...buckets.map((bucket) => bucket.revenue), 0);
  return buckets.map((bucket) => ({
    ...bucket,
    percent: peak > 0 ? (bucket.revenue / peak) * 100 : 0,
  }));
}

/** ISO date in local time; `toISOString` would shift the day for negative offsets. */
function toLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface BranchTotals {
  branch: string;
  revenue: number;
  orders: number;
}

/** Revenue per branch, busiest first, so one branch lagging is visible. */
export function revenueByBranch(orders: OrderRow[]): BranchTotals[] {
  const totals = new Map<string, BranchTotals>();

  for (const order of orders.filter(isPaid)) {
    const branch = order.branch_id || 'غير محدد';
    const existing = totals.get(branch);
    if (existing) {
      existing.revenue += orderRevenue(order);
      existing.orders++;
    } else {
      totals.set(branch, { branch, revenue: orderRevenue(order), orders: 1 });
    }
  }

  return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Branch ids present in any mirrored table, so the filter offers only real branches. */
export function branchOptions(
  orders: OrderRow[],
  inventory: InventoryRow[],
  customers: CustomerRow[]
): string[] {
  const ids = new Set<string>();
  for (const row of [...orders, ...inventory, ...customers]) {
    if (row.branch_id) ids.add(row.branch_id);
  }
  return [...ids].sort();
}

export function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Clock time for the "last read" line.
 *
 * Latin digits, matching every other figure the portal prints. An `ar-EG` time would render
 * Arabic-Indic digits, and next to a Latin count the two runs read as one number: the scope
 * line showed the time ending in `٠` beside `5 طلب` and was read as fifty orders.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
