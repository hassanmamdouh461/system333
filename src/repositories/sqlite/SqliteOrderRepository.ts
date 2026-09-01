import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';
import { requireDesktopApi } from '../../services/desktopBridge';

export class SqliteOrderRepository implements IOrderRepository {
  async getAll(branchId?: string): Promise<Order[]> {
    // Branch filtering happens in SQL inside the main process (Issue 22)
    return requireDesktopApi('Reading orders').getOrders(branchId);
  }

  async create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    const orderWithBranch = { ...order, branchId };
    return requireDesktopApi('Creating an order').createOrder(orderWithBranch);
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    return requireDesktopApi('Updating an order').updateOrder(id, data);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return requireDesktopApi('Updating an order status').updateOrderStatus(id, status);
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card'): Promise<Order> {
    return requireDesktopApi('Completing a payment').completeOrderPayment(id, method);
  }

  async delete(id: string): Promise<void> {
    return requireDesktopApi('Deleting an order').deleteOrder(id);
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    const defaultsWithBranch = defaults.map(order => ({ ...order, branchId }));
    return requireDesktopApi('Resetting orders').resetOrders(defaultsWithBranch);
  }
}
