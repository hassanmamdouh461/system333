import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryItem } from '../../global';
import { Modal } from '../ui/Modal';

export interface StockItemForm {
  name: string;
  unit: string;
  stock: string;
  minStock: string;
  costPerUnit: string;
}

interface StockItemModalProps {
  /** The item being edited, or null when creating a new one. */
  item: InventoryItem | null;
  form: StockItemForm;
  onChange: (form: StockItemForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  'w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all';

export function StockItemModal({ item, form, onChange, onSubmit, onClose }: StockItemModalProps) {
  const { t } = useLanguage();

  return (
    <Modal title={item ? t('Edit Stock Item') : t('Add Stock Item')} onClose={onClose}>
      <form onSubmit={onSubmit} className="p-6 space-y-4">
        <div>
          <label htmlFor="stock-name" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
            {t('Item Name')}
          </label>
          <input
            id="stock-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            className={FIELD_CLASS}
            placeholder="مثال: حبوب إسبريسو"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="stock-unit" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Unit')}
            </label>
            <select
              id="stock-unit"
              value={form.unit}
              onChange={(e) => onChange({ ...form, unit: e.target.value })}
              className={`${FIELD_CLASS} bg-white`}
            >
              <option value="kg">{t('kg')}</option>
              <option value="g">{t('g')}</option>
              <option value="liter">{t('liter')}</option>
              <option value="ml">{t('ml')}</option>
              <option value="piece">{t('piece')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="stock-cost" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Cost Per Unit')}
            </label>
            <input
              id="stock-cost"
              type="number"
              step="0.01"
              required
              dir="ltr"
              value={form.costPerUnit}
              onChange={(e) => onChange({ ...form, costPerUnit: e.target.value })}
              className={FIELD_CLASS}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="stock-level" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Current Stock')}
            </label>
            <input
              id="stock-level"
              type="number"
              step="0.001"
              required
              dir="ltr"
              // Stock changes through adjustments so every movement is logged; editing it
              // directly here would silently break the audit trail.
              disabled={!!item}
              value={form.stock}
              onChange={(e) => onChange({ ...form, stock: e.target.value })}
              className={`${FIELD_CLASS} disabled:bg-gray-50 disabled:text-gray-400`}
              placeholder="0.0"
            />
          </div>

          <div>
            <label htmlFor="stock-min" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Min Stock Warning')}
            </label>
            <input
              id="stock-min"
              type="number"
              step="0.01"
              required
              dir="ltr"
              value={form.minStock}
              onChange={(e) => onChange({ ...form, minStock: e.target.value })}
              className={FIELD_CLASS}
              placeholder="1.00"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 rounded-xl bg-mocha-700 text-white font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20 transition-colors"
          >
            {t('Save Changes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
