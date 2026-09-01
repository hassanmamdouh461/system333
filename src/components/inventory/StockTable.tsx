import { Edit2, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryItem } from '../../global';
import { isLowStock, valuateStockItem } from '../../utils/inventoryMath';

interface StockTableProps {
  items: InventoryItem[];
  /** Average selling yield per unit, keyed by item id. */
  itemYields: Record<string, number>;
  onAdjust: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}

export function StockTable({ items, itemYields, onAdjust, onEdit, onDelete }: StockTableProps) {
  const { t } = useLanguage();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
            <th className="p-4">{t('Item Name')}</th>
            <th className="p-4 text-center">{t('Unit')}</th>
            <th className="p-4 text-center">{t('Current Stock')}</th>
            <th className="p-4 text-center">{t('Min Stock Warning')}</th>
            <th className="p-4 text-center">{t('Cost Per Unit')}</th>
            <th className="p-4 text-center">{t('Estimated Cost')}</th>
            <th className="p-4 text-center">{t('Potential Sales')}</th>
            <th className="p-4 text-center">{t('Potential Profit')}</th>
            <th className="p-4 text-end">{t('Action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const isLow = isLowStock(item);
            const { costValue, potentialSales, potentialProfit } = valuateStockItem(item, itemYields);

            return (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="p-4 font-semibold text-gray-900">{t(item.name)}</td>
                <td className="p-4 text-center text-gray-500 font-medium">{t(item.unit)}</td>
                <td className={`p-4 text-center font-bold ${isLow ? 'text-red-600 bg-red-50/30 rounded-lg' : 'text-gray-800'}`}>
                  {item.stock.toFixed(2)}
                  {isLow && <span className="block text-[10px] text-red-500 font-semibold">{t('Low Stock')}</span>}
                </td>
                <td className="p-4 text-center text-gray-500">{item.minStock.toFixed(2)}</td>
                <td className="p-4 text-center font-medium text-gray-700">EGP {item.costPerUnit.toFixed(2)}</td>
                <td className="p-4 text-center font-bold text-gray-800">EGP {costValue.toFixed(2)}</td>
                <td className="p-4 text-center font-bold text-emerald-600">EGP {potentialSales.toFixed(2)}</td>
                <td className="p-4 text-center font-bold text-sky-600">EGP {potentialProfit.toFixed(2)}</td>
                <td className="p-4 text-end">
                  <div className="flex justify-end items-center gap-1.5">
                    <button
                      onClick={() => onAdjust(item)}
                      className="px-3 py-1.5 bg-mocha-50 text-mocha-700 rounded-lg text-xs font-semibold hover:bg-mocha-100 transition-colors"
                    >
                      {t('Adjust Stock')}
                    </button>
                    <button
                      onClick={() => onEdit(item)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title={t('Edit')}
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title={t('Delete')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={9} className="p-8 text-center text-gray-400">
                {t('No stock items found')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
