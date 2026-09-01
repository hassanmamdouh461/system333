import React from 'react';
import { Phone, User } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Modal } from '../ui/Modal';

interface AddCustomerModalProps {
  phone: string;
  name: string;
  onPhoneChange: (phone: string) => void;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  'w-full ps-9 pe-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-start';

export function AddCustomerModal({
  phone,
  name,
  onPhoneChange,
  onNameChange,
  onSubmit,
  onClose,
}: AddCustomerModalProps) {
  const { t } = useLanguage();

  return (
    <Modal title={t('Register New Customer')} onClose={onClose} maxWidth="max-w-sm">
      <form onSubmit={onSubmit} className="p-6 space-y-4">
        <div className="space-y-1">
          <label htmlFor="customer-phone" className="text-xs font-semibold text-gray-500 block text-start">
            {t('Phone Number')}
          </label>
          <div className="relative">
            <Phone className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-400" aria-hidden="true" />
            <input
              id="customer-phone"
              type="tel"
              required
              dir="ltr"
              placeholder="01xxxxxxxxx"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              className={`${FIELD_CLASS} font-mono`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="customer-name" className="text-xs font-semibold text-gray-500 block text-start">
            {t('Customer Name')}
          </label>
          <div className="relative">
            <User className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-400" aria-hidden="true" />
            <input
              id="customer-name"
              type="text"
              placeholder={t('Customer Name')}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold hover:bg-gray-50 transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="flex-1 py-2.5 bg-mocha-700 hover:bg-mocha-800 text-white rounded-xl font-bold transition-all shadow-md"
          >
            {t('Confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
