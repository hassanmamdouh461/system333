import { useState, useEffect } from 'react';
import { X, Armchair, Plus, Trash2, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';
import {
  getTables,
  addTable,
  removeTable,
  setTables,
  DEFAULT_TABLES,
} from '../../utils/tablesConfig';

interface TablesConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTablesChange?: (tables: string[]) => void;
}

export function TablesConfigModal({ isOpen, onClose, onTablesChange }: TablesConfigModalProps) {
  if (!isOpen) return null;
  return <TablesConfigModalBody onClose={onClose} onTablesChange={onTablesChange} />;
}

function TablesConfigModalBody({
  onClose,
  onTablesChange,
}: {
  onClose: () => void;
  onTablesChange?: (tables: string[]) => void;
}) {
  const { t } = useLanguage();
  const { panelRef, titleId, dialogProps } = useDialog<HTMLDivElement>({ onClose });

  const [tables, setLocalTables] = useState<string[]>([]);
  const [newTableInput, setNewTableInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setLocalTables(getTables());
  }, []);

  const handleAdd = (nameToAdd?: string) => {
    setError('');
    setSuccess('');
    const target = (nameToAdd ?? newTableInput).trim();
    if (!target) {
      setError(t('Please enter a valid table name or number'));
      return;
    }

    if (tables.includes(target)) {
      setError(t('Table already exists'));
      return;
    }

    const updated = addTable(target);
    setLocalTables(updated);
    setNewTableInput('');
    setSuccess(t('Table added successfully'));
    onTablesChange?.(updated);
    setTimeout(() => setSuccess(''), 2000);
  };

  const handleRemove = (tableName: string) => {
    setError('');
    setSuccess('');
    const updated = removeTable(tableName);
    setLocalTables(updated);
    setSuccess(t('Table removed'));
    onTablesChange?.(updated);
    setTimeout(() => setSuccess(''), 2000);
  };

  const handleReset = () => {
    const updated = setTables([...DEFAULT_TABLES]);
    setLocalTables(updated);
    setSuccess(t('Reset to Default (1-10)'));
    onTablesChange?.(updated);
    setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={panelRef}
        {...dialogProps}
        dir="rtl"
        className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden outline-none flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="bg-mocha-700 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-xl text-white flex items-center justify-center">
              <Armchair size={24} />
            </div>
            <div className="text-right">
              <h2 id={titleId} className="text-lg font-bold text-white leading-tight">
                {t('Table Management')}
              </h2>
              <p className="text-mocha-100 text-xs mt-0.5 font-medium">
                {t('Add or remove dining tables')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-gray-800 overflow-y-auto max-h-[calc(90vh-72px)]">
          {/* Add Table Section */}
          <div className="space-y-2">
            <label htmlFor="new-table-name" className="text-sm font-bold text-gray-700 block text-right">
              {t('Add Table')}
            </label>
            <div className="flex gap-2">
              <input
                id="new-table-name"
                type="text"
                value={newTableInput}
                onChange={(e) => setNewTableInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={t('Table Name or Number')}
                className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-base font-semibold text-gray-800 focus:ring-2 focus:ring-mocha-500 focus:border-mocha-500 outline-none transition-all text-right"
              />
              <button
                type="button"
                onClick={() => handleAdd()}
                className="bg-mocha-600 hover:bg-mocha-700 active:scale-95 text-white font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5 shrink-0"
              >
                <Plus size={18} />
                <span>{t('Add')}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100 text-right">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-2.5 rounded-lg border border-emerald-100 text-right">
              <Check size={16} className="shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Current Tables List */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700 block text-right">
                {t('Current Tables')} ({tables.length})
              </label>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-gray-500 hover:text-mocha-700 flex items-center gap-1 font-medium transition-colors"
                title={t('Reset to Default (1-10)')}
              >
                <RotateCcw size={12} />
                <span>{t('Reset to Default (1-10)')}</span>
              </button>
            </div>

            {tables.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                {t('No tables added yet')}
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto p-1">
                {tables.map((tbl) => (
                  <div
                    key={tbl}
                    className="flex items-center justify-between bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl px-3 py-2 transition-all group"
                  >
                    <span className="font-extrabold text-sm text-gray-800">
                      {tbl.startsWith('T') || tbl.startsWith('ط') ? tbl : `T${tbl}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(tbl)}
                      className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-colors"
                      title={t('Delete Table')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer close button */}
          <div className="pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition-all"
            >
              {t('Close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
