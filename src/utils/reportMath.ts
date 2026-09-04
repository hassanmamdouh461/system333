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
 * ingredient cost. Floored at zero: a negative figure on a profit card reads as a data
 * problem rather than a loss.
 */
export function computeNetProfit(revenue: number, taxAmount: number, cogs: number): number {
  return Math.max(0, roundMoney(revenue - taxAmount - cogs));
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
  return {
    cashAmount: roundMoney(cashAmount),
    cardAmount: roundMoney(cardAmount),
    totalAmount: roundMoney(totalAmount),
    cashPercentage: totalAmount > 0 ? Math.round((cashAmount / totalAmount) * 100) : 0,
    cardPercentage: totalAmount > 0 ? Math.round((cardAmount / totalAmount) * 100) : 0,
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
