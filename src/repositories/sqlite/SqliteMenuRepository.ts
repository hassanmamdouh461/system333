import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { requireDesktopApi } from '../../services/desktopBridge';

export class SqliteMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    const items = await requireDesktopApi('Reading the menu').getMenu();
    if (!branchId) return items;
    // Auto-filter by branch_id
    return items.filter(item => !item.branchId || item.branchId === branchId || item.branchId === 'default');
  }

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    const itemWithBranch = { ...item, branchId };
    return requireDesktopApi('Creating a menu item').createMenuItem(itemWithBranch);
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    return requireDesktopApi('Updating a menu item').updateMenuItem(id, data);
  }

  async delete(id: string): Promise<void> {
    return requireDesktopApi('Deleting a menu item').deleteMenuItem(id);
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const defaultsWithBranch = defaults.map(item => ({ ...item, branchId }));
    return requireDesktopApi('Resetting the menu').resetMenu(defaultsWithBranch);
  }
}
