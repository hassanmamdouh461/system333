import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildOrderTotals,
  orderTotals,
  orderGrandTotal,
  orderRevenue,
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

  it('honours a fully discounted order', () => {
    const order = { subtotal: 50, taxRate: 0.1, taxAmount: 5, grandTotal: 55, paidAmount: 0 };
    expect(orderRevenue(order)).toBe(0);
  });
});

describe('lineItemTotal', () => {
  it('applies the order rate to a single line', () => {
    expect(lineItemTotal({ price: 6, quantity: 2 }, { taxRate: 0.1 })).toBe(13.2);
  });

  it('sums to the snapshot grand total across all lines of an order', () => {
    const items = [{ price: 6, quantity: 2 }, { price: 4.5, quantity: 1 }];
    const snapshot = buildOrderTotals(items, 0.1);
    const summed = roundMoney(items.reduce((s, i) => s + lineItemTotal(i, snapshot), 0));
    expect(summed).toBe(snapshot.grandTotal);
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
