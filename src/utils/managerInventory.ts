import { MenuItem } from '../types/menu';
import { ManagerInventoryRow, ManagerOrderRow } from '../services/managerDataService';
import {
  INITIAL_STOCKS,
  ItemRecipes,
  ManagerInventoryItem,
} from '../data/managerInventorySeed';
import { parseOrderItems } from './managerAnalytics';
import { roundMoney } from './orderTotals';

export const BRANCH_IDS = ['branch_1', 'branch_2', 'branch_3'] as const;

/** Fallback opening stock when neither the seed nor the row carries one. */
const DEFAULT_STARTING_STOCK = 100;

export interface BranchStockLevel {
  remaining: number;
  consumed: number;
  startStock: number;
  /** Remaining as a share of opening stock, capped at 100. */
  percentage: number;
  isLow: boolean;
}

export interface ManagerStockRow extends ManagerInventoryItem {
  branches: Record<string, BranchStockLevel>;
}

/**
 * Turns live stock rows into the shape the dashboard renders, falling back to the seed
 * catalogue when the database has no stock. Opening stock is scaled from the current level
 * for live rows because the database records only what is left, not what was received.
 */
export function buildInventoryCatalogue(
  dbInventory: ManagerInventoryRow[],
  fallback: ManagerInventoryItem[]
): ManagerInventoryItem[] {
  if (dbInventory.length === 0) return fallback;

  return dbInventory.map(item => {
    const startValue = INITIAL_STOCKS[item.$id] || item.stock * 1.5 || DEFAULT_STARTING_STOCK;
    return {
      id: item.$id,
      nameAr: item.name,
      nameEn: item.name,
      unit: item.unit,
      unitAr: item.unit,
      costPerUnit: item.costPerUnit,
      startingStock: Object.fromEntries(
        BRANCH_IDS.map(branchId => [branchId, item.branch_id === branchId ? startValue : 0])
      ),
      minStock: item.minStock,
    };
  });
}

/** Maps live recipe rows into the seed's shape, falling back when there are none. */
export function buildRecipeCatalogue(dbRecipes: unknown[], fallback: ItemRecipes): ItemRecipes {
  if (dbRecipes.length === 0) return fallback;

  const mapped: ItemRecipes = {};
  for (const raw of dbRecipes as Array<{ menuItemId: string; inventoryItemId: string; quantity: number }>) {
    if (!mapped[raw.menuItemId]) mapped[raw.menuItemId] = {};
    mapped[raw.menuItemId][raw.inventoryItemId] = raw.quantity;
  }
  return mapped;
}

/** How much of each stock item every branch has consumed, derived from its orders. */
function computeConsumption(
  orders: ManagerOrderRow[],
  recipes: ItemRecipes
): Record<string, Record<string, number>> {
  const consumption: Record<string, Record<string, number>> = {};
  for (const branchId of BRANCH_IDS) consumption[branchId] = {};

  for (const order of orders) {
    const branch = consumption[order.branch_id];
    if (!branch) continue;

    for (const item of parseOrderItems(order.items)) {
      // Recipes may be keyed by menu item id or by name depending on their origin.
      const recipe = recipes[item.id] || recipes[item.menuItemId || ''] || recipes[item.name];
      if (!recipe) continue;
      for (const [stockId, quantityPerUnit] of Object.entries(recipe)) {
        branch[stockId] = (branch[stockId] || 0) + quantityPerUnit * item.quantity;
      }
    }
  }

  return consumption;
}

/**
 * Per-branch stock levels for every catalogue item.
 *
 * Consumption derived from orders is only an estimate; where the database reports an
 * actual level for a branch it wins, because that number reflects deliveries and manual
 * adjustments the order history cannot see.
 */
export function buildStockRows(
  orders: ManagerOrderRow[],
  catalogue: ManagerInventoryItem[],
  recipes: ItemRecipes,
  dbInventory: ManagerInventoryRow[]
): ManagerStockRow[] {
  const consumption = computeConsumption(orders, recipes);

  return catalogue.map(item => {
    const branches: Record<string, BranchStockLevel> = {};

    for (const branchId of BRANCH_IDS) {
      const startStock =
        INITIAL_STOCKS[item.id] || item.startingStock?.[branchId] || DEFAULT_STARTING_STOCK;
      const consumed = consumption[branchId]?.[item.id] || 0;

      const liveRow = dbInventory.find(row => row.$id === item.id && row.branch_id === branchId);
      const remaining = liveRow ? liveRow.stock : Math.max(startStock - consumed, 0);

      branches[branchId] = {
        remaining: roundMoney(remaining),
        consumed: roundMoney(consumed),
        startStock,
        percentage: startStock > 0 ? Math.min(Math.round((remaining / startStock) * 100), 100) : 0,
        isLow: remaining <= item.minStock,
      };
    }

    return { ...item, branches };
  });
}

/**
 * Average selling value one unit of each stock item yields, averaged across every recipe
 * that uses it. Recipes whose menu item has no known price are skipped rather than
 * counted as zero, which would understate the yield.
 */
export function computeMaterialYields(
  catalogue: ManagerInventoryItem[],
  recipes: ItemRecipes,
  menuItems: MenuItem[]
): Record<string, number> {
  const yields: Record<string, number> = {};

  for (const item of catalogue) {
    let totalYield = 0;
    let validCount = 0;

    for (const [menuKey, recipe] of Object.entries(recipes)) {
      const quantity = recipe[item.id];
      if (!quantity || quantity <= 0) continue;

      const menuItem = menuItems.find(m => m.name === menuKey || m.id === menuKey);
      if (menuItem && menuItem.price > 0) {
        totalYield += menuItem.price / quantity;
        validCount++;
      }
    }

    yields[item.id] = validCount > 0 ? totalYield / validCount : 0;
  }

  return yields;
}

export interface ManagerInventorySummary {
  totalValue: number;
  totalSalesValue: number;
  totalProfitValue: number;
  lowStockCount: number;
  totalItems: number;
}

export function summarizeManagerInventory(
  stockRows: ManagerStockRow[],
  selectedBranch: string,
  materialYields: Record<string, number>
): ManagerInventorySummary {
  const branchIds = selectedBranch === 'all' ? [...BRANCH_IDS] : [selectedBranch];
  const summary: ManagerInventorySummary = {
    totalValue: 0,
    totalSalesValue: 0,
    totalProfitValue: 0,
    lowStockCount: 0,
    totalItems: 0,
  };

  for (const row of stockRows) {
    for (const branchId of branchIds) {
      const level = row.branches[branchId];
      if (!level) continue;

      const costValue = level.remaining * row.costPerUnit;
      const salesValue = level.remaining * (materialYields[row.id] || 0);

      summary.totalValue += costValue;
      summary.totalSalesValue += salesValue;
      summary.totalProfitValue += salesValue > 0 ? Math.max(salesValue - costValue, 0) : 0;
      if (level.isLow) summary.lowStockCount++;
      summary.totalItems++;
    }
  }

  summary.totalValue = roundMoney(summary.totalValue);
  summary.totalSalesValue = roundMoney(summary.totalSalesValue);
  summary.totalProfitValue = roundMoney(summary.totalProfitValue);
  return summary;
}
