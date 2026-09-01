import { InventoryItem, RecipeIngredient } from '../global';
import { MenuItem } from '../types/menu';

/**
 * Average selling value that one unit of a stock item yields, keyed by item id.
 *
 * An ingredient can appear in several recipes at different quantities, so the yield is
 * averaged over every recipe that uses it. Items with no recipe mapping yield 0 rather
 * than being omitted, so callers can index the map without a presence check.
 */
export function computeItemYields(
  inventory: InventoryItem[],
  recipes: RecipeIngredient[],
  menuItems: MenuItem[]
): Record<string, number> {
  const recipeGroups: Record<string, { menuItemId: string; quantity: number }[]> = {};
  for (const recipe of recipes) {
    // A row with no menu item cannot be priced, so it yields nothing.
    if (!recipe.menuItemId) continue;
    if (!recipeGroups[recipe.inventoryItemId]) {
      recipeGroups[recipe.inventoryItemId] = [];
    }
    recipeGroups[recipe.inventoryItemId].push({
      menuItemId: recipe.menuItemId,
      quantity: recipe.quantity,
    });
  }

  const menuMap = new Map(menuItems.map(item => [item.id, item]));
  const yields: Record<string, number> = {};

  for (const item of inventory) {
    const itemRecipes = recipeGroups[item.id] || [];
    let totalYield = 0;
    let validCount = 0;

    for (const recipe of itemRecipes) {
      const menuItem = menuMap.get(recipe.menuItemId);
      if (menuItem && recipe.quantity > 0) {
        totalYield += menuItem.price / recipe.quantity;
        validCount++;
      }
    }

    yields[item.id] = validCount > 0 ? totalYield / validCount : 0;
  }

  return yields;
}

export interface StockValuation {
  /** What the quantity on hand cost to buy. */
  costValue: number;
  /** What the quantity on hand is expected to sell for once turned into menu items. */
  potentialSales: number;
  /** Sales minus cost, floored at zero so an unprofitable recipe never reads as negative profit. */
  potentialProfit: number;
}

/** Valuation of an arbitrary quantity of one stock item. */
export function valuateQuantity(
  quantity: number,
  costPerUnit: number,
  averageYield: number
): StockValuation {
  const costValue = quantity * costPerUnit;
  const potentialSales = quantity * averageYield;
  return {
    costValue,
    potentialSales,
    potentialProfit: potentialSales > 0 ? Math.max(potentialSales - costValue, 0) : 0,
  };
}

/** Valuation of the quantity currently on hand for one stock item. */
export function valuateStockItem(
  item: InventoryItem,
  itemYields: Record<string, number>
): StockValuation {
  return valuateQuantity(item.stock, item.costPerUnit, itemYields[item.id] || 0);
}

export interface InventorySummary {
  totalItems: number;
  lowStockCount: number;
  totalCostValue: number;
  totalPotentialProfit: number;
}

export function summarizeInventory(
  inventory: InventoryItem[],
  itemYields: Record<string, number>
): InventorySummary {
  let totalCostValue = 0;
  let totalPotentialProfit = 0;
  let lowStockCount = 0;

  for (const item of inventory) {
    const valuation = valuateStockItem(item, itemYields);
    totalCostValue += valuation.costValue;
    totalPotentialProfit += valuation.potentialProfit;
    if (item.stock <= item.minStock) lowStockCount++;
  }

  return {
    totalItems: inventory.length,
    lowStockCount,
    totalCostValue,
    totalPotentialProfit,
  };
}

export function isLowStock(item: InventoryItem): boolean {
  return item.stock <= item.minStock;
}
