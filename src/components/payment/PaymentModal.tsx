import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Order } from '../../types/order';
import { X, CheckCircle2, Printer, CreditCard, Banknote } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../../context/LanguageContext';
import { orderTotals } from '../../utils/orderTotals';
import { getStoreConfig } from '../../utils/settingsConfig';
import { printCustomerReceipt } from '../../utils/printReceipts';
import { playPaymentSuccessChime } from '../../utils/soundEffects';

interface PaymentModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentComplete: (orderId: string, method: 'Cash' | 'Card') => Promise<Order>;
}

export function PaymentModal({ order, isOpen, onClose, onPaymentComplete }: PaymentModalProps) {
  // Retain pending writes across close/reopen and order switches, without allowing a
  // second database write for the same invoice while the first is still unresolved.
  const pending = useRef(new Map<string, Promise<Order>>());
  const completePayment = async (id: string, method: 'Cash' | 'Card') => {
    const existing = pending.current.get(id);
    if (existing) return existing;
    const request = Promise.resolve().then(() => onPaymentComplete(id, method));
    pending.current.set(id, request);
    try {
      return await request;
    } finally {
      pending.current.delete(id);
    }
  };

  return isOpen && order ? (
    <PaymentSession key={order.id} order={order} onClose={onClose} onPaymentComplete={completePayment} />
  ) : null;
}

