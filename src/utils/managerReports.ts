import { ManagerCustomerRow, ManagerOrderRow } from '../services/managerDataService';
import {
  AnalyticsPeriod,
  BRANCHES,
  ManagerAnalytics,
  inPeriod,
  matchesBranch,
} from './managerAnalytics';
import { ManagerInventorySummary, ManagerStockRow, BRANCH_IDS } from './managerInventory';
import { orderRevenue } from './orderTotals';

/** Longest customer list a single Telegram message will carry. */
const CUSTOMER_LIST_LIMIT = 30;

const BRANCH_REPORT_NAMES: Record<string, { ar: string; en: string }> = {
  branch_1: { ar: 'فرع المعادي (فرع 1)', en: 'Maadi Branch (1)' },
  branch_2: { ar: 'فرع مصر الجديدة (فرع 2)', en: 'Heliopolis Branch (2)' },
  branch_3: { ar: 'فرع الزمالك (فرع 3)', en: 'Zamalek Branch (3)' },
  default: { ar: 'الفرع الرئيسي', en: 'Main Branch' },
};

const PERIOD_NAMES: Record<AnalyticsPeriod, { ar: string; en: string }> = {
  'Today': { ar: 'اليوم', en: 'Today' },
  'This Week': { ar: 'هذا الأسبوع', en: 'This Week' },
  'This Month': { ar: 'هذا الشهر', en: 'This Month' },
  'This Year': { ar: 'هذا العام', en: 'This Year' },
};

export type Lang = 'ar' | 'en';

function branchName(branchId: string, language: Lang): string {
  return BRANCH_REPORT_NAMES[branchId]?.[language] ?? branchId;
}

export function activeBranchName(selectedBranch: string, language: Lang): string {
  if (selectedBranch === 'all') return language === 'ar' ? 'كافة الفروع' : 'All Branches';
  return branchName(selectedBranch, language);
}

function money(value: number): string {
  return value.toFixed(2);
}

interface BranchTotals {
  totalOrders: number;
  totalRevenue: number;
  totalUnpaid: number;
  cash: number;
  card: number;
}

/** Per-branch breakdown, only meaningful when the report covers all branches. */
function branchBreakdown(
  orders: ManagerOrderRow[],
  period: AnalyticsPeriod,
  taxRate: number
): Record<string, BranchTotals> {
  const stats: Record<string, BranchTotals> = {};

  for (const order of orders) {
    if (!inPeriod(order.$createdAt, period)) continue;
    const branchId = order.branch_id || 'default';
    if (!stats[branchId]) {
      stats[branchId] = { totalOrders: 0, totalRevenue: 0, totalUnpaid: 0, cash: 0, card: 0 };
    }

    const entry = stats[branchId];
    entry.totalOrders += 1;
    const amount = orderRevenue(order, taxRate);

    if (order.paymentStatus === 'Unpaid') {
      entry.totalUnpaid += amount;
    } else {
      entry.totalRevenue += amount;
      if (order.payment_method?.toLowerCase() === 'card') entry.card += amount;
      else entry.cash += amount;
    }
  }

  return stats;
}

export interface SalesReportInput {
  analytics: ManagerAnalytics;
  orders: ManagerOrderRow[];
  selectedBranch: string;
  period: AnalyticsPeriod;
  language: Lang;
  taxRate: number;
  todayStr: string;
}

