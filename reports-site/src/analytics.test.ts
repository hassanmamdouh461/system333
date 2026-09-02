import { describe, it, expect } from 'vitest';
import {
  bestSellers,
  branchOptions,
  costOfGoodsSold,
  dailyRevenue,
  inBranch,
  inPeriod,
  orderLines,
  orderRevenue,
  periodStart,
  revenueByBranch,
  summarizeSales,
  summarizeStock,
  type CustomerRow,
  type InventoryRow,
  type OrderRow,
  type StockMovementRow,
} from './analytics';

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o1',
    createdAt: '2026-09-01T10:00:00.000Z',
    branch_id: 'branch-1',
    totalAmount: 100,
    grandTotal: 100,
    subtotal: 90,
    taxAmount: 10,
    paidAmount: 100,
    paymentStatus: 'Paid',
    paymentMethod: 'Cash',
    items: null,
    ...overrides,
  };
}

function material(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'inv-beans',
    name: 'Beans',
    unit: 'kg',
    stock: 10,
    minStock: 2,
    costPerUnit: 100,
    branch_id: 'branch-1',
    ...overrides,
  };
}

function movement(overrides: Partial<StockMovementRow> = {}): StockMovementRow {
  return {
    id: 'tx1',
    itemId: 'inv-beans',
    type: 'OUT',
    quantity: 1,
    referenceId: 'o1',
    createdAt: '2026-09-01T10:00:00.000Z',
    branch_id: 'branch-1',
    ...overrides,
  };
}

describe('orderRevenue', () => {
  it('prefers what the till collected over what was billed', () => {
    // Loyalty points paid 30 of a 100 bill, so revenue is 70.
    expect(orderRevenue(order({ paidAmount: 70, grandTotal: 100 }))).toBe(70);
  });

  it('falls back to the billed total, then the legacy total', () => {
    expect(orderRevenue(order({ paidAmount: null, grandTotal: 120 }))).toBe(120);
    expect(orderRevenue(order({ paidAmount: null, grandTotal: null, totalAmount: 90 }))).toBe(90);
  });

  it('treats a missing figure as zero rather than NaN', () => {
    expect(orderRevenue(order({ paidAmount: null, grandTotal: null, totalAmount: null }))).toBe(0);
  });
});

describe('inPeriod', () => {
  // Periods are local calendar days, which is what a shop owner means by "today", so the
  // fixtures are built in local time. UTC literals would straddle midnight at some offsets
  // and make these assertions depend on the machine's timezone.
  const now = new Date(2026, 8, 15, 12, 0, 0);
  const localAt = (year: number, month: number, day: number, hour: number) =>
    new Date(year, month, day, hour, 0, 0).toISOString();

  it('includes everything for the all-time period', () => {
    expect(inPeriod(localAt(2020, 0, 1, 0), 'all', now)).toBe(true);
    expect(inPeriod(null, 'all', now)).toBe(true);
  });

  it('counts today from midnight, not from 24 hours ago', () => {
    expect(inPeriod(localAt(2026, 8, 15, 1), 'today', now)).toBe(true);
    expect(inPeriod(localAt(2026, 8, 14, 23), 'today', now)).toBe(false);
  });

  it('spans seven calendar days for the week, inclusive of today', () => {
    expect(periodStart('week', now)?.getDate()).toBe(9);
    expect(inPeriod(localAt(2026, 8, 9, 8), 'week', now)).toBe(true);
    expect(inPeriod(localAt(2026, 8, 8, 23), 'week', now)).toBe(false);
  });

  it('starts the year period on the first of January', () => {
    const start = periodStart('year', now);
    expect(start?.getMonth()).toBe(0);
    expect(start?.getDate()).toBe(1);
  });

  it('excludes a row with no date, and an unparseable one', () => {
    expect(inPeriod(null, 'week', now)).toBe(false);
    expect(inPeriod('not-a-date', 'week', now)).toBe(false);
  });
});

describe('inBranch', () => {
  it('accepts every row when no branch is selected', () => {
    expect(inBranch('branch-2', 'all')).toBe(true);
    expect(inBranch(null, 'all')).toBe(true);
  });

  it('matches only the selected branch', () => {
    expect(inBranch('branch-1', 'branch-1')).toBe(true);
    expect(inBranch('branch-2', 'branch-1')).toBe(false);
    expect(inBranch(null, 'branch-1')).toBe(false);
  });
});

