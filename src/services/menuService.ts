import { MenuItem } from '../types/menu';

/**
 * Menu Service - Handle all CRUD operations for Menu Items using SQLite via Electron IPC
 */
export const menuService = {
  /**
   * Fetch all menu items from local SQLite DB
   */
  async getAll(): Promise<MenuItem[]> {
    try {
      return await window.electronAPI.getMenu();
    } catch (error) {
      console.error('[menuService] Error fetching menu items:', error);
      throw new Error('Failed to fetch menu items');
    }
  },

  /**
   * Create a new menu item in local SQLite DB
   */
  async create(item: Omit<MenuItem, 'id'>): Promise<MenuItem> {
    try {
      return await window.electronAPI.createMenuItem(item);
    } catch (error) {
      console.error('[menuService] Error creating menu item:', error);
      throw new Error('Failed to create menu item');
    }
  },

  /**
   * Update an existing menu item in local SQLite DB
   */
  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    try {
      return await window.electronAPI.updateMenuItem(id, data);
    } catch (error) {
      console.error('[menuService] Error updating menu item:', error);
      throw new Error('Failed to update menu item');
    }
  },

  /**
   * Delete a menu item from local SQLite DB
   */
  async delete(id: string): Promise<void> {
    try {
      await window.electronAPI.deleteMenuItem(id);
    } catch (error) {
      console.error('[menuService] Error deleting menu item:', error);
      throw new Error('Failed to delete menu item');
    }
  },

  /**
   * Reset menu to default items (delete all + recreate)
   */
  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[]): Promise<MenuItem[]> {
    try {
      return await window.electronAPI.resetMenu(defaultItems);
    } catch (error) {
      console.error('[menuService] Error resetting menu to defaults:', error);
      throw new Error('Failed to reset menu to defaults');
    }
  },
};

