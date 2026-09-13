import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { requireDesktopApi } from '../../services/desktopBridge';

export class SqliteMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    const items = await requireDesktopApi('قراءة القائمة').getMenu();
    // The main process already scopes by branch (own rows + shared NULL rows); this
    // secondary filter exists for the non-desktop reads that bypass it. It mirrors that
    // same rule: a row with no branch is shared, not owned by 'default'.
    if (!branchId) return items;
    return items.filter(item => !item.branchId || item.branchId === branchId);
  }

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    const itemWithBranch = { ...item, branchId };
    return requireDesktopApi('إضافة صنف للقائمة').createMenuItem(itemWithBranch);
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    return requireDesktopApi('تعديل صنف القائمة').updateMenuItem(id, data);
  }

  async delete(id: string): Promise<void> {
    return requireDesktopApi('حذف صنف من القائمة').deleteMenuItem(id);
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const defaultsWithBranch = defaults.map(item => ({ ...item, branchId }));
    return requireDesktopApi('إعادة تعيين القائمة').resetMenu(defaultsWithBranch);
  }
}
