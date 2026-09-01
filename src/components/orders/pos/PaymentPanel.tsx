import { clsx } from 'clsx';
import { CreditCard, DollarSign, Check, Printer } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { PaymentMethod } from '../../../hooks/usePosDraft';

const QUICK_CASH_AMOUNTS = [10, 20, 50, 100, 200, 500];
const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'];

interface PaymentPanelProps {
  grandTotal: number;
  receivedAmount: string;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  onReceivedAmountChange: (next: string) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onPrintAndPay: () => void;
  onSave: () => void;
  onReset: () => void;
}

/** Dark LCD-style readout used for the three money figures. */
function Readout({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'emerald' }) {
  const { isRtl } = useLanguage();
  return (
    <div className="space-y-0.5">
      <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{label}</span></label>
      <div
        className={clsx(
          'w-full bg-gray-950 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center select-all h-[36px]',
          tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'
        )}
      >
        <span>{value}</span>
        <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
      </div>
    </div>
  );
}

export function PaymentPanel({
  grandTotal,
  receivedAmount,
  changeAmount,
  paymentMethod,
  onReceivedAmountChange,
  onPaymentMethodChange,
  onPrintAndPay,
  onSave,
  onReset,
}: PaymentPanelProps) {
  const { t } = useLanguage();

  const handleKeypadPress = (key: string) => {
    if (key === 'C') return onReceivedAmountChange('0');
    if (key === '.') {
      if (receivedAmount.includes('.')) return;
      return onReceivedAmountChange(receivedAmount + '.');
    }
    onReceivedAmountChange(receivedAmount === '0' ? key : receivedAmount + key);
  };

  const handleQuickCash = (amount: number) => {
    onReceivedAmountChange(String((parseFloat(receivedAmount) || 0) + amount));
  };

  return (
    <div className="w-full lg:w-[28%] lg:h-full bg-white p-2 md:p-2.5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden pos-calculator">
      <div className="overflow-y-auto hide-scrollbar flex-1 pe-0.5 flex flex-col justify-start gap-2 h-full">
        <h2 className="font-extrabold text-xs md:text-sm text-mocha-800 border-b border-gray-100 pb-1.5 shrink-0">
          <span className="font-sans">{t('Payment & Invoice')}</span>
        </h2>

        <div className="grid grid-cols-2 gap-2 shrink-0">
          <Readout label={t('Total Due')} value={grandTotal.toFixed(2)} tone="amber" />
          <Readout label={t('Received Amount')} value={receivedAmount} tone="emerald" />
        </div>

        <div className="shrink-0">
          <Readout label={t('Change for Customer')} value={changeAmount.toFixed(2)} tone="amber" />
        </div>

        <div className="grid grid-cols-3 gap-1.5 shrink-0">
          {QUICK_CASH_AMOUNTS.map(amt => (
            <button
              key={amt}
              onClick={() => handleQuickCash(amt)}
              className="bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all text-xs md:text-sm font-black text-gray-800 py-1.5 rounded-xl border border-gray-200 shadow-sm"
            >
              {amt}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 grid-rows-5 gap-1.5 font-mono flex-grow min-h-[160px]">
          {KEYPAD_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKeypadPress(key)}
              className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all text-base md:text-lg font-black text-gray-900 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center h-full"
            >
              {key}
            </button>
          ))}
          <button
            onClick={() => handleKeypadPress('C')}
            className="col-span-3 bg-red-500 hover:bg-red-600 text-white text-base md:text-lg font-black rounded-xl border border-red-600 shadow-sm active:scale-95 transition-all flex items-center justify-center h-full"
          >
            C
          </button>
        </div>

        <div className="mt-1 border-t border-gray-100 pt-1.5 shrink-0">
          <div className="space-y-0.5">
            <label className="text-[10px] md:text-xs text-gray-500 font-extrabold uppercase block">
              <span className="font-sans">{t('Payment Method')}</span>
            </label>
            <div className="flex bg-gray-100 rounded-xl p-0.5 border border-gray-200">
              <button
                onClick={() => onPaymentMethodChange('Cash')}
                className={clsx(
                  'flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5',
                  paymentMethod === 'Cash' ? 'bg-white text-mocha-700 shadow-sm' : 'text-gray-500 hover:bg-white/30'
                )}
              >
                <DollarSign size={14} />
                <span className="font-sans">{t('Cash')}</span>
              </button>
              <button
                onClick={() => onPaymentMethodChange('Card')}
                className={clsx(
                  'flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5',
                  paymentMethod === 'Card' ? 'bg-white text-mocha-700 shadow-sm' : 'text-gray-500 hover:bg-white/30'
                )}
              >
                <CreditCard size={14} />
                <span className="font-sans">{t('Card')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 mt-2 pt-1.5 border-t border-gray-100 shrink-0">
        <button
          onClick={onPrintAndPay}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-1.5 rounded-xl border border-emerald-700 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Printer size={14} />
          <span className="font-sans">{t('Print & Pay')}</span>
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onReset}
            className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-1.5 rounded-xl border border-red-200 transition-all active:scale-95 text-xs sm:text-sm text-center"
          >
            <span className="font-sans">{t('Clear / Reset')}</span>
          </button>
          <button
            onClick={onSave}
            className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-1.5 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Check size={14} />
            <span className="font-sans">{t('Save Invoice')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
