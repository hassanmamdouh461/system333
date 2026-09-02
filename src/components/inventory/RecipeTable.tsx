import { AlertTriangle, Edit2, Package } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { RecipeCosting } from '../../utils/recipeMath';

interface RecipeTableProps {
  costings: RecipeCosting[];
  /** Opens the recipe editor for one menu item. */
  onEdit: (menuItemId: string) => void;
}

const money = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RecipeTable({ costings, onEdit }: RecipeTableProps) {
  const { t } = useLanguage();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
            <th className="p-4">{t('Product')}</th>
            <th className="p-4 text-center">{t('Ingredients')}</th>
            <th className="p-4 text-center">{t('Selling Price')}</th>
            <th className="p-4 text-center">{t('Recipe Cost')}</th>
            <th className="p-4 text-center">{t('Profit Per Portion')}</th>
            <th className="p-4 text-center">{t('Margin')}</th>
            <th className="p-4 text-center">{t('Buildable Portions')}</th>
            <th className="p-4 text-end">{t('Action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {costings.map((costing) => {
            const isUnmapped = costing.ingredientCount === 0;
            const isLosingMoney = !isUnmapped && costing.profit < 0;
            const isOutOfStock = costing.buildablePortions === 0;

            return (
              <tr key={costing.menuItemId} className="hover:bg-gray-50/50 transition-colors">
                <td className="p-4 font-semibold text-gray-900">{t(costing.menuItemName)}</td>

                <td className="p-4 text-center">
                  {isUnmapped ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
                      <AlertTriangle size={12} aria-hidden="true" />
                      {t('No Recipe')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-gray-700 font-medium">
                      <Package size={13} aria-hidden="true" className="text-gray-400" />
                      {costing.ingredientCount}
                    </span>
                  )}
                </td>

                <td className="p-4 text-center font-medium text-gray-700">
                  EGP {money(costing.price)}
                </td>

                <td className="p-4 text-center font-bold text-gray-800">
                  {isUnmapped ? <span className="text-gray-300">—</span> : `EGP ${money(costing.cost)}`}
                </td>

                <td className={`p-4 text-center font-bold ${isLosingMoney ? 'text-red-600' : 'text-emerald-600'}`}>
                  {isUnmapped ? <span className="text-gray-300">—</span> : `EGP ${money(costing.profit)}`}
                </td>

                <td className={`p-4 text-center font-bold ${isLosingMoney ? 'text-red-600' : 'text-sky-600'}`}>
                  {isUnmapped ? <span className="text-gray-300">—</span> : `${costing.marginPercent.toFixed(0)}%`}
                </td>

                <td className="p-4 text-center">
                  {costing.buildablePortions === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    <>
                      <span className={`font-bold tabular-nums ${isOutOfStock ? 'text-red-600' : 'text-gray-800'}`}>
                        {costing.buildablePortions}
                      </span>
                      {costing.limitingItemName && (
                        <span className="block text-[10px] text-gray-400 font-medium">
                          {isOutOfStock ? t('Out of stock') : t('Limited by')}: {t(costing.limitingItemName)}
                        </span>
                      )}
                    </>
                  )}
                </td>

                <td className="p-4 text-end">
                  <button
                    onClick={() => onEdit(costing.menuItemId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-mocha-50 text-mocha-700 rounded-lg text-xs font-semibold hover:bg-mocha-100 transition-colors"
                  >
                    <Edit2 size={13} aria-hidden="true" />
                    {isUnmapped ? t('Add Recipe') : t('Edit Recipe')}
                  </button>
                </td>
              </tr>
            );
          })}

          {costings.length === 0 && (
            <tr>
              <td colSpan={8} className="p-8 text-center text-gray-400">
                {t('No products found')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
