import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Customer } from '../../types/customer';
import { Modal } from '../ui/Modal';

interface EditPointsModalProps {
  customer: Customer;
  points: number;
  onPointsChange: (points: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function EditPointsModal({
  customer,
  points,
  onPointsChange,
  onSubmit,
  onClose,
}: EditPointsModalProps) {
  const { t } = useLanguage();

  return (
    <Modal
      title={t('Edit Points')}
      description={`${t('Adjust points for')}: ${customer.name} (${customer.phone})`}
      onClose={onClose}
      maxWidth="max-w-sm"
    >
      <form onSubmit={onSubmit} className="p-6 space-y-4">
        <div className="space-y-1">
          <label htmlFor="customer-points" className="text-xs font-semibold text-gray-500 block text-start">
            {t('Loyalty Points')}
          </label>
          <input
            id="customer-points"
            type="number"
            required
            min={0}
            dir="ltr"
            value={points}
            // Points are a whole-unit balance and can never be negative: a redemption is
            // recorded as a transaction, not as a negative balance.
            onChange={(e) => onPointsChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-start font-mono"
          />
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
