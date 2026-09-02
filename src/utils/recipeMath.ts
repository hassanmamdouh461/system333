import { InventoryItem, RecipeIngredient } from '../global';
import { MenuItem } from '../types/menu';

/**
 * Recipe costing: what a menu item costs to make, and how many portions the stock on hand
 * can still produce.
 *
 * `inventoryMath` answers the inverse question — what one unit of a raw material is worth —
 * so the two files share the same tables but never the same direction.
 */

/** Ingredient lines of every menu item, keyed by menu item id. */
export function groupRecipesByMenuItem(
  recipes: RecipeIngredient[]
): Map<string, RecipeIngredient[]> {
  const grouped = new Map<string, RecipeIngredient[]>();
  for (const line of recipes) {
    if (!line.menuItemId) continue;
    const existing = grouped.get(line.menuItemId);
    if (existing) existing.push(line);
    else grouped.set(line.menuItemId, [line]);
  }
  return grouped;
}

/** Menu items that consume each raw material, keyed by inventory item id. */
export function groupRecipesByInventoryItem(
  recipes: RecipeIngredient[]
): Map<string, RecipeIngredient[]> {
  const grouped = new Map<string, RecipeIngredient[]>();
  for (const line of recipes) {
    const existing = grouped.get(line.inventoryItemId);
    if (existing) existing.push(line);
    else grouped.set(line.inventoryItemId, [line]);
  }
  return grouped;
}

export interface RecipeCosting {
  menuItemId: string;
  menuItemName: string;
  price: number;
  /** How many ingredient lines the recipe has; zero means it was never mapped. */
  ingredientCount: number;
  /** Raw material cost of one portion. */
  cost: number;
  /** Price minus cost. Negative when the recipe costs more than the item sells for. */
  profit: number;
  /** Profit as a percentage of price; zero when the item is free or unpriced. */
  marginPercent: number;
  /**
   * Whole portions the stock on hand can still produce, limited by the scarcest ingredient.
   * Null when the item has no recipe, which is different from a recipe that can make none.
   */
  buildablePortions: number | null;
  /** The ingredient that runs out first, so a shortage names the material to buy. */
  limitingItemId: string | null;
  limitingItemName: string | null;
}

/**
 * Costs every menu item against the current stock levels.
 *
 * A line whose inventory item no longer exists is skipped rather than counted as free: a
 * deleted material removes its recipe rows, so this only happens for a stale in-memory list.
 */
export function costRecipes(
  menuItems: MenuItem[],
  recipes: RecipeIngredient[],
  inventory: InventoryItem[]
): RecipeCosting[] {
  const byMenuItem = groupRecipesByMenuItem(recipes);
  const stockById = new Map(inventory.map(item => [item.id, item]));

  return menuItems.map(menuItem => {
    const lines = byMenuItem.get(menuItem.id) ?? [];
    let cost = 0;
    let ingredientCount = 0;
    let buildablePortions: number | null = null;
    let limitingItem: InventoryItem | null = null;

    for (const line of lines) {
      const material = stockById.get(line.inventoryItemId);
      if (!material || line.quantity <= 0) continue;

      ingredientCount++;
      cost += material.costPerUnit * line.quantity;

      const portions = Math.floor(material.stock / line.quantity);
      if (buildablePortions === null || portions < buildablePortions) {
        buildablePortions = portions;
        limitingItem = material;
      }
    }

    const profit = menuItem.price - cost;
    return {
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      price: menuItem.price,
      ingredientCount,
      cost,
      profit,
      marginPercent: menuItem.price > 0 ? (profit / menuItem.price) * 100 : 0,
      buildablePortions,
      limitingItemId: limitingItem?.id ?? null,
      limitingItemName: limitingItem?.name ?? null,
    };
  });
}

export interface RecipeSummary {
  /** Menu items with at least one ingredient mapped. */
  mappedCount: number;
  /** Menu items with no recipe, so a sale of them deducts no stock at all. */
  unmappedCount: number;
  /** Mapped items whose stock cannot produce a single portion. */
  outOfStockCount: number;
  /** Mapped items that cost more to make than they sell for. */
  losingMoneyCount: number;
  /** Average margin across mapped, priced items. */
  averageMarginPercent: number;
}

export function summarizeRecipes(costings: RecipeCosting[]): RecipeSummary {
  let mappedCount = 0;
  let outOfStockCount = 0;
  let losingMoneyCount = 0;
  let marginTotal = 0;
  let marginCount = 0;

  for (const costing of costings) {
    if (costing.ingredientCount === 0) continue;

    mappedCount++;
    if (costing.buildablePortions === 0) outOfStockCount++;
    if (costing.profit < 0) losingMoneyCount++;
    if (costing.price > 0) {
      marginTotal += costing.marginPercent;
      marginCount++;
    }
  }

  return {
    mappedCount,
    unmappedCount: costings.length - mappedCount,
    outOfStockCount,
    losingMoneyCount,
    averageMarginPercent: marginCount > 0 ? marginTotal / marginCount : 0,
  };
}

/** Raw material cost of a draft recipe, for the live total while editing. */
export function draftRecipeCost(
  lines: Array<{ inventoryItemId: string; quantity: number }>,
  inventory: InventoryItem[]
): number {
  const stockById = new Map(inventory.map(item => [item.id, item]));
  return lines.reduce((total, line) => {
    const material = stockById.get(line.inventoryItemId);
    return material ? total + material.costPerUnit * line.quantity : total;
  }, 0);
}
