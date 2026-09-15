import { SqliteMenuRepository } from './sqlite/SqliteMenuRepository';
import { SqliteOrderRepository } from './sqlite/SqliteOrderRepository';

export * from './types';

export const menuRepository = new SqliteMenuRepository();
export const orderRepository = new SqliteOrderRepository();
