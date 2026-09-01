import { motion } from 'framer-motion';
import { useLanguage } from '../../../context/LanguageContext';
import { useDialog } from '../../../hooks/useDialog';

export interface LoyaltyCustomer {
  name: string;
  phone: string;
  points: number;
}

interface LoyaltyModalProps {
  phone: string;
  name: string;
  /** The matched customer, or null when the phone is unknown or incomplete. */
  customer: LoyaltyCustomer | null;
  /** Whole points that can be applied to this sale. */
  redeemablePoints: number;
  redeemPoints: boolean;
  onPhoneChange: (phone: string) => void;
  onNameChange: (name: string) => void;
  onRedeemChange: (redeem: boolean) => void;
  onConfirm: () => void;
  onSkip: () => void;
}

export function LoyaltyModal({
  phone,
  name,
  customer,
  redeemablePoints,
  redeemPoints,
  onPhoneChange,
  onNameChange,
  onRedeemChange,
  onConfirm,
  onSkip,
}: LoyaltyModalProps) {
  const { t, language } = useLanguage();
  // Escape skips the loyalty step rather than cancelling the sale, which is what the
  // cashier means when they dismiss this prompt.
  const { panelRef, titleId, descriptionId, dialogProps } = useDialog<HTMLDivElement>({
    onClose: onSkip,
    hasDescription: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        ref={panelRef}
        {...dialogProps}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 max-w-md w-full relative overflow-hidden outline-none"
      >
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-mocha-500 to-caramel" />

        <div className="mb-6 mt-2">
          <h3 id={titleId} className="text-xl font-bold text-gray-900 text-start">{t('Register New Customer')}</h3>
          <p id={descriptionId} className="text-xs text-gray-400 mt-1 text-start">
            {t('Enter customer phone number to accumulate or redeem loyalty points.')}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="loyalty-phone" className="text-xs font-semibold text-gray-500 block text-start">{t('Phone Number')}</label>
            <input
              id="loyalty-phone"
              type="tel"
              placeholder={t('Enter customer phone')}
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-start font-mono"
              autoFocus
            />
          </div>

          {/* The name field appears only once the phone is complete, because that is when a
              lookup has run and we know whether the customer already exists. */}
          {phone.length === 11 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-1"
            >
              <label htmlFor="loyalty-name" className="text-xs font-semibold text-gray-500 block text-start">{t('Customer Name')}</label>
              <input
                id="loyalty-name"
                type="text"
                placeholder={t('Customer Name')}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-start"
                disabled={!!customer}
              />
            </motion.div>
          )}

          {customer && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-4 bg-mocha-50/50 rounded-2xl border border-mocha-100 flex flex-col gap-2"
            >
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600 font-medium">{t('Points Balance')}:</span>
                <span className="font-bold text-mocha-800">{customer.points} {t('Points')}</span>
              </div>
              {redeemablePoints > 0 && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={redeemPoints}
                    onChange={(e) => onRedeemChange(e.target.checked)}
                    className="w-4 h-4 rounded text-mocha-600 focus:ring-mocha-500 border-gray-300"
                  />
                  <span className="text-xs font-semibold text-gray-700">
                    {t('Redeem Points')} ({redeemablePoints} {language === 'ar' ? 'ج.م' : 'EGP'} {t('discount')})
                  </span>
                </label>
              )}
            </motion.div>
          )}
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onSkip}
            className="flex-1 py-3 border border-gray-200 text-gray-500 rounded-2xl font-bold hover:bg-gray-50 transition-colors"
          >
            {t('Skip')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 bg-mocha-700 hover:bg-mocha-800 text-white rounded-2xl font-bold transition-all shadow-lg shadow-mocha-200 active:scale-[0.98]"
          >
            {t('Confirm')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
