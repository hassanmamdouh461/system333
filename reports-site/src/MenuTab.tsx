import { useMemo, useState } from 'react';
import { formatCount, formatMoney, toNum, type MenuItemRow } from './analytics';
import { Card, Empty, StatCard } from './ui';

interface MenuTabProps {
  menuItems: MenuItemRow[];
  /** Quantity sold per product name, over the selected period. */
  soldByName: Map<string, number>;
}

/** The category part of the stored `category|preparation` pair. */
function categoryOf(item: MenuItemRow): string {
  return (item.category || '').split('|')[0] || 'غير مصنف';
}

export function MenuTab({ menuItems, soldByName }: MenuTabProps) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? menuItems.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            categoryOf(item).toLowerCase().includes(needle)
        )
      : menuItems;

    return [...matched]
      .map((item) => ({ item, sold: soldByName.get(item.name) ?? 0 }))
      .sort((a, b) => b.sold - a.sold || a.item.name.localeCompare(b.item.name, 'ar'));
  }, [menuItems, query, soldByName]);

  const availableCount = menuItems.filter((item) => toNum(item.available) === 1).length;
  const categories = new Set(menuItems.map(categoryOf));
  const unsoldCount = menuItems.filter((item) => (soldByName.get(item.name) ?? 0) === 0).length;
  const averagePrice =
    menuItems.length > 0
      ? menuItems.reduce((sum, item) => sum + toNum(item.price), 0) / menuItems.length
      : 0;

  return (
    <>
      <section className="stat-grid">
        <StatCard
          tone="violet"
          icon="menu"
          label="أصناف القائمة"
          badge={`${formatCount(availableCount)} متوفر الآن`}
          value={formatCount(menuItems.length)}
        />
        <StatCard
          tone="sky"
          icon="stock"
          label="عدد الأقسام"
          badge="أقسام القائمة"
          value={formatCount(categories.size)}
        />
        <StatCard
          tone="amber"
          icon="money"
          label="متوسط سعر الصنف"
          badge="على كل القائمة"
          value={formatMoney(averagePrice)}
          unit="ج.م"
        />
        <StatCard
          tone={unsoldCount > 0 ? 'rose' : 'emerald'}
          icon="alert"
          label="أصناف بلا مبيعات"
          badge="خلال الفترة المختارة"
          value={formatCount(unsoldCount)}
        />
      </section>

      <Card title="أصناف القائمة" hint={`${formatCount(rows.length)} صنف`}>
        <label className="search">
          <span className="sr-only">ابحث بالاسم أو القسم</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو القسم..."
          />
        </label>

        {rows.length === 0 ? (
          <Empty text="لا توجد أصناف مطابقة" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>القسم</th>
                  <th>السعر</th>
                  <th>الكمية المباعة</th>
                  <th>إيراد الفترة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, sold }) => (
                  <tr key={item.id}>
                    <td className="cell-strong">{item.name}</td>
                    <td>{categoryOf(item)}</td>
                    <td>{formatMoney(toNum(item.price))}</td>
                    <td>{formatCount(sold)}</td>
                    <td className="cell-strong">{formatMoney(sold * toNum(item.price))} ج.م</td>
                    <td>
                      {toNum(item.available) === 1 ? (
                        <span className="tag tag-ok">متوفر</span>
                      ) : (
                        <span className="tag tag-warn">غير متوفر</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
