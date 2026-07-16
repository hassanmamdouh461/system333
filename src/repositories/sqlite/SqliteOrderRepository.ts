import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';

export class SqliteOrderRepository implements IOrderRepository {
  async getAll(branchId?: string): Promise<Order[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const orders = await window.electronAPI.getOrders();
      if (!branchId) return orders;
      return orders.filter(order => order.branchId === branchId);
    } else {
      try {
        const workerUrl = 'https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev';
        const res = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: "SELECT * FROM orders ORDER BY createdAt DESC" })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'D1 query failed');
        const docs = data.result[0]?.results || [];
        const orders = docs.map((row: any) => {
          let items = row.items;
          if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch { items = []; }
          }
          return {
            id: row.id,
            orderNumber: row.orderNumber,
            tableId: row.tableId,
            items: Array.isArray(items) ? items : [],
            status: row.status as OrderStatus,
            paymentStatus: row.paymentStatus || 'Unpaid',
            totalAmount: Number(row.totalAmount),
            createdAt: row.createdAt,
            branchId: row.branch_id
          };
        });
        if (!branchId) return orders;
        return orders.filter(order => order.branchId === branchId);
      } catch (e) {
        console.error("SqliteOrderRepository D1 fallback failed:", e);
        return [];
      }
    }
  }

  async create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const orderWithBranch = { ...order, branchId };
      return window.electronAPI.createOrder(orderWithBranch);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.updateOrder(id, data);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.updateOrderStatus(id, status);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card'): Promise<Order> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.completeOrderPayment(id, method);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async delete(id: string): Promise<void> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.deleteOrder(id);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const defaultsWithBranch = defaults.map(order => ({ ...order, branchId }));
      return window.electronAPI.resetOrders(defaultsWithBranch);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }
}
