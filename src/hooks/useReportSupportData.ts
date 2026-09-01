import { useEffect, useState } from 'react';
import { customersService } from '../services/customersService';
import { inventoryService } from '../services/inventoryService';
import { menuService } from '../services/menuService';
import { Customer } from '../types/customer';
import { MenuItem } from '../types/menu';
import { InventoryItem, RecipeIngredient } from '../global';

export interface ReportSupportData {
  customers: Customer[];
  inventory: InventoryItem[];
  recipes: RecipeIngredient[];
  menuItems: MenuItem[];
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the customer, stock, recipe and menu data that the reports page needs on top of
 * order analytics.
 *
 * These four feed cost of goods sold, stock valuation and loyalty. Swallowing their
 * failures to the console made an unreachable database render as genuine zeros, so a
 * failure is surfaced as an error the page can block on. Results are dropped if the
 * component unmounted first.
 */
export function useReportSupportData(): ReportSupportData {
  const [customers, setCustomers] = useState<Customer[]>([]);
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
      customersService.getAll(),
      inventoryService.getAll(),
      inventoryService.getMenuRecipes(),
      menuService.getAll(),
    ])
      .then(([customerList, inventoryList, recipeList, menuList]) => {
        if (!active) return;
        setCustomers(customerList);
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

  return { customers, inventory, recipes, menuItems, loading, error };
}
