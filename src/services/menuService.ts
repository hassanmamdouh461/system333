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
    throw new Error(`${action} متاح فقط في تطبيق سطح المكتب`);
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
        throw new Error('فشل قراءة أصناف القائمة');
      }
    }

    // In the browser (public menu / web build):
    // First try the public reports worker endpoint (engaz-reports-db) which needs no auth
    try {
      const reportsUrl = (import.meta.env.VITE_REPORTS_WORKER_URL as string) || 'https://api-reports.engaz.tech';
      const res = await fetch(`${reportsUrl.replace(/\/+$/, '')}/read/public-menu`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.menuItems)) {
          return data.menuItems.map(mapRow);
        }
      }
    } catch (e) {
      console.warn('[menuService] Public menu fetch from reports worker failed, falling back:', e);
    }

    try {
      const data = await callWorker<{ menuItems: MenuItemRow[] }>('/read/menu-items');
      return (data.menuItems || []).map(mapRow);
    } catch (error) {
      console.error('[menuService] Error fetching menu items from the worker:', error);
      throw new Error('فشل قراءة أصناف القائمة');
    }
  },

  async create(item: Omit<MenuItem, 'id'>): Promise<MenuItem> {
    try {
      return await requireDesktop('إضافة صنف للقائمة').createMenuItem(item);
    } catch (error) {
      console.error('[menuService] Error creating menu item:', error);
      throw new Error('فشل إضافة صنف للقائمة');
    }
  },

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    try {
      return await requireDesktop('تعديل صنف القائمة').updateMenuItem(id, data);
    } catch (error) {
      console.error('[menuService] Error updating menu item:', error);
      throw new Error('فشل تعديل صنف القائمة');
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await requireDesktop('حذف صنف من القائمة').deleteMenuItem(id);
    } catch (error) {
      console.error('[menuService] Error deleting menu item:', error);
      throw new Error('فشل حذف صنف من القائمة');
    }
  },

  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[]): Promise<MenuItem[]> {
    try {
      return await requireDesktop('إعادة تعيين القائمة').resetMenu(defaultItems);
    } catch (error) {
      console.error('[menuService] Error resetting menu to defaults:', error);
      throw new Error('فشل إعادة تعيين القائمة');
    }
  },
};
