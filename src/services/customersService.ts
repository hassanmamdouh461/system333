import { Customer } from '../types/customer';

/**
 * Customers Service - Handle CRUD operations for Customers using SQLite via Electron IPC
 */
export const customersService = {
  /**
   * Fetch all customers from local SQLite DB
   */
  async getAll(): Promise<Customer[]> {
    try {
      return await window.electronAPI.getCustomers();
    } catch (error) {
      console.error('[customersService] Error fetching customers:', error);
      throw new Error('Failed to fetch customers');
    }
  },

  /**
   * Fetch a single customer by phone number
   */
  async getByPhone(phone: string): Promise<Customer | null> {
    try {
      return await window.electronAPI.getCustomerByPhone(phone);
    } catch (error) {
      console.error('[customersService] Error fetching customer by phone:', error);
      throw new Error('Failed to fetch customer');
    }
  },

  /**
   * Create or update a customer profile (points, name, etc.)
   */
  async save(customer: Partial<Customer> & { phone: string }): Promise<Customer> {
    try {
      return await window.electronAPI.saveCustomer(customer);
    } catch (error) {
      console.error('[customersService] Error saving customer:', error);
      throw new Error('Failed to save customer');
    }
  },

  /**
   * Delete a customer from local SQLite DB
   */
  async delete(id: string): Promise<void> {
    try {
      await window.electronAPI.deleteCustomer(id);
    } catch (error) {
      console.error('[customersService] Error deleting customer:', error);
      throw new Error('Failed to delete customer');
    }
  },
};
