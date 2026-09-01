import { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { getTaxRate } from '../../utils/settingsConfig';
import { MenuItem } from '../../types/menu';
import { OrderItem, Order } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { buildOrderTotals, roundMoney } from '../../utils/orderTotals';
import { printCustomerReceipt } from '../../utils/printReceipts';
import { usePosDraft, OrderMode, PaymentMethod } from '../../hooks/usePosDraft';
import { PaymentPanel } from './pos/PaymentPanel';
import { ProductGrid } from './pos/ProductGrid';
import { InvoicePanel } from './pos/InvoicePanel';
import { LoyaltyModal, LoyaltyCustomer } from './pos/LoyaltyModal';

/** One loyalty point is earned per this many currency units spent. */
const POINTS_EARNED_PER = 50;
const PHONE_LENGTH = 11;

interface POSViewProps {
  menuItems: MenuItem[];
  onCreateOrder: (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: PaymentMethod,
    paidAmount?: number,
    customerPhone?: string,
    pointsEarned?: number,
    pointsRedeemed?: number,
    customerName?: string
  ) => Promise<Order | null>;
  estimatedOrderNumber: string;
}

/** Preparation destination is the part of the category after the pipe. */
function prepDestination(category: string | undefined): string {
  const parts = category ? category.split('|') : [];
  return parts[1] || parts[0] || '';
}

export function POSView({ menuItems, onCreateOrder, estimatedOrderNumber }: POSViewProps) {
  const { t, language } = useLanguage();
  const { draft, update, setInvoiceItems, reset } = usePosDraft();
  const { invoiceItems, receivedAmount, paymentMethod, paymentStatus, orderMode, tableId } = draft;

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyName, setLoyaltyName] = useState('');
  const [existingCustomer, setExistingCustomer] = useState<LoyaltyCustomer | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState<'save' | 'print'>('save');

  // Takeaway is settled at the counter; dine-in is settled later from the payment screen.
  const handleSetOrderMode = (mode: OrderMode) => {
    update(
      mode === 'Takeaway'
        ? { orderMode: mode, paymentStatus: 'Paid' }
        : { orderMode: mode, paymentStatus: 'Unpaid', tableId: '' }
    );
  };

  const filteredMenuItems = useMemo(() => {
    const available = menuItems.filter(item => item.available);
    const byCategory = selectedCategory === 'All'
      ? available
      : available.filter(item => prepDestination(item.category) === selectedCategory);

    const query = searchQuery.toLowerCase().trim();
    if (!query) return byCategory;

    return byCategory.filter(item =>
      item.name.toLowerCase().includes(query) ||
      (item.description || '').toLowerCase().includes(query) ||
      t(item.name).toLowerCase().includes(query) ||
      t(item.description || '').toLowerCase().includes(query)
    );
  }, [menuItems, selectedCategory, searchQuery, t]);

  // Money for the basket being built. Computed by the shared builder so the number shown
  // to the cashier is byte-identical to the snapshot that gets stored.
  const taxRate = getTaxRate();
  const { grandTotal } = useMemo(
    () => buildOrderTotals(invoiceItems, taxRate),
    [invoiceItems, taxRate]
  );

  // Loyalty points are whole currency units, so a fractional balance can never be redeemed.
  const redeemablePoints = useMemo(() => {
    if (!existingCustomer) return 0;
    return Math.min(Math.floor(existingCustomer.points), Math.floor(grandTotal));
  }, [existingCustomer, grandTotal]);

  const itemsCount = useMemo(
    () => invoiceItems.reduce((sum, item) => sum + item.quantity, 0),
    [invoiceItems]
  );

  const changeAmount = useMemo(() => {
    const received = parseFloat(receivedAmount);
    if (isNaN(received) || received <= grandTotal) return 0;
    return roundMoney(received - grandTotal);
  }, [receivedAmount, grandTotal]);

  const handleAddItem = (menuItem: MenuItem) => {
    setInvoiceItems(prev => {
      const existing = prev.find(item => item.id === menuItem.id);
      if (existing) {
        return prev.map(item =>
          item.id === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: 1,
        category: menuItem.category,
      }];
    });
  };

  const handleAdjustQuantity = (itemId: string, amount: number) => {
    setInvoiceItems(prev =>
      prev.flatMap(item => {
        if (item.id !== itemId) return [item];
        const nextQty = item.quantity + amount;
        return nextQty > 0 ? [{ ...item, quantity: nextQty }] : [];
      })
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setInvoiceItems(prev => prev.filter(item => item.id !== itemId));
  };

  const triggerCheckout = (action: 'save' | 'print') => {
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }
    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    setPendingCheckoutAction(action);
    setLoyaltyPhone('');
    setLoyaltyName('');
    setExistingCustomer(null);
    setRedeemPoints(false);
    setIsLoyaltyModalOpen(true);
  };

  const handlePhoneChange = async (phone: string) => {
    const cleaned = phone.replace(/\D/g, '').slice(0, PHONE_LENGTH);
    setLoyaltyPhone(cleaned);

    if (cleaned.length < PHONE_LENGTH) {
      setExistingCustomer(null);
      setLoyaltyName('');
      return;
    }

    try {
      const customer = await window.electronAPI?.getCustomerByPhone(cleaned);
      setExistingCustomer(customer ?? null);
      setLoyaltyName(customer?.name ?? '');
    } catch (err) {
      console.error('[POS] Customer lookup failed:', err);
    }
  };

  /** Places the order and, for the print action, prints the customer receipt. */
  const checkout = async (
    action: 'save' | 'print',
    customerPhone?: string,
    pointsEarned?: number,
    pointsRedeemed?: number,
    customerName?: string
  ) => {
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      // Printing implies the sale was settled, so it always records as paid.
      const finalPaymentStatus = action === 'print' ? 'Paid' : paymentStatus;
      const paidAmount = finalPaymentStatus === 'Paid'
        ? Math.max(0, roundMoney(grandTotal - (pointsRedeemed || 0)))
        : undefined;

      const newOrder = await onCreateOrder(
        finalTableId,
        invoiceItems,
        finalPaymentStatus,
        paymentMethod,
        paidAmount,
        customerPhone,
        pointsEarned,
        pointsRedeemed,
        customerName
      );

      if (action === 'print' && newOrder) {
        printCustomerReceipt(newOrder, language);
      }

      reset();
      setSuccessMessage(t('Successfully saved order'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('[POS] Checkout failed:', err);
      // The basket is deliberately left intact: the sale did not happen, and clearing it
      // would make the cashier ring the whole order again. The reason is surfaced rather
      // than a generic message, because the useful ones are actionable — a points balance
      // that changed under them, or a stock item that no longer exists.
      const reason = err instanceof Error ? err.message : '';
      alert(reason ? `${t('Failed to save order')}: ${reason}` : t('Failed to save order'));
    }
  };

  const handleConfirmLoyalty = async () => {
    const phone = loyaltyPhone.trim();
    if (phone && phone.length !== PHONE_LENGTH) {
      alert(t('Phone number must be exactly 11 digits'));
      return;
    }

    let pointsRedeemed = 0;
    let pointsEarned = 0;
    if (phone) {
      if (redeemPoints && existingCustomer) pointsRedeemed = redeemablePoints;
      const remaining = Math.max(0, roundMoney(grandTotal - pointsRedeemed));
      pointsEarned = Math.floor(remaining / POINTS_EARNED_PER);
      // Points are applied atomically with the order in the main process (Issue 26),
      // so there is deliberately no separate saveCustomer call here.
    }

    setIsLoyaltyModalOpen(false);
    await checkout(
      pendingCheckoutAction,
      phone || undefined,
      pointsEarned,
      pointsRedeemed,
      loyaltyName.trim() || undefined
    );
  };

  const handleSkipLoyalty = async () => {
    setIsLoyaltyModalOpen(false);
    await checkout(pendingCheckoutAction);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full overflow-hidden text-gray-800">

      {orderMode === 'Takeaway' && (
        <PaymentPanel
          grandTotal={grandTotal}
          receivedAmount={receivedAmount}
          changeAmount={changeAmount}
          paymentMethod={paymentMethod}
          onReceivedAmountChange={value => update({ receivedAmount: value })}
          onPaymentMethodChange={method => update({ paymentMethod: method })}
          onPrintAndPay={() => triggerCheckout('print')}
          onSave={() => triggerCheckout('save')}
          onReset={reset}
        />
      )}

      <ProductGrid
        items={filteredMenuItems}
        selectedCategory={selectedCategory}
        searchQuery={searchQuery}
        successMessage={successMessage}
        onSelectCategory={setSelectedCategory}
        onSearchChange={setSearchQuery}
        onAddItem={handleAddItem}
      />

      <InvoicePanel
        items={invoiceItems}
        itemsCount={itemsCount}
        grandTotal={grandTotal}
        orderMode={orderMode}
        tableId={tableId}
        estimatedOrderNumber={estimatedOrderNumber}
        onOrderModeChange={handleSetOrderMode}
        onTableIdChange={value => update({ tableId: value })}
        onAdjustQuantity={handleAdjustQuantity}
        onRemoveItem={handleRemoveItem}
        onSave={() => triggerCheckout('save')}
        onReset={reset}
      />

      <AnimatePresence>
        {isLoyaltyModalOpen && (
          <LoyaltyModal
            phone={loyaltyPhone}
            name={loyaltyName}
            customer={existingCustomer}
            redeemablePoints={redeemablePoints}
            redeemPoints={redeemPoints}
            onPhoneChange={handlePhoneChange}
            onNameChange={setLoyaltyName}
            onRedeemChange={setRedeemPoints}
            onConfirm={handleConfirmLoyalty}
            onSkip={handleSkipLoyalty}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
