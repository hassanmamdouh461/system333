import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildOrderTotals,
  orderTotals,
  orderGrandTotal,
  orderRevenue,
  allocateOrderRevenue,
  lineItemTotal,
  roundMoney,
  DEFAULT_TAX_RATE,
} from './orderTotals';

/**
 * settingsConfig reads localStorage, which does not exist in the node test environment.
 * A minimal stub keeps the fallback path exercisable without pulling in a DOM.
 */
const store = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe('roundMoney', () => {
  it('rounds to two decimals', () => {
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('returns zero for non-numeric input rather than NaN', () => {
    expect(roundMoney(Number('abc'))).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });
});

describe('buildOrderTotals', () => {
  it('produces a snapshot whose parts add up exactly', () => {
    const totals = buildOrderTotals([{ price: 6, quantity: 2 }, { price: 4.5, quantity: 1 }], 0.1);
    expect(totals.subtotal).toBe(16.5);
    expect(totals.taxAmount).toBe(1.65);
    expect(totals.grandTotal).toBe(18.15);
    expect(roundMoney(totals.subtotal + totals.taxAmount)).toBe(totals.grandTotal);
  });

  it('keeps line rounding and total rounding consistent on fractional prices', () => {
    const items = [{ price: 3.333, quantity: 3 }, { price: 0.005, quantity: 1 }];
    const totals = buildOrderTotals(items, 0.14);
    const lineSum = roundMoney(items.reduce((s, i) => s + roundMoney(i.price * i.quantity), 0));
    expect(totals.subtotal).toBe(lineSum);
    expect(roundMoney(totals.subtotal + totals.taxAmount)).toBe(totals.grandTotal);
  });

  it('falls back to the shared default when handed an unusable rate', () => {
    const totals = buildOrderTotals([{ price: 10, quantity: 1 }], Number('x'));
    expect(totals.taxRate).toBe(DEFAULT_TAX_RATE);
    expect(totals.taxAmount).toBe(1);
  });

  it('treats an empty basket as zero, not NaN', () => {
    expect(buildOrderTotals([], 0.1)).toEqual({
      subtotal: 0, taxRate: 0.1, taxAmount: 0, grandTotal: 0,
    });
  });
});

describe('orderTotals', () => {
  it('returns the stored snapshot untouched instead of re-taxing it', () => {
    const order = { totalAmount: 18.15, subtotal: 16.5, taxRate: 0.1, taxAmount: 1.65, grandTotal: 18.15 };
    expect(orderTotals(order)).toEqual({ subtotal: 16.5, taxRate: 0.1, taxAmount: 1.65, grandTotal: 18.15 });
  });

  it('honours a stored zero grand total instead of treating it as missing', () => {
    const order = { totalAmount: 0, subtotal: 0, taxRate: 0.1, taxAmount: 0, grandTotal: 0 };
    expect(orderGrandTotal(order)).toBe(0);
  });

  it('derives tax for legacy rows that predate the snapshot columns', () => {
    expect(orderGrandTotal({ totalAmount: 20 }, 0.1)).toBe(22);
  });

  it('treats null snapshot fields as absent, including the tax rate', () => {
    expect(orderTotals({ totalAmount: 20, subtotal: null, taxRate: null, taxAmount: null, grandTotal: null }, 0.1))
      .toEqual({ subtotal: 20, taxRate: 0.1, taxAmount: 2, grandTotal: 22 });
  });

  it('preserves explicit zero snapshots and tax rates', () => {
    expect(orderTotals({ totalAmount: 20, subtotal: 0, taxRate: 0, taxAmount: 0, grandTotal: 0 }, 0.1))
      .toEqual({ subtotal: 0, taxRate: 0, taxAmount: 0, grandTotal: 0 });
  });

  it('prefers the order rate over the caller fallback', () => {
    expect(orderGrandTotal({ totalAmount: 100, taxRate: 0.2 }, 0.1)).toBe(120);
  });
});

describe('orderRevenue', () => {
  it('uses the amount actually collected when points were redeemed', () => {
    const order = { subtotal: 100, taxRate: 0.1, taxAmount: 10, grandTotal: 110, paidAmount: 60 };
    expect(orderRevenue(order)).toBe(60);
    expect(orderGrandTotal(order)).toBe(110);
  });

  it('falls back to the grand total when nothing was recorded as paid', () => {
    expect(orderRevenue({ subtotal: 100, taxRate: 0.1, taxAmount: 10, grandTotal: 110 })).toBe(110);
  });

  it('falls back for null paidAmount instead of recording zero collected', () => {
    expect(orderRevenue({ grandTotal: 110, paidAmount: null })).toBe(110);
    expect(orderRevenue({ totalAmount: 20, subtotal: null, taxRate: null, taxAmount: null, grandTotal: null, paidAmount: null }, 0.1)).toBe(22);
  });

  it('honours a fully discounted order', () => {
    const order = { subtotal: 50, taxRate: 0.1, taxAmount: 5, grandTotal: 55, paidAmount: 0 };
    expect(orderRevenue(order)).toBe(0);
  });
});

describe('lineItemTotal', () => {
  it('applies the order rate to a single line', () => {
    expect(lineItemTotal({ price: 6, quantity: 2 }, { taxRate: 0.1 })).toBe(13.2);
  });

  it('taxes a line at the rate the order was charged, not the rate configured today', () => {
    // Historical orders keep their own rate. Re-deriving from the current setting silently
    // re-priced every old sale, so last quarter's best-sellers revenue shifted whenever the
    // tax rate changed.
    const order = { subtotal: 100, taxRate: 0.1, taxAmount: 10, grandTotal: 110 };
    expect(lineItemTotal({ price: 100, quantity: 1 }, order)).toBe(110);
  });

  it('sums to the snapshot grand total across all lines of an order', () => {
    const items = [{ price: 6, quantity: 2 }, { price: 4.5, quantity: 1 }];
    const snapshot = buildOrderTotals(items, 0.1);
    const summed = roundMoney(items.reduce((s, i) => s + lineItemTotal(i, snapshot), 0));
    expect(summed).toBe(snapshot.grandTotal);
  });
});

describe('allocateOrderRevenue', () => {
  const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0);

  it('allocates three 0.05 lines at 10% to the 0.17 order total, not 0.18', () => {
    const items = Array.from({ length: 3 }, () => ({ price: 0.05, quantity: 1 }));
    const order = buildOrderTotals(items, 0.1);
    expect(order.grandTotal).toBe(0.17);
    const allocated = allocateOrderRevenue(items, order);
    expect(allocated).toEqual([0.06, 0.06, 0.05]);
    expect(cents(allocated)).toBe(17);
  });

  it('allocates actual discounted payment and breaks equal remainders by line order', () => {
    const items = Array.from({ length: 3 }, () => ({ price: 0.05, quantity: 1 }));
    const order = { ...buildOrderTotals(items, 0.1), paidAmount: 0.10 };
    expect(allocateOrderRevenue(items, order)).toEqual([0.04, 0.03, 0.03]);
    expect(cents(allocateOrderRevenue(items, order))).toBe(10);
  });

  it('uses line weights rather than snapshot subtotal and gives the largest remainder its cent', () => {
    const items = [{ price: 1, quantity: 1 }, { price: 1, quantity: 2 }, { price: 0, quantity: 1 }];
    const order = { subtotal: 999, grandTotal: 999, paidAmount: 0.02 };
    expect(allocateOrderRevenue(items, order)).toEqual([0.01, 0.01, 0]);
  });

  it('allocates no revenue to fully discounted orders', () => {
    const items = [{ price: 10, quantity: 1 }, { price: 20, quantity: 1 }];
    expect(allocateOrderRevenue(items, { grandTotal: 33, paidAmount: 0 })).toEqual([0, 0]);
  });

  it('splits collected cents evenly when all line values are zero', () => {
    const items = Array.from({ length: 3 }, () => ({ price: 0, quantity: 1 }));
    expect(allocateOrderRevenue(items, { paidAmount: 0.05 })).toEqual([0.02, 0.02, 0.01]);
    expect(allocateOrderRevenue(items, { paidAmount: 0 })).toEqual([0, 0, 0]);
  });

  it('falls back through null paidAmount and snapshot fields for legacy orders', () => {
    const items = Array.from({ length: 3 }, () => ({ price: 0.05, quantity: 1 }));
    const order = { totalAmount: 0.15, subtotal: null, taxRate: null, taxAmount: null, grandTotal: null, paidAmount: null };
    expect(allocateOrderRevenue(items, order, 0.1)).toEqual([0.06, 0.06, 0.05]);
    expect(allocateOrderRevenue(items, { ...order, grandTotal: 0.16 }, 0.1)).toEqual([0.06, 0.05, 0.05]);
  });

  it('preserves the sign if stored revenue is negative', () => {
    const items = [{ price: 1, quantity: 1 }, { price: 1, quantity: 1 }];
    expect(allocateOrderRevenue(items, { paidAmount: -0.03 })).toEqual([-0.02, -0.01]);
  });

  it('returns no allocations when an order has no lines', () => {
    expect(allocateOrderRevenue([], { paidAmount: 10 })).toEqual([]);
  });

  it('conserves collected cents over differing quantities, tax rates and discounts', () => {
    for (let count = 1; count <= 12; count++) {
      const items = Array.from({ length: count }, (_, index) => ({ price: (index + 1) * 0.05, quantity: index % 3 + 1 }));
      for (const taxRate of [0, 0.1, 0.14]) {
        const snapshot = buildOrderTotals(items, taxRate);
        for (const discount of [0, 0.01, 0.07, snapshot.grandTotal]) {
          const order = { ...snapshot, paidAmount: roundMoney(Math.max(0, snapshot.grandTotal - discount)) };
          const allocated = allocateOrderRevenue(items, order);
          expect(allocated).toHaveLength(items.length);
          expect(cents(allocated)).toBe(Math.round(orderRevenue(order) * 100));
          expect(allocated.every(value => value >= 0)).toBe(true);
        }
      }
    }
  });
});

describe('aggregate consistency', () => {
  it('keeps the sum of displayed invoices equal to the reported revenue', () => {
    const baskets = [
      [{ price: 3.33, quantity: 3 }],
      [{ price: 0.99, quantity: 7 }],
      [{ price: 12.345, quantity: 2 }, { price: 1.115, quantity: 1 }],
    ];
    const orders = baskets.map(items => buildOrderTotals(items, 0.14));

    const displayedSum = roundMoney(
      orders.reduce((s, o) => s + Number(orderGrandTotal(o).toFixed(2)), 0)
    );
    const reportedRevenue = roundMoney(orders.reduce((s, o) => s + orderRevenue(o), 0));

    expect(displayedSum).toBe(reportedRevenue);
  });
});
