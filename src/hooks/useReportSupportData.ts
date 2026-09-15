import { useEffect, useState } from 'react';
import { inventoryService } from '../services/inventoryService';
import { menuService } from '../services/menuService';
import { MenuItem } from '../types/menu';
import { InventoryItem, RecipeIngredient } from '../global';

export interface ReportSupportData {
  inventory: InventoryItem[];
  recipes: RecipeIngredient[];
  menuItems: MenuItem[];
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the stock, recipe and menu data that the reports page needs on top of
 * order analytics.
 */
export function useReportSupportData(): ReportSupportData {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      inventoryService.getAll(),
      inventoryService.getMenuRecipes(),
      menuService.getAll(),
    ])
      .then(([inventoryList, recipeList, menuList]) => {
        if (!active) return;
        setInventory(inventoryList);
        setRecipes(recipeList);
        setMenuItems(menuList);
      })
      .catch(err => {
        if (!active) return;
        console.error('[Reports] Failed to load supporting report data:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return { inventory, recipes, menuItems, loading, error };
}
