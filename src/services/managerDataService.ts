import { toFiniteNumber } from '../utils/orderTotals';
import { callWorker } from './workerClient';

/** A row of the central orders table as the manager dashboard consumes it. */
export interface ManagerOrderRow {
  $id: string;
  $createdAt: string;
  branch_id: string;
  total_amount: number;
  payment_method: string;
  /** Stringified JSON array of order items. */
  items: string;
  tableId?: string;
  paymentStatus?: string;
  /** Tax snapshot taken when the order was created. When grandTotal is present it is
   *  authoritative and must not be re-taxed. */
  grandTotal?: number | null;
  taxRate?: number | null;
  paidAmount?: number | null;
}

export interface ManagerCustomerRow {
  $id: string;
  name: string;
  phone: string;
  points: number;
  createdAt: string;
  branchId: string;
}

export interface ManagerInventoryRow {
  $id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  branch_id: string;
}

export interface ManagerSnapshot {
  orders: ManagerOrderRow[];
  customers: ManagerCustomerRow[];
  inventory: ManagerInventoryRow[];
  recipes: unknown[];
}


function mapOrderRow(row: Record<string, unknown>): ManagerOrderRow {
  return {
    $id: String(row.id),
    $createdAt: String(row.createdAt),
    branch_id: String(row.branch_id ?? ''),
    // Number(null) is 0 and Number('abc') is NaN, and a single NaN poisons every
    // downstream sum into NaN on screen. toFiniteNumber keeps a bad row at 0.
    total_amount: toFiniteNumber(row.totalAmount),
    grandTotal: row.grandTotal != null ? toFiniteNumber(row.grandTotal) : null,
    taxRate: row.taxRate != null ? toFiniteNumber(row.taxRate) : null,
    paidAmount: row.paidAmount != null ? toFiniteNumber(row.paidAmount) : null,
    payment_method: String(row.paymentMethod ?? ''),
    items: String(row.items ?? '[]'),
    tableId: row.tableId != null ? String(row.tableId) : undefined,
    paymentStatus: row.paymentStatus != null ? String(row.paymentStatus) : undefined,
  };
}

function mapCustomerRow(row: Record<string, unknown>): ManagerCustomerRow {
  return {
    $id: String(row.id),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? ''),
    points: toFiniteNumber(row.points),
    createdAt: String(row.createdAt ?? ''),
    branchId: String(row.branch_id ?? ''),
  };
}

function mapInventoryRow(row: Record<string, unknown>): ManagerInventoryRow {
  return {
    $id: String(row.id),
    name: String(row.name ?? ''),
    unit: String(row.unit ?? ''),
    stock: toFiniteNumber(row.stock),
    minStock: toFiniteNumber(row.minStock),
    costPerUnit: toFiniteNumber(row.costPerUnit),
    branch_id: String(row.branch_id ?? ''),
  };
}

/** Reads the central database through the Cloudflare worker (browser path). */
async function fetchFromWorker(): Promise<ManagerSnapshot> {
  const data = await callWorker<{
    orders: Record<string, unknown>[];
    customers: Record<string, unknown>[];
    inventory: Record<string, unknown>[];
  }>('/read/manager-snapshot');

  return {
    orders: (data.orders || []).map(mapOrderRow),
    customers: (data.customers || []).map(mapCustomerRow),
    inventory: (data.inventory || []).map(mapInventoryRow),
    // Recipes live in the branch database only; the browser view derives consumption from
    // the seed catalogue instead.
    recipes: [],
  };
}

/** Reads the central database through the Electron main process, which bypasses CORS. */
async function fetchFromDesktop(api: NonNullable<Window['electronAPI']>): Promise<ManagerSnapshot> {
  // One round trip for orders, customers and stock. Recipes come from the local database,
  // which the snapshot endpoint does not carry.
  const snapshot = api.getManagerSnapshot
    ? await api.getManagerSnapshot()
    : {
        orders: await api.getManagerOrders(),
        customers: await api.getManagerCustomers(),
        inventory: api.getInventory ? await api.getInventory() : [],
      };

  const recipes = api.getMenuRecipes ? await api.getMenuRecipes() : [];

  return {
    orders: snapshot.orders as unknown as ManagerOrderRow[],
    customers: snapshot.customers as unknown as ManagerCustomerRow[],
    inventory: snapshot.inventory as unknown as ManagerInventoryRow[],
    recipes,
  };
}

/**
 * Loads the manager snapshot from whichever transport this build has: the desktop app goes
 * through the main process, the browser goes through the worker.
 */
export function fetchManagerSnapshot(): Promise<ManagerSnapshot> {
  const api = window.electronAPI;
  return api?.getManagerOrders ? fetchFromDesktop(api) : fetchFromWorker();
}
