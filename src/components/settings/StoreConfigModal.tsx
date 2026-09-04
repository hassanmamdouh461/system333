import { useState, useEffect } from 'react';
import { X, Store, Percent, ShieldCheck, Type, MapPin, Phone, Clock } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';
import { getStoreConfig, setStoreConfig } from '../../utils/settingsConfig';

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

  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [tagline, setTagline] = useState('');
  const [taxInput, setTaxInput] = useState('');
  const [startHourInput, setStartHourInput] = useState('');

  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const config = getStoreConfig();
    setStoreName(config.storeName);
    setAddress(config.address);
    setPhone(config.phone);
    setTagline(config.tagline);
    setTaxInput((config.taxRate * 100).toString());
    setStartHourInput(config.businessDayStartHour.toString());
    setSuccess(false);
    setError('');
  }, []);

  const handleSave = () => {
    setError('');

    const rate = parseFloat(taxInput);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setError(t('Tax rate must be a number between 0 and 100'));
      return;
    }

    const hour = parseInt(startHourInput, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      setError(t('Start hour must be an integer between 0 and 23'));
      return;
    }

    setStoreConfig({
      storeName: storeName.trim() || 'BrewMaster Coffee',
      address: address.trim(),
      phone: phone.trim(),
      tagline: tagline.trim(),
      taxRate: rate / 100,
      businessDayStartHour: hour,
    });

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
        dir="rtl"
        className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden outline-none flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-xl text-white flex items-center justify-center">
              <Store size={24} />
            </div>
            <div className="text-right">
              <h2 id={titleId} className="text-lg font-bold text-white leading-tight">
                {t('Store Configuration')}
              </h2>
              <p className="text-emerald-100 text-xs mt-0.5 font-medium">الضريبة • الهوية</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-4 text-gray-800 overflow-y-auto max-h-[calc(90vh-72px)]">
          {/* Store Name */}
          <div className="space-y-1.5">
            <label htmlFor="store-name" className="text-sm font-bold text-gray-700 block text-right">
              {t('Store Name')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
                <Type size={18} />
              </div>
              <input
                id="store-name"
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="BrewMaster Coffee"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label htmlFor="store-address" className="text-sm font-bold text-gray-700 block text-right">
              {t('Address')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
                <MapPin size={18} />
              </div>
              <input
                id="store-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="القاهرة - مصر"
              />
            </div>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label htmlFor="store-phone" className="text-sm font-bold text-gray-700 block text-right">
              {t('Phone')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
                <Phone size={18} />
              </div>
              <input
                id="store-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="0100000000"
              />
            </div>
          </div>

          {/* Tagline / Description */}
          <div className="space-y-1.5">
            <label htmlFor="store-tagline" className="text-sm font-bold text-gray-700 block text-right">
              {t('Tagline / Description')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
                <Type size={18} />
              </div>
              <input
                id="store-tagline"
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="أفضل تجربة قهوة"
              />
            </div>
          </div>

          {/* Tax Rate % */}
          <div className="space-y-1.5">
            <label htmlFor="tax-rate" className="text-sm font-bold text-gray-700 block text-right">
              {t('Tax Rate %')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
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
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="0"
              />
            </div>
          </div>

          {/* Business Day Start Hour */}
          <div className="space-y-1.5">
            <label
              htmlFor="business-day-start-hour"
              className="text-sm font-bold text-gray-700 block text-right"
            >
              {t('Business Day Start Hour')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-3.5 flex items-center pointer-events-none text-gray-400">
                <Clock size={18} />
              </div>
              <input
                id="business-day-start-hour"
                type="number"
                min="0"
                max="23"
                step="1"
                value={startHourInput}
                onChange={(e) => setStartHourInput(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-right"
                placeholder="0"
              />
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mt-1.5 text-right">
              {t('Business day start hour helper text')}
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100 text-right">
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100 justify-end">
              <p>{t('Store settings updated successfully!')}</p>
              <ShieldCheck size={16} />
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
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

