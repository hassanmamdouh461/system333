import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryItem } from '../../global';
import { valuateQuantity } from '../../utils/inventoryMath';
import { Modal } from '../ui/Modal';

export interface StockAdjustForm {
  quantity: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  notes: string;
}

interface AdjustStockModalProps {
  item: InventoryItem;
  form: StockAdjustForm;
  /** Average selling yield per unit of this item, used for the live valuation card. */
  averageYield: number;
  onChange: (form: StockAdjustForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  'w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent transition-all';

/** Live cost, sales and profit preview for the quantity being typed. */
function ValuationPreview({
  quantity,
  costPerUnit,
  averageYield,
  type,
}: {
  quantity: number;
  costPerUnit: number;
  averageYield: number;
  type: StockAdjustForm['type'];
}) {
  const { t } = useLanguage();
  if (quantity <= 0) return null;

  const { costValue, potentialSales, potentialProfit } = valuateQuantity(
    quantity,
    costPerUnit,
    averageYield
  );

  if (type === 'OUT') {
    return (
      <div className="bg-orange-50/50 border border-orange-100 p-4 rounded-xl space-y-2 text-xs" role="status">
        <div className="flex justify-between font-bold text-gray-700">
          <span>{t('Total Cost Value')}:</span>
          <span>EGP {costValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold text-orange-700">
          <span>{t('Potential Value Loss')}:</span>
          <span>EGP {potentialSales.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl space-y-2 text-xs" role="status">
      <div className="flex justify-between font-bold text-gray-700">
        <span>{t('Total Cost Value')}:</span>
        <span>EGP {costValue.toFixed(2)}</span>
      </div>
      <div className="flex justify-between font-bold text-emerald-700">
        <span>{t('Potential Selling Value')}:</span>
        <span>EGP {potentialSales.toFixed(2)}</span>
      </div>
      <div className="flex justify-between font-bold text-sky-700">
        <span>{t('Expected Potential Profit')}:</span>
        <span>EGP {potentialProfit.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function AdjustStockModal({
  item,
  form,
  averageYield,
  onChange,
  onSubmit,
  onClose,
}: AdjustStockModalProps) {
  const { t } = useLanguage();

  return (
    <Modal
      title={t('Adjust Stock Level')}
      description={`${t(item.name)} (${item.stock.toFixed(2)} ${item.unit})`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="adjust-type" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Transaction Type')}
            </label>
            <select
              id="adjust-type"
              value={form.type}
              onChange={(e) => onChange({ ...form, type: e.target.value as StockAdjustForm['type'] })}
              className={`${FIELD_CLASS} bg-white`}
            >
              <option value="IN">{t('Incoming (Stock In)')}</option>
              <option value="OUT">{t('Outgoing (Order/Sold)')}</option>
              <option value="ADJUST">{t('Adjusted (Stock Count)')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="adjust-quantity" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              {t('Quantity')} ({item.unit})
            </label>
            <input
              id="adjust-quantity"
              type="number"
              step="0.001"
              required
              dir="ltr"
              value={form.quantity}
              onChange={(e) => onChange({ ...form, quantity: e.target.value })}
              className={FIELD_CLASS}
              placeholder="0.00"
            />
          </div>
        </div>

        <div>
          <label htmlFor="adjust-notes" className="block text-xs font-semibold text-gray-500 uppercase mb-1">
            {t('Notes')}
          </label>
          <textarea
            id="adjust-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            className={`${FIELD_CLASS} resize-none`}
            placeholder={t('e.g. Weekly inventory audit / purchase invoice #124')}
          />
        </div>

        <ValuationPreview
          quantity={parseFloat(form.quantity) || 0}
          costPerUnit={item.costPerUnit}
          averageYield={averageYield}
          type={form.type}
        />

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
