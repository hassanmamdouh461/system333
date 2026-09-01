import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MenuItem } from '../types/menu';
import { INITIAL_MENU_ITEMS } from '../data/menuSeed';
import { Order, OrderStatus } from '../types/order';
import { menuRepository, orderRepository } from '../repositories';
import { useAuth } from './AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuState {
  items: MenuItem[];
  loading: boolean;
  error: Error | null;
  addItem: (item: Omit<MenuItem, 'id'>) => Promise<MenuItem | null>;
  updateItem: (id: string, data: Partial<Omit<MenuItem, 'id'>>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  toggleAvailability: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
  resetMenu: () => Promise<void>;
}

interface OrdersState {
  orders: Order[];
  loading: boolean;
  error: Error | null;
  addOrder: (order: Omit<Order, 'id'>) => Promise<Order | null>;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
  completeWithPayment: (id: string, method?: 'Cash' | 'Card') => Promise<void>;
  updateOrder: (id: string, data: Partial<Omit<Order, 'id'>>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

interface DataContextValue {
  menu: MenuState;
  orders: OrdersState;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextValue | null>(null);

// A repository can reject with a plain string (the IPC bridge does when the main
// process throws a non-Error), and `err as Error` produced an object whose .message
// was undefined — the UI then rendered an empty error box.
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  // Get the current branch session for auto-injecting branchId into new records
  const { branch } = useAuth();

  // Menu state
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<Error | null>(null);

  // Orders state
  const [ordersList, setOrdersList] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<Error | null>(null);

  // Monotonic token per fetch. A response is applied only if it belongs to the most
  // recent request, so a slow fetch for the previous branch cannot land after a fast
  // fetch for the current one and show another branch's data.
  const menuFetchId = useRef(0);
  const ordersFetchId = useRef(0);

  // Mirrors menuItems so callbacks can read the latest list without listing the whole
  // array as a dependency (which would change their identity on every menu mutation).
  const menuItemsRef = useRef<MenuItem[]>(menuItems);
  menuItemsRef.current = menuItems;

  // ── Menu fetching ────────────────────────────────────────────────────────────

  const fetchMenu = useCallback(async () => {
    const fetchId = ++menuFetchId.current;
    try {
      setMenuLoading(true);
      setMenuError(null);
      const data = await menuRepository.getAll(branch?.branchId);
      if (fetchId !== menuFetchId.current) return;
      setMenuItems(data);
    } catch (err) {
      if (fetchId !== menuFetchId.current) return;
      console.warn('[DataContext] Failed to fetch menu from repository:', err);
      // Leave the list empty. Substituting the seed catalogue here let POSView — which
      // reads items and never reads error — sell forty items that do not exist, at
      // prices nobody set.
      setMenuError(toError(err));
      setMenuItems([]);
    } finally {
      if (fetchId === menuFetchId.current) setMenuLoading(false);
    }
  }, [branch?.branchId]);

  // ── Orders fetching ───────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    const fetchId = ++ordersFetchId.current;
    try {
      setOrdersLoading(true);
      setOrdersError(null);
      const data = await orderRepository.getAll(branch?.branchId);
      if (fetchId !== ordersFetchId.current) return;
      setOrdersList(data);
    } catch (err) {
      if (fetchId !== ordersFetchId.current) return;
      console.warn('[DataContext] Failed to fetch orders from repository:', err);
      setOrdersError(toError(err));
      setOrdersList([]);
    } finally {
      if (fetchId === ordersFetchId.current) setOrdersLoading(false);
    }
  }, [branch?.branchId]);

  // Fetch when branch changes
  useEffect(() => {
    fetchMenu();
    fetchOrders();
  }, [fetchMenu, fetchOrders]);

  // ── Menu mutations ────────────────────────────────────────────────────────────

  const addItem = useCallback(async (item: Omit<MenuItem, 'id'>) => {
    try {
      const newItem = await menuRepository.create(item, branch?.branchId);
      setMenuItems(prev => [newItem, ...prev]);
      setMenuError(null);
      return newItem;
    } catch (err) {
      console.error('[DataContext] Failed to create item in repository:', err);
      setMenuError(toError(err));
      return null;
    }
  }, [branch?.branchId]);

