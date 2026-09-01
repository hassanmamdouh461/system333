import { DollarSign, TrendingUp, Coins, AlertTriangle, Package } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { StatCard } from '../ui/StatCard';
import { Card, SectionHeader, EmptyState } from '../ui/Card';
import {
  ManagerInventorySummary,
  ManagerStockRow,
  BRANCH_IDS,
} from '../../utils/managerInventory';
import { BRANCHES } from '../../utils/managerAnalytics';

interface InventoryTabProps {
  stockRows: ManagerStockRow[];
  summary: ManagerInventorySummary;
  /** Average selling value per unit of each stock item, keyed by item id. */
  materialYields: Record<string, number>;
  selectedBranch: string;
  activeBranchLabel: string | undefined;
}

/** Bar colour by how much of the opening stock is left. */
function levelTone(percentage: number): string {
  if (percentage > 50) return 'bg-emerald-500';
  if (percentage > 25) return 'bg-amber-500';
  return 'bg-red-500';
}

/** A stock level as a bar plus its number, announced as a progressbar. */
function StockLevel({ label, remaining, percentage, isLow }: {
  label: string;
  remaining: number;
  percentage: number;
  isLow: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      <span className={`flex items-center gap-1 text-sm font-bold tabular-nums ${isLow ? 'text-red-700' : 'text-gray-900'}`}>
        {remaining}
        {isLow && <AlertTriangle size={12} aria-hidden="true" className="text-red-600" />}
      </span>
      <div
        className="w-full max-w-[92px] h-2 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${levelTone(percentage)}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 tabular-nums">{percentage}%</span>
    </div>
  );
}

