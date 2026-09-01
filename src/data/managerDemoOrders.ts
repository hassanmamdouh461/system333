/**
 * Demo orders shown when the central database is unreachable.
 *
 * The dashboard is a read-only supervisory view, so an unreachable database would
 * otherwise render as a café with zero sales. These rows are clearly labelled as demo
 * mode in the UI and are never written anywhere.
 */
import type { OrderItem } from '../types/order';
import type { ManagerOrderRow } from '../services/managerDataService';

export const generateDemoOrders = (): ManagerOrderRow[] => {
  // Custom items list to randomly pick from
  const itemsList = [
    [
      { name: "Spanish Latte", quantity: 2, price: 6.00 },
      { name: "Cortado", quantity: 1, price: 4.50 }
    ],
    [
      { name: "Iced Caramel Macchiato", quantity: 3, price: 6.50 },
      { name: "Americano", quantity: 1, price: 4.00 }
    ],
    [
      { name: "Cappuccino", quantity: 2, price: 5.00 },
      { name: "Warm Chocolate Brownie", quantity: 1, price: 5.50 }
    ],
    [
      { name: "Mocha Frappe", quantity: 1, price: 7.00 },
      { name: "Espresso Shot", quantity: 4, price: 4.00 }
    ],
    [
      { name: "Turkish Coffee", quantity: 2, price: 3.50 }
    ],
    [
      { name: "Spanish Latte", quantity: 1, price: 6.00 },
      { name: "Oreo Milkshake", quantity: 2, price: 6.50 }
    ],
    [
      { name: "Prime Beef Cheeseburger", quantity: 1, price: 12.00 },
      { name: "Cheese Fries", quantity: 1, price: 5.00 },
      { name: "Mint Lemonade", quantity: 1, price: 4.50 }
    ],
    [
      { name: "Classic Club Sandwich", quantity: 1, price: 10.00 },
      { name: "Peach Iced Tea", quantity: 2, price: 5.00 }
    ]
  ];

  // Only the priced quantities matter here, so the demo item literals below do not
  // need to satisfy the full OrderItem shape.
  const calcTotal = (items: Pick<OrderItem, 'quantity' | 'price'>[]) =>
    items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  // Generate 20 realistic orders distributed nicely over times & branches
  const rawMocks = [
    // Today
    { branch_id: 'branch_1', payment_method: 'Cash', minutesAgo: 25, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', minutesAgo: 60, itemsIdx: 1, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', minutesAgo: 95, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', minutesAgo: 150, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', minutesAgo: 190, itemsIdx: 4, paymentStatus: 'Unpaid' }, // Unpaid invoice demo
    { branch_id: 'branch_3', payment_method: 'Cash', minutesAgo: 280, itemsIdx: 5, paymentStatus: 'Paid' },
    
    // Yesterday
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 1, itemsIdx: 6, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 1, itemsIdx: 7, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', daysAgo: 1, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 1, itemsIdx: 1, paymentStatus: 'Unpaid' }, // Unpaid invoice demo
    
    // This Week
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 2, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Card', daysAgo: 3, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Cash', daysAgo: 4, itemsIdx: 4, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 5, itemsIdx: 5, paymentStatus: 'Paid' },
    
    // This Month
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 9, itemsIdx: 6, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', daysAgo: 14, itemsIdx: 7, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 19, itemsIdx: 1, paymentStatus: 'Paid' },
    
    // This Year
    { branch_id: 'branch_2', payment_method: 'Card', daysAgo: 40, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Cash', daysAgo: 80, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 110, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 160, itemsIdx: 4, paymentStatus: 'Paid' }
  ];

  return rawMocks.map((m, idx) => {
    const orderDate = new Date();
    if (m.minutesAgo !== undefined) {
      orderDate.setMinutes(orderDate.getMinutes() - m.minutesAgo);
    } else if (m.daysAgo !== undefined) {
      orderDate.setDate(orderDate.getDate() - m.daysAgo);
      orderDate.setHours(9 + (idx % 12), (idx * 7) % 60, 0, 0);
    }
    const items = itemsList[m.itemsIdx % itemsList.length];
    const total_amount = calcTotal(items);

    return {
      $id: `mock-doc-${idx + 1}`,
      $createdAt: orderDate.toISOString(),
      branch_id: m.branch_id,
      total_amount,
      payment_method: m.payment_method,
      items: JSON.stringify(items),
      tableId: m.itemsIdx % 3 === 0 ? 'Takeaway' : String((idx % 6) + 1),
      paymentStatus: m.paymentStatus
    };
  });
};
