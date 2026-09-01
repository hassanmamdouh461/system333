import { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderItem } from '../types/order';
import { OrderCard } from '../components/orders/OrderCard';
import { OrderDetails } from '../components/orders/OrderDetails';
import { useIsMobile } from '../hooks/useIsMobile';
import { useOrders } from '../hooks/useOrders';
import { useMenu } from '../hooks/useMenu';
import { LayoutList, Calculator } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { POSView } from '../components/orders/POSView';
import { getTaxRate } from '../utils/settingsConfig';
import { buildOrderTotals, roundMoney } from '../utils/orderTotals';

import { filterItemsBySection, getOrderStatusForSection } from '../utils/orderSection';
import { printKitchenReceipt, printDrinksReceipt } from '../utils/printReceipts';

interface OrdersProps {
  type?: 'all' | 'kitchen' | 'drinks';
}

export default function Orders({ type = 'all' }: OrdersProps) {
  // Use local SQLite database for data persistence
  const { orders, error, updateOrder, addOrder } = useOrders();
  const { t, language } = useLanguage();
  const { items: menuItems, error: menuError } = useMenu();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [activeView, setActiveView] = useState<'pos' | 'tracker'>('pos');

  const handleCreatePOSOrder = async (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: 'Cash' | 'Card',
    paidAmount?: number,
    customerPhone?: string,
    pointsEarned?: number,
    pointsRedeemed?: number,
    customerName?: string
  ) => {
    // Snapshot the financial fields at creation time (Issue 25) so every screen
    // and report reads stored values instead of re-computing tax retroactively.
    const { subtotal, taxRate, taxAmount, grandTotal } = buildOrderTotals(items, getTaxRate());
    // The amount that actually reached the till. Without storing it, an order discounted by
    // loyalty points still reported its full grand total as revenue.
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
      customerPhone,
      pointsEarned,
      pointsRedeemed,
      ...(customerName ? { customerName } : {})
    } as Omit<Order, 'id'>);
    if (newOrder) {
      printKitchenReceipt(newOrder, language);
      printDrinksReceipt(newOrder, language);
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

  const isMobile = useIsMobile();

  const sectionOrders = useMemo(() => {
    return orders.filter(order => filterItemsBySection(order.items, type).length > 0);
  }, [orders, type]);

  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      // Update the status of items belonging to this section!
      const updatedItems = order.items.map(item => {
        const isMatch = type === 'all' || 
                        (type === 'drinks' && filterItemsBySection([item], 'drinks').length > 0) || 
                        (type === 'kitchen' && filterItemsBySection([item], 'kitchen').length > 0);
                        
        if (isMatch) {
          return { ...item, status: newStatus };
        }
        return { ...item, status: item.status || order.status || 'New' };
      });

      // Calculate the new overall status for the order
      let overallStatus = order.status;
      if (newStatus === 'Cancelled') {
        overallStatus = 'Cancelled';
      } else if (newStatus === 'Completed') {
        overallStatus = 'Completed';
      } else {
        const allStatuses = updatedItems.map(item => item.status || 'New');
        if (allStatuses.every(s => s === 'Completed')) {
          overallStatus = 'Completed';
        } else if (allStatuses.every(s => s === 'Ready' || s === 'Completed')) {
          overallStatus = 'Ready';
        } else if (allStatuses.includes('Preparing') || allStatuses.includes('Ready')) {
          overallStatus = 'Preparing';
        } else {
          overallStatus = 'New';
        }
      }

      await updateOrder(orderId, {
        items: updatedItems,
        status: overallStatus
      });

      // Update selected order if it's the one being changed
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ 
          ...selectedOrder, 
          items: updatedItems,
          status: overallStatus 
        });
      }
    } catch (err) {
      console.error('Failed to update order status:', err);
      alert('Failed to update order status');
    }
  };

  const handleCardClick = (order: Order) => {
    const cardStatus = getOrderStatusForSection(order, type);
    if (cardStatus === 'New') {
      handleUpdateStatus(order.id, 'Preparing');
    } else if (cardStatus === 'Preparing') {
      handleUpdateStatus(order.id, 'Ready');
    } else if (cardStatus === 'Ready') {
      handleUpdateStatus(order.id, 'Completed');
    } else {
      setSelectedOrder(order);
    }
  };

  const handleCancelOrder = (orderId: string) => {
    if (window.confirm(t('Cancel this order?'))) {
      handleUpdateStatus(orderId, 'Cancelled');
    }
  };

  const columns: { title: string; status: OrderStatus; color: string }[] = [
    { title: 'New Orders', status: 'New', color: 'bg-mocha-100 text-mocha-800' },
    { title: 'Brewing ☕', status: 'Preparing', color: 'bg-caramel-light text-coffee-dark' },
    { title: 'Ready for Pickup 🛎️', status: 'Ready', color: 'bg-green-50 text-green-700' },
    { title: 'Cancelled ✕', status: 'Cancelled', color: 'bg-red-50 text-red-600' },
  ];

  // Single-pass grouping — O(n) instead of O(n × columns).
  // All kanban columns and the mobile list read from this memo.
  const groupedOrders = useMemo(() => {
    const map: Record<string, Order[]> = {
      New: [], Preparing: [], Ready: [], Completed: [], Cancelled: [],
    };
    for (const o of sectionOrders) {
      const sectionStatus = getOrderStatusForSection(o, type);
      if (map[sectionStatus]) map[sectionStatus].push(o);
    }
    // Sort active and cancelled columns by orderNumber numerically ascending
    const statusesToSort: OrderStatus[] = ['New', 'Preparing', 'Ready', 'Cancelled'];
    for (const status of statusesToSort) {
      map[status].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));
    }
    // Completed sorted newest-first so the most recent payment is at the top
    map.Completed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return map;
  }, [sectionOrders, type]);

  // Error state renders after every hook has run: an early return above the useMemo
  // changed the hook call order between renders.
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

  // A failed menu load must block the cashier board too. The catalogue is what the POS
  // sells from, so rendering it empty would look like a café with nothing on the menu
  // rather than a database that is unreachable.
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

  const titleMap = {
    all: { title: 'Cashier Board' },
    kitchen: { title: 'Kitchen Board' },
    drinks: { title: 'Drinks Board' }
  };
  const { title } = titleMap[type];

  return (
    <div className="flex flex-col h-[calc(100vh-168px)] md:h-[calc(100vh-114px)]">
      {/* Header. The cashier board carries the register/tracker switch; the kitchen and
          drinks boards only ever show the tracker, so they get a plain title. */}
      {(type !== 'all' || activeView !== 'pos') && (
        <div className="mb-2 md:mb-4 shrink-0">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h1 className="font-bold text-gray-900 text-lg md:text-2xl">
                {t(title)}
              </h1>
            </div>
            {type === 'all' && (
              <button
                onClick={() => setActiveView('pos')}
                className="mobile-touch-target flex items-center gap-2 bg-mocha-600 hover:bg-mocha-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors"
              >
                <Calculator size={18} /> {t('POS View')}
              </button>
            )}
          </div>
        </div>
      )}

      {type === 'all' && activeView === 'pos' ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="shrink-0 flex justify-end mb-2">
            <button
              onClick={() => setActiveView('tracker')}
              className="mobile-touch-target flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold transition-colors"
            >
              <LayoutList size={18} /> {t('Order Tracker')}
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <POSView
              menuItems={menuItems}
              onCreateOrder={handleCreatePOSOrder}
              estimatedOrderNumber={nextOrderNumberHint}
            />
          </div>
        </div>
      ) : (
        /* Kanban Board - Desktop | Mobile: Simple list */
        isMobile ? (
        /* Mobile: Full-width list, padded for bottom nav */
        <div className="flex-1 overflow-y-auto space-y-2 pb-24">
          {sectionOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">{t('No orders found')}</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {sectionOrders.map(order => (
                <OrderCard 
                  key={order.id} 
                  order={order} 
                  onClick={handleCardClick}
                  onCancel={handleCancelOrder}
                  type={type}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      ) : (
        /* Desktop: Kanban View */
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-[900px] h-full">
            {columns.map(col => (
              <div key={col.status} className="flex-1 flex flex-col bg-gray-100/50 rounded-2xl p-3 border border-gray-200/50">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-gray-700 text-sm">{t(col.title)}</h3>
                  <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">
                    {(groupedOrders[col.status] ?? []).length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pe-1">
                  <AnimatePresence mode="popLayout">
                    {(groupedOrders[col.status] ?? [])
                      .map(order => (
                        <OrderCard 
                          key={order.id} 
                          order={order} 
                          onClick={handleCardClick}
                          onCancel={handleCancelOrder}
                          type={type}
                        />
                      ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}

            {/* Completed Column */}
            <div className="flex-1 flex flex-col bg-gray-100/50 rounded-2xl p-3 border border-gray-200/50 opacity-75">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-500 text-sm">{t('Completed')}</h3>
                <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">
                  {groupedOrders.Completed.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pe-1">
                <AnimatePresence mode="popLayout">
                  {groupedOrders.Completed
                    .map(order => (
                      <OrderCard 
                        key={order.id} 
                        order={order} 
                        onClick={handleCardClick}
                        onCancel={handleCancelOrder}
                        type={type}
                      />
                    ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      ))}

      <OrderDetails 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)}
        onUpdateStatus={handleUpdateStatus}
        type={type}
      />
    </div>
  );
}
