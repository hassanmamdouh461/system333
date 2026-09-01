import { useState, useEffect } from 'react';
import { X, Store, Percent, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';
import { getTaxRate, setTaxRate } from '../../utils/settingsConfig';

interface StoreConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Renders nothing while closed so the dialog body — and its focus management — mounts
 * and unmounts with the dialog itself.
 */
export function StoreConfigModal({ isOpen, onClose }: StoreConfigModalProps) {
  if (!isOpen) return null;
  return <StoreConfigModalBody onClose={onClose} />;
}

function StoreConfigModalBody({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { panelRef, titleId, dialogProps } = useDialog<HTMLDivElement>({ onClose });
  const [taxInput, setTaxInput] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const currentRate = getTaxRate() * 100;
    setTaxInput(currentRate.toString());
    setSuccess(false);
    setError('');
  }, []);

  const handleSave = () => {
    setError('');
    const rate = parseFloat(taxInput);
    // An out-of-range rate silently corrupts every stored order total, so it is rejected
    // here rather than persisted and discovered on a receipt.
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setError(t('Tax rate must be a number between 0 and 100'));
      return;
    }
    setTaxRate(rate / 100);
    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div
        ref={panelRef}
        {...dialogProps}
        className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden outline-none">
        {/* Header */}
        <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Store size={24} />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-white">{t('Store Configuration')}</h2>
              <p className="text-emerald-100 text-xs">{t('Edit tax rates')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-gray-800">
          <div className="space-y-1">
            <label htmlFor="tax-rate" className="text-sm font-bold text-gray-700 block">{t('Tax Rate Percentage')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-4 flex items-center pointer-events-none text-gray-400">
                <Percent size={18} />
              </div>
              <input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="1"
                value={taxInput}
                onChange={(e) => setTaxInput(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl ps-11 pe-4 py-3 text-lg font-semibold focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="14"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('Enter the tax rate as a whole number (e.g., 14 for 14%)')}</p>
          </div>

          {error && (
            <div className="text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{t('Tax rate updated successfully!')}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
            >
              {t('Save Changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
