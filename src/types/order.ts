export type OrderStatus = 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
export type PaymentStatus = 'Unpaid' | 'Paid';

export interface OrderItem {
  id: string;
  /** Links back to the menu_items row this line came from; used for recipe/cost lookups. */
  menuItemId?: string;
  name: string;
  quantity: number;
  price: number;
  status?: OrderStatus;
  category?: string;
  notes?: string;
}

export interface Order {
  id: string; // Database ID (for API calls)
  orderNumber: string; // Display ID (e.g., ORD-1025)
  tableId: string;
  status: OrderStatus;
  /** Financial status. Only set to 'Paid' from Payment.tsx — never from the kitchen/orders screen. */
  paymentStatus: PaymentStatus;
  paymentMethod?: 'Cash' | 'Card';
  items: OrderItem[];
  totalAmount: number;
  /** Tax snapshot stored at order-creation time (Issue 25): read these, never recompute. */
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  grandTotal?: number;
  /**
   * What the till actually collected, stamped at payment time. Below `grandTotal` whenever
   * loyalty points covered part of the bill, so revenue reporting must read this.
   */
  paidAmount?: number;
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string — last modification timestamp for sync conflict resolution
  paidAt?: string; // ISO string when payment was completed
  customerPhone?: string;
  customerName?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  /** Multi-branch sync fields */
  branchId?: string; // UUID identifying which branch created/owns this record
  isSynced?: boolean; // false = needs to be pushed to central server
}
