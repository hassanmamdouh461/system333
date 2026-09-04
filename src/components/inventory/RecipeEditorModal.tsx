import React, { useState } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryItem } from '../../global';
import { MenuItem } from '../../types/menu';
import { draftRecipeCost } from '../../utils/recipeMath';
import { Modal } from '../ui/Modal';
import {
  convertToBaseQuantity,
  convertFromBaseQuantity,
  getInitialDisplayUnitAndQty,
} from '../../utils/unitConversion';

export interface RecipeLine {
  inventoryItemId: string;
  quantity: number;
}

interface RecipeLineRow {
  inventoryItemId: string;
  quantity: number;
  displayQuantity: number | string;
  displayUnit: string;
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
  const { t, language } = useLanguage();

  const [lines, setLines] = useState<RecipeLineRow[]>(() => {
    return initialLines.map((line) => {
      const mat = inventory.find((item) => item.id === line.inventoryItemId);
      const baseUnit = mat ? mat.unit : 'piece';
      const { displayQty, displayUnit } = getInitialDisplayUnitAndQty(line.quantity, baseUnit);
      return {
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        displayQuantity: displayQty,
        displayUnit,
      };
    });
  });
  const [saving, setSaving] = useState(false);

  const cost = draftRecipeCost(lines, inventory);
  const profit = menuItem.price - cost;
  const marginPercent = menuItem.price > 0 ? (profit / menuItem.price) * 100 : 0;

  const addLine = () => {
    const [first] = inventory;
    if (!first) return;
    const { displayUnit } = getInitialDisplayUnitAndQty(0, first.unit);
    setLines((prev) => [
      ...prev,
      {
        inventoryItemId: first.id,
        quantity: 0,
        displayQuantity: '',
        displayUnit,
      },
    ]);
  };

  const handleItemChange = (index: number, newItemId: string) => {
    const newItem = inventory.find((i) => i.id === newItemId);
    const baseUnit = newItem ? newItem.unit : 'piece';
    const { displayUnit } = getInitialDisplayUnitAndQty(0, baseUnit);
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const num =
          typeof line.displayQuantity === 'number'
            ? line.displayQuantity
            : parseFloat(line.displayQuantity as string) || 0;
        const baseQty = convertToBaseQuantity(num, displayUnit, baseUnit);
        return {
          inventoryItemId: newItemId,
          quantity: baseQty,
          displayQuantity: line.displayQuantity,
          displayUnit,
        };
      })
    );
  };

  const handleQuantityChange = (index: number, valStr: string) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const mat = inventory.find((it) => it.id === line.inventoryItemId);
        const baseUnit = mat ? mat.unit : 'piece';
        const num = parseFloat(valStr) || 0;
        const baseQty = convertToBaseQuantity(num, line.displayUnit, baseUnit);
        return {
          ...line,
          displayQuantity: valStr,
          quantity: baseQty,
        };
      })
    );
  };

  const handleUnitChange = (index: number, newUnit: string) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const mat = inventory.find((it) => it.id === line.inventoryItemId);
        const baseUnit = mat ? mat.unit : 'piece';
        const currentVal =
          typeof line.displayQuantity === 'number'
            ? line.displayQuantity
            : parseFloat(line.displayQuantity as string) || 0;

        const baseQty = convertToBaseQuantity(currentVal, line.displayUnit, baseUnit);
        const newDisplayVal =
          currentVal > 0
            ? convertFromBaseQuantity(baseQty, baseUnit, newUnit)
            : line.displayQuantity;

        const roundedVal =
          typeof newDisplayVal === 'number'
            ? Math.round(newDisplayVal * 1000) / 1000
            : newDisplayVal;

        return {
          ...line,
          displayUnit: newUnit,
          displayQuantity: roundedVal,
          quantity: baseQty,
        };
      })
    );
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const validLines = lines
        .filter((line) => line.quantity > 0)
        .map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
        }));
      await onSave(validLines);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('Edit Recipe')}
      description={`${t(menuItem.name)} — ${menuItem.price.toFixed(2)} ج.م`}
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
              return (
                <div
                  key={index}
                  className="flex gap-2 items-center bg-gray-50 p-2 rounded-xl border border-gray-100"
                >
                  <select
                    aria-label={t('Ingredient')}
                    value={line.inventoryItemId}
                    onChange={(e) => handleItemChange(index, e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-medium truncate"
                  >
                    {inventory.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(item.name)}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      aria-label={t('Quantity Used')}
                      type="number"
                      step="any"
                      min="0"
                      dir="ltr"
                      required
                      value={line.displayQuantity}
                      onChange={(e) => handleQuantityChange(index, e.target.value)}
                      className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none text-center font-bold"
                      placeholder="0"
                    />
                    <select
                      value={line.displayUnit}
                      onChange={(e) => handleUnitChange(index, e.target.value)}
                      aria-label={t('Unit')}
                      className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none bg-white font-bold text-mocha-800 cursor-pointer shadow-xs min-w-[78px]"
                    >
                      <optgroup label={language === 'ar' ? 'أوزان' : 'Weights'}>
                        <option value="g">{language === 'ar' ? 'جرام (g)' : 'g'}</option>
                        <option value="kg">{language === 'ar' ? 'كجم (kg)' : 'kg'}</option>
                      </optgroup>
                      <optgroup label={language === 'ar' ? 'سوائل' : 'Volumes'}>
                        <option value="ml">{language === 'ar' ? 'مل (ml)' : 'ml'}</option>
                        <option value="liter">{language === 'ar' ? 'لتر (L)' : 'liter'}</option>
                        <option value="cup">{language === 'ar' ? 'كوب' : 'cup'}</option>
                        <option value="shot">{language === 'ar' ? 'شوت' : 'shot'}</option>
                      </optgroup>
                      <optgroup label={language === 'ar' ? 'قطع ووحدات' : 'Count'}>
                        <option value="piece">{language === 'ar' ? 'قطعة' : 'piece'}</option>
                        <option value="portion">{language === 'ar' ? 'حصة' : 'portion'}</option>
                        <option value="can">{language === 'ar' ? 'علبة' : 'can'}</option>
                      </optgroup>
                    </select>
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
            <span className="font-bold text-gray-800">{cost.toFixed(2)} ج.م</span>
          </div>
          <div className="flex justify-between items-center font-medium">
            <span>{t('Potential Margin')}:</span>
            <span className={`font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {profit.toFixed(2)} ج.م ({marginPercent.toFixed(0)}%)
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
