import { useState, useMemo, useEffect } from 'react';
import { getTaxRate } from '../../utils/settingsConfig';
import { MenuItem } from '../../types/menu';
import { OrderItem, Order } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { Coffee, Trash2, Plus, Minus, CreditCard, DollarSign, Check, XCircle, Printer, Search, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { printCustomerReceipt } from '../../utils/printReceipts';
import { playKeypadClick, playAddItemSound, playPaymentSuccessChime, playWarningSound } from '../../utils/soundEffects';
import { getTables, removeTable } from '../../utils/tablesConfig';
import { TablesConfigModal } from '../settings/TablesConfigModal';

interface POSViewProps {
  menuItems: MenuItem[];
  onCreateOrder: (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: 'Cash' | 'Card',
    paidAmount?: number
  ) => Promise<Order | null>;
  estimatedOrderNumber: string;
}

export function POSView({ menuItems, onCreateOrder, estimatedOrderNumber }: POSViewProps) {
  const { t, isRtl } = useLanguage();
  
  const [invoiceItems, setInvoiceItems] = useState<OrderItem[]>(() => {
    try {
      const saved = localStorage.getItem('pos_invoiceItems');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [receivedAmount, setReceivedAmount] = useState<string>(() => {
    return localStorage.getItem('pos_receivedAmount') || '0';
  });
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card'>(() => {
    return (localStorage.getItem('pos_paymentMethod') as 'Cash' | 'Card') || 'Cash';
  });
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Unpaid'>(() => {
    return (localStorage.getItem('pos_paymentStatus') as 'Paid' | 'Unpaid') || 'Paid';
  });
  const [orderMode, setOrderMode] = useState<'Dine-in' | 'Takeaway'>(() => {
    return (localStorage.getItem('pos_orderMode') as 'Dine-in' | 'Takeaway') || 'Takeaway';
  });
  const [tableId, setTableId] = useState<string>(() => {
    return localStorage.getItem('pos_tableId') || '';
  });
  const [tables, setTablesList] = useState<string[]>(() => getTables());
  const [isEditTablesMode, setIsEditTablesMode] = useState(false);
  const [isTablesModalOpen, setIsTablesModalOpen] = useState(false);
  
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('pos_invoiceItems', JSON.stringify(invoiceItems));
  }, [invoiceItems]);

  useEffect(() => {
    localStorage.setItem('pos_receivedAmount', receivedAmount);
  }, [receivedAmount]);

  useEffect(() => {
    localStorage.setItem('pos_paymentMethod', paymentMethod);
  }, [paymentMethod]);

  useEffect(() => {
    localStorage.setItem('pos_paymentStatus', paymentStatus);
  }, [paymentStatus]);

  useEffect(() => {
    localStorage.setItem('pos_orderMode', orderMode);
  }, [orderMode]);

  useEffect(() => {
    localStorage.setItem('pos_tableId', tableId);
  }, [tableId]);



  const handleSetOrderMode = (mode: 'Dine-in' | 'Takeaway') => {
    setOrderMode(mode);
    if (mode === 'Takeaway') {
      setPaymentStatus('Paid');
    } else {
      setPaymentStatus('Unpaid');
      setTableId('');
    }
  };

  // Available categories for cashier: Only categories that actually contain at least 1 available item
  const categories = useMemo(() => {
    const availableItems = menuItems.filter(
      item => item.available !== false && (item.available as unknown) !== 0
    );
    const catCounts = new Map<string, number>();

    availableItems.forEach(item => {
      if (!item.category) return;
      // item.category is stored as "categoryName|preparationDestination"
      const parts = item.category.split('|');
      const menuCat = parts[0]?.trim();
      if (menuCat) {
        catCounts.set(menuCat, (catCounts.get(menuCat) || 0) + 1);
      }
    });

    const activeCats = Array.from(catCounts.entries())
      .filter(([_, count]) => count > 0)
      .map(([cat]) => cat);

    if (activeCats.length === 0) {
      return ['All'];
    }

    return ['All', ...activeCats];
  }, [menuItems]);

  useEffect(() => {
    if (selectedCategory !== 'All' && !categories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [categories, selectedCategory]);

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    const available = menuItems.filter(
      item => item.available !== false && (item.available as unknown) !== 0
    );
    
    // Filter by item category (part before '|')
    const categoryFiltered = selectedCategory === 'All' 
      ? available 
      : available.filter(item => {
          const parts = item.category ? item.category.split('|') : [];
          const menuCat = parts[0]?.trim() || '';
          return menuCat === selectedCategory;
        });
      
    // Next, filter by search query (Arabic & English support)
    if (!searchQuery.trim()) return categoryFiltered;
    
    const query = searchQuery.toLowerCase().trim();
    return categoryFiltered.filter(item => {
      const nameTranslated = t(item.name).toLowerCase();
      const descTranslated = t(item.description || '').toLowerCase();
      const nameOriginal = item.name.toLowerCase();
      const descOriginal = (item.description || '').toLowerCase();
      
      return nameOriginal.includes(query) || 
             descOriginal.includes(query) ||
             nameTranslated.includes(query) ||
             descTranslated.includes(query);
    });
  }, [menuItems, selectedCategory, searchQuery, t]);

  // Total invoice amount
  const totalAmount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [invoiceItems]);

  const taxRate = getTaxRate();
  const taxAmount = useMemo(() => totalAmount * taxRate, [totalAmount, taxRate]);
  const grandTotal = useMemo(() => totalAmount + taxAmount, [totalAmount, taxAmount]);

  // Items count
  const itemsCount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [invoiceItems]);

  // Change amount
  const changeAmount = useMemo(() => {
    const received = parseFloat(receivedAmount);
    if (isNaN(received) || received <= grandTotal) return 0;
    return received - grandTotal;
  }, [receivedAmount, grandTotal]);

  // Cash payment validation: strictly require cash received >= grandTotal
  const numReceived = parseFloat(receivedAmount);
  const isCash = paymentMethod === 'Cash';
  const isCashCovered = !isCash || (!isNaN(numReceived) && numReceived >= grandTotal && grandTotal > 0);
  const cashRemaining = Math.max(0, grandTotal - (isNaN(numReceived) ? 0 : numReceived));

  // Map of item quantities already added to invoice
  const cartItemCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of invoiceItems) {
      map[item.id] = (map[item.id] || 0) + item.quantity;
    }
    return map;
  }, [invoiceItems]);

  // Smart tender cash buttons based on grandTotal
  const smartCashButtons = useMemo(() => {
    if (grandTotal <= 0) return [10, 20, 50, 100, 200, 500];
    const rounded = Math.ceil(grandTotal);
    const exact = Number(grandTotal.toFixed(2));
    const set = new Set<number>();
    set.add(exact);
    set.add(rounded);
    [10, 20, 50, 100, 200, 500].forEach(base => {
      const val = Math.ceil(rounded / base) * base;
      if (val >= rounded) set.add(val);
    });
    if (rounded < 50) set.add(50);
    if (rounded < 100) set.add(100);
    if (rounded < 200) set.add(200);
    if (rounded < 500) set.add(500);
    return Array.from(set).sort((a, b) => a - b).slice(0, 6);
  }, [grandTotal]);

  // Add item to invoice
  const handleAddItem = (menuItem: MenuItem) => {
    playAddItemSound();
    setInvoiceItems(prev => {
      const existing = prev.find(item => item.id === menuItem.id);
      if (existing) {
        return prev.map(item =>
          item.id === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          category: menuItem.category,
        },
      ];
    });
  };

  // Adjust item quantity
  const handleAdjustQuantity = (itemId: string, amount: number) => {
    playKeypadClick();
    setInvoiceItems(prev => {
      return prev
        .map(item => {
          if (item.id === itemId) {
            const nextQty = item.quantity + amount;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as OrderItem[];
    });
  };

  // Remove item from invoice
  const handleRemoveItem = (itemId: string) => {
    playKeypadClick();
    setInvoiceItems(prev => prev.filter(item => item.id !== itemId));
  };

  // Keypad presses
  const handleKeypadPress = (val: string) => {
    playKeypadClick();
    setReceivedAmount(prev => {
      if (val === 'C') return '0';
      if (val === '.') {
        if (prev.includes('.')) return prev;
        return prev + '.';
      }
      if (prev === '0') return val;
      return prev + val;
    });
  };

  // Quick cash buttons (sets tendered amount directly for fast cashier flow)
  const handleQuickCash = (amount: number) => {
    playKeypadClick();
    setReceivedAmount(String(amount));
  };

  // Reset current invoice
  const handleReset = () => {
    playKeypadClick();
    setInvoiceItems([]);
    setReceivedAmount('0');
    setPaymentMethod('Cash');
    setPaymentStatus(orderMode === 'Takeaway' ? 'Paid' : 'Unpaid');
    setTableId('');
    localStorage.removeItem('pos_invoiceItems');
    localStorage.removeItem('pos_receivedAmount');
    localStorage.removeItem('pos_paymentMethod');
    localStorage.removeItem('pos_paymentStatus');
    localStorage.removeItem('pos_orderMode');
    localStorage.removeItem('pos_tableId');
  };

  // Save and place order directly
  const handleSaveOrder = async () => {
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    // Cash validation: Never allow cash order to be saved as paid without full amount received
    if (paymentMethod === 'Cash' && (orderMode === 'Takeaway' || paymentStatus === 'Paid') && !isCashCovered) {
      playWarningSound();
      alert(t('Cannot complete cash order without receiving full amount'));
      return;
    }

    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const paidAmt = paymentStatus === 'Paid' ? grandTotal : undefined;
      await onCreateOrder(finalTableId, invoiceItems, paymentStatus, paymentMethod, paidAmt);

      handleReset();
      playPaymentSuccessChime();
      setSuccessMessage(t('Successfully saved order'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error(err);
      playWarningSound();
      alert('Failed to save order');
    }
  };

  // Print receipt and save directly
  const handlePrintAndPay = async () => {
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    // Cash validation: Never allow cash order to be printed & paid without full amount received
    if (paymentMethod === 'Cash' && !isCashCovered) {
      playWarningSound();
      alert(t('Cannot complete cash order without receiving full amount'));
      return;
    }

    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const finalPaymentStatus = 'Paid';
      const paidAmt = grandTotal;

      // Create order
      const newOrder = await onCreateOrder(finalTableId, invoiceItems, finalPaymentStatus, paymentMethod, paidAmt);

      if (newOrder) {
        printCustomerReceipt(newOrder);
      }

      handleReset();
      playPaymentSuccessChime();
      setSuccessMessage(t('Successfully saved order'));
      setTimeout(() => setSuccessMessage(null), 3050);
    } catch (err) {
      console.error(err);
      playWarningSound();
      alert('Failed to process print and save');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-2 md:gap-2.5 h-full w-full overflow-hidden text-gray-800">
      
      {/* 1. LEFT COLUMN: Payments & Calculator (Width 26-27%) - Only visible for Takeaway */}
      {orderMode === 'Takeaway' && (
        <div className="w-full lg:w-[27%] xl:w-[26%] lg:h-full bg-white p-2.5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden pos-calculator">
          <div className="overflow-y-auto hide-scrollbar flex-1 pr-0.5 flex flex-col justify-start gap-2 h-full">
            <h2 className="font-extrabold text-xs md:text-sm text-mocha-800 border-b border-gray-100 pb-1.5 shrink-0 flex items-center justify-between">
              <span className="font-sans">{t('Payment & Invoice')}</span>
              {grandTotal > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    playKeypadClick();
                    setReceivedAmount(grandTotal.toFixed(2));
                  }}
                  className="text-[10px] text-mocha-700 bg-mocha-50 hover:bg-mocha-100 border border-mocha-200 px-2 py-0.5 rounded-lg font-bold transition-all"
                  title={t('Exact')}
                >
                  {t('Exact')} ({grandTotal.toFixed(2)})
                </button>
              )}
            </h2>
            
            {/* Total Due & Received Amount Input */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <div className="space-y-0.5">
                <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Total Due')}</span></label>
                <div className="w-full bg-gray-950 text-amber-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center select-all h-[36px]">
                  <span>{grandTotal.toFixed(2)}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Received Amount')}</span></label>
                <div className="w-full bg-gray-950 text-emerald-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center select-all h-[36px]">
                  <span>{receivedAmount}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>
            </div>

            {/* Change for Customer */}
            <div className="space-y-0.5 shrink-0">
              <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Change for Customer')}</span></label>
              <div className="w-full bg-gray-950 text-amber-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center h-[36px]">
                <span>{changeAmount.toFixed(2)}</span>
                <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
              </div>
            </div>

            {/* Dynamic Smart Cash Buttons */}
            <div className="grid grid-cols-3 gap-1.5 shrink-0">
              {smartCashButtons.map(amt => {
                const isExact = grandTotal > 0 && Math.abs(amt - grandTotal) < 0.001;
                const isRound = grandTotal > 0 && Math.abs(amt - Math.ceil(grandTotal)) < 0.001 && !isExact;
                return (
                  <button
                    key={amt}
                    onClick={() => handleQuickCash(amt)}
                    className={`active:scale-95 transition-all text-xs md:text-sm font-black py-1.5 rounded-xl border shadow-sm ${
                      parseFloat(receivedAmount) === amt 
                        ? 'bg-mocha-700 text-white border-mocha-800 shadow-mocha-500/30' 
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-200'
                    }`}
                  >
                    {amt}
                    {isExact && <span className="text-[9px] block text-emerald-600 font-bold">ضبط</span>}
                    {isRound && <span className="text-[9px] block text-caramel">تقريب</span>}
                  </button>
                );
              })}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 grid-rows-5 gap-1.5 font-mono flex-grow min-h-[160px]">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all text-base md:text-lg font-black text-gray-900 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center h-full"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress('C')}
                className="col-span-3 bg-red-500 hover:bg-red-600 text-white text-base md:text-lg font-black rounded-xl border border-red-600 shadow-sm active:scale-95 transition-all flex items-center justify-center h-full"
              >
                C
              </button>
            </div>

            {/* Payment Method Selection */}
            <div className="mt-1 border-t border-gray-100 pt-1.5 shrink-0">
              <div className="space-y-0.5">
                <label className="text-[10px] md:text-xs text-gray-500 font-extrabold uppercase block"><span className="font-sans">{t('Payment Method')}</span></label>
                <div className="flex bg-gray-100 rounded-xl p-0.5 border border-gray-200">
                  <button
                    onClick={() => setPaymentMethod('Cash')}
                    className={clsx(
                      "flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5",
                      paymentMethod === 'Cash' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/30"
                    )}
                  >
                    <DollarSign size={14} />
                    <span className="font-sans">{t('Cash')}</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('Card')}
                    className={clsx(
                      "flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5",
                      paymentMethod === 'Card' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/30"
                    )}
                  >
                    <CreditCard size={14} />
                    <span className="font-sans">{t('Card')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button Row */}
          <div className="space-y-1.5 mt-2 pt-1.5 border-t border-gray-100 shrink-0">
            {/* Cash validation alert banner */}
            {isCash && invoiceItems.length > 0 && !isCashCovered && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2 text-amber-800 text-xs flex items-center gap-2 font-bold animate-pulse">
                <AlertCircle size={16} className="shrink-0 text-amber-600" />
                <div className="flex-1 flex justify-between items-center">
                  <span>{t('Cannot complete cash order without receiving full amount')}</span>
                  <span className="font-mono text-xs font-black bg-amber-100 px-1.5 py-0.5 rounded text-amber-900">
                    {t('Remaining')}: {cashRemaining.toFixed(2)} {isRtl ? 'ج.م' : 'EGP'}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handlePrintAndPay}
              disabled={invoiceItems.length === 0 || (isCash && !isCashCovered)}
              className={clsx(
                "w-full font-black py-1.5 rounded-xl border transition-all text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm",
                invoiceItems.length === 0 || (isCash && !isCashCovered)
                  ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed shadow-none"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 active:scale-95 shadow-emerald-600/20"
              )}
            >
              <Printer size={14} />
              <span className="font-sans">{t('Print & Pay')}</span>
            </button>
            
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleReset}
                className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-1.5 rounded-xl border border-red-200 transition-all active:scale-95 text-xs sm:text-sm text-center"
              >
                <span className="font-sans">{t('Clear / Reset')}</span>
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={invoiceItems.length === 0 || ((orderMode === 'Takeaway' || paymentStatus === 'Paid') && isCash && !isCashCovered)}
                className={clsx(
                  "font-black py-1.5 rounded-xl border transition-all text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm",
                  invoiceItems.length === 0 || ((orderMode === 'Takeaway' || paymentStatus === 'Paid') && isCash && !isCashCovered)
                    ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed shadow-none"
                    : "bg-mocha-600 hover:bg-mocha-700 text-white border-mocha-700 active:scale-95 shadow-mocha-600/20"
                )}
              >
                <Check size={14} />
                <span className="font-sans">{t('Save Invoice')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CENTER COLUMN: Product Grid & Category Filters */}
      <div className="flex-1 lg:h-full bg-white p-2.5 md:p-3 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col overflow-hidden">
        {/* Category Selector & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-gray-100 shrink-0">
          {/* Categories */}
          <div className="flex gap-1.5 md:gap-2 overflow-x-auto hide-scrollbar">
            {categories.length > 1 && categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={clsx(
                  "px-4 py-2 rounded-xl text-xs md:text-sm font-black whitespace-nowrap transition-all border",
                  selectedCategory === cat
                    ? "bg-mocha-600 text-white border-mocha-700 shadow-sm"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                )}
              >
                {t(cat)}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
            <input
              type="text"
              placeholder={t('Search items...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-mocha-500 focus:border-transparent text-sm font-semibold ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 ${isRtl ? 'left-3' : 'right-3'}`}
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto mt-2.5 pr-1 custom-scrollbar">
          {successMessage && (
            <div className="bg-green-50 text-green-700 border border-green-200 rounded-xl p-3 mb-4 font-bold text-center text-xs animate-bounce">
              {successMessage}
            </div>
          )}
          {filteredMenuItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
              <Coffee size={50} className="stroke-1 mb-2" />
              <p className="text-sm md:text-base font-bold">{t('No items')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-2 md:gap-2.5">
              {filteredMenuItems.map(item => {
                const inCart = cartItemCounts[item.id] || 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className={`active:scale-95 transition-all p-2.5 rounded-xl border shadow-sm flex flex-col justify-between items-start text-start h-28 relative overflow-hidden group ${
                      inCart > 0 
                        ? 'bg-amber-50/60 border-caramel/60 shadow-gold-sm ring-1 ring-caramel/30' 
                        : 'bg-gray-50 hover:bg-gray-100 border-gray-200/60 hover:border-gray-300'
                    }`}
                  >
                    {/* In-cart count badge */}
                    {inCart > 0 && (
                      <span className="absolute top-2 left-2 bg-gradient-to-r from-caramel to-mocha-600 text-white font-black text-[11px] px-2 py-0.5 rounded-full shadow-sm z-20">
                        {inCart}×
                      </span>
                    )}
                    <span className="w-full font-bold text-xs sm:text-sm text-gray-900 group-hover:text-mocha-700 font-sans leading-normal line-clamp-2">
                      {t(item.name)}
                    </span>
                    <div className="w-full flex justify-between items-center z-10 mt-auto pt-1 gap-1">
                      <span className="font-mono text-xs sm:text-sm md:text-base font-black text-mocha-800 tabular-nums whitespace-nowrap">
                        {item.price.toFixed(2)} <span className="text-[10px] sm:text-xs text-gray-400 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                      </span>
                      <span className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border transition-colors font-black text-sm shrink-0 ${
                        inCart > 0
                          ? 'bg-caramel text-white border-caramel'
                          : 'bg-mocha-50 text-mocha-600 border-mocha-200 group-hover:bg-mocha-600 group-hover:text-white'
                      }`}>
                        +
                      </span>
                    </div>
                    {/* Subtle hover icon decoration */}
                    <Coffee size={32} className="absolute -right-2 -bottom-2 text-gray-200/20 group-hover:text-mocha-200/10 transition-all pointer-events-none" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3. RIGHT COLUMN: Current Bill & Summary (Width 25-26%) */}
      <div className="w-full lg:w-[26%] xl:w-[25%] lg:h-full bg-white p-2.5 md:p-3 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <h2 className="font-extrabold text-base md:text-lg text-mocha-800 border-b border-gray-100 pb-2 shrink-0">{t('Invoice Details')}</h2>
          
          {/* Table Mode Selector */}
          <div className="flex bg-gray-100 rounded-xl p-1 border border-gray-200 mt-3 shrink-0">
            <button
              onClick={() => handleSetOrderMode('Dine-in')}
              className={clsx(
                "flex-1 py-2.5 rounded-lg text-sm md:text-base font-black transition-all",
                orderMode === 'Dine-in' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Dine-in')}
            </button>
            <button
              onClick={() => handleSetOrderMode('Takeaway')}
              className={clsx(
                "flex-1 py-2.5 rounded-lg text-sm md:text-base font-black transition-all",
                orderMode === 'Takeaway' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Takeaway')}
            </button>
          </div>

          {/* Table ID Selector (Only visible for Dine-in) */}
          {orderMode === 'Dine-in' && (
            <div className="mt-3 shrink-0 space-y-2 border-b border-gray-100 pb-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-600 font-extrabold">{t('Table')}</label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsEditTablesMode(!isEditTablesMode)}
                    className={clsx(
                      "text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1 transition-all",
                      isEditTablesMode
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                    )}
                    title={isEditTablesMode ? t('Done') : t('Delete / Edit Tables')}
                  >
                    {isEditTablesMode ? (
                      <>
                        <Check size={13} />
                        <span>{t('Done')}</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={13} />
                        <span>{t('Delete')}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTablesModalOpen(true)}
                    className="text-xs font-bold px-2 py-1 rounded-lg bg-mocha-50 text-mocha-700 hover:bg-mocha-100 flex items-center gap-1 transition-all"
                    title={t('Manage Tables')}
                  >
                    <Plus size={13} />
                    <span>{t('Add Table')}</span>
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                placeholder={t('Enter Table Number')}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl font-extrabold text-base md:text-lg focus:outline-none focus:border-mocha-600 focus:ring-2 focus:ring-mocha-100"
              />

              {isEditTablesMode && (
                <p className="text-xs text-red-600 font-bold bg-red-50 p-1.5 rounded-lg border border-red-100 text-center animate-fade-in">
                  {t('Click on any table to delete it')}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5 items-center">
                {tables.map(tbl => (
                  <button
                    key={tbl}
                    type="button"
                    onClick={() => {
                      if (isEditTablesMode) {
                        const updated = removeTable(tbl);
                        setTablesList(updated);
                        if (tableId === tbl) setTableId('');
                      } else {
                        setTableId(tbl);
                      }
                    }}
                    className={clsx(
                      "px-3.5 py-2 text-sm md:text-base font-extrabold rounded-xl border transition-all shadow-sm",
                      isEditTablesMode
                        ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-600 hover:text-white"
                        : tableId === tbl
                          ? "bg-mocha-600 text-white border-mocha-700"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {isEditTablesMode ? (
                      <span className="flex items-center gap-1">
                        <span>{tbl.startsWith('T') || tbl.startsWith('ط') ? tbl : `T${tbl}`}</span>
                        <Trash2 size={12} className="shrink-0" />
                      </span>
                    ) : (
                      tbl.startsWith('T') || tbl.startsWith('ط') ? tbl : `T${tbl}`
                    )}
                  </button>
                ))}

                {/* Quick Add Button */}
                <button
                  type="button"
                  onClick={() => setIsTablesModalOpen(true)}
                  className="px-3 py-2 text-sm font-extrabold rounded-xl border-2 border-dashed border-gray-300 text-gray-400 hover:text-mocha-600 hover:border-mocha-400 hover:bg-mocha-50/50 flex items-center justify-center transition-all"
                  title={t('Add Table')}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Current Invoice List */}
          <div className="flex-1 overflow-y-auto mt-2 pr-1 hide-scrollbar border-b border-gray-100 pb-2">
            {invoiceItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-6">
                <Coffee size={32} className="stroke-1 mb-1" />
                <p className="text-xs font-bold">{t('No items')}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {invoiceItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center bg-gray-50 p-2 rounded-xl border border-gray-200 text-xs md:text-sm gap-1.5 shadow-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-extrabold text-[10px] md:text-xs text-gray-400 font-sans">{idx + 1}.</span>
                        <span className="font-extrabold text-gray-900 truncate text-xs md:text-sm font-sans">{t(item.name)}</span>
                      </div>
                      <span className="text-[11px] md:text-xs text-mocha-700 font-extrabold font-mono">{(item.price * item.quantity).toFixed(2)} <span className="font-sans text-[9px] md:text-[10px]">{isRtl ? 'ج.م' : 'EGP'}</span></span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <div className="flex items-center bg-white border border-gray-200 rounded-md p-0.5 shadow-sm">
                        <button
                          onClick={() => handleAdjustQuantity(item.id, -1)}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="px-1.5 font-black text-gray-900 text-xs md:text-sm">{item.quantity}</span>
                        <button
                          onClick={() => handleAdjustQuantity(item.id, 1)}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Invoice Summary Box */}
        <div className="mt-2 space-y-1.5 shrink-0">
          <div className="grid grid-cols-2 gap-1.5 text-xs md:text-sm">
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Invoice Number')}</span>
              <span className="font-black text-gray-950 mt-1 text-xs md:text-sm">{estimatedOrderNumber}</span>
            </div>
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Items Count')}</span>
              <span className="font-black text-gray-950 mt-1 text-xs md:text-sm">{itemsCount}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs md:text-sm">
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Invoice Date')}</span>
              <span className="font-extrabold text-gray-900 mt-1 text-xs md:text-sm">{new Date().toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span>
            </div>
            
            {/* Invoice Total - Highlighted in Caramel/Yellow */}
            <div className="bg-amber-50/50 rounded-xl p-1.5 border border-amber-200/60 flex flex-col items-center justify-center min-h-[44px] relative">
              <span className="text-[8px] text-amber-600/80 font-extrabold mb-0.5 font-sans">{t('Total')}</span>
              <span className="font-mono text-xs font-black text-amber-900 mt-0.5">{grandTotal.toFixed(2)} <span className="text-[9px] font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span></span>
              <span className="absolute bottom-0.5 text-[6px] text-amber-600/60 font-sans">{isRtl ? 'شامل الضريبة' : 'incl. tax'}</span>
            </div>
          </div>
          
          {/* Action buttons (only visible here for Dine-in orders to save space) */}
          {orderMode === 'Dine-in' && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onClick={handleReset}
                className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-2 rounded-xl border border-red-200 transition-all active:scale-95 text-xs md:text-sm text-center"
              >
                {t('Clear / Reset')}
              </button>
              <button
                onClick={handleSaveOrder}
                className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-2 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs md:text-sm text-center flex items-center justify-center gap-1 shadow-sm"
              >
                <Check size={14} />
                {t('Save Invoice')}
              </button>
            </div>
          )}
        </div>

      </div>

      <TablesConfigModal
        isOpen={isTablesModalOpen}
        onClose={() => setIsTablesModalOpen(false)}
        onTablesChange={(newTables) => setTablesList(newTables)}
      />
    </div>
  );
}