describe('orderLines', () => {
  it('reads name, quantity and price from the stored blob', () => {
    const lines = orderLines(order({ items: '[{"name":"Latte","quantity":2,"price":70}]' }));
    expect(lines).toEqual([{ name: 'Latte', quantity: 2, price: 70 }]);
  });

  it('accepts the alternate itemName field older rows used', () => {
    expect(orderLines(order({ items: '[{"itemName":"Espresso","quantity":1}]' }))[0].name).toBe(
      'Espresso'
    );
  });

  it('yields nothing for a malformed or non-array blob instead of throwing', () => {
    expect(orderLines(order({ items: 'not json' }))).toEqual([]);
    expect(orderLines(order({ items: '{"name":"Latte"}' }))).toEqual([]);
    expect(orderLines(order({ items: null }))).toEqual([]);
  });

  it('drops a nameless line, which cannot be ranked', () => {
    expect(orderLines(order({ items: '[{"quantity":3},{"name":"Tea","quantity":1}]' }))).toEqual([
      { name: 'Tea', quantity: 1, price: 0 },
    ]);
  });
});

describe('costOfGoodsSold', () => {
  it('values consumption at the material cost per unit', () => {
    const cost = costOfGoodsSold(
      [movement({ quantity: 2 })],
      [material({ costPerUnit: 150 })],
      new Set(['o1'])
    );
    expect(cost).toBe(300);
  });

  it('nets a cancellation back out, so a reversed order costs nothing', () => {
    const cost = costOfGoodsSold(
      [movement({ quantity: 2 }), movement({ id: 'tx2', type: 'IN', quantity: 2 })],
      [material()],
      new Set(['o1'])
    );
    expect(cost).toBe(0);
  });

  it('never reports a negative cost', () => {
    const cost = costOfGoodsSold(
      [movement({ type: 'IN', quantity: 5 })],
      [material()],
      new Set(['o1'])
    );
    expect(cost).toBe(0);
  });

  it('ignores movements belonging to other orders', () => {
    const cost = costOfGoodsSold(
      [movement({ referenceId: 'other-order', quantity: 9 })],
      [material()],
      new Set(['o1'])
    );
    expect(cost).toBe(0);
  });

  it('ignores a manual adjustment, which is not a sale', () => {
    const cost = costOfGoodsSold(
      [movement({ referenceId: 'MANUAL', quantity: 9 })],
      [material()],
      new Set(['o1'])
    );
    expect(cost).toBe(0);
  });

  it('skips a movement whose material is no longer in the snapshot', () => {
    const cost = costOfGoodsSold([movement({ itemId: 'deleted' })], [material()], new Set(['o1']));
    expect(cost).toBe(0);
  });
});

describe('summarizeSales', () => {
  it('separates revenue, tax and material cost into net profit', () => {
    const totals = summarizeSales(
      [order({ paidAmount: 500, taxAmount: 50 })],
      [movement({ quantity: 1 })],
      [material({ costPerUnit: 100 })]
    );

    expect(totals.revenue).toBe(500);
    expect(totals.tax).toBe(50);
    expect(totals.cogs).toBe(100);
    expect(totals.netProfit).toBe(350);
    expect(totals.marginPercent).toBeCloseTo(70);
  });

  it('counts an unpaid order as outstanding, never as revenue', () => {
    const totals = summarizeSales(
      [order({ id: 'o2', paymentStatus: 'Unpaid', paidAmount: 0, grandTotal: 200 })],
      [],
      []
    );

    expect(totals.revenue).toBe(0);
    expect(totals.paidCount).toBe(0);
    expect(totals.unpaidCount).toBe(1);
    expect(totals.outstanding).toBe(200);
  });

  it('treats a part-paid order as outstanding only for the remainder', () => {
    const totals = summarizeSales(
      [order({ paymentStatus: 'Unpaid', grandTotal: 200, paidAmount: 80 })],
      [],
      []
    );
    expect(totals.outstanding).toBe(120);
  });

  it('excludes a cancelled order cost from a paid order alongside it', () => {
    const totals = summarizeSales(
      [order({ id: 'o1', paidAmount: 300 })],
      [movement({ referenceId: 'cancelled-order', quantity: 5 })],
      [material()]
    );
    expect(totals.cogs).toBe(0);
    expect(totals.netProfit).toBe(300 - 10);
  });

  it('returns zeroes, not NaN, with nothing sold', () => {
    const totals = summarizeSales([], [], []);
    expect(totals.averageOrder).toBe(0);
    expect(totals.marginPercent).toBe(0);
    expect(totals.netProfit).toBe(0);
  });
});

