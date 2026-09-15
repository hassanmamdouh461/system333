import { getTaxRate, DEFAULT_TAX_RATE } from './settingsConfig';

/** Money is stored and compared at two decimals; anything finer is a rounding artefact. */
export const MONEY_DECIMALS = 2;

export { DEFAULT_TAX_RATE };

/**
 * Coerce a value that came off the network or out of storage into a usable number.
 * `Number(null)` is 0 and `Number('abc')` is NaN, and one NaN propagates through every
 * subsequent sum, so a single malformed row would otherwise render every total as NaN.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Round to the currency's smallest unit. Values are scaled before rounding because
 * `Math.round(1.005 * 100) / 100` and `(1.005).toFixed(2)` disagree on binary-float
 * midpoints; using the scaled epsilon keeps the two consistent.
 */
export function roundMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** MONEY_DECIMALS;
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * factor) / factor;
}

export interface OrderTotalsSnapshot {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
}

export interface OrderTotalFields {
  totalAmount?: number | null;
  subtotal?: number | null;
  grandTotal?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  paidAmount?: number | null;
}

interface PricedLine {
  quantity: number;
  price: number;
}

/**
 * The only place an order's money is computed from scratch. Every creation path must call
 * this and store all four fields, so no reader ever has to guess whether a stored number
 * already includes tax.
 *
 * Rounding happens per line, then on the subtotal, then on the tax — in that order — so the
 * printed lines always add up to the printed total.
 */
export function buildOrderTotals(items: PricedLine[], taxRate: number): OrderTotalsSnapshot {
  const rate = Number.isFinite(Number(taxRate)) ? Number(taxRate) : DEFAULT_TAX_RATE;
  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + roundMoney(toFiniteNumber(item.price) * toFiniteNumber(item.quantity)), 0)
  );
  const taxAmount = roundMoney(subtotal * rate);
  return { subtotal, taxRate: rate, taxAmount, grandTotal: roundMoney(subtotal + taxAmount) };
}

/**
 * Read an order's money back out. The stored snapshot is authoritative and is never
 * recomputed; the derived branch exists only for rows written before the snapshot columns
 * existed, where `totalAmount` held a pre-tax subtotal.
 */
export function orderTotals(order: OrderTotalFields, fallbackTaxRate?: number): OrderTotalsSnapshot {
  const rate = order.taxRate != null && Number.isFinite(Number(order.taxRate))
    ? Number(order.taxRate)
    : fallbackTaxRate ?? getTaxRate();

  // SQL NULL means no snapshot, not a recorded zero (matching Electron's null guards).
  const storedSubtotal = Number(order.subtotal ?? NaN);
  const storedGrandTotal = Number(order.grandTotal ?? NaN);
  const storedTaxAmount = Number(order.taxAmount ?? NaN);

  const subtotal = Number.isFinite(storedSubtotal)
    ? roundMoney(storedSubtotal)
    : roundMoney(toFiniteNumber(order.totalAmount));

  const taxAmount = Number.isFinite(storedTaxAmount)
    ? roundMoney(storedTaxAmount)
    : roundMoney(subtotal * rate);

  const grandTotal = Number.isFinite(storedGrandTotal)
    ? roundMoney(storedGrandTotal)
    : roundMoney(subtotal + taxAmount);

  return { subtotal, taxRate: rate, taxAmount, grandTotal };
}

/** What the customer owes for this order, tax included. */
export function orderGrandTotal(order: OrderTotalFields, fallbackTaxRate?: number): number {
  return orderTotals(order, fallbackTaxRate).grandTotal;
}

/**
 * What actually landed in the till. Differs from the grand total whenever loyalty points
 * were redeemed, so revenue reporting must use this and never the grand total.
 */
export function orderRevenue(order: OrderTotalFields, fallbackTaxRate?: number): number {
  const paid = Number(order.paidAmount ?? NaN);
  if (Number.isFinite(paid)) return roundMoney(paid);
  return orderGrandTotal(order, fallbackTaxRate);
}

/**
 * Allocate collected revenue (including tax and discounts) in whole cents across ALL lines.
 * Largest fractional remainders receive the leftover cents, with input order breaking ties.
 * If every line is zero, split evenly; an empty order has no lines to allocate to.
 */
export function allocateOrderRevenue(
  items: PricedLine[],
  order: OrderTotalFields,
  fallbackTaxRate?: number
): number[] {
  if (items.length === 0) return [];

  const revenue = orderRevenue(order, fallbackTaxRate);
  const targetCents = Math.round(Math.abs(revenue) * 100);
  let weights = items.map(item =>
    Math.max(0, Math.round(roundMoney(toFiniteNumber(item.price) * toFiniteNumber(item.quantity)) * 100))
  );
  let totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    weights = items.map(() => 1);
    totalWeight = items.length;
  }

  const shares = weights.map((weight, index) => {
    const numerator = targetCents * weight;
    return { index, cents: Math.floor(numerator / totalWeight), remainder: numerator % totalWeight };
  });
  const remaining = targetCents - shares.reduce((sum, share) => sum + share.cents, 0);
  const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) ranked[i].cents++;

  return shares.map(share => share.cents === 0 ? 0 : Math.sign(revenue) * share.cents / 100);
}

/**
 * Standalone tax-inclusive line estimate using the stored snapshot when available.
 * Independent rounding cannot reconcile an order; revenue reports must use
 * allocateOrderRevenue for the entire basket instead.
 */
export function lineItemTotal(
  item: PricedLine,
  order?: OrderTotalFields,
  fallbackTaxRate?: number
): number {
  const gross = roundMoney(toFiniteNumber(item.quantity) * toFiniteNumber(item.price));

  const totals = order ? orderTotals(order, fallbackTaxRate) : null;
  if (totals && totals.subtotal > 0) {
    return roundMoney(gross * (totals.grandTotal / totals.subtotal));
  }

  const rate = order?.taxRate != null && Number.isFinite(Number(order.taxRate))
    ? Number(order.taxRate)
    : fallbackTaxRate ?? getTaxRate();
  return roundMoney(gross * (1 + rate));
}
