import { clsx } from 'clsx';
import { Coffee, XCircle, Search } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { MenuItem } from '../../../types/menu';
import { POS_CATEGORIES } from '../../../utils/posCategories';

interface ProductGridProps {
  items: MenuItem[];
  categories?: string[];
  selectedCategory: string;
  searchQuery: string;
  successMessage: string | null;
  onSelectCategory: (category: string) => void;
  onSearchChange: (query: string) => void;
  onAddItem: (item: MenuItem) => void;
}

export function ProductGrid({
  items,
  categories = POS_CATEGORIES as unknown as string[],
  selectedCategory,
  searchQuery,
  successMessage,
  onSelectCategory,
  onSearchChange,
  onAddItem,
}: ProductGridProps) {
  const { t } = useLanguage();

  return (
    <div className="flex-1 lg:h-full bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 shrink-0">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={clsx(
                'px-5 py-2.5 rounded-xl text-sm md:text-base font-black whitespace-nowrap transition-all border',
                selectedCategory === cat
                  ? 'bg-mocha-600 text-white border-mocha-700 shadow-sm'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              )}
            >
              {t(cat)}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className={"absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 right-3"} />
          <input
            aria-label={t('Search items...')}
            type="text"
            placeholder={t('Search items...')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={"w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-mocha-500 focus:border-transparent text-sm font-semibold pr-9 pl-4"}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className={"absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 left-3"}
            >
              <XCircle size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-4 pe-1 custom-scrollbar">
        {successMessage && (
          <div className="bg-green-50 text-green-700 border border-green-200 rounded-xl p-3 mb-4 font-bold text-center text-xs animate-bounce">
            {successMessage}
          </div>
        )}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
            <Coffee size={50} className="stroke-1 mb-2" />
            <p className="text-sm md:text-base font-bold">{t('No items')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-4 gap-3">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => onAddItem(item)}
                className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all p-2.5 rounded-xl border border-gray-200/60 hover:border-gray-300 shadow-sm flex flex-col justify-between items-start text-start h-28 relative overflow-hidden group"
              >
                <span className="w-full font-bold text-xs sm:text-sm text-gray-900 group-hover:text-mocha-700 font-sans leading-normal line-clamp-2">
                  {t(item.name)}
                </span>
                <div className="w-full flex justify-between items-center z-10 mt-auto pt-1 gap-1">
                  <span className="font-mono text-xs sm:text-sm md:text-base font-black text-mocha-800 tabular-nums whitespace-nowrap">
                    {item.price.toFixed(2)}{' '}
                    <span className="text-[10px] sm:text-xs text-gray-400 font-sans font-bold">ج.م</span>
                  </span>
                  <span className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-mocha-200 bg-mocha-50 text-mocha-600 group-hover:bg-mocha-600 group-hover:text-white transition-colors font-black text-sm shrink-0">
                    +
                  </span>
                </div>
                <Coffee size={32} className="absolute -right-2 -bottom-2 text-gray-200/20 group-hover:text-mocha-200/10 transition-all pointer-events-none" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