export function InventoryTab({
  stockRows,
  summary,
  materialYields,
  selectedBranch,
  activeBranchLabel,
}: InventoryTabProps) {
  const { t, language } = useLanguage();
  const currency = language === 'ar' ? 'ج.م' : 'EGP';
  const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`;

  const isAllBranches = selectedBranch === 'all';
  const branchRows = isAllBranches
    ? stockRows
    : stockRows.filter(row => row.branches[selectedBranch]);

  return (
    <div className="space-y-4 md:space-y-6">

      {/* ── Valuation summary ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label={t('Total Stock Cost')}
          value={money(summary.totalValue)}
          icon={DollarSign}
          trend={`${activeBranchLabel} · ${t('Cost value of remaining stock')}`}
          color="blue"
        />
        <StatCard
          label={t('Potential Sales Value')}
          value={money(summary.totalSalesValue)}
          icon={Coins}
          trend={language === 'ar' ? 'قيمة البيع المتوقعة للمخزون' : 'Expected selling yield'}
          color="green"
        />
        <StatCard
          label={t('Expected Potential Profit')}
          value={money(summary.totalProfitValue)}
          icon={TrendingUp}
          trend={t('Potential profit of remaining stock')}
          color="purple"
        />
        <StatCard
          label={t('Low Stock Alerts')}
          value={summary.lowStockCount.toLocaleString()}
          icon={AlertTriangle}
          trend={
            summary.lowStockCount > 0
              ? (language === 'ar' ? 'أصناف تحتاج إعادة طلب' : 'Items needing reorder')
              : (language === 'ar' ? 'كل الأصناف في مستوى آمن' : 'All items at a safe level')
          }
          color={summary.lowStockCount > 0 ? 'red' : 'green'}
          emphasis={summary.lowStockCount > 0}
        />
      </div>

      {branchRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title={t('No stock items found')}
            hint={language === 'ar' ? 'لم تُسجَّل أي مواد خام لهذا النطاق' : 'No materials recorded for this scope'}
          />
        </Card>
      ) : isAllBranches ? (
        /* ── Cross-branch comparison ───────────────────────────────────────── */
        <Card flush>
          <div className="p-4 md:p-6 border-b border-gray-200">
            <SectionHeader
              title={language === 'ar' ? 'مقارنة المخزون بين الفروع' : 'Cross-Branch Inventory'}
              subtitle={
                language === 'ar'
                  ? 'الكميات المتبقية لكل مادة خام في كل فرع، محسوبة من الطلبات الفعلية'
                  : 'Remaining quantity per material in each branch, derived from actual sales'
              }
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm">
              <caption className="sr-only">
                {language === 'ar' ? 'مقارنة كميات المخزون بين الفروع' : 'Inventory levels compared across branches'}
              </caption>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th scope="col" className="text-start px-4 py-3 font-bold text-gray-700">
                    {language === 'ar' ? 'المادة الخام' : 'Material'}
                  </th>
                  <th scope="col" className="text-center px-3 py-3 font-semibold text-gray-500">
                    {t('Unit')}
                  </th>
                  {BRANCHES.filter(b => b.id !== 'all').map(branch => (
                    <th key={branch.id} scope="col" className="text-center px-3 py-3 font-bold text-gray-700 min-w-[130px]">
                      {language === 'ar' ? branch.labelAr : branch.labelEn}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stockRows.map(row => {
                  const name = language === 'ar' ? row.nameAr : row.nameEn;
                  const unit = language === 'ar' ? row.unitAr : row.unit;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50/70 transition-colors">
                      <th scope="row" className="text-start px-4 py-3 font-bold text-gray-900">
                        {name}
                      </th>
                      <td className="text-center px-3 py-3 text-gray-500">{unit}</td>
                      {BRANCH_IDS.map(branchId => {
                        const level = row.branches[branchId];
                        if (!level) {
                          return <td key={branchId} className="text-center px-3 py-3 text-gray-400">—</td>;
                        }
                        return (
                          <td key={branchId} className="px-3 py-3">
                            <StockLevel
                              label={`${name} — ${branchId}`}
                              remaining={level.remaining}
                              percentage={level.percentage}
                              isLow={level.isLow}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ── Single branch detail ──────────────────────────────────────────── */
        <div className="space-y-4">
          <SectionHeader
            title={language === 'ar' ? `تفاصيل مخزون ${activeBranchLabel}` : `${activeBranchLabel} — Stock Detail`}
            subtitle={
              language === 'ar'
                ? 'الكمية المتبقية وقيمتها التقديرية لكل مادة خام'
                : 'Remaining quantity and estimated value per material'
            }
          />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
            {branchRows.map(row => {
              const level = row.branches[selectedBranch];
              const name = language === 'ar' ? row.nameAr : row.nameEn;
              const unit = language === 'ar' ? row.unitAr : row.unit;
              const costValue = level.remaining * row.costPerUnit;
              const salesValue = level.remaining * (materialYields[row.id] || 0);
              const profit = Math.max(salesValue - costValue, 0);

              return (
                <Card key={row.id} className={level.isLow ? 'border-red-200 bg-red-50/40' : undefined}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 text-sm truncate">{name}</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                        {row.costPerUnit} {currency} / {unit}
                      </p>
                    </div>
                    {level.isLow && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg shrink-0">
                        <AlertTriangle size={11} aria-hidden="true" />
                        {t('Low Stock')}
                      </span>
                    )}
                  </div>

                  <div
                    className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-2"
                    role="progressbar"
                    aria-label={name}
                    aria-valuenow={level.percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={`h-full rounded-full ${levelTone(level.percentage)}`} style={{ width: `${level.percentage}%` }} />
                  </div>

                  <div className="flex items-baseline justify-between mb-3">
                    <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">
                      {level.remaining}
                      <span className="text-[11px] font-semibold text-gray-500 ms-1">{unit}</span>
                    </p>
                    <span className="text-[11px] text-gray-500 tabular-nums">
                      {level.percentage}% {language === 'ar' ? 'من الرصيد الافتتاحي' : 'of opening'}
                    </span>
                  </div>

                  <dl className="space-y-1.5 pt-3 border-t border-gray-200 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">{language === 'ar' ? 'المستهلك' : 'Consumed'}</dt>
                      <dd className="font-semibold text-gray-700 tabular-nums">{level.consumed} {unit}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">{t('Cost Value:')}</dt>
                      <dd className="font-semibold text-gray-900 tabular-nums">{money(costValue)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">{t('Potential Selling Value:')}</dt>
                      <dd className="font-semibold text-emerald-700 tabular-nums">{money(salesValue)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">{t('Potential Profit:')}</dt>
                      <dd className="font-semibold text-blue-700 tabular-nums">{money(profit)}</dd>
                    </div>
                  </dl>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
