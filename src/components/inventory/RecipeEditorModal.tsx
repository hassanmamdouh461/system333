import React, { useState } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryItem } from '../../global';
import { MenuItem } from '../../types/menu';
import { draftRecipeCost } from '../../utils/recipeMath';
import { Modal } from '../ui/Modal';

export interface RecipeLine {
  inventoryItemId: string;
  quantity: number;
}

interface RecipeEditorModalProps {
  menuItem: MenuItem;
  inventory: InventoryItem[];
  /** Lines already saved for this product; the modal edits its own copy. */
  initialLines: RecipeLine[];
  onSave: (lines: RecipeLine[]) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Edits one product's recipe from the inventory page.
 *
 * The menu item dialog has its own recipe tab, but reaching it means opening each product in
 * turn. This is the same edit from the direction of the raw materials, so the person counting
 * stock can fix a recipe where they noticed it was wrong.
 */
export function RecipeEditorModal({
  menuItem,
  inventory,
  initialLines,
  onSave,
  onClose,
}: RecipeEditorModalProps) {
  const { t } = useLanguage();
  const [lines, setLines] = useState<RecipeLine[]>(initialLines);
  const [saving, setSaving] = useState(false);

  const cost = draftRecipeCost(lines, inventory);
  const profit = menuItem.price - cost;
  const marginPercent = menuItem.price > 0 ? (profit / menuItem.price) * 100 : 0;

  const addLine = () => {
    const [first] = inventory;
    if (!first) return;
    setLines((prev) => [...prev, { inventoryItemId: first.id, quantity: 0 }]);
  };

  const updateLine = (index: number, next: RecipeLine) => {
    setLines((prev) => prev.map((line, i) => (i === index ? next : line)));
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // A zero quantity would be rejected by the validator, and an empty line is how a
      // half-finished row looks — dropping them lets the rest of the recipe save.
      await onSave(lines.filter((line) => line.quantity > 0));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('Edit Recipe')}
      description={`${t(menuItem.name)} — EGP ${menuItem.price.toFixed(2)}`}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-400 font-semibold uppercase">
            {t('Recipe Ingredients')}
          </span>
          <button
            type="button"
            onClick={addLine}
            disabled={inventory.length === 0}
            className="text-xs text-mocha-700 hover:text-mocha-800 font-bold flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-mocha-50 hover:bg-mocha-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} aria-hidden="true" />
            {t('Add Ingredient')}
          </button>
        </div>

        {inventory.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-4">
            <Info size={24} className="mx-auto mb-2 text-gray-300" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              {t('Add stock items first, then map them as ingredients.')}
            </p>
          </div>
        ) : lines.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 p-4">
            <Info size={24} className="mx-auto mb-2 text-gray-300" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              {t('No ingredients mapped yet. Add ingredients below to calculate costs.')}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {lines.map((line, index) => {
              const material = inventory.find((item) => item.id === line.inventoryItemId);
              return (
                <div
                  key={index}
                  className="flex gap-2 items-center bg-gray-50 p-2 rounded-xl border border-gray-100"
                >
                  <select
                    aria-label={t('Ingredient')}
                    value={line.inventoryItemId}
                    onChange={(e) => updateLine(index, { ...line, inventoryItemId: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-medium"
                  >
                    {inventory.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(item.name)}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1.5 w-28">
                    <input
                      aria-label={t('Quantity Used')}
                      type="number"
                      step="0.001"
                      min="0"
                      dir="ltr"
                      value={line.quantity || ''}
                      onChange={(e) =>
                        updateLine(index, { ...line, quantity: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none text-center font-bold"
                      placeholder="0"
                    />
                    <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">
                      {material ? t(material.unit) : ''}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    aria-label={t('Remove Ingredient')}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-mocha-50/50 rounded-xl p-3 border border-mocha-100 flex flex-col gap-1.5 text-xs text-mocha-900">
          <div className="flex justify-between items-center font-medium">
            <span>{t('Recipe Cost')}:</span>
            <span className="font-bold text-gray-800">EGP {cost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center font-medium">
            <span>{t('Potential Margin')}:</span>
            <span className={`font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              EGP {profit.toFixed(2)} ({marginPercent.toFixed(0)}%)
            </span>
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
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-xl bg-mocha-700 text-white font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20 transition-colors disabled:opacity-60"
          >
            {saving ? t('Saving...') : t('Save Changes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
