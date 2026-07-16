import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';

export class SqliteMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const items = await window.electronAPI.getMenu();
      if (!branchId) return items;
      return items.filter(item => !item.branchId || item.branchId === branchId || item.branchId === 'default');
    } else {
      try {
        const workerUrl = 'https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev';
        const res = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: "SELECT * FROM menu_items ORDER BY category ASC, name ASC" })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'D1 query failed');
        const docs = data.result[0]?.results || [];
        const items = docs.map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          price: Number(doc.price),
          category: doc.category,
          description: doc.description || "",
          image: doc.image || "",
          available: doc.available !== undefined ? Boolean(doc.available) : true,
          isSynced: true,
          branchId: doc.branch_id || 'default'
        }));
        if (!branchId) return items;
        return items.filter(item => !item.branchId || item.branchId === branchId || item.branchId === 'default');
      } catch (e) {
        console.error("SqliteMenuRepository D1 fallback failed:", e);
        return [];
      }
    }
  }

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const itemWithBranch = { ...item, branchId };
      return window.electronAPI.createMenuItem(itemWithBranch);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.updateMenuItem(id, data);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async delete(id: string): Promise<void> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.deleteMenuItem(id);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const defaultsWithBranch = defaults.map(item => ({ ...item, branchId }));
      return window.electronAPI.resetMenu(defaultsWithBranch);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }
}