  const updateItem = useCallback(async (id: string, data: Partial<Omit<MenuItem, 'id'>>) => {
    try {
      const updatedItem = await menuRepository.update(id, data);
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
      setMenuError(null);
    } catch (err) {
      console.error('[DataContext] Failed to update item in repository:', err);
      setMenuError(toError(err));
      throw err;
    }
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    try {
      await menuRepository.delete(id);
      setMenuItems(prev => prev.filter(i => i.id !== id));
      setMenuError(null);
    } catch (err) {
      console.error('[DataContext] Failed to delete item in repository:', err);
      setMenuError(toError(err));
      throw err;
    }
  }, []);

  const toggleAvailability = useCallback(async (id: string) => {
    const item = menuItemsRef.current.find(i => i.id === id);
    if (!item) return;
    try {
      const updatedItem = await menuRepository.update(id, { available: !item.available });
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
      setMenuError(null);
    } catch (err) {
      console.error('[DataContext] Failed to toggle availability in repository:', err);
      setMenuError(toError(err));
      throw err;
    }
  }, []);

  const resetMenu = useCallback(async () => {
    try {
      setMenuLoading(true);
      setMenuError(null);
      const seeded = await menuRepository.resetToDefaults(INITIAL_MENU_ITEMS, branch?.branchId);
      setMenuItems(seeded);
    } catch (err) {
      console.error('[DataContext] Failed to reset menu to defaults:', err);
      setMenuError(toError(err));
    } finally {
      setMenuLoading(false);
    }
  }, [branch?.branchId]);

  // ── Orders mutations ──────────────────────────────────────────────────────────

  const addOrder = useCallback(async (order: Omit<Order, 'id'>): Promise<Order | null> => {
    try {
      const newOrder = await orderRepository.create(order, branch?.branchId);
      setOrdersList(prev => [newOrder, ...prev]);
      setOrdersError(null);
      return newOrder;
    } catch (err) {
      console.error('[DataContext] Failed to create order in repository:', err);
      setOrdersError(toError(err));
      return null;
    }
  }, [branch?.branchId]);

  const updateOrderStatus = useCallback(async (id: string, status: OrderStatus) => {
    try {
      const updatedOrder = await orderRepository.updateStatus(id, status);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
      setOrdersError(null);
    } catch (err) {
      console.error('[DataContext] Failed to update order status in repository:', err);
      setOrdersError(toError(err));
      throw err;
    }
  }, []);

  const completeWithPayment = useCallback(async (id: string, method: 'Cash' | 'Card' = 'Cash') => {
    try {
      const updatedOrder = await orderRepository.completeWithPayment(id, method);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
      setOrdersError(null);
    } catch (err) {
      console.error('[DataContext] Failed to complete payment in repository:', err);
      setOrdersError(toError(err));
      throw err;
    }
  }, []);

  const updateOrder = useCallback(async (id: string, data: Partial<Omit<Order, 'id'>>) => {
    try {
      const updatedOrder = await orderRepository.update(id, data);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
      setOrdersError(null);
    } catch (err) {
      console.error('[DataContext] Failed to update order in repository:', err);
      setOrdersError(toError(err));
      throw err;
    }
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    try {
      await orderRepository.delete(id);
      setOrdersList(prev => prev.filter(o => o.id !== id));
      setOrdersError(null);
    } catch (err) {
      console.error('[DataContext] Failed to delete order in repository:', err);
      setOrdersError(toError(err));
      throw err;
    }
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────────

  // Memoized: an unmemoized object literal here re-renders every consumer screen
  // (Orders, Menu, Payment, Reports, Dashboard, POSView) on any provider state change.
  const value = useMemo<DataContextValue>(() => ({
    menu: {
      items: menuItems,
      loading: menuLoading,
      error: menuError,
      addItem,
      updateItem,
      deleteItem,
      toggleAvailability,
      refetch: fetchMenu,
      resetMenu,
    },
    orders: {
      orders: ordersList,
      loading: ordersLoading,
      error: ordersError,
      addOrder,
      updateOrderStatus,
      completeWithPayment,
      updateOrder,
      deleteOrder,
      refetch: fetchOrders,
    },
  }), [
    menuItems, menuLoading, menuError,
    addItem, updateItem, deleteItem, toggleAvailability, fetchMenu, resetMenu,
    ordersList, ordersLoading, ordersError,
    addOrder, updateOrderStatus, completeWithPayment, updateOrder, deleteOrder, fetchOrders,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useMenuContext(): MenuState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useMenuContext must be used within DataProvider');
  return ctx.menu;
}

export function useOrdersContext(): OrdersState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useOrdersContext must be used within DataProvider');
  return ctx.orders;
}

