import { ICustomerRepository } from '../types';
import { Customer } from '../../types/customer';

export class SqliteCustomerRepository implements ICustomerRepository {
  async getAll(branchId?: string): Promise<Customer[]> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const customers = await window.electronAPI.getCustomers();
      if (!branchId) return customers;
      return customers.filter(c => c.branchId === branchId);
    } else {
      try {
        const workerUrl = 'https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev';
        const res = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: "SELECT * FROM customers ORDER BY createdAt DESC" })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'D1 query failed');
        const docs = data.result[0]?.results || [];
        const customers = docs.map((row: any) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          points: Number(row.points),
          createdAt: row.createdAt,
          branchId: row.branch_id
        }));
        if (!branchId) return customers;
        return customers.filter(c => c.branchId === branchId);
      } catch (e) {
        console.error("SqliteCustomerRepository D1 fallback failed:", e);
        return [];
      }
    }
  }

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const customer = await window.electronAPI.getCustomerByPhone(phone);
      if (!customer) return null;
      if (branchId && customer.branchId !== branchId) return null;
      return customer;
    }
    const customers = await this.getAll(branchId);
    return customers.find(c => c.phone === phone) || null;
  }

  async save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      const customerWithBranch = { ...customer, branchId };
      return window.electronAPI.saveCustomer(customerWithBranch);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }

  async delete(id: string): Promise<void> {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron) {
      return window.electronAPI.deleteCustomer(id);
    }
    throw new Error("Mutation not supported in browser fallback mode");
  }
}
