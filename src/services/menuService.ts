import { MenuItem } from '../types/menu';
import { callWorker } from './workerClient';

interface MenuItemRow {
  id: string;
  name: string;
  price: number | string;
  category: string;
  description?: string | null;
  image?: string | null;
  available?: number | boolean | null;
}

function mapRow(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price) || 0,
    category: row.category,
    description: row.description || '',
    image: row.image || '',
    available: row.available === undefined || row.available === null ? true : Boolean(row.available),
    isSynced: true,
  };
}

/** Throws when a mutation is attempted in the web build, which has no local database. */
function requireDesktop(action: string) {
  if (!window.electronAPI) {
    throw new Error(`${action} is only available in the desktop app`);
  }
  return window.electronAPI;
}

/**
 * Menu CRUD. Reads work in both builds — the desktop app from local SQLite, the browser
 * from the central worker — while writes are desktop-only because the branch database is
 * the source of truth.
 */
export const menuService = {
  async getAll(): Promise<MenuItem[]> {
    if (window.electronAPI) {
      try {
        return await window.electronAPI.getMenu();
      } catch (error) {
        console.error('[menuService] Error fetching menu items from SQLite:', error);
        throw new Error('Failed to fetch menu items');
      }
    }

    try {
      const data = await callWorker<{ menuItems: MenuItemRow[] }>('/read/menu-items');
      return (data.menuItems || []).map(mapRow);
    } catch (error) {
      console.error('[menuService] Error fetching menu items from the worker:', error);
      throw new Error('Failed to fetch menu items');
    }
  },

  async create(item: Omit<MenuItem, 'id'>): Promise<MenuItem> {
    try {
      return await requireDesktop('Creating a menu item').createMenuItem(item);
    } catch (error) {
      console.error('[menuService] Error creating menu item:', error);
      throw new Error('Failed to create menu item');
    }
  },

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    try {
      return await requireDesktop('Updating a menu item').updateMenuItem(id, data);
    } catch (error) {
      console.error('[menuService] Error updating menu item:', error);
      throw new Error('Failed to update menu item');
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await requireDesktop('Deleting a menu item').deleteMenuItem(id);
    } catch (error) {
      console.error('[menuService] Error deleting menu item:', error);
      throw new Error('Failed to delete menu item');
    }
  },

  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[]): Promise<MenuItem[]> {
    try {
      return await requireDesktop('Resetting the menu').resetMenu(defaultItems);
    } catch (error) {
      console.error('[menuService] Error resetting menu to defaults:', error);
      throw new Error('Failed to reset menu to defaults');
    }
  },
};
