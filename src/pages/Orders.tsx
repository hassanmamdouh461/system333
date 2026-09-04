import { useMemo } from 'react';
import { Order, OrderItem } from '../types/order';
import { useOrders } from '../hooks/useOrders';
import { useMenu } from '../hooks/useMenu';
import { useLanguage } from '../context/LanguageContext';
import { POSView } from '../components/orders/POSView';
import { getTaxRate } from '../utils/settingsConfig';
import { buildOrderTotals, roundMoney } from '../utils/orderTotals';
import { printKitchenReceipt, printDrinksReceipt } from '../utils/printReceipts';

export default function Orders() {
  // Use local SQLite database for data persistence
  const { orders, error, addOrder } = useOrders();
  const { t } = useLanguage();
  const { items: menuItems, error: menuError } = useMenu();

  const handleCreatePOSOrder = async (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: 'Cash' | 'Card',
    paidAmount?: number
  ) => {
    // Snapshot the financial fields at creation time (Issue 25) so every screen
    // and report reads stored values instead of re-computing tax retroactively.
    const { subtotal, taxRate, taxAmount, grandTotal } = buildOrderTotals(items, getTaxRate());
    const collected = paidAmount != null
      ? Math.max(0, roundMoney(paidAmount))
      : (paymentStatus === 'Paid' ? grandTotal : undefined);
    const newOrder = await addOrder({
      orderNumber: '',
      tableId,
      items,
      status: 'New',
      paymentStatus,
      paymentMethod,
      totalAmount: grandTotal,
      subtotal,
      taxRate,
      taxAmount,
      grandTotal,
      ...(collected != null ? { paidAmount: collected } : {}),
      createdAt: new Date().toISOString(),
      paidAt: paymentStatus === 'Paid' ? new Date().toISOString() : undefined,
    } as Omit<Order, 'id'>);
    if (newOrder) {
      printKitchenReceipt(newOrder);
      printDrinksReceipt(newOrder);
    }
    return newOrder;
  };

  // The authoritative number is assigned by the atomic per-day counter in the main process
  // when the order is written. This is only a hint for the cashier, derived the same way —
  // today's order count plus one — so it matches in the normal case instead of showing a
  // lifetime total.
  const nextOrderNumberHint = useMemo(() => {
    const today = new Date().toDateString();
    const todayCount = orders.filter(o => new Date(o.createdAt).toDateString() === today).length;
    return String(todayCount + 1);
  }, [orders]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load orders')}</p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load menu')}</p>
          <p className="text-gray-500 text-sm">{menuError.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex-1 h-full overflow-hidden">
        <POSView
          menuItems={menuItems}
          onCreateOrder={handleCreatePOSOrder}
          estimatedOrderNumber={nextOrderNumberHint}
        />
      </div>
    </div>
  );
}
