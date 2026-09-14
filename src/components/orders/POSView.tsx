import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getTaxRate } from '../../utils/settingsConfig';
import { buildOrderTotals, roundMoney } from '../../utils/orderTotals';
import { MenuItem } from '../../types/menu';
import { OrderItem, Order } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { Coffee, Trash2, Plus, Minus, CreditCard, DollarSign, Check, XCircle, Printer, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { printCustomerReceipt } from '../../utils/printReceipts';
import { playKeypadClick, playAddItemSound, playPaymentSuccessChime, playWarningSound } from '../../utils/soundEffects';
import { getTables, removeTable } from '../../utils/tablesConfig';
import { TablesConfigModal } from '../settings/TablesConfigModal';
import { Cashier } from '../../global';
import { UserRound, UserRoundPlus, UserRoundCheck, X, Camera } from 'lucide-react';

interface POSViewProps {
  menuItems: MenuItem[];
  onCreateOrder: (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: 'Cash' | 'Card',
    paidAmount?: number,
    cashierName?: string,
    cashierAvatar?: string
  ) => Promise<Order | null>;
  estimatedOrderNumber: string;
}

export function POSView({ menuItems, onCreateOrder, estimatedOrderNumber }: POSViewProps) {
  const { t, isRtl } = useLanguage();
  const { branch } = useAuth();
  const branchId = branch?.branchId;
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  
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

  // ─── Cashier selection ─────────────────────────────────────────────────────
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  // Persist only an identity hint. Names/photos must come from the current branch's DB.
  const [activeCashier, setActiveCashier] = useState<Cashier | null>(null);
  const selectedCashierId = useRef<string | null>(null);
  const cashierFetchId = useRef(0);
  const currentBranch = useRef(branchId);
  currentBranch.current = branchId;

  const selectCashier = useCallback((cashier: Cashier | null) => {
    selectedCashierId.current = cashier?.id ?? null;
    setActiveCashier(cashier);
    if (cashier) {
      localStorage.setItem('pos_activeCashier', JSON.stringify({ id: cashier.id, branchId }));
    } else {
      localStorage.removeItem('pos_activeCashier');
    }
  }, [branchId]);

  const [isCashierModalOpen, setIsCashierModalOpen] = useState(false);
  const [newCashierName, setNewCashierName] = useState('');

  const refreshCashiers = useCallback(async () => {
    if (!window.electronAPI?.getCashiers) return;
    const fetchId = ++cashierFetchId.current;
    try {
      const list = await window.electronAPI.getCashiers();
      if (fetchId !== cashierFetchId.current || currentBranch.current !== branchId) return;
      setCashiers(list);

      let targetId = selectedCashierId.current;
      if (!targetId) {
        try {
          const savedRaw = localStorage.getItem('pos_activeCashier');
          if (savedRaw) {
            const parsed = JSON.parse(savedRaw);
            if (parsed && typeof parsed === 'object' && parsed.id) {
              if (!parsed.branchId || parsed.branchId === branchId) {
                targetId = parsed.id;
              }
            }
          }
        } catch {
          // ignore error
        }
      }

      if (list.length === 0) {
        selectCashier(null);
      } else if (targetId) {
        const found = list.find(c => c.id === targetId);
        if (found) {
          selectCashier(found);
        } else {
          selectCashier(null);
        }
      } else {
        selectCashier(null);
      }
    } catch (err) {
      console.error('Failed to load cashiers:', err);
    }
  }, [branchId, selectCashier]);

  useEffect(() => {
    refreshCashiers();
  }, [refreshCashiers]);

  // ─── Cashier avatar ─────────────────────────────────────────────────────────
  const [newCashierAvatar, setNewCashierAvatar] = useState<string | undefined>(undefined);

  // Shrink the picked photo to a small square JPEG data URL so it stays cheap to store
  // and print; the raw phone-camera file is multi-MB and would bloat SQLite and receipts.
  const resizeImageFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 96;
          canvas.height = 96;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas unavailable')); return; }
          ctx.drawImage(img, 0, 0, 96, 96);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      setNewCashierAvatar(await resizeImageFile(file));
    } catch (err) {
      console.error('Failed to process cashier photo:', err);
      showToast(t('Invalid photo'));
    }
  };

  const handleSetAvatar = async (cashierId: string, file: File | undefined) => {
    if (!file || !window.electronAPI?.setCashierAvatar) return;
    try {
      const avatar = await resizeImageFile(file);
      const updated = await window.electronAPI.setCashierAvatar(cashierId, avatar);
      setCashiers(prev => prev.map(c => (c.id === cashierId ? updated : c)));
      if (selectedCashierId.current === cashierId) {
        selectCashier(updated);
      }
    } catch (err) {
      console.error(err);
      showToast(t('Could not save photo'));
    }
  };

  const handleAddCashier = async () => {
    const name = newCashierName.trim();
    if (!name) return;
    if (name.length > 60) {
      showToast(t('Cashier name must be at most 60 characters'));
      return;
    }
    if (!window.electronAPI?.createCashier) return;
    try {
      const created = await window.electronAPI.createCashier(name, newCashierAvatar);
      setCashiers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      selectCashier(created);
      setNewCashierName('');
      setNewCashierAvatar(undefined);
      setIsCashierModalOpen(false);
      playKeypadClick();
    } catch (err) {
      console.error(err);
      playWarningSound();
      showToast(t('Failed to add cashier'));
    }
  };

  const handleDeleteCashier = async (id: string) => {
    if (!window.electronAPI?.deleteCashier) return;
    try {
      await window.electronAPI.deleteCashier(id);
      if (selectedCashierId.current === id) {
        selectCashier(null);
      }
      setCashiers(prev => {
        const remaining = prev.filter(c => c.id !== id);
        if (remaining.length === 0) {
          selectCashier(null);
        }
        return remaining;
      });
    } catch (err) {
      console.error(err);
    }
  };
  
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastText, setToastText] = useState<string>('');
  const [isToastVisible, setIsToastVisible] = useState(false);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastText(msg);
    setIsToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => {
      setIsToastVisible(false);
    }, 1300);
  };

  const dismissToast = () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setIsToastVisible(false);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

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

  // Invoice money. This must go through the same helper that writes the snapshot stored
  // with the order, not a second floating-point pipeline: the two used to disagree by a
  // cent, and the stray cent then printed a phantom loyalty-discount line on a bill that
  // was paid in full.
  const taxRate = getTaxRate();
  const { grandTotal } = useMemo(
    () => buildOrderTotals(invoiceItems, taxRate),
    [invoiceItems, taxRate]
  );

  // Items count
  const itemsCount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [invoiceItems]);

  // Change amount
  const changeAmount = useMemo(() => {
    const received = parseFloat(receivedAmount);
    if (isNaN(received) || received <= grandTotal) return 0;
    return roundMoney(received - grandTotal);
  }, [receivedAmount, grandTotal]);

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
    dismissToast();
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
    if (savingRef.current) return;
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const paidAmt = paymentStatus === 'Paid' ? grandTotal : undefined;
      const createdOrder = await onCreateOrder(
        finalTableId,
        invoiceItems,
        paymentStatus,
        paymentMethod,
        paidAmt,
        activeCashier?.name,
        activeCashier?.avatar
      );

      if (!createdOrder) {
        const msg = t('Failed to save order');
        setSaveError(msg);
        playWarningSound();
        showToast(msg);
        return;
      }

      handleReset();
      playPaymentSuccessChime();
      showToast(t('Successfully saved order'));
    } catch (err: unknown) {
      console.error(err);
      playWarningSound();
      const msg = (err as Error)?.message || t('Failed to save order');
      setSaveError(msg);
      showToast(msg);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  // Print receipt and save directly
  const handlePrintAndPay = async () => {
    if (savingRef.current) return;
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    let createdOrder: Order | null = null;
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const finalPaymentStatus = 'Paid';
      const paidAmt = grandTotal;

      createdOrder = await onCreateOrder(
        finalTableId,
        invoiceItems,
        finalPaymentStatus,
        paymentMethod,
        paidAmt,
        activeCashier?.name,
        activeCashier?.avatar
      );

      if (!createdOrder) {
        const msg = t('Failed to save order');
        setSaveError(msg);
        playWarningSound();
        showToast(msg);
        return;
      }

      handleReset();
      playPaymentSuccessChime();
      showToast(t('Successfully saved order'));
    } catch (err: unknown) {
      console.error(err);
      playWarningSound();
      const msg = (err as Error)?.message || t('Failed to process print and save');
      setSaveError(msg);
      showToast(msg);
      return;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }

    if (createdOrder) {
      try {
        await printCustomerReceipt(createdOrder, activeCashier?.avatar);
      } catch (printErr) {
        console.error('Print failed:', printErr);
        showToast(t('Order saved but printing failed'));
      }
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
            {saveError && (
              <div className="text-center text-xs text-red-600 font-bold bg-red-50 p-1.5 rounded-xl border border-red-200">
                {saveError}
              </div>
            )}
            <button
              onClick={handlePrintAndPay}
              disabled={invoiceItems.length === 0 || isSaving}
              className={clsx(
                "w-full font-black py-1.5 rounded-xl border transition-all text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm",
                invoiceItems.length === 0 || isSaving
                  ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed shadow-none"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 active:scale-95 shadow-emerald-600/20"
              )}
            >
              <Printer size={14} />
              <span className="font-sans">{isSaving ? t('Saving...') : t('Print & Pay')}</span>
            </button>
            
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleReset}
                disabled={isSaving}
                className={clsx(
                  "font-black py-1.5 rounded-xl border transition-all text-xs sm:text-sm text-center",
                  isSaving
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-red-50 hover:bg-red-100 text-red-600 border-red-200 active:scale-95"
                )}
              >
                <span className="font-sans">{t('Clear / Reset')}</span>
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={invoiceItems.length === 0 || isSaving}
                className={clsx(
                  "font-black py-1.5 rounded-xl border transition-all text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm",
                  invoiceItems.length === 0 || isSaving
                    ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed shadow-none"
                    : "bg-mocha-600 hover:bg-mocha-700 text-white border-mocha-700 active:scale-95 shadow-mocha-600/20"
                )}
              >
                <Check size={14} />
                <span className="font-sans">{isSaving ? t('Saving...') : t('Save Invoice')}</span>
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

          {/* Cashier Selector */}
          <button
            type="button"
            onClick={() => { playKeypadClick(); refreshCashiers(); setIsCashierModalOpen(true); }}
            className={clsx(
              "mt-3 w-full px-3 py-2.5 rounded-xl border-2 flex items-center justify-between gap-2 transition-all shrink-0",
              activeCashier
                ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
            )}
            title={t('Select Cashier')}
          >
            <span className="flex items-center gap-2 min-w-0">
              {activeCashier?.avatar ? (
                <img src={activeCashier.avatar} alt={activeCashier.name} className="w-9 h-9 rounded-full object-cover border-2 border-current shrink-0" />
              ) : activeCashier ? <UserRoundCheck size={18} className="shrink-0" /> : <UserRound size={18} className="shrink-0" />}
              <span className="flex flex-col items-start leading-tight min-w-0">
                <span className="text-[10px] font-bold uppercase opacity-70">{t('Cashier')}</span>
                <span className="font-black text-sm truncate">
                  {activeCashier ? activeCashier.name : t('Select Cashier')}
                </span>
              </span>
            </span>
            <UserRoundPlus size={16} className="shrink-0 opacity-60" />
          </button>

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
                disabled={isSaving}
                className={clsx(
                  "font-black py-2 rounded-xl border transition-all text-xs md:text-sm text-center",
                  isSaving
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-red-50 hover:bg-red-100 text-red-600 border-red-200 active:scale-95"
                )}
              >
                {t('Clear / Reset')}
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={invoiceItems.length === 0 || isSaving}
                className={clsx(
                  "font-black py-2 rounded-xl border transition-all text-xs md:text-sm text-center flex items-center justify-center gap-1 shadow-sm",
                  invoiceItems.length === 0 || isSaving
                    ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed shadow-none"
                    : "bg-mocha-600 hover:bg-mocha-700 text-white border-mocha-700 active:scale-95 shadow-mocha-600/20"
                )}
              >
                <Check size={14} />
                {isSaving ? t('Saving...') : t('Save Invoice')}
              </button>
            </div>
          )}
          {saveError && (
            <div className="mt-1 text-center text-xs text-red-600 font-bold bg-red-50 p-1.5 rounded-xl border border-red-200">
              {saveError}
            </div>
          )}
        </div>

      </div>

      <TablesConfigModal
        isOpen={isTablesModalOpen}
        onClose={() => setIsTablesModalOpen(false)}
        onTablesChange={(newTables) => setTablesList(newTables)}
      />

      {/* Cashier Selection Modal: pick who is on the till, or add a new name */}
      {isCashierModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setIsCashierModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-black text-mocha-800 text-base flex items-center gap-2">
                <UserRound size={18} />
                {t('Select Cashier')}
              </h3>
              <button
                type="button"
                onClick={() => setIsCashierModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">
              {activeCashier && (
                <button
                  type="button"
                  onClick={() => { selectCashier(null); setIsCashierModalOpen(false); }}
                  className="w-full px-3 py-2 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-800 font-bold text-sm hover:bg-amber-100 transition-all"
                >
                  {t('Clear selection')}
                </button>
              )}

              {cashiers.length === 0 && !activeCashier && (
                <p className="text-center text-gray-400 text-sm font-bold py-2">
                  {t('No cashiers yet — add the first one below')}
                </p>
              )}

              <div className="space-y-1.5">
                {cashiers.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { selectCashier(c); setIsCashierModalOpen(false); playKeypadClick(); }}
                      className={clsx(
                        "flex-1 px-3 py-2.5 rounded-xl border-2 font-black text-sm text-start transition-all flex items-center gap-2",
                        activeCashier?.id === c.id
                          ? "bg-emerald-50 border-emerald-400 text-emerald-800"
                          : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-mocha-50 hover:border-mocha-300"
                      )}
                    >
                      {c.avatar ? (
                        <img src={c.avatar} alt={c.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : activeCashier?.id === c.id ? <UserRoundCheck size={16} className="shrink-0" /> : <UserRound size={16} className="shrink-0 opacity-40" />}
                      <span className="truncate">{c.name}</span>
                    </button>
                    <label
                      className="px-2 py-2.5 rounded-xl text-gray-300 hover:text-mocha-600 hover:bg-mocha-50 transition-all shrink-0 cursor-pointer"
                      title={t('Change photo')}
                    >
                      <Camera size={16} />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleSetAvatar(c.id, e.target.files?.[0])}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDeleteCashier(c.id)}
                      className="px-2 py-2.5 rounded-xl text-gray-300 hover:text-red-600 hover:bg-red-50 transition-all shrink-0"
                      title={t('Delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <label className="text-xs text-gray-500 font-extrabold uppercase">{t('Add New Cashier')}</label>
                <div className="flex gap-1.5">
                  <label className="w-10 h-10 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0 cursor-pointer hover:border-mocha-400 hover:bg-mocha-50/50 transition-all overflow-hidden">
                    {newCashierAvatar ? (
                      <img src={newCashierAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Camera size={16} className="text-gray-400" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePickAvatar(e.target.files?.[0])}
                    />
                  </label>
                  <input
                    type="text"
                    value={newCashierName}
                    onChange={(e) => setNewCashierName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddCashier(); }}
                    placeholder={t('Cashier name')}
                    maxLength={60}
                    className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-bold text-sm focus:outline-none focus:border-mocha-600 focus:ring-2 focus:ring-mocha-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddCashier}
                    disabled={!newCashierName.trim()}
                    className="px-3 py-2 rounded-xl bg-mocha-600 text-white font-black text-sm hover:bg-mocha-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1 shrink-0"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification (Non-intrusive) */}
      <div
        className={clsx(
          "fixed bottom-6 start-6 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl shadow-lg border text-xs sm:text-sm font-bold transition-all duration-300 pointer-events-none select-none",
          "bg-emerald-600/95 text-white border-emerald-500/40 shadow-emerald-950/20 backdrop-blur-sm",
          isToastVisible
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-2 scale-95"
        )}
        role="status"
        aria-live="polite"
      >
        <Check size={16} className="shrink-0 stroke-[2.5]" />
        <span className="font-sans">{toastText}</span>
      </div>
    </div>
  );
}