function PaymentSession({ order, onClose, onPaymentComplete }: Omit<PaymentModalProps, 'order' | 'isOpen'> & { order: Order }) {
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card'>(order.paymentMethod || 'Cash');
  const [isProcessing, setIsProcessing] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(order.paymentStatus === 'Paid' ? order : null);
  const [error, setError] = useState('');
  const { t, language } = useLanguage();
  const activeRef = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const showReceipt = receiptOrder !== null;
  const displayOrder = receiptOrder || order;
  const storeConfig = getStoreConfig();
  const { subtotal, taxRate, taxAmount: tax, grandTotal: total } = orderTotals(displayOrder);

  const handleProcessPayment = async () => {
    if (submittingRef.current || showReceipt || !activeRef.current) return;
    submittingRef.current = true;
    setIsProcessing(true);
    setError('');
    try {
      const updatedOrder = await onPaymentComplete(order.id, paymentMethod);
      if (!activeRef.current) return;
      if (!updatedOrder || updatedOrder.id !== order.id || updatedOrder.paymentStatus !== 'Paid') {
        throw new Error(t('Payment was not confirmed. Please try again.'));
      }
      setReceiptOrder(updatedOrder);
      playPaymentSuccessChime();
    } catch (err) {
      if (!activeRef.current) return;
      console.error('[PaymentModal] Payment failed:', err);
      setError(t('Payment failed. Please try again.'));
    } finally {
      submittingRef.current = false;
      if (activeRef.current) setIsProcessing(false);
    }
  };

  const handleClose = () => {
    // A committed write cannot be cancelled, but its old session must not show UI or play sounds.
    activeRef.current = false;
    onClose();
  };

  const handlePrintReceipt = async () => {
    if (!receiptOrder) return;
    setError('');
    try {
      await printCustomerReceipt(receiptOrder);
    } catch (err) {
      console.error('[PaymentModal] Print failed:', err);
      if (activeRef.current) setError(t('Receipt printing failed. Please try again.'));
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           exit={{ opacity: 0, scale: 0.95 }}
           className="bg-white rounded-2xl w-full max-w-lg shadow-2xl relative z-50 overflow-hidden flex flex-col max-h-[90dvh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <CreditCard className="text-mocha-700" />
              {showReceipt ? t('Payment Successful') : t('Process Payment')}
            </h2>
            <button aria-label={t('Close')} onClick={handleClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {!showReceipt ? (
              <div className="space-y-6">
                 {/* Order Summary */}
                 <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-500">{t('Table')}</span>
                      <span className="font-bold text-gray-900">{t(order.tableId)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                       <span className="text-sm text-gray-500">{t('Order ID')}</span>
                       <span className="font-mono text-xs bg-gray-200 px-2 py-1 rounded">{order.orderNumber}</span>
                    </div>
                    
                    {/* Order Items Details */}
                    <div className="mt-3 bg-white border border-gray-100 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <p className="text-xs font-bold text-gray-500 mb-2 border-b border-gray-100 pb-1">{t('Items')}</p>
                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={item.id || idx} className="flex justify-between text-xs text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400 font-mono">x{item.quantity}</span>
                              <span className="font-medium">{t(item.name)}</span>
                            </div>
                            <span className="font-mono">{(item.price * item.quantity).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-gray-200 my-3" />
                    
                    <div className="space-y-1.5 text-xs text-gray-500">
                      <div className="flex justify-between">
                        <span>{t('Subtotal')} ({t('Price')})</span>
                        <span className="font-mono">{subtotal.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                      </div>
                      <div className="flex justify-between items-center text-gray-500 mb-2">
                        <span>{language === 'ar' ? `الضريبة (${Math.round(taxRate * 100)}%)` : `Tax (${Math.round(taxRate * 100)}%)`}</span>
                        <span className="font-mono">{tax.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 my-3" />
                    <div className="flex justify-between items-center text-lg font-bold">
                       <span>{t('Total to Pay')}</span>
                       <span className="text-mocha-700">{total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                    </div>
                 </div>

                 {/* Payment Method Selection */}
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">{t('Select Payment Method')}</label>
                    <div className="grid grid-cols-2 gap-4">
                       <button
                          disabled={isProcessing}
                          onClick={() => setPaymentMethod('Cash')}
                          className={clsx(
                             "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                             paymentMethod === 'Cash' ? "border-mocha-700 bg-mocha-100 text-mocha-800" : "border-gray-100 hover:border-gray-200 text-gray-600"
                          )}
                       >
                          <Banknote size={24} />
                          <span className="font-medium">{t('Cash')}</span>
                       </button>
                       <button
                          disabled={isProcessing}
                          onClick={() => setPaymentMethod('Card')}
                          className={clsx(
                             "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                             paymentMethod === 'Card' ? "border-mocha-700 bg-mocha-100 text-mocha-800" : "border-gray-100 hover:border-gray-200 text-gray-600"
                          )}
                       >
                          <CreditCard size={24} />
                          <span className="font-medium">{t('Card')}</span>
                       </button>
                    </div>
                 </div>

                 <button
                    onClick={handleProcessPayment}
                    disabled={isProcessing}
                    className="w-full bg-mocha-700 text-white py-4 rounded-xl font-bold text-lg hover:bg-mocha-800 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                 >
                    {isProcessing ? t('Processing...') : `${t('Pay')} ${total.toFixed(2)} ${language === 'ar' ? 'ج.م' : 'EGP'}`}
                 </button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                 <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 size={32} />
                 </div>
                 
                 <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-1">{t('Payment Received!')}</h3>
                    <p className="text-gray-500">{t('Transaction completed successfully.')}</p>
                    
                    {/* Mock Realistic Thermal Receipt Preview */}
                    <motion.div 
                      initial={{ y: -24, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: 'spring', damping: 20 }}
                      className="bg-amber-50/20 p-6 rounded-2xl border-2 border-dashed border-gray-300 text-left font-mono text-sm shadow-md relative overflow-hidden text-gray-900 mx-auto max-w-md mt-6"
                    >
                       <div className="text-center border-b border-dashed border-gray-300 pb-3 mb-3">
                          <p className="font-black text-xl tracking-tight text-mocha-900">☕ {storeConfig.storeName || 'Engaz POS'}</p>
                          <p className="text-[11px] text-gray-500 font-sans">{t('نظام الكاشير الذكي للكافيهات والمطاعم')}</p>
                          <p className="text-[10px] text-gray-400 mt-1 font-mono">INV #{displayOrder.orderNumber} • {t(displayOrder.tableId)}</p>
                       </div>

                       <div className="space-y-1.5 mb-3 border-b border-dashed border-gray-300 pb-3">
                          {displayOrder.items.map((item, i) => (
                             <div key={i} className="flex justify-between text-xs">
                                <span>{item.quantity}× {t(item.name)}</span>
                                <span className="tabular-nums font-bold">{(item.price * item.quantity).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                             </div>
                          ))}
                       </div>

                       <div className="space-y-1 text-xs">
                          <div className="flex justify-between text-gray-600">
                             <span>{t('Subtotal')}</span>
                             <span className="tabular-nums">{subtotal.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                          <div className="flex justify-between text-gray-600">
                             <span>{language === 'ar' ? `الضريبة (${Math.round(taxRate * 100)}%)` : `Tax (${Math.round(taxRate * 100)}%)`}</span>
                             <span className="tabular-nums">{tax.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                          <div className="flex justify-between font-black text-base pt-2 border-t border-dashed border-gray-300 text-mocha-800">
                             <span>{t('TOTAL')}</span>
                             <span className="tabular-nums">{total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                       </div>
                       
                       {/* Simulated Thermal Barcode */}
                       <div className="mt-4 pt-3 border-t border-dashed border-gray-300 text-center flex flex-col items-center">
                          <div className="flex gap-[2px] h-8 items-center justify-center opacity-75 mb-1">
                            {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 4, 3, 1, 2].map((w, i) => (
                              <div key={i} className="bg-gray-800 h-full" style={{ width: `${w * 1.5}px` }} />
                            ))}
                          </div>
                          <p className="text-[9px] text-gray-400 font-mono tracking-widest">{displayOrder.id.slice(0, 16).toUpperCase()}</p>
                          <p className="text-[10px] text-gray-400 mt-1 font-sans">{t('Thank you for choosing Engaz POS! ☕')}</p>
                       </div>
                    </motion.div>
                 </div>

                 <div className="flex gap-4">
                    <button 
                      onClick={handlePrintReceipt} 
                      className="flex-1 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                    >
                       <Printer size={18} /> {t('Print Receipt')}
                    </button>
                    <button aria-label={t('Close')} onClick={handleClose} className="flex-1 py-3 bg-mocha-700 text-white rounded-xl font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20">
                       {t('Done')}
                    </button>
                 </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