export function buildSalesReport({
  analytics,
  orders,
  selectedBranch,
  period,
  language,
  taxRate,
  todayStr,
}: SalesReportInput): string {
  const lines = [
    `📊 <b>تقرير مبيعات Engaz: ${activeBranchName(selectedBranch, language)}</b>`,
    `⏱️ الفئة/الفترة: <b>${PERIOD_NAMES[period][language]}</b> (بتاريخ: <code>${todayStr}</code>)`,
    '',
    '💰 <b>الملخص المالي للفترة:</b>',
    `• إجمالي المبيعات (المحصلة): <b>${money(analytics.totalRevenue)}</b> ج.م`,
    `• عدد الطلبات الكلي: <b>${analytics.totalCount}</b> طلب`,
    `• إجمالي الآجل: <b>${money(analytics.unpaidAmount)}</b> ج.م`,
    '',
    '💳 <b>تفاصيل طرق الدفع (المحصلة):</b>',
    `• نقدي (Cash): <b>${money(analytics.cashAmount)}</b> ج.م (${analytics.cashPercentage}%)`,
    `• شبكة/بطاقة (Card): <b>${money(analytics.cardAmount)}</b> ج.م (${analytics.cardPercentage}%)`,
    '',
    '🍽️ <b>أنواع الطلبات:</b>',
    `• سفري (Takeaway): <b>${analytics.takeawayCount}</b> طلب`,
    `• صالة (Dine-in): <b>${analytics.dineInCount}</b> طلب`,
    '',
  ];

  if (selectedBranch === 'all') {
    const stats = branchBreakdown(orders, period, taxRate);
    if (Object.keys(stats).length > 0) {
      lines.push('🏢 <b>تفاصيل الفروع المفرّقة:</b>');
      for (const [branchId, s] of Object.entries(stats)) {
        lines.push(
          `📍 <b>${branchName(branchId, language)}:</b>`,
          `• عدد الطلبات: <b>${s.totalOrders}</b>`,
          `• مبيعات محصلة: <b>${money(s.totalRevenue)}</b> ج.م`,
          `• مبيعات آجلة: <b>${money(s.totalUnpaid)}</b> ج.م`,
          `• كاش: <b>${money(s.cash)}</b> | شبكة: <b>${money(s.card)}</b>`,
          ''
        );
      }
    }
  }

  if (analytics.topItems.length > 0) {
    lines.push('☕ <b>أكثر الأصناف مبيعاً في هذه الفترة:</b>');
    for (const item of analytics.topItems) {
      lines.push(`• ${item.name}: عدد <b>${item.count}</b>`);
    }
    lines.push('');
  }

  lines.push('✅ تم تصدير التقرير من لوحة الإشراف المركزية');
  return lines.join('\n');
}

export interface InventoryReportInput {
  summary: ManagerInventorySummary;
  stockRows: ManagerStockRow[];
  selectedBranch: string;
  language: Lang;
  todayStr: string;
}

export function buildInventoryReport({
  summary,
  stockRows,
  selectedBranch,
  language,
  todayStr,
}: InventoryReportInput): string {
  const lines = [
    `📦 <b>تقرير حالة المخزون: ${activeBranchName(selectedBranch, language)}</b>`,
    `⏱️ التاريخ: <code>${todayStr}</code>`,
    '',
    '📊 <b>ملخص حالة المخزون للفترة:</b>',
    `• القيمة التقديرية للمخزون: <b>${summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> ج.م`,
    `• عدد المواد الخام المتابعة: <b>${summary.totalItems}</b> صنف`,
    `• تنبيهات نقص المخزون: <b>${summary.lowStockCount}</b> صنف`,
    '',
  ];

  if (selectedBranch === 'all') {
    lines.push('🏢 <b>الكميات المتبقية مقارنة بين الفروع:</b>');
    for (const row of stockRows) {
      const name = language === 'ar' ? row.nameAr : row.nameEn;
      const unit = language === 'ar' ? row.unitAr : row.unit;
      lines.push(`• <b>${name}:</b>`);
      for (const branchId of BRANCH_IDS) {
        const level = row.branches[branchId];
        if (!level) continue;
        const warning = level.isLow ? ' ⚠️ (نقص)' : '';
        lines.push(`  - ${branchName(branchId, language)}: <code>${level.remaining}</code> ${unit}${warning}`);
      }
    }
  } else {
    lines.push('📋 <b>تفاصيل كميات المواد الخام بالفرع:</b>');
    for (const row of stockRows) {
      const level = row.branches[selectedBranch];
      if (!level) continue;
      const name = language === 'ar' ? row.nameAr : row.nameEn;
      const unit = language === 'ar' ? row.unitAr : row.unit;
      const warning = level.isLow ? ' ⚠️ (نقص)' : '';
      lines.push(`• ${name}: <b>${level.remaining}</b> ${unit} (${level.percentage}%)${warning}`);
    }
  }

  lines.push('', '✅ تم تصدير تقرير المخزون من لوحة الإشراف المركزية');
  return lines.join('\n');
}

