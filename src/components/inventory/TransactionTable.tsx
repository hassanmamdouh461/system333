import { ArrowUpRight, ArrowDownRight, Scale } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { InventoryTransaction } from '../../global';

interface TransactionTableProps {
  transactions: InventoryTransaction[];
}

function TypeBadge({ type }: { type: InventoryTransaction['type'] }) {
  const { t } = useLanguage();

  if (type === 'IN') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-green-50 text-green-600 border border-green-100">
        <ArrowUpRight size={12} />
        {t('Incoming (Stock In)')}
      </span>
    );
  }

  if (type === 'OUT') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-orange-50 text-orange-600 border border-orange-100">
        <ArrowDownRight size={12} />
        {t('Outgoing (Order/Sold)')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-50 text-blue-600 border border-blue-100">
      <Scale size={12} />
      {t('Adjusted (Stock Count)')}
    </span>
  );
}

export function TransactionTable({ transactions }: TransactionTableProps) {
  const { t } = useLanguage();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
            <th className="p-4">{t('Date & Time')}</th>
            <th className="p-4">{t('Item Name')}</th>
            <th className="p-4 text-center">{t('Transaction Type')}</th>
            <th className="p-4 text-center">{t('Quantity')}</th>
            <th className="p-4 text-center">{t('Reference')}</th>
            <th className="p-4">{t('Notes')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {transactions.map((tx) => (
            <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
              <td className="p-4 text-gray-500 whitespace-nowrap">
                {new Date(tx.createdAt).toLocaleString()}
              </td>
              <td className="p-4 font-semibold text-gray-900">{t(tx.itemName || '')}</td>
              <td className="p-4 text-center">
                <TypeBadge type={tx.type} />
              </td>
              <td className="p-4 text-center font-bold text-gray-800">
                {tx.type === 'OUT' ? '-' : '+'}{tx.quantity.toFixed(2)} {t(tx.itemUnit || '')}
              </td>
              <td className="p-4 text-center font-mono text-xs text-gray-500">
                {tx.referenceId}
              </td>
              <td className="p-4 text-gray-600 max-w-xs truncate" title={tx.notes}>
                {tx.notes || '-'}
              </td>
            </tr>
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-gray-400">
                {t('No transactions logged yet')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
