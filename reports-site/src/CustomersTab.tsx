import { useMemo, useState } from 'react';
import { formatCount, formatMoney, toNum, type CustomerRow, type OrderRow } from './analytics';
import { Card, Empty, StatCard } from './ui';

interface CustomersTabProps {
  customers: CustomerRow[];
  /** Orders already narrowed to the selected branch and period. */
  orders: OrderRow[];
  newCustomerCount: number;
}

export function CustomersTab({ customers, orders, newCustomerCount }: CustomersTabProps) {
  const [query, setQuery] = useState('');

  /** Spend and order count per phone number, from the orders in scope. */
  const spendByPhone = useMemo(() => {
    const totals = new Map<string, { spend: number; orders: number }>();
    for (const order of orders) {
      const phone = order.customerPhone || '';
      if (!phone) continue;
      const existing = totals.get(phone);
      const revenue = toNum(order.paidAmount ?? order.grandTotal ?? order.totalAmount);
      if (existing) {
        existing.spend += revenue;
        existing.orders++;
      } else {
        totals.set(phone, { spend: revenue, orders: 1 });
      }
    }
    return totals;
  }, [orders]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(needle) ||
            (customer.phone || '').includes(needle)
        )
      : customers;

    return [...matched]
      .map((customer) => ({
        customer,
        ...(spendByPhone.get(customer.phone || '') ?? { spend: 0, orders: 0 }),
      }))
      .sort((a, b) => toNum(b.customer.points) - toNum(a.customer.points));
  }, [customers, query, spendByPhone]);

  const totalPoints = useMemo(
    () => customers.reduce((sum, customer) => sum + toNum(customer.points), 0),
    [customers]
  );

  return (
    <>
      <section className="stat-grid">
        <StatCard
          tone="sky"
          icon="users"
          label="إجمالي العملاء"
          badge="المسجلون في النظام"
          value={formatCount(customers.length)}
        />
        <StatCard
          tone="emerald"
          icon="users"
          label="عملاء جدد"
          badge="خلال الفترة المختارة"
          value={formatCount(newCustomerCount)}
        />
        <StatCard
          tone="violet"
          icon="star"
          label="إجمالي نقاط الولاء"
          badge="رصيد النقاط الحالي"
          value={formatCount(totalPoints)}
        />
        <StatCard
          tone="amber"
          icon="orders"
          label="عملاء لهم طلبات في الفترة"
          badge="حسب رقم الهاتف"
          value={formatCount(spendByPhone.size)}
        />
      </section>

      <Card title="العملاء" hint={`${formatCount(rows.length)} عميل`}>
        <label className="search">
          <span className="sr-only">ابحث بالاسم أو رقم الهاتف</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو رقم الهاتف..."
          />
        </label>

        {rows.length === 0 ? (
          <Empty text="لا يوجد عملاء مطابقون" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>الهاتف</th>
                  <th>النقاط</th>
                  <th>طلبات الفترة</th>
                  <th>إنفاق الفترة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.customer.id}>
                    <td className="cell-rank">{index + 1}</td>
                    <td className="cell-strong">{row.customer.name}</td>
                    <td dir="ltr">{row.customer.phone || '—'}</td>
                    <td>{formatCount(toNum(row.customer.points))}</td>
                    <td>{formatCount(row.orders)}</td>
                    <td className="cell-strong">{formatMoney(row.spend)} ج.م</td>
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