export interface CustomerReportInput {
  customers: ManagerCustomerRow[];
  selectedBranch: string;
  language: Lang;
  todayStr: string;
}

export function buildCustomerReport({
  customers,
  selectedBranch,
  language,
  todayStr,
}: CustomerReportInput): string {
  const totalPoints = customers.reduce((sum, c) => sum + (Number(c.points) || 0), 0);

  const lines = [
    `👥 <b>تقرير العملاء ونقاط الولاء: ${activeBranchName(selectedBranch, language)}</b>`,
    `⏱️ التاريخ: <code>${todayStr}</code>`,
    '',
    '📊 <b>إحصائيات ولاء العملاء:</b>',
    `• إجمالي العملاء المسجلين: <b>${customers.length}</b> عضو`,
    `• إجمالي نقاط الولاء الموزعة: <b>${totalPoints.toLocaleString()}</b> نقطة`,
    `• قيمة استرداد النقاط الكلية: <b>${totalPoints.toLocaleString()}</b> ج.م`,
    '',
  ];

  if (customers.length === 0) {
    lines.push('⚠️ لا يوجد عملاء مسجلين حالياً في هذا النطاق.', '');
  } else {
    lines.push(`📋 <b>قائمة العملاء المسجلين (أعلى ${CUSTOMER_LIST_LIMIT} نقاط):</b>`);
    const ranked = [...customers].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));

    for (const customer of ranked.slice(0, CUSTOMER_LIST_LIMIT)) {
      const branch = BRANCHES.find(b => b.id === customer.branchId);
      const label = (language === 'ar' ? branch?.labelAr : branch?.labelEn) || 'default';
      lines.push(`• ${customer.name || 'عميل'} (<code>${customer.phone}</code>): <b>${customer.points || 0}</b> نقطة [${label}]`);
    }

    if (customers.length > CUSTOMER_LIST_LIMIT) {
      lines.push(`• ... و <b>${customers.length - CUSTOMER_LIST_LIMIT}</b> عميل آخرين`);
    }
    lines.push('');
  }

  lines.push('✅ تم تصدير تقرير العملاء من لوحة الإشراف المركزية');
  return lines.join('\n');
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Reads the Telegram credentials the settings screen stored. Returns null when they are
 * absent or unusable so the caller can tell the user to configure them rather than
 * failing at send time.
 */
export function readTelegramConfig(): TelegramConfig | null {
  const raw = localStorage.getItem('engaz_telegram_config');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TelegramConfig>;
    if (!parsed.botToken || !parsed.chatId) return null;
    return { botToken: parsed.botToken, chatId: parsed.chatId };
  } catch (e) {
    console.error('[ManagerDashboard] Telegram config is not valid JSON:', e);
    return null;
  }
}

/** Sends an HTML-formatted message, throwing with the API's own description on failure. */
export async function sendTelegramMessage(
  { botToken, chatId }: TelegramConfig,
  message: string
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
}

/** Orders in the current branch and period, for callers that need the raw rows. */
export function scopedOrders(
  orders: ManagerOrderRow[],
  selectedBranch: string,
  period: AnalyticsPeriod
): ManagerOrderRow[] {
  return orders.filter(
    order => matchesBranch(order.branch_id, selectedBranch) && inPeriod(order.$createdAt, period)
  );
}
