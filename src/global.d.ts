/// <reference types="vite/client" />

// The domain types live in src/types/. They are re-exported here so the three
// modules that import from '../global' keep working, and so the IPC surface below
// describes the same types the app actually uses. Duplicating them here is what
// caused the Order/MenuItem split-brain: two structurally different `Order` types
// on either side of window.electronAPI.
import type { MenuItem } from './types/menu';
import type { Order, OrderItem, OrderStatus, PaymentStatus } from './types/order';
import type { Customer } from './types/customer';

export type { MenuItem, Order, OrderItem, OrderStatus, PaymentStatus, Customer };

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  branchId?: string;
  isSynced?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName?: string;
  itemUnit?: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  referenceId?: string;
  createdAt: string;
  branchId?: string;
  isSynced?: boolean;
  notes?: string;
}

export interface RecipeIngredient {
  menuItemId?: string;
  inventoryItemId: string;
  itemName?: string;
  itemUnit?: string;
  costPerUnit?: number;
  quantity: number;
}

declare global {
  interface Window {
    /** Absent in the web build; every caller must guard before use. */
    electronAPI?: {
      getMenu: () => Promise<MenuItem[]>;
      createMenuItem: (item: Omit<MenuItem, 'id'>) => Promise<MenuItem>;
      updateMenuItem: (id: string, data: Partial<Omit<MenuItem, 'id'>>) => Promise<MenuItem>;
      deleteMenuItem: (id: string) => Promise<void>;
      resetMenu: (defaults: Omit<MenuItem, 'id'>[]) => Promise<MenuItem[]>;
      
      getOrders: (branchId?: string) => Promise<Order[]>;
      createOrder: (order: Omit<Order, 'id'>) => Promise<Order>;
      updateOrderStatus: (id: string, status: Order['status']) => Promise<Order>;
      completeOrderPayment: (id: string, method: 'Cash' | 'Card') => Promise<Order>;
      updateOrder: (id: string, data: Partial<Omit<Order, 'id'>>) => Promise<Order>;
      deleteOrder: (id: string) => Promise<void>;
      resetOrders: (defaults: Omit<Order, 'id'>[]) => Promise<Order[]>;

      getCustomers: () => Promise<Customer[]>;
      getCustomerByPhone: (phone: string) => Promise<Customer | null>;
      saveCustomer: (customer: Partial<Customer> & { phone: string }) => Promise<Customer>;
      deleteCustomer: (id: string) => Promise<void>;

      getSettings: () => Promise<Record<string, string>>;
      saveSetting: (key: string, value: string) => Promise<void>;
      deleteSetting: (key: string) => Promise<void>;

      // Inventory & Recipes APIs
      getInventory: (branchId?: string) => Promise<InventoryItem[]>;
      createInventoryItem: (item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<InventoryItem>;
      updateInventoryItem: (id: string, data: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<InventoryItem>;
      deleteInventoryItem: (id: string) => Promise<void>;
      getInventoryTransactions: (itemId?: string, branchId?: string) => Promise<InventoryTransaction[]>;
      createInventoryTransaction: (tx: Omit<InventoryTransaction, 'id' | 'createdAt'>) => Promise<InventoryTransaction>;
      getMenuRecipes: () => Promise<RecipeIngredient[]>;
      getMenuItemRecipe: (menuItemId: string) => Promise<RecipeIngredient[]>;
      saveMenuRecipe: (menuItemId: string, ingredients: RecipeIngredient[]) => Promise<RecipeIngredient[]>;
      getRecipeCost: (menuItemId: string) => Promise<number>;

      getSyncStatus: () => Promise<{
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }>;
      triggerSync: () => Promise<{
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }>;
      onSyncStatusUpdate: (callback: (status: {
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }) => void) => () => void;

      getDailyReportStats: () => Promise<{
        orderCount: number;
        revenue: number;
        cash: number;
        card: number;
      }>;
      sendDailyReportToTelegram: () => Promise<{ success: boolean; error?: string }>;

      getParkedSyncRows: () => Promise<Array<{
        table: string;
        id: string;
        sync_attempts: number;
        last_error: string | null;
      }>>;
      retryParkedSyncRows: (table: string, ids?: string[] | null) => Promise<number>;
    };
  }
}