describe('summarizeStock', () => {
  const noSales = summarizeSales([], [], []);

  it('values stock at purchase cost and flags what is low', () => {
    const totals = summarizeStock(
      [
        material({ id: 'a', stock: 10, minStock: 2, costPerUnit: 100 }),
        material({ id: 'b', stock: 1, minStock: 5, costPerUnit: 50 }),
      ],
      noSales
    );

    expect(totals.itemCount).toBe(2);
    expect(totals.costValue).toBe(1050);
    expect(totals.lowStockCount).toBe(1);
  });

  it('treats stock exactly at its threshold as low', () => {
    expect(summarizeStock([material({ stock: 5, minStock: 5 })], noSales).lowStockCount).toBe(1);
  });

  it('withholds expected profit when the period sold nothing', () => {
    // No observed margin means any figure here would be invented.
    expect(summarizeStock([material()], noSales).expectedProfit).toBeNull();
  });

  it('projects expected profit from the margin the period actually achieved', () => {
    // Net revenue 400 on 100 of materials is a 4x multiple, so 1000 of stock projects 3000.
    const sales = summarizeSales(
      [order({ paidAmount: 450, taxAmount: 50 })],
      [movement({ quantity: 1 })],
      [material({ costPerUnit: 100 })]
    );
    const totals = summarizeStock([material({ stock: 10, costPerUnit: 100 })], sales);
    expect(totals.expectedProfit).toBeCloseTo(3000);
  });
});

describe('bestSellers', () => {
  it('sums quantity and revenue for a product across orders', () => {
    const ranked = bestSellers([
      order({ items: '[{"name":"Latte","quantity":2,"price":70}]' }),
      order({ id: 'o2', items: '[{"name":"Latte","quantity":1,"price":70}]' }),
    ]);

    expect(ranked[0]).toEqual({ name: 'Latte', quantity: 3, revenue: 210 });
  });

  it('ranks by quantity, busiest first, and honours the limit', () => {
    const ranked = bestSellers(
      [
        order({
          items: '[{"name":"A","quantity":1,"price":10},{"name":"B","quantity":5,"price":10}]',
        }),
      ],
      1
    );
    expect(ranked.map((r) => r.name)).toEqual(['B']);
  });
});

describe('dailyRevenue', () => {
  // Buckets are keyed by local calendar day, so the fixtures are local too.
  const now = new Date(2026, 8, 15, 12, 0, 0);
  const localAt = (day: number, hour: number) => new Date(2026, 8, day, hour, 0, 0).toISOString();

  it('returns one bucket per day, oldest first', () => {
    const buckets = dailyRevenue([], 7, now);
    expect(buckets).toHaveLength(7);
    expect(buckets[0].day).toBe('2026-09-09');
    expect(buckets[6].day).toBe('2026-09-15');
  });

  it('places an order in its own day and scales the tallest bar to full height', () => {
    const buckets = dailyRevenue(
      [
        order({ createdAt: localAt(15, 9), paidAmount: 100 }),
        order({ id: 'o2', createdAt: localAt(14, 9), paidAmount: 50 }),
      ],
      7,
      now
    );

    const today = buckets.find((b) => b.day === '2026-09-15');
    const yesterday = buckets.find((b) => b.day === '2026-09-14');
    expect(today?.revenue).toBe(100);
    expect(today?.percent).toBe(100);
    expect(yesterday?.percent).toBe(50);
  });

  it('leaves every bar at zero height when nothing sold, rather than dividing by zero', () => {
    expect(dailyRevenue([], 7, now).every((b) => b.percent === 0)).toBe(true);
  });
});

describe('revenueByBranch', () => {
  it('totals paid orders per branch, busiest first', () => {
    const rows = revenueByBranch([
      order({ branch_id: 'b1', paidAmount: 100 }),
      order({ id: 'o2', branch_id: 'b2', paidAmount: 300 }),
      order({ id: 'o3', branch_id: 'b1', paidAmount: 50 }),
      order({ id: 'o4', branch_id: 'b2', paymentStatus: 'Unpaid', paidAmount: 999 }),
    ]);

    expect(rows.map((r) => [r.branch, r.revenue, r.orders])).toEqual([
      ['b2', 300, 1],
      ['b1', 150, 2],
    ]);
  });

  it('groups rows with no branch under a named bucket rather than dropping them', () => {
    expect(revenueByBranch([order({ branch_id: null })])[0].branch).toBe('غير محدد');
  });
});

describe('branchOptions', () => {
  it('collects branch ids from every table, sorted and deduplicated', () => {
    const customer: CustomerRow = {
      id: 'c1',
      name: 'x',
      phone: null,
      points: 0,
      createdAt: null,
      branch_id: 'b3',
    };

    expect(
      branchOptions([order({ branch_id: 'b2' })], [material({ branch_id: 'b1' })], [customer])
    ).toEqual(['b1', 'b2', 'b3']);
  });

  it('omits rows with no branch', () => {
    expect(branchOptions([order({ branch_id: null })], [], [])).toEqual([]);
  });
});
