import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeRecipeCosts,
  computeCogs,
  computeNetProfit,
  summarizeInvoices,
  summarizePaymentMethods,
  summarizeOrderModes,
} from './reportMath';
import { Order } from '../types/order';
import { InventoryItem, RecipeIngredient } from '../global';

const store = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

function fakeItem(id: string, costPerUnit: number): InventoryItem {
  return {
    id,
    name: id,
    unit: 'unit',
    stock: 100,
    minStock: 10,
    costPerUnit,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('reportMath', () => {
  describe('computeRecipeCosts', () => {
    it('calculates the ingredient cost for each menu item correctly', () => {
      const inventory: InventoryItem[] = [
        fakeItem('inv-1', 0.5),
        fakeItem('inv-2', 0.1),
      ];
      const recipes: RecipeIngredient[] = [
        { menuItemId: 'item-1', inventoryItemId: 'inv-1', quantity: 18 },
        { menuItemId: 'item-1', inventoryItemId: 'inv-2', quantity: 200 },
      ];

      const costs = computeRecipeCosts(recipes, inventory);
      expect(costs['item-1']).toBe(29);
    });

    it('ignores recipes with no menuItemId or unknown inventory items', () => {
      const inventory: InventoryItem[] = [fakeItem('inv-1', 0.5)];
      const recipes: RecipeIngredient[] = [
        { menuItemId: '', inventoryItemId: 'inv-1', quantity: 18 },
        { menuItemId: 'item-2', inventoryItemId: 'unknown', quantity: 5 },
      ];

      const costs = computeRecipeCosts(recipes, inventory);
      expect(costs['']).toBeUndefined();
      expect(costs['item-2']).toBe(0);
    });
  });

  describe('computeCogs', () => {
    it('calculates cost of goods sold across paid orders', () => {
      const paidOrders: Partial<Order>[] = [
        {
          items: [
            { id: 'item-1', menuItemId: 'item-1', name: 'Latte', price: 50, quantity: 2 },
            { id: 'item-2', menuItemId: 'item-2', name: 'Espresso', price: 30, quantity: 1 },
          ],
        },
      ];
      const recipeCosts = { 'item-1': 15, 'item-2': 8 };

      const cogs = computeCogs(paidOrders as Order[], recipeCosts);
      expect(cogs).toBe(38);
    });
  });

  describe('computeNetProfit', () => {
    it('subtracts actual tax amount and COGS from revenue', () => {
      expect(computeNetProfit(114, 14, 40)).toBe(60);
    });

    it('floors negative profit at zero to prevent confusing negative cards', () => {
      expect(computeNetProfit(50, 10, 60)).toBe(0);
    });

    it('handles zero tax cleanly', () => {
      expect(computeNetProfit(100, 0, 30)).toBe(70);
    });
  });

  describe('summarizeInvoices', () => {
    it('summarizes paid and unpaid invoices correctly', () => {
      const orders: Partial<Order>[] = [
        { paymentStatus: 'Paid', grandTotal: 100, subtotal: 90, taxRate: 0.1, taxAmount: 10 },
        { paymentStatus: 'Paid', grandTotal: 50, subtotal: 45, taxRate: 0.1, taxAmount: 5 },
        { paymentStatus: 'Unpaid', grandTotal: 75, subtotal: 68.18, taxRate: 0.1, taxAmount: 6.82 },
      ];

      const stats = summarizeInvoices(orders as Order[]);
      expect(stats.paidCount).toBe(2);
      expect(stats.openCount).toBe(1);
      expect(stats.paidAmount).toBe(150);
      expect(stats.openAmount).toBe(75);
      expect(stats.totalCount).toBe(3);
    });
  });

  describe('summarizePaymentMethods', () => {
    it('splits cash and card revenue with percentages', () => {
      const orders: Partial<Order>[] = [
        { paymentMethod: 'Cash', grandTotal: 80, subtotal: 70, taxRate: 0.14, taxAmount: 10 },
        { paymentMethod: 'Card', grandTotal: 120, subtotal: 105, taxRate: 0.14, taxAmount: 15 },
      ];

      const stats = summarizePaymentMethods(orders as Order[]);
      expect(stats.cashAmount).toBe(80);
      expect(stats.cardAmount).toBe(120);
      expect(stats.totalAmount).toBe(200);
      expect(stats.cashPercentage).toBe(40);
      expect(stats.cardPercentage).toBe(60);
    });
  });

  describe('summarizeOrderModes', () => {
    it('counts takeaway vs dine-in orders', () => {
      const orders: Partial<Order>[] = [
        { tableId: 'Takeaway' },
        { tableId: 'Table 1' },
        { tableId: 'Table 2' },
      ];

      const stats = summarizeOrderModes(orders as Order[]);
      expect(stats.takeaway).toBe(1);
      expect(stats.dineIn).toBe(2);
      expect(stats.total).toBe(3);
    });
  });
});
