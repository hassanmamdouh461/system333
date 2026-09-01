import {
  TrendingUp, DollarSign, ShoppingBag, Coffee, CheckCircle2,
  Utensils, Scale, Receipt, ShoppingBasket, Wallet, CreditCard, Banknote,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { StatCard } from '../ui/StatCard';
import { Card, SectionHeader, EmptyState, Meter } from '../ui/Card';
import { BRANCHES, ManagerAnalytics, AnalyticsPeriod, parseOrderItems } from '../../utils/managerAnalytics';
import { ManagerInventorySummary } from '../../utils/managerInventory';
import { MenuItem } from '../../types/menu';
import { orderRevenue } from '../../utils/orderTotals';
import { RevenueChart } from './RevenueChart';

interface AnalyticsTabProps {
  analytics: ManagerAnalytics;
  inventorySummary: ManagerInventorySummary;
  menuItems: MenuItem[];
  selectedBranch: string;
  /** Selected period, used to re-key the chart so its bars replay on a change. */
  period: AnalyticsPeriod;
  activeBranchLabel: string | undefined;
  /** Translated name of the selected period, e.g. "this week". */
  periodLabel: string;
  taxRate: number;
}

/** Percentage of a whole, safe when the whole is zero. */
function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function AnalyticsTab({
  analytics,
  inventorySummary,
  menuItems,
  selectedBranch,
  period,
  activeBranchLabel,
  periodLabel: pLabel,
  taxRate,
}: AnalyticsTabProps) {
  const { t, language, isRtl } = useLanguage();
  const currency = language === 'ar' ? 'ج.م' : 'EGP';
  const money = (n: number, decimals = 2) =>
    `${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`;

  const maxItemCount = Math.max(...analytics.topItems.map(i => i.count), 1);
  const availableCount = menuItems.filter(i => i.available).length;

  return (
    <div className="space-y-4 md:space-y-6">

      {/* ── Headline figures ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        <StatCard
          label={t('TOTAL REVENUE (INCL. TAX)')}
          value={money(analytics.totalRevenue)}
          icon={DollarSign}
          trend={`${t('Paid revenue')} · ${pLabel}`}
          color="green"
        />
        <StatCard
          label={t('TOTAL ORDERS')}
          value={analytics.totalCount.toLocaleString()}
          icon={ShoppingBag}
          trend={`${analytics.paidCount} ${t('completed')} · ${analytics.unpaidCount} ${t('Open')}`}
          color="blue"
        />
        <StatCard
          label={t('AVG. ORDER VALUE')}
          value={money(analytics.avgOrderValue)}
          icon={TrendingUp}
          trend={`${t('Average ticket')} · ${pLabel}`}
          color="amber"
        />
        <StatCard
          label={t('Menu Items')}
          value={menuItems.length.toLocaleString()}
          icon={Coffee}
          trend={`${availableCount} ${t('available now')}`}
          color="purple"
        />
        <StatCard
          label={t('Total Stock Cost')}
          value={money(inventorySummary.totalValue, 0)}
          icon={Scale}
          trend={t('Cost value of remaining stock')}
          color="blue"
        />
        <StatCard
          label={t('Expected Potential Profit')}
          value={money(inventorySummary.totalProfitValue, 0)}
          icon={TrendingUp}
          trend={t('Potential profit of remaining stock')}
          color="green"
        />
      </div>

      {/* ── Revenue trend and best sellers ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="lg:col-span-2 flex flex-col">
          <SectionHeader
            title={language === 'ar' ? 'منحنى الإيرادات' : 'Revenue Trend'}
            subtitle={
              language === 'ar'
                ? `المبيعات المحصلة لـ ${activeBranchLabel} خلال ${pLabel}`
                : `Collected sales for ${activeBranchLabel} during ${pLabel}`
            }
            action={
              analytics.totalRevenue > 0 ? (
                <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-100 px-3 py-1 rounded-full tabular-nums whitespace-nowrap">
                  {money(analytics.totalRevenue, 0)}
                </span>
              ) : undefined
            }
            className="mb-5"
          />

          {analytics.totalRevenue === 0 ? (
            <EmptyState
              icon={Receipt}
              title={language === 'ar' ? 'لا مبيعات محصلة في هذه الفترة' : 'No collected sales in this period'}
              hint={language === 'ar' ? 'الفواتير غير المدفوعة لا تُحسب إيرادًا' : 'Unpaid invoices are not counted as revenue'}
              className="flex-1"
            />
          ) : (
            <RevenueChart
              data={analytics.chartData}
              currency={currency}
              ordersLabel={t('orders')}
              replayKey={`${period}-${selectedBranch}`}
              isRtl={isRtl}
            />
          )}
        </Card>

        <Card className="flex flex-col">
          <SectionHeader
            title={t('Top Selling Items')}
            subtitle={
              language === 'ar'
                ? 'الأكثر طلبًا في الفواتير المدفوعة'
                : 'Most ordered items on paid invoices'
            }
            className="mb-5"
          />

          {analytics.topItems.length === 0 ? (
            <EmptyState icon={Utensils} title={`${t('No orders')} · ${pLabel}`} className="flex-1" />
          ) : (
            <div className="space-y-4 flex-1">
              {analytics.topItems.map(item => (
                <Meter
                  key={item.name}
                  label={t(item.name)}
                  value={`${item.count}×`}
                  percent={share(item.count, maxItemCount)}
                  tone="caramel"
                  footnote={money(item.revenue)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Breakdowns ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">

        <Card>
          <SectionHeader
            title={t('Sales by Order Mode')}
            subtitle={t('Dine-in vs Takeaway orders in the selected period')}
            className="mb-5"
          />

          {analytics.totalCount === 0 ? (
            <EmptyState icon={ShoppingBasket} title={t('No orders')} />
          ) : (
            <div className="space-y-5">
              <Meter
                label={t('Takeaway')}
                value={`${analytics.takeawayCount} · ${Math.round(share(analytics.takeawayCount, analytics.totalCount))}%`}
                percent={share(analytics.takeawayCount, analytics.totalCount)}
                tone="mocha"
                icon={<ShoppingBasket size={15} aria-hidden="true" />}
              />
              <Meter
                label={t('Dine-in')}
                value={`${analytics.dineInCount} · ${Math.round(share(analytics.dineInCount, analytics.totalCount))}%`}
                percent={share(analytics.dineInCount, analytics.totalCount)}
                tone="caramel"
                icon={<Coffee size={15} aria-hidden="true" />}
              />
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title={t('Invoice Payment Status')}
            subtitle={t('Paid vs Open invoices breakdown')}
            className="mb-5"
          />

          {analytics.totalCount === 0 ? (
            <EmptyState icon={Receipt} title={t('No orders')} />
          ) : (
            <div className="space-y-5">
              <Meter
                label={t('Paid Invoices')}
                value={`${analytics.paidCount} · ${Math.round(share(analytics.paidCount, analytics.totalCount))}%`}
                percent={share(analytics.paidCount, analytics.totalCount)}
                tone="green"
                icon={<CheckCircle2 size={15} aria-hidden="true" />}
                footnote={`${t('Total Paid')}: ${money(analytics.paidAmount)}`}
              />
              <Meter
                label={t('Open Invoices')}
                value={`${analytics.unpaidCount} · ${Math.round(share(analytics.unpaidCount, analytics.totalCount))}%`}
                percent={share(analytics.unpaidCount, analytics.totalCount)}
                tone="amber"
                icon={<Wallet size={15} aria-hidden="true" />}
                footnote={`${t('Total Open')}: ${money(analytics.unpaidAmount)}`}
              />

              <div className="pt-4 border-t border-gray-200 space-y-4">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  {t('Payment Methods')}
                </h3>
                <Meter
                  label={t('Cash')}
                  value={`${analytics.cashPercentage}%`}
                  percent={analytics.cashPercentage}
                  tone="emerald"
                  icon={<Banknote size={15} aria-hidden="true" />}
                  footnote={`${t('Total Cash')}: ${money(analytics.cashAmount)}`}
                />
                <Meter
                  label={t('Card')}
                  value={`${analytics.cardPercentage}%`}
                  percent={analytics.cardPercentage}
                  tone="blue"
                  icon={<CreditCard size={15} aria-hidden="true" />}
                  footnote={`${t('Total Card')}: ${money(analytics.cardAmount)}`}
                />
              </div>
            </div>
          )}
        </Card>

        <Card flush className="flex flex-col">
          <div className="p-4 md:p-6 pb-4">
            <SectionHeader
              title={t('Recent Transactions')}
              subtitle={language === 'ar' ? 'أحدث الفواتير المحصلة' : 'Latest collected invoices'}
            />
          </div>

          {analytics.recentTransactions.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t('No completed orders')} className="flex-1 pb-8" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {analytics.recentTransactions.map(order => {
                const items = parseOrderItems(order.items);
                const summary = items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                const more = items.length > 2 ? ` +${items.length - 2}` : '';

                const branch = BRANCHES.find(b => b.id === order.branch_id);
                const branchLabel = language === 'ar' ? branch?.labelAr : branch?.labelEn;

                const elapsedMinutes = Math.round((Date.now() - new Date(order.$createdAt).getTime()) / 60000);
                const timeAgo =
                  elapsedMinutes < 1 ? t('just now')
                  : elapsedMinutes < 60 ? `${elapsedMinutes}${t('m ago')}`
                  : `${Math.round(elapsedMinutes / 60)}${t('h ago')}`;

                return (
                  <li key={order.$id} className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="p-2 bg-green-50 text-green-700 rounded-xl shrink-0">
                        <CheckCircle2 size={15} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {order.tableId === 'Takeaway' ? t('Takeaway') : `${t('Table')} ${order.tableId}`}
                          {branchLabel && (
                            <span className="text-[10px] font-bold text-mocha-700 bg-mocha-50 border border-mocha-100 px-1.5 py-0.5 rounded mx-2 whitespace-nowrap">
                              {branchLabel}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">{summary}{more}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-sm font-bold text-gray-900 tabular-nums">
                        {money(orderRevenue(order, taxRate))}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{timeAgo}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
