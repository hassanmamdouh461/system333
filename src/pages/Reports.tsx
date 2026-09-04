import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Calendar, Download,
  CheckCircle2, Utensils,
  TrendingDown, AlertTriangle, Scale, Coins
} from 'lucide-react';
import { useAnalytics, AnalyticsPeriod } from '../hooks/useAnalytics';
import { useReportSupportData } from '../hooks/useReportSupportData';
import { StatCard } from '../components/ui/StatCard';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { RevenueAreaChart } from '../components/reports/RevenueAreaChart';
import { useLanguage } from '../context/LanguageContext';
import { orderRevenue, orderTotals, roundMoney } from '../utils/orderTotals';
import { computeItemYields, isLowStock, summarizeInventory } from '../utils/inventoryMath';
import {
  computeCogs,
  computeNetProfit,
  computeRecipeCosts,
  summarizeInvoices,
  summarizeOrderModes,
  summarizePaymentMethods,
} from '../utils/reportMath';

function periodLabel(p: AnalyticsPeriod, t: (k: string) => string) {
  const map: Record<AnalyticsPeriod, string> = {
    'Today': 'today', 'This Week': 'this week', 'This Month': 'this month', 'This Year': 'this year',
  };
  return t(map[p]);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Reports() {
  const { t } = useLanguage();
  const [dateRange, setDateRange] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem('reports_date_range');
    return (saved as AnalyticsPeriod) || 'This Week';
  });

  const handleDateRangeChange = (value: AnalyticsPeriod) => {
    setDateRange(value);
    localStorage.setItem('reports_date_range', value);
  };

  const {
    inventory,
    recipes,
    menuItems,
    loading: auxLoading,
    error: auxError,
  } = useReportSupportData();

  const itemYields = useMemo(
    () => computeItemYields(inventory, recipes, menuItems),
    [inventory, recipes, menuItems]
  );

  const inventoryValuation = useMemo(
    () => summarizeInventory(inventory, itemYields),
    [inventory, itemYields]
  );

  // Single hook call — all computation happens inside useAnalytics.
  // When dateRange = 'Today', every stat equals Dashboard's values exactly.
  const analytics = useAnalytics(dateRange);

  const recipeCosts = useMemo(
    () => computeRecipeCosts(recipes, inventory),
    [recipes, inventory]
  );

  const cogs = useMemo(
    () => computeCogs(analytics.completedPeriod, recipeCosts),
    [analytics.completedPeriod, recipeCosts]
  );

  const periodTax = useMemo(
    () => roundMoney(analytics.completedPeriod.reduce((sum, o) => sum + orderTotals(o).taxAmount, 0)),
    [analytics.completedPeriod]
  );

  const netProfit = useMemo(
    () => computeNetProfit(analytics.totalRevenue, periodTax, cogs),
    [analytics.totalRevenue, periodTax, cogs]
  );

  const lowStockItems = useMemo(
    () => inventory.filter(isLowStock),
    [inventory]
  );

  const invoiceStats = useMemo(
    () => summarizeInvoices(analytics.periodOrders),
    [analytics.periodOrders]
  );

  const paymentMethodStats = useMemo(
    () => summarizePaymentMethods(analytics.completedPeriod),
    [analytics.completedPeriod]
  );

  const orderModeStats = useMemo(
    () => summarizeOrderModes(analytics.periodOrders),
    [analytics.periodOrders]
  );

  // Loading and error states render only after every hook has run: returning early above
  if (analytics.loading || auxLoading) {
    return <LoadingScreen message="جاري تحميل التقارير والإحصائيات..." subMessage="يتم تجميع المبيعات وحساب التكاليف..." />;
  }
  if (analytics.error || auxError) {
    const shown = analytics.error ?? auxError;
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load reports')}</p>
          <p className="text-gray-500 text-sm">{shown?.message}</p>
        </div>
      </div>
    );
  }

  const { chartData, topItems, recentTransactions } = analytics;
  const pLabel       = periodLabel(dateRange, t);
  const maxSale      = Math.max(...chartData.map(d => d.value), 1);
  const maxItemCount = Math.max(...topItems.map(i => i.count), 1);

  const currencyStr = 'ج.م';

  const statCards = [
    {
      label: t('TOTAL REVENUE (INCL. TAX)'),
      value: `${analytics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: DollarSign,
      trend: `${analytics.paidOrders} ${t('completed')} ${pLabel}`,
      color: 'green',
    },
    {
      label: t('TOTAL ORDERS'),
      value: analytics.totalOrders.toLocaleString(),
      icon: ShoppingBag,
      trend: `${analytics.openOrders} ${t('Open')}`,
      color: 'blue',
    },
    {
      label: t('AVG. ORDER VALUE'),
      value: `${analytics.avgOrderValue.toFixed(2)} ${currencyStr}`,
      icon: TrendingUp,
      trend: `${analytics.paidOrders} ${t('completed')} ${pLabel}`,
      color: 'orange',
    },
    {
      label: t('MENU ITEMS'),
      value: analytics.menuItemsCount.toString(),
      icon: Utensils,
      trend: `${analytics.availableMenuItemsCount} ${t('available now')}`,
      color: 'purple',
    },
  ];

  return (
    <div className="space-y-4 md:space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Reports & Analytics')}</h1>
          <p className="text-xs md:text-base text-gray-500">{t('Track your cafe performance and growth.')}</p>
        </div>
        <div className="flex gap-2 md:gap-3">
          <div className="relative flex-1 md:flex-initial">
            <Calendar className={"absolute top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5 md:w-4 md:h-4 right-3"} />
            <select
              aria-label={t('Reports & Analytics')}
              value={dateRange}
              onChange={e => handleDateRangeChange(e.target.value as AnalyticsPeriod)}
              className={"w-full py-2 bg-white border border-gray-200 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-caramel pr-8 md:pr-9 pl-3 md:pl-4"}
            >
              <option value="Today">{t('Today')}</option>
              <option value="This Week">{t('This Week')}</option>
              <option value="This Month">{t('This Month')}</option>
              <option value="This Year">{t('This Year')}</option>
            </select>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-gray-900 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-black transition-colors"
          >
            <Download size={14} className="md:w-4 md:h-4" />
            <span className="hidden sm:inline">{t('Export')}</span>
          </button>
        </div>
      </div>

      {/* ── Stat Cards (same StatCard component as Dashboard) ──────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6">
        {statCards.map((s, i) => <StatCard key={i} {...s} />)}
      </div>

      {/* ── Cost & Profit Cards Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6">
        <StatCard
          label={t('Cost of Goods Sold (COGS)')}
          value={`${cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={TrendingDown}
          trend={t('Recipe materials cost')}
          color="orange"
        />
        <StatCard
          label={t('Net Profit')}
          value={`${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={Coins}
          trend={t('Earnings after COGS & tax')}
          color="green"
        />
        <StatCard
          label={t('Total Stock Cost')}
          value={`${inventoryValuation.totalCostValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={Scale}
          trend={t('Cost value of remaining stock')}
          color="blue"
        />
        <StatCard
          label={t('Expected Potential Profit')}
          value={`${inventoryValuation.totalPotentialProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={TrendingUp}
          trend={t('Potential profit of remaining stock')}
          color="purple"
        />
      </div>

      {/* ── Low Stock Alerts banner ────────────────────────────────────────── */}
      {lowStockItems.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-900 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="bg-red-100 text-red-600 p-2 rounded-xl">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t('Low Stock Alerts')}</h3>
              <p className="text-xs text-red-700">
                {lowStockItems.map(i => `${t(i.name)} (${i.stock.toFixed(2)} ${t(i.unit)} remaining)`).join(', ')}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Revenue Trend + Top Items ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8 text-gray-900">

        {/* Revenue Smooth Area Chart */}
        <RevenueAreaChart
          data={chartData}
          maxSale={maxSale}
          totalRevenue={analytics.totalRevenue}
          currencyStr={currencyStr}
          periodLabel={pLabel}
          dateRange={dateRange}
        />

        {/* Top Selling Items */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-sm md:text-lg font-bold text-gray-900 mb-4 md:mb-6">{t('Top Selling Items')}</h2>
          {topItems.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')} {pLabel}</p>
          ) : (
            <div className="space-y-4 md:space-y-5">
              {topItems.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs md:text-sm">
                    <span className="font-medium text-gray-900">{t(item.name)}</span>
                    <span className="text-gray-500 shrink-0 ms-2">{item.count}x</span>
                  </div>
                  <div className="w-full h-2 bg-mocha-100 rounded-full overflow-hidden">
                    <motion.div
                      key={`${dateRange}-top-${idx}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.count / maxItemCount) * 100}%` }}
                      transition={{ duration: 0.9, delay: 0.2 + idx * 0.08 }}
                      className="h-full bg-caramel rounded-full"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400">{item.revenue.toFixed(2)} {currencyStr} {t('revenue')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Order Status Breakdown + Recent Transactions ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8 text-gray-900">

        {/* Sales by Order Mode */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <div className="mb-4 md:mb-6">
            <h2 className="text-sm md:text-lg font-bold text-gray-900">{t('Sales by Order Mode')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('Dine-in vs Takeaway orders in the selected period')}
            </p>
          </div>
          {orderModeStats.total === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')}</p>
          ) : (
            <div className="space-y-6 md:space-y-8 py-2">
              {/* Takeaway Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🎒</span>
                    <span className="font-semibold text-gray-800">{t('Takeaway')}</span>
                  </div>
                  <span className="font-bold text-mocha-700 tabular-nums">
                    {orderModeStats.takeaway} {t('orders')} ({Math.round((orderModeStats.takeaway / orderModeStats.total) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-mocha-50 rounded-full overflow-hidden border border-mocha-100/50">
                  <motion.div
                    key={`takeaway-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(orderModeStats.takeaway / orderModeStats.total) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-mocha-600 rounded-full"
                  />
                </div>
              </div>

              {/* Dine-in Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">☕</span>
                    <span className="font-semibold text-gray-800">{t('Dine-in')}</span>
                  </div>
                  <span className="font-bold text-caramel-600 tabular-nums">
                    {orderModeStats.dineIn} {t('orders')} ({Math.round((orderModeStats.dineIn / orderModeStats.total) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-caramel-50/50 rounded-full overflow-hidden border border-caramel-100/30">
                  <motion.div
                    key={`dinein-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(orderModeStats.dineIn / orderModeStats.total) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-caramel rounded-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Payment Status */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <div className="mb-4 md:mb-6">
            <h2 className="text-sm md:text-lg font-bold text-gray-900 text-start">{t('Invoice Payment Status')}</h2>
            <p className="text-xs text-gray-400 mt-0.5 text-start">
              {t('Paid vs Open invoices breakdown')}
            </p>
          </div>
          {invoiceStats.totalCount === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')}</p>
          ) : (
            <div className="space-y-6 md:space-y-8 py-2">
              {/* Paid Invoices Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">✅</span>
                    <span className="font-semibold text-gray-800">{t('Paid Invoices')}</span>
                  </div>
                  <span className="font-bold text-green-700 tabular-nums">
                    {invoiceStats.paidCount} ({Math.round((invoiceStats.paidCount / invoiceStats.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-green-50 rounded-full overflow-hidden border border-green-100/50">
                  <motion.div
                    key={`paid-invoices-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(invoiceStats.paidCount / invoiceStats.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-green-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-start">
                  {t('Total Paid')}: {invoiceStats.paidAmount.toFixed(2)} ج.م
                </p>
              </div>

              {/* Open Invoices Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">⏳</span>
                    <span className="font-semibold text-gray-800">{t('Open Invoices')}</span>
                  </div>
                  <span className="font-bold text-amber-600 tabular-nums">
                    {invoiceStats.openCount} ({Math.round((invoiceStats.openCount / invoiceStats.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-amber-50 rounded-full overflow-hidden border border-amber-100/30">
                  <motion.div
                    key={`open-invoices-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(invoiceStats.openCount / invoiceStats.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-start">
                  {t('Total Open')}: {invoiceStats.openAmount.toFixed(2)} ج.م
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100 my-4 pt-4" />

              <div className="mb-3">
                <h3 className="text-xs md:text-sm font-bold text-gray-800 text-start">{t('Payment Methods')}</h3>
                <p className="text-[10px] text-gray-400 text-start">
                  {t('Breakdown of paid revenue')}
                </p>
              </div>

              {/* Cash Revenue Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💵</span>
                    <span className="font-semibold text-gray-800">{t('Cash')}</span>
                  </div>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {paymentMethodStats.cashPercentage}%
                  </span>
                </div>
                <div className="w-full h-3 bg-emerald-50 rounded-full overflow-hidden border border-emerald-100/50">
                  <motion.div
                    key={`cash-rev-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${paymentMethodStats.cashPercentage}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-emerald-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-start">
                  {t('Total Cash')}: {paymentMethodStats.cashAmount.toFixed(2)} ج.م
                </p>
              </div>

              {/* Card Revenue Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💳</span>
                    <span className="font-semibold text-gray-800">{t('Card')}</span>
                  </div>
                  <span className="font-bold text-blue-700 tabular-nums">
                    {paymentMethodStats.cardPercentage}%
                  </span>
                </div>
                <div className="w-full h-3 bg-blue-50 rounded-full overflow-hidden border border-blue-100/50">
                  <motion.div
                    key={`card-rev-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${paymentMethodStats.cardPercentage}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-blue-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-start">
                  {t('Total Card')}: {paymentMethodStats.cardAmount.toFixed(2)} ج.م
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-sm md:text-lg font-bold text-gray-900 mb-4 md:mb-6">{t('Recent Transactions')}</h2>
          {recentTransactions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No completed orders')} {pLabel}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentTransactions.map((order, idx) => {
                const elapsed = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
                const timeStr = elapsed < 1 ? t('just now') : elapsed < 60 ? `${elapsed}${t('m ago')}` : `${Math.round(elapsed / 60)}${t('h ago')}`;
                const summary = order.items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                const more    = order.items.length > 2 ? ` +${order.items.length - 2}` : '';
                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between py-2.5 md:py-3 gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 bg-green-50 text-green-600 rounded-lg shrink-0">
                        <CheckCircle2 size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs md:text-sm font-semibold text-gray-900 truncate text-start">
                          #{order.orderNumber} · {order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? t(order.tableId) : `${t('Table')} ${order.tableId}`}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate text-start">{summary}{more}</p>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-xs md:text-sm font-bold text-gray-900">{orderRevenue(order).toFixed(2)} ج.م</p>
                      <p className="text-[11px] text-gray-400">{timeStr}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
