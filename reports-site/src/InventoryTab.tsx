import { useMemo, useState } from 'react';
import {
  formatCount,
  formatMoney,
  toNum,
  type InventoryRow,
  type StockTotals,
} from './analytics';
import { Card, Empty, StatCard } from './ui';
import { branchLabel } from './branches';

interface InventoryTabProps {
  inventory: InventoryRow[];
  stock: StockTotals;
  /** Display name per branch id, so the branch column is not a raw slug. */
  branchNames: Map<string, string>;
}

export function InventoryTab({ inventory, stock, branchNames }: InventoryTabProps) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? inventory.filter((item) => item.name.toLowerCase().includes(needle))
      : inventory;
    // Low stock first: the reason to open this tab is to find what needs ordering.
    return [...matched].sort((a, b) => {
      const aLow = toNum(a.stock) <= toNum(a.minStock) ? 0 : 1;
      const bLow = toNum(b.stock) <= toNum(b.minStock) ? 0 : 1;
      return aLow - bLow || a.name.localeCompare(b.name, 'ar');
    });
  }, [inventory, query]);

  const lowStock = useMemo(
    () => inventory.filter((item) => toNum(item.stock) <= toNum(item.minStock)),
    [inventory]
  );

  return (
    <>
      <section className="stat-grid">
        <StatCard
          tone="violet"
          icon="stock"
          label="إجمالي الأصناف"
          badge="مواد خام بالمخزن"
          value={formatCount(stock.itemCount)}
        />
        <StatCard
          tone={lowStock.length > 0 ? 'rose' : 'emerald'}
          icon="alert"
          label="تحذيرات نقص المخزون"
          badge={lowStock.length > 0 ? 'تحتاج شراء' : 'المستويات جيدة'}
          value={formatCount(stock.lowStockCount)}
        />
        <StatCard
          tone="sky"
          icon="scale"
          label="إجمالي قيمة المخزون"
          badge="سعر شراء الخامات"
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
              : 'بهامش الربح المحقق في الفترة'
          }
          value={stock.expectedProfit === null ? '—' : formatMoney(stock.expectedProfit)}
          unit={stock.expectedProfit === null ? undefined : 'ج.م'}
        />
      </section>

      <Card title="أصناف المخزون" hint={`${formatCount(rows.length)} صنف`}>
        <label className="search">
          <span className="sr-only">ابحث في أصناف المخزون</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في أصناف المخزون..."
          />
        </label>

        {rows.length === 0 ? (
          <Empty text="لا توجد أصناف مطابقة" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>اسم الصنف</th>
                  <th>الوحدة</th>
                  <th>المخزون الحالي</th>
                  <th>حد التنبيه</th>
                  <th>سعر الوحدة</th>
                  <th>قيمة المخزون</th>
                  <th>الفرع</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const isLow = toNum(item.stock) <= toNum(item.minStock);
                  return (
                    <tr key={item.id} className={isLow ? 'row-warn' : undefined}>
                      <td className="cell-strong">{item.name}</td>
                      <td>{item.unit || '—'}</td>
                      <td className={isLow ? 'is-negative' : undefined}>
                        {formatMoney(toNum(item.stock))}
                        {isLow && <span className="tag tag-warn">منخفض</span>}
                      </td>
                      <td>{formatMoney(toNum(item.minStock))}</td>
                      <td>{formatMoney(toNum(item.costPerUnit))}</td>
                      <td className="cell-strong">
                        {formatMoney(toNum(item.stock) * toNum(item.costPerUnit))}
                      </td>
                      <td>{branchLabel(item.branch_id, branchNames)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
