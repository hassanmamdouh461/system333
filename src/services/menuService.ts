import { MenuItem } from '../types/menu';

const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT = '69879ae70002444f3f38';
const APPWRITE_DB = '6a545eb00016d126bc82';

/**
 * Menu Service - Handle all CRUD operations for Menu Items using SQLite via Electron IPC
 */
export const menuService = {
  /**
   * Fetch all menu items from local SQLite DB or Appwrite fallback
   */
  async getAll(): Promise<MenuItem[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      try {
        return await window.electronAPI.getMenu();
      } catch (error) {
        console.error('[menuService] Error fetching menu items from SQLite:', error);
        throw new Error('Failed to fetch menu items');
      }
    } else {
      // Browser/Web fallback — fetch from central Appwrite database
      try {
        const headers = { 'X-Appwrite-Project': APPWRITE_PROJECT };
        const url = `${APPWRITE_ENDPOINT}/databases/${APPWRITE_DB}/collections/menu_items/documents?limit=1000`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Appwrite menu fetch failed: ${res.status}`);
        const data = await res.json();
        const docs = data.documents || [];
        return docs.map((doc: any) => ({
          id: doc.$id || doc.id,
          name: doc.name,
          price: doc.price,
          category: doc.category,
          description: doc.description || "",
          image: doc.image || "",
          available: doc.available !== undefined ? doc.available : true,
          isSynced: true
        }));
      } catch (error) {
        console.error('[menuService] Error fetching menu items from Appwrite:', error);
        throw new Error('Failed to fetch menu items');
      }
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

