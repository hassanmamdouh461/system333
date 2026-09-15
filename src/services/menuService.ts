import { MenuItem } from '../types/menu';
import { PublicMenuConfig } from '../types/menuBranding';

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

    // In the browser (public menu / web build) the menu is read from the public reports
    // worker endpoint, which needs no credential. There is no authenticated fallback any
    // more: the key that fallback used to send was inlined into the public bundle, so the
    // whole path had to go. Reading the live menu is the public endpoint's job.
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
      console.warn('[menuService] Public menu fetch from reports worker failed:', e);
    }

    throw new Error('فشل قراءة أصناف القائمة');
  },

  async getPublicMenuData(): Promise<{
    menuItems: MenuItem[];
    config: PublicMenuConfig | null;
    /** True when the endpoint could not be reached: callers must surface a real message. */
    unavailable?: boolean;
  }> {
    try {
      const reportsUrl = (import.meta.env.VITE_REPORTS_WORKER_URL as string) || 'https://api-reports.engaz.tech';
      const res = await fetch(`${reportsUrl.replace(/\/+$/, '')}/read/public-menu`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.menuItems)) {
          return {
            menuItems: data.menuItems.map(mapRow),
            config: data.config || null,
          };
        }
      }
    } catch (e) {
      console.warn('[menuService] Public menu fetch with config failed:', e);
    }

    // No retry through getAll(): that method re-requests the very same /read/public-menu
    // endpoint, so a failure here is a failure there. Retrying would double the browser's
    // requests against an endpoint that just proved it is unreachable, and on the desktop
    // build it would silently return the branch's local menu instead of the published one —
    // which looks like success while showing stale data. Report unavailability instead.
    return { menuItems: [], config: null, unavailable: true };
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
