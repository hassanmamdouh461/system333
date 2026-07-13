import { SqliteMenuRepository } from './sqlite/SqliteMenuRepository';
import { SqliteOrderRepository } from './sqlite/SqliteOrderRepository';
import { SqliteCustomerRepository } from './sqlite/SqliteCustomerRepository';

export * from './types';

export const menuRepository = new SqliteMenuRepository();
export const orderRepository = new SqliteOrderRepository();
export const customerRepository = new SqliteCustomerRepository();
