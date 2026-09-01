import { clsx } from 'clsx';
import { Coffee, Trash2, Plus, Minus, Check } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { OrderItem } from '../../../types/order';
import { OrderMode } from '../../../hooks/usePosDraft';

const QUICK_TABLES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

interface InvoicePanelProps {
  items: OrderItem[];
  itemsCount: number;
  grandTotal: number;
  orderMode: OrderMode;
  tableId: string;
  estimatedOrderNumber: string;
  onOrderModeChange: (mode: OrderMode) => void;
  onTableIdChange: (tableId: string) => void;
  onAdjustQuantity: (itemId: string, amount: number) => void;
  onRemoveItem: (itemId: string) => void;
  onSave: () => void;
  onReset: () => void;
}

export function InvoicePanel({
  items,
  itemsCount,
  grandTotal,
  orderMode,
  tableId,
  estimatedOrderNumber,
  onOrderModeChange,
  onTableIdChange,
  onAdjustQuantity,
  onRemoveItem,
  onSave,
  onReset,
}: InvoicePanelProps) {
  const { t, isRtl } = useLanguage();
  const currency = isRtl ? 'ج.م' : 'EGP';

  return (
    <div className="w-full lg:w-[23%] lg:h-full bg-white p-3 md:p-3.5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <h2 className="font-extrabold text-base md:text-lg text-mocha-800 border-b border-gray-100 pb-2 shrink-0">
          {t('Invoice Details')}
        </h2>

        <div className="flex bg-gray-100 rounded-xl p-1 border border-gray-200 mt-3 shrink-0">
          {(['Dine-in', 'Takeaway'] as OrderMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onOrderModeChange(mode)}
              className={clsx(
                'flex-1 py-2.5 rounded-lg text-sm md:text-base font-black transition-all',
                orderMode === mode ? 'bg-white text-mocha-700 shadow-sm' : 'text-gray-500 hover:bg-white/50'
              )}
            >
              {t(mode)}
            </button>
          ))}
        </div>

        {orderMode === 'Dine-in' && (
          <div className="mt-3 shrink-0 space-y-2 border-b border-gray-100 pb-3">
            <label className="text-sm text-gray-600 font-extrabold">{t('Table')}</label>
            <input
              aria-label={t('Enter Table Number')}
              type="text"
              value={tableId}
              onChange={(e) => onTableIdChange(e.target.value)}
              placeholder={t('Enter Table Number')}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl font-extrabold text-base md:text-lg focus:outline-none focus:border-mocha-600 focus:ring-2 focus:ring-mocha-100"
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TABLES.map(num => (
                <button
                  key={num}
                  onClick={() => onTableIdChange(num)}
                  className={clsx(
                    'px-3.5 py-2 text-sm md:text-base font-extrabold rounded-xl border transition-all shadow-sm',
                    tableId === num
                      ? 'bg-mocha-600 text-white border-mocha-700'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  )}
                >
                  T{num}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto mt-2 pe-1 hide-scrollbar border-b border-gray-100 pb-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-6">
              <Coffee size={32} className="stroke-1 mb-1" />
              <p className="text-xs font-bold">{t('No items')}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex justify-between items-center bg-gray-50 p-2 rounded-xl border border-gray-200 text-xs md:text-sm gap-1.5 shadow-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-extrabold text-[10px] md:text-xs text-gray-400 font-sans">{idx + 1}.</span>
                      <span className="font-extrabold text-gray-900 truncate text-xs md:text-sm font-sans">{t(item.name)}</span>
                    </div>
                    <span className="text-[11px] md:text-xs text-mocha-700 font-extrabold font-mono">
                      {(item.price * item.quantity).toFixed(2)}{' '}
                      <span className="font-sans text-[9px] md:text-[10px]">{currency}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <div className="flex items-center bg-white border border-gray-200 rounded-md p-0.5 shadow-sm">
                      <button
                        onClick={() => onAdjustQuantity(item.id, -1)}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="px-1.5 font-black text-gray-900 text-xs md:text-sm">{item.quantity}</span>
                      <button
                        onClick={() => onAdjustQuantity(item.id, 1)}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <button
                      onClick={() => onRemoveItem(item.id)}
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
            <span className="font-extrabold text-gray-900 mt-1 text-xs md:text-sm">
              {new Date().toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
            </span>
          </div>

          <div className="bg-amber-50/50 rounded-xl p-1.5 border border-amber-200/60 flex flex-col items-center justify-center min-h-[44px] relative">
            <span className="text-[8px] text-amber-600/80 font-extrabold mb-0.5 font-sans">{t('Total')}</span>
            <span className="font-mono text-xs font-black text-amber-900 mt-0.5">
              {grandTotal.toFixed(2)} <span className="text-[9px] font-sans font-bold">{currency}</span>
            </span>
            <span className="absolute bottom-0.5 text-[6px] text-amber-600/60 font-sans">
              {isRtl ? 'شامل الضريبة' : 'incl. tax'}
            </span>
          </div>
        </div>

        {/* Dine-in has no payment panel on the left, so its actions live here. */}
        {orderMode === 'Dine-in' && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={onReset}
              className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-2 rounded-xl border border-red-200 transition-all active:scale-95 text-xs md:text-sm text-center"
            >
              {t('Clear / Reset')}
            </button>
            <button
              onClick={onSave}
              className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-2 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs md:text-sm text-center flex items-center justify-center gap-1 shadow-sm"
            >
              <Check size={14} />
              {t('Save Invoice')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
