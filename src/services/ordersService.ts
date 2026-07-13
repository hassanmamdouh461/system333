import { Order, OrderStatus, PaymentStatus } from '../types/order';

/**
 * Orders Service - Handle all CRUD operations for Orders using SQLite via Electron IPC
 */
export const ordersService = {
  /**
   * Fetch all orders from local SQLite DB
   */
  async getAll(): Promise<Order[]> {
    try {
      return await window.electronAPI.getOrders();
    } catch (error) {
      console.error('[ordersService] Error fetching orders:', error);
      throw new Error('Failed to fetch orders');
    }
  },

  /**
   * Create a new order in local SQLite DB
   */
  async create(order: Omit<Order, 'id'>): Promise<Order> {
    try {
      return await window.electronAPI.createOrder(order);
    } catch (error) {
      console.error('[ordersService] Error creating order:', error);
      throw new Error('Failed to create order');
    }
  },

  /**
   * Update order status in local SQLite DB
   */
  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    try {
      return await window.electronAPI.updateOrderStatus(id, status);
    } catch (error) {
      console.error('[ordersService] Error updating order status:', error);
      throw new Error('Failed to update order status');
    }
  },

  /**
   * Update entire order in local SQLite DB
   */
  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    try {
      return await window.electronAPI.updateOrder(id, data);
    } catch (error) {
      console.error('[ordersService] Error updating order:', error);
      throw new Error('Failed to update order');
    }
  },

  /**
   * Mark an order as Paid in local SQLite DB
   */
  async completeWithPayment(id: string, method: 'Cash' | 'Card' = 'Cash'): Promise<Order> {
    try {
      return await window.electronAPI.completeOrderPayment(id, method);
    } catch (error) {
      console.error('[ordersService] Error completing order with payment:', error);
      throw new Error('Failed to complete payment');
    }
  },

  /**
   * Delete an order from local SQLite DB
   */
  async delete(id: string): Promise<void> {
    try {
      await window.electronAPI.deleteOrder(id);
    } catch (error) {
      console.error('[ordersService] Error deleting order:', error);
      throw new Error('Failed to delete order');
    }
  },

  /**
   * Reset orders to defaults (delete all + recreate)
   */
  async resetToDefaults(defaultOrders: Omit<Order, 'id'>[]): Promise<Order[]> {
    try {
      return await window.electronAPI.resetOrders(defaultOrders);
    } catch (error) {
      console.error('[ordersService] Error resetting orders to defaults:', error);
      throw new Error('Failed to reset orders to defaults');
    }
  },
};

