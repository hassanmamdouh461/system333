import { Order } from '../types/order';
import { InventoryItem, RecipeIngredient } from '../global';
import { orderRevenue, roundMoney } from './orderTotals';

/** Ingredient cost of one unit of each menu item, keyed by menu item id. */
export function computeRecipeCosts(
  recipes: RecipeIngredient[],
  inventory: InventoryItem[]
): Record<string, number> {
  const costPerUnit = new Map(inventory.map(item => [item.id, item.costPerUnit]));
  const costs: Record<string, number> = {};
  for (const recipe of recipes) {
    // A row with no menu item cannot be attributed to a product's cost.
    if (!recipe.menuItemId) continue;
    const unitCost = costPerUnit.get(recipe.inventoryItemId) ?? 0;
    costs[recipe.menuItemId] = (costs[recipe.menuItemId] || 0) + recipe.quantity * unitCost;
  }
  return costs;
}

/** Ingredient cost of every paid order in the period. */
export function computeCogs(
  paidOrders: Order[],
  recipeCosts: Record<string, number>
): number {
  let cogs = 0;
  for (const order of paidOrders) {
    for (const item of order.items) {
      cogs += (recipeCosts[item.menuItemId || item.id] || 0) * item.quantity;
    }
  }
  return roundMoney(cogs);
}

/**
 * Revenue is collected tax-inclusive, so the tax amount is removed before subtracting
 * ingredient cost.
 *
 * The result is signed and is NOT floored at zero. It used to be, and that made the cashier
 * screen show 0 for a loss-making period while the manager portal (analytics.ts, which has
 * no floor) showed the real negative number for the same day — two different profits from
 * one set of orders, with nothing on screen explaining the difference. Money maths belongs
 * in one place; deciding how a loss *looks* is the view's job.
 *
 * Callers that display this in a card should render `Math.max(0, value)` and surface a loss
 * indicator when the value is negative — see `formatProfitForDisplay`.
 */
export function computeNetProfit(revenue: number, taxAmount: number, cogs: number): number {
  return roundMoney(revenue - taxAmount - cogs);
}

/**
 * How a profit figure is shown: the magnitude is always positive, and the sign is carried
 * separately so a UI can label a loss instead of hiding it behind a zero.
 */
export function formatProfitForDisplay(netProfit: number): {
  amount: number;
  isLoss: boolean;
} {
  const value = roundMoney(netProfit);
  return { amount: Math.abs(value), isLoss: value < 0 };
}

export interface InvoiceStats {
  paidCount: number;
  openCount: number;
  paidAmount: number;
  openAmount: number;
  totalCount: number;
}

export function summarizeInvoices(orders: Order[]): InvoiceStats {
  let paidCount = 0;
  let openCount = 0;
  let paidAmount = 0;
  let openAmount = 0;

  for (const order of orders) {
    const total = orderRevenue(order);
    if (order.paymentStatus === 'Paid') {
      paidCount++;
      paidAmount += total;
    } else if (order.paymentStatus === 'Unpaid') {
      openCount++;
      openAmount += total;
    }
  }

  return {
    paidCount,
    openCount,
    paidAmount: roundMoney(paidAmount),
    openAmount: roundMoney(openAmount),
    totalCount: paidCount + openCount,
  };
}

export interface PaymentMethodStats {
  cashAmount: number;
  cardAmount: number;
  totalAmount: number;
  cashPercentage: number;
  cardPercentage: number;
}

export function summarizePaymentMethods(paidOrders: Order[]): PaymentMethodStats {
  let cashAmount = 0;
  let cardAmount = 0;

  for (const order of paidOrders) {
    const total = orderRevenue(order);
    if (order.paymentMethod === 'Cash') cashAmount += total;
    else if (order.paymentMethod === 'Card') cardAmount += total;
  }

  const totalAmount = cashAmount + cardAmount;
  // Card is derived by subtraction, not by rounding the same ratio twice. Two independent
  // Math.round calls can both round up — 50.5 + 49.5 became 51% + 50% = 101% — and a split
  // that does not add to 100 is read as a bug in the totals, not as rounding.
  const cashPercentage = totalAmount > 0 ? Math.round((cashAmount / totalAmount) * 100) : 0;
  return {
    cashAmount: roundMoney(cashAmount),
    cardAmount: roundMoney(cardAmount),
    totalAmount: roundMoney(totalAmount),
    cashPercentage,
    cardPercentage: totalAmount > 0 ? 100 - cashPercentage : 0,
  };
}

export interface OrderModeStats {
  takeaway: number;
  dineIn: number;
  total: number;
}

export function summarizeOrderModes(orders: Order[]): OrderModeStats {
  let takeaway = 0;
  let dineIn = 0;

  for (const order of orders) {
    if (order.tableId === 'Takeaway') takeaway++;
    else dineIn++;
  }

  return { takeaway, dineIn, total: takeaway + dineIn };
}
