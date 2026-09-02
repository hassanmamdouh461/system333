import { useMemo } from 'react';
import {
  bestSellers,
  dailyRevenue,
  formatCount,
  formatMoney,
  revenueByBranch,
  type OrderRow,
  type SalesTotals,
  type StockTotals,
} from './analytics';
import { Card, Empty, StatCard } from './ui';

interface AnalyticsTabProps {
  orders: OrderRow[];
  sales: SalesTotals;
  stock: StockTotals;
  menuItemCount: number;
  availableCount: number;
  customerCount: number;
  newCustomerCount: number;
  periodLabel: string;
}

export function AnalyticsTab({
  orders,
  sales,
  stock,
  menuItemCount,
  availableCount,
  customerCount,
  newCustomerCount,
  periodLabel,
}: AnalyticsTabProps) {
  const chart = useMemo(() => dailyRevenue(orders), [orders]);
  const ranked = useMemo(() => bestSellers(orders), [orders]);
  const branches = useMemo(() => revenueByBranch(orders), [orders]);

  return (
    <>
      <section className="stat-grid">
        <StatCard
          tone="emerald"
          icon="money"
          label="إجمالي الإيرادات (شامل الضريبة)"
          badge="الإجمالي الكلي"
          value={formatMoney(sales.revenue)}
          unit="ج.م"
        />
        <StatCard
          tone="amber"
          icon="receivable"
          label="إجمالي المبالغ المستحقة"
          badge="على العملاء والشركات"
          value={formatMoney(sales.outstanding)}
          unit="ج.م"
        />
        <StatCard
          tone="sky"
          icon="orders"
          label="إجمالي الطلبات"
          badge={`${formatCount(sales.unpaidCount)} غير مدفوع`}
          value={formatCount(sales.paidCount)}
        />
        <StatCard
          tone="violet"
          icon="menu"
          label="أصناف القائمة"
          badge={`${formatCount(availableCount)} متوفر الآن`}
          value={formatCount(menuItemCount)}
        />
      </section>

      <section className="stat-grid">
        <StatCard
          tone="rose"
          icon="cogs"
          label="تكلفة البضاعة المباعة (المواد الخام)"
          badge="تكلفة الخامات اللازمة للوجبات المباعة"
          value={formatMoney(sales.cogs)}
          unit="ج.م"
        />
        <StatCard
          tone="emerald"
          icon="profit"
          label="صافي الربح الفعلي"
          badge="صافي الربح بعد الخامات والضريبة"
          value={formatMoney(sales.netProfit)}
          unit="ج.م"
          negative={sales.netProfit < 0}
        />
        <StatCard
          tone="sky"
          icon="scale"
          label="إجمالي تكلفة المخزون"
          badge="سعر شراء الخامات بالمخزن"
          value={formatMoney(stock.costValue)}
          unit="ج.م"
        />
        <StatCard
          tone="emerald"
          icon="trend"
          label="الأرباح المتوقعة"
          badge={
            stock.expectedProfit === null
              ? 'لا توجد مبيعات في الفترة لتقديرها'
              : 'الأرباح المتوقعة من الخامات بالمخزن'
          }
          value={stock.expectedProfit === null ? '—' : formatMoney(stock.expectedProfit)}
          unit={stock.expectedProfit === null ? undefined : 'ج.م'}
        />
      </section>

      <div className="split-grid">
        <Card title="المبيعات آخر 7 أيام" hint="حسب يوم البيع">
          <div className="chart">
            {chart.map((bucket) => (
              <div className="chart-col" key={bucket.day}>
                <span className="chart-value">{bucket.revenue > 0 ? formatMoney(bucket.revenue) : ''}</span>
                <div
                  className="chart-bar"
                  style={{ height: `${Math.max(bucket.percent, bucket.revenue > 0 ? 4 : 1)}%` }}
                  title={`${formatMoney(bucket.revenue)} ج.م — ${formatCount(bucket.orders)} طلب`}
                />
                <span className="chart-label">{bucket.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="ملخص الفترة" hint={periodLabel}>
          <ul className="kv-list">
            <li>
              <span>متوسط قيمة الطلب</span>
              <strong>{formatMoney(sales.averageOrder)} ج.م</strong>
            </li>
            <li>
              <span>الضريبة المحصلة</span>
              <strong>{formatMoney(sales.tax)} ج.م</strong>
            </li>
            <li>
              <span>هامش الربح</span>
              <strong className={sales.netProfit < 0 ? 'is-negative' : 'is-positive'}>
                {sales.marginPercent.toFixed(1)}%
              </strong>
            </li>
            <li>
              <span>إجمالي العملاء</span>
              <strong>{formatCount(customerCount)}</strong>
            </li>
            <li>
              <span>عملاء جدد في الفترة</span>
              <strong>{formatCount(newCustomerCount)}</strong>
            </li>
          </ul>
        </Card>
      </div>

      <div className="split-grid">
        <Card title="الأصناف الأكثر مبيعًا" hint="حسب الكمية">
          {ranked.length === 0 ? (
            <Empty text="لا توجد مبيعات في هذه الفترة" />
          ) : (
            <ul className="rank-list">
              {ranked.map((item, index) => (
                <li key={item.name}>
                  <span className="rank">{index + 1}</span>
                  <span className="rank-name">{item.name}</span>
                  <span className="rank-value">{formatCount(item.quantity)} قطعة</span>
                  <span className="rank-sub">{formatMoney(item.revenue)} ج.م</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="الإيرادات حسب الفرع" hint="الطلبات المدفوعة فقط">
          {branches.length === 0 ? (
            <Empty text="لا توجد إيرادات في هذه الفترة" />
          ) : (
            <ul className="rank-list">
              {branches.map((branch, index) => (
                <li key={branch.branch}>
                  <span className="rank">{index + 1}</span>
                  <span className="rank-name">{branch.branch}</span>
                  <span className="rank-value">{formatMoney(branch.revenue)} ج.م</span>
                  <span className="rank-sub">{formatCount(branch.orders)} طلب</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
