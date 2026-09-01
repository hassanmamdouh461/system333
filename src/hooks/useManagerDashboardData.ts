import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTaxRate } from '../utils/settingsConfig';
import { useMenu } from './useMenu';
import {
  ManagerCustomerRow,
  ManagerInventoryRow,
  ManagerOrderRow,
  fetchManagerSnapshot,
} from '../services/managerDataService';
import { generateDemoOrders } from '../data/managerDemoOrders';
import {
  FALLBACK_INVENTORY_ITEMS,
  FALLBACK_ITEM_RECIPES,
} from '../data/managerInventorySeed';
import {
  AnalyticsPeriod,
  ManagerAnalytics,
  computeManagerAnalytics,
} from '../utils/managerAnalytics';
import {
  ManagerInventorySummary,
  ManagerStockRow,
  buildInventoryCatalogue,
  buildRecipeCatalogue,
  buildStockRows,
  computeMaterialYields,
  summarizeManagerInventory,
} from '../utils/managerInventory';

export interface UseManagerDashboardDataOptions {
  selectedBranch: string;
  period: AnalyticsPeriod;
  language: 'ar' | 'en';
  customerSearchTerm: string;
}

export interface UseManagerDashboardDataResult {
  loading: boolean;
  /** True when the central database was unreachable and demo rows are being shown. */
  isDemoMode: boolean;
  errorInfo: string | null;
  refresh: () => void;

  orders: ManagerOrderRow[];
  customers: ManagerCustomerRow[];
  filteredCustomers: ManagerCustomerRow[];

  analytics: ManagerAnalytics;
  stockRows: ManagerStockRow[];
  materialYields: Record<string, number>;
  inventorySummary: ManagerInventorySummary;
  taxRate: number;
}

/**
 * Loads the manager snapshot and derives everything the dashboard tabs render.
 *
 * All fetches run behind a monotonic token: the refresh button can fire repeatedly and the
 * queries complete in arbitrary order, so only the newest run may commit — otherwise the
 * totals depend on which response happened to land last.
 */
export function useManagerDashboardData({
  selectedBranch,
  period,
  language,
  customerSearchTerm,
}: UseManagerDashboardDataOptions): UseManagerDashboardDataResult {
  const { items: menuItems } = useMenu();
  const taxRate = getTaxRate();

  const [orders, setOrders] = useState<ManagerOrderRow[]>([]);
  const [customers, setCustomers] = useState<ManagerCustomerRow[]>([]);
  const [dbInventory, setDbInventory] = useState<ManagerInventoryRow[]>([]);
  const [dbRecipes, setDbRecipes] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  const fetchIdRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    const isCurrent = () => fetchId === fetchIdRef.current && mountedRef.current;

    setLoading(true);
    setErrorInfo(null);
    try {
      const snapshot = await fetchManagerSnapshot();
      if (!isCurrent()) return;
      setOrders(snapshot.orders);
      setCustomers(snapshot.customers);
      setDbInventory(snapshot.inventory);
      setDbRecipes(snapshot.recipes);
      setIsDemoMode(false);
    } catch (err) {
      if (!isCurrent()) return;
      console.warn('[ManagerDashboard] Central database fetch failed; switching to demo mode.', err);
      setErrorInfo(err instanceof Error ? err.message : 'Network Timeout');
      setOrders(generateDemoOrders());
      setCustomers([]);
      setDbInventory([]);
      setDbRecipes([]);
      setIsDemoMode(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const analytics = useMemo(
    () => computeManagerAnalytics({ orders, customers, selectedBranch, period, language, taxRate }),
    [orders, customers, selectedBranch, period, language, taxRate]
  );

  const catalogue = useMemo(
    () => buildInventoryCatalogue(dbInventory, FALLBACK_INVENTORY_ITEMS),
    [dbInventory]
  );

  const recipes = useMemo(
    () => buildRecipeCatalogue(dbRecipes, FALLBACK_ITEM_RECIPES),
    [dbRecipes]
  );

  const stockRows = useMemo(
    () => buildStockRows(orders, catalogue, recipes, dbInventory),
    [orders, catalogue, recipes, dbInventory]
  );

  const materialYields = useMemo(
    () => computeMaterialYields(catalogue, recipes, menuItems),
    [catalogue, recipes, menuItems]
  );

  const inventorySummary = useMemo(
    () => summarizeManagerInventory(stockRows, selectedBranch, materialYields),
    [stockRows, selectedBranch, materialYields]
  );

  const filteredCustomers = useMemo(() => {
    const query = customerSearchTerm.trim().toLowerCase();
    return customers.filter(c => {
      if (selectedBranch !== 'all' && c.branchId !== selectedBranch) return false;
      if (!query) return true;
      return c.name?.toLowerCase().includes(query) || c.phone?.includes(query);
    });
  }, [customers, selectedBranch, customerSearchTerm]);

  return {
    loading,
    isDemoMode,
    errorInfo,
    refresh,
    orders,
    customers,
    filteredCustomers,
    analytics,
    stockRows,
    materialYields,
    inventorySummary,
    taxRate,
  };
}
