import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { requireDesktopApi } from './desktopBridge';

/**
 * Inventory Service - Interface to Electron SQLite Database for Inventory and Recipes
 */
export const inventoryService = {
  /**
   * Fetch all inventory items (optionally filtered by branch)
   */
  async getAll(branchId?: string): Promise<InventoryItem[]> {
    try {
      return await requireDesktopApi('قراءة المخزون').getInventory(branchId);
    } catch (error) {
      console.error('[inventoryService] Error fetching inventory:', error);
      throw new Error('فشل قراءة المخزون');
    }
  },

  /**
   * Create a new inventory item
   */
  async create(item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem> {
    try {
      return await requireDesktopApi('إضافة صنف مخزون').createInventoryItem(item);
    } catch (error) {
      console.error('[inventoryService] Error creating inventory item:', error);
      throw new Error('فشل إضافة صنف المخزون');
    }
  },

  /**
   * Update an inventory item's details (stock, min stock, cost, name, etc.)
   */
  async update(id: string, data: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>): Promise<InventoryItem> {
    try {
      return await requireDesktopApi('تعديل صنف المخزون').updateInventoryItem(id, data);
    } catch (error) {
      console.error('[inventoryService] Error updating inventory item:', error);
      throw new Error('فشل تعديل صنف المخزون');
    }
  },

  /**
   * Delete an inventory item (and its associated recipes and transaction histories)
   */
  async delete(id: string): Promise<void> {
    try {
      await requireDesktopApi('حذف صنف المخزون').deleteInventoryItem(id);
    } catch (error) {
      console.error('[inventoryService] Error deleting inventory item:', error);
      throw new Error('فشل حذف صنف المخزون');
    }
  },

  /**
   * Fetch transaction logs, optionally filtered by item and/or branch
   */
  async getTransactions(itemId?: string, branchId?: string): Promise<InventoryTransaction[]> {
    try {
      return await requireDesktopApi('قراءة حركة المخزون').getInventoryTransactions(itemId, branchId);
    } catch (error) {
      console.error('[inventoryService] Error fetching transactions:', error);
      throw new Error('فشل قراءة حركة المخزون');
    }
  },

  /**
   * Manually create a stock transaction (IN, OUT, ADJUST), which automatically adjusts inventory levels
   */
  async createTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    try {
      return await requireDesktopApi('تسجيل حركة مخزون').createInventoryTransaction(tx);
    } catch (error) {
      console.error('[inventoryService] Error creating stock transaction:', error);
      throw new Error('فشل تسجيل حركة المخزون');
    }
  },

  /**
   * Get all recipe ingredient mapping entries
   */
  async getMenuRecipes(): Promise<RecipeIngredient[]> {
    try {
      return await requireDesktopApi('قراءة الوصفات').getMenuRecipes();
    } catch (error) {
      console.error('[inventoryService] Error fetching all recipes:', error);
      throw new Error('فشل قراءة الوصفات');
    }
  },

  /**
   * Fetch mapped ingredients/recipes for a specific menu item
   */
  async getMenuItemRecipe(menuItemId: string): Promise<RecipeIngredient[]> {
    try {
      return await requireDesktopApi('قراءة الوصفة').getMenuItemRecipe(menuItemId);
    } catch (error) {
      console.error('[inventoryService] Error fetching recipe for item:', menuItemId, error);
      return [];
    }
  },

  /**
   * Save ingredient mapping for a menu item (replaces existing ingredients with the new ones)
   */
  async saveMenuRecipe(menuItemId: string, ingredients: RecipeIngredient[]): Promise<RecipeIngredient[]> {
    try {
      return await requireDesktopApi('حفظ الوصفة').saveMenuRecipe(menuItemId, ingredients);
    } catch (error) {
      console.error('[inventoryService] Error saving recipe for item:', menuItemId, error);
      throw new Error('فشل حفظ وصفة الصنف');
    }
  },

  /**
   * Get total calculated recipe cost for a menu item (cost per unit * ingredient quantity)
   */
  async getRecipeCost(menuItemId: string): Promise<number> {
    try {
      return await requireDesktopApi('قراءة تكلفة الوصفة').getRecipeCost(menuItemId);
    } catch (error) {
      console.error('[inventoryService] Error getting recipe cost:', menuItemId, error);
      return 0;
    }
  }
};
