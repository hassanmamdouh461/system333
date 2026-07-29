import { logger } from '../utils/logger';
import { MenuItem } from '../types/menu';

// In-memory cache for the web public menu (see getAll below)
const WEB_MENU_CACHE_TTL_MS = 5 * 60 * 1000;
let webMenuCache: { at: number; items: MenuItem[] } | null = null;

/**
 * Menu Service - Handle all CRUD operations for Menu Items using SQLite via Electron IPC
 */
export const menuService = {
  /**
   * Fetch all menu items from local SQLite DB, or the public cloud menu on web
   */
  async getAll(): Promise<MenuItem[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      try {
        return await window.electronAPI.getMenu();
      } catch (error) {
        logger.error('[menuService] Error fetching menu items from SQLite:', error);
        throw new Error('Failed to fetch menu items');
      }
    } else {
      // Browser/Web fallback — public read-only menu endpoint (no credentials in the bundle).
      // A 5-minute in-memory cache keeps repeat QR visits instant and avoids
      // hammering the cloud API on every page open.
      try {
        const cachedAt = webMenuCache?.at ?? 0;
        if (webMenuCache && Date.now() - cachedAt < WEB_MENU_CACHE_TTL_MS) {
          return webMenuCache.items;
        }
        const workerUrl = import.meta.env.VITE_CF_WORKER_URL || 'https://api.engaz.tech';
        const res = await fetch(`${workerUrl.replace(/\/+$/, '')}/menu/public`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Menu query failed');
        const docs = data.result || [];
        const items = docs.map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          price: Number(doc.price),
          category: doc.category,
          description: doc.description || "",
          image: doc.image || "",
          available: doc.available !== undefined ? Boolean(doc.available) : true,
          isSynced: true
        }));
        webMenuCache = { at: Date.now(), items };
        return items;
      } catch (error) {
        // Serve the stale cache rather than failing outright when the API blips
        if (webMenuCache) return webMenuCache.items;
        logger.error('[menuService] Error fetching menu items from cloud:', error);
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
      logger.error('[menuService] Error creating menu item:', error);
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
      logger.error('[menuService] Error updating menu item:', error);
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
      logger.error('[menuService] Error deleting menu item:', error);
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
      logger.error('[menuService] Error resetting menu to defaults:', error);
      throw new Error('Failed to reset menu to defaults');
    }
  },
};

