import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';
import { requireDesktopApi } from '../../services/desktopBridge';

export class SqliteOrderRepository implements IOrderRepository {
  async getAll(branchId?: string): Promise<Order[]> {
    // Branch filtering happens in SQL inside the main process (Issue 22)
    return requireDesktopApi('قراءة الطلبات').getOrders(branchId);
  }

  async create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    const orderWithBranch = { ...order, branchId };
    return requireDesktopApi('إنشاء طلب').createOrder(orderWithBranch);
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    return requireDesktopApi('تعديل الطلب').updateOrder(id, data);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return requireDesktopApi('تعديل حالة الطلب').updateOrderStatus(id, status);
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card'): Promise<Order> {
    return requireDesktopApi('إتمام الدفع').completeOrderPayment(id, method);
  }

  async delete(id: string): Promise<void> {
    return requireDesktopApi('حذف الطلب').deleteOrder(id);
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    const defaultsWithBranch = defaults.map(order => ({ ...order, branchId }));
    return requireDesktopApi('إعادة تعيين الطلبات').resetOrders(defaultsWithBranch);
  }
}
