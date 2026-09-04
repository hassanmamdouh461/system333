import { useState, useEffect, useMemo } from 'react';
import { Search, AlertCircle, UtensilsCrossed, X, RefreshCw, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { menuService } from '../services/menuService';
import { MenuItem } from '../types/menu';
import { getStoreConfig } from '../utils/settingsConfig';

const CATEGORY_TRANSLATIONS: Record<string, string> = {
  'Hot Coffee': 'قهوة ساخنة',
  'Iced Coffee': 'قهوة باردة',
  'Frappe': 'فرابيه',
  'Milkshakes': 'ميلك شيك',
  'Kitchen': 'مأكولات',
  'Bar': 'مشروبات',
  'Food': 'مأكولات',
  'Drinks': 'مشروبات',
  'Dessert': 'حلويات',
  'Desserts': 'حلويات',
  'Appetizers': 'مقبلات',
  'Sandwiches': 'ساندوتشات',
  'Beverages': 'مشروبات',
};

// Fallback dictionary for common English names if entered in English
const ITEM_TRANSLATIONS: Record<string, { name: string; desc: string }> = {
  'espresso': { name: 'إسبيريسو', desc: 'جرعة مركزة وغنية من حبوب البن الفاخرة.' },
  'double espresso': { name: 'إسبيريسو دبل', desc: 'جرعة مزدوجة من الإسبريسو الغني والمركز.' },
  'cortado': { name: 'كورتادو', desc: 'أجزاء متساوية من الإسبريسو والحليب الدافئ الناعم.' },
  'flat white': { name: 'فلات وايت', desc: 'جرعة مزدوجة من الإسبريسو مع طبقة رقيقة من رغوة الحليب.' },
  'cafe latte': { name: 'لاتيه', desc: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'latte': { name: 'لاتيه', desc: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'cappuccino': { name: 'كابوتشينو', desc: 'قهوة كلاسيكية مع رغوة حليب كثيفة وغنية.' },
  'spanish latte': { name: 'سبانش لاتيه', desc: 'إسبريسو مع الحليب المكثف المحلى والحليب المبخر.' },
  'americano': { name: 'أمريكانو', desc: 'جرعات إسبريسو مخففة بالماء الساخن لمذاق ناعم.' },
  'cafe mocha': { name: 'كافيه موكا', desc: 'إسبريسو ممزوج بالشوكولاتة الغنية والحليب الساخن.' },
  'turkish coffee': { name: 'قهوة تركي', desc: 'بن مطحون ناعم ومحضر على الطريقة التقليدية.' },
  'french coffee': { name: 'قهوة فرنساوي', desc: 'قهوة تقليدية محضرة بالحليب المبخر.' },
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.32,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.15 },
  },
};

export default function PublicMenu() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract store display name (avoiding default "BrewMaster" branding)
  const storeDisplayName = useMemo(() => {
    try {
      const cfg = getStoreConfig();
      if (
        cfg.storeName &&
        !cfg.storeName.toLowerCase().includes('brewmaster') &&
        cfg.storeName.trim().length > 0
      ) {
        return cfg.storeName.trim();
      }
    } catch {
      // ignore
    }
    return 'قائمة الطعام والأسعار';
  }, []);

  const loadMenu = async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedItems = await menuService.getAll();
      setItems(fetchedItems);
    } catch (err) {
      console.error('Error fetching public menu:', err);
      setError('تعذر تحميل القائمة. يرجى التحقق من الاتصال بالإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = `${storeDisplayName} | المنيو الإلكتروني`;
    loadMenu();
  }, [storeDisplayName]);

  // Filter only actually available items from the database
  const activeItems = useMemo(() => {
    return items.filter(
      item => item.available !== false && (item.available as unknown) !== 0
    );
  }, [items]);

  // Extract ONLY real categories that contain at least 1 active item
  const categories = useMemo(() => {
    const catCounts = new Map<string, number>();

    activeItems.forEach(item => {
      const raw = item.category ? item.category.split('|')[0].trim() : '';
      const cat = raw && raw !== 'All' ? raw : 'أخرى';
      catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
    });

    return Array.from(catCounts.entries())
      .filter(([_, count]) => count > 0)
      .map(([id, count]) => ({
        id,
        name: CATEGORY_TRANSLATIONS[id] || id,
        count,
      }));
  }, [activeItems]);

  // Filtered items based on search query and category selection
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return activeItems.filter(item => {
      const rawCat = item.category ? item.category.split('|')[0].trim() : 'أخرى';
      const catName = (CATEGORY_TRANSLATIONS[rawCat] || rawCat).toLowerCase();

      // Check search match
      if (q) {
        const key = item.name.toLowerCase().trim();
        const translation = ITEM_TRANSLATIONS[key];
        const displayName = (translation ? translation.name : item.name).toLowerCase();
        const displayDesc = (translation ? translation.desc : (item.description || '')).toLowerCase();

        const matches =
          displayName.includes(q) ||
          displayDesc.includes(q) ||
          catName.includes(q) ||
          item.name.toLowerCase().includes(q);

        if (!matches) return false;
      }

      // Check category match if not 'ALL'
      if (selectedCategory !== 'ALL' && !q) {
        if (rawCat !== selectedCategory) return false;
      }

      return true;
    });
  }, [activeItems, selectedCategory, searchQuery]);

  return (
    <div className="min-h-screen bg-[#f8f7f5] text-stone-800 font-sans flex flex-col antialiased selection:bg-amber-100 selection:text-amber-900" dir="rtl">
      {/* Top Banner / Header */}
      <header className="relative bg-gradient-to-br from-stone-900 via-stone-850 to-neutral-900 text-white pt-8 pb-14 px-4 sm:px-8 rounded-b-[2rem] sm:rounded-b-[2.5rem] shadow-xl overflow-hidden z-0">
        {/* Subtle decorative background gradient accents */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-stone-700/20 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
          {/* Logo / Badge */}
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white/10 border border-white/15 rounded-2xl flex items-center justify-center mb-3 shadow-lg backdrop-blur-md">
            <UtensilsCrossed className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400" />
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight mb-2 text-white">
            {storeDisplayName}
          </h1>
          <p className="text-stone-300 text-xs sm:text-sm font-medium max-w-md leading-relaxed">
            أهلاً بكم • تصفح أحدث الأصناف والأسعار
          </p>

          {!loading && !error && activeItems.length > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-stone-200 text-xs font-semibold backdrop-blur-sm border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{activeItems.length} صنف متاح</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 -mt-7 relative z-10 flex-1 space-y-6">
        {/* Search Bar */}
        <div className="max-w-xl mx-auto shadow-lg rounded-2xl bg-white p-1 border border-stone-200/80 transition-all focus-within:ring-2 focus-within:ring-amber-500/30 focus-within:border-amber-500">
          <div className="relative flex items-center">
            <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-stone-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="ابحث عن صنف أو وجبة أو مشروب..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-3 sm:py-3.5 pr-11 pl-10 bg-transparent text-sm sm:text-base font-bold text-stone-800 placeholder-stone-400 outline-none text-right"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 left-3 flex items-center text-stone-400 hover:text-stone-600 transition-colors"
                aria-label="مسح البحث"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="mb-4 text-amber-600"
            >
              <RefreshCw className="w-10 h-10" />
            </motion.div>
            <p className="text-stone-700 font-bold text-sm sm:text-base animate-pulse text-center">
              جاري تحضير القائمة وتحديث الأسعار...
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="bg-white rounded-3xl border border-red-100 p-8 text-center max-w-md mx-auto shadow-sm">
            <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-stone-900 mb-2">عذراً، حدث خطأ أثناء التحميل</h2>
            <p className="text-stone-500 text-xs sm:text-sm mb-6 leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={loadMenu}
              className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold text-sm shadow-md transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        )}

        {/* Loaded Menu Content */}
        {!loading && !error && (
          <>
            {/* Category Filter Tabs (Only shown if more than 1 category exists and not searching) */}
            {!searchQuery.trim() && categories.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto py-1.5 scroll-smooth no-scrollbar">
                {/* "All" Tab */}
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-black whitespace-nowrap shrink-0 transition-all duration-200 ${
                    selectedCategory === 'ALL'
                      ? 'bg-stone-900 text-white shadow-md shadow-stone-900/20 scale-[1.02]'
                      : 'bg-white text-stone-700 border border-stone-200/80 hover:bg-stone-100/80'
                  }`}
                >
                  الكل ({activeItems.length})
                </button>

                {/* Dynamic Real Categories */}
                {categories.map(cat => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-black whitespace-nowrap shrink-0 transition-all duration-200 ${
                        isSelected
                          ? 'bg-stone-900 text-white shadow-md shadow-stone-900/20 scale-[1.02]'
                          : 'bg-white text-stone-700 border border-stone-200/80 hover:bg-stone-100/80'
                      }`}
                    >
                      {cat.name} ({cat.count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search feedback */}
            {searchQuery.trim() && (
              <div className="flex justify-between items-center px-1">
                <span className="text-xs sm:text-sm text-stone-500 font-bold">
                  نتائج البحث: <span className="text-stone-900">({filteredItems.length})</span> صنف
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs sm:text-sm text-amber-700 hover:text-amber-800 font-bold transition-colors"
                >
                  عرض جميع الأصناف
                </button>
              </div>
            )}

            {/* Menu Items Grid with Smooth Cascading Animation */}
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedCategory + (searchQuery ? `_search_${searchQuery}` : '')}
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4"
              >
                {filteredItems.map(item => {
                  const key = item.name.toLowerCase().trim();
                  const translation = ITEM_TRANSLATIONS[key];
                  const displayName = translation ? translation.name : item.name;
                  const displayDesc = translation ? translation.desc : item.description;

                  const rawCat = item.category ? item.category.split('|')[0].trim() : '';
                  const catLabel = rawCat && rawCat !== 'All' ? (CATEGORY_TRANSLATIONS[rawCat] || rawCat) : null;

                  return (
                    <motion.div
                      key={item.id}
                      variants={cardVariants}
                      whileHover={{ y: -2, transition: { duration: 0.15 } }}
                      whileTap={{ scale: 0.99 }}
                      className="bg-white rounded-2xl border border-stone-200/80 p-4 sm:p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-extrabold text-stone-900 text-base sm:text-lg leading-snug group-hover:text-amber-900 transition-colors">
                              {displayName}
                            </h3>
                            {catLabel && (
                              <span className="text-[10px] sm:text-[11px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md">
                                {catLabel}
                              </span>
                            )}
                          </div>
                          {displayDesc && (
                            <p className="text-stone-500 text-xs sm:text-sm font-medium leading-relaxed line-clamp-2 mt-1">
                              {displayDesc}
                            </p>
                          )}
                        </div>

                        {/* Price Badge */}
                        <div className="shrink-0 text-left">
                          <div className="bg-amber-500/10 text-amber-950 border border-amber-500/20 px-3 py-1.5 rounded-xl font-black text-sm sm:text-base whitespace-nowrap shadow-sm">
                            {Number(item.price).toFixed(2)}{' '}
                            <span className="text-xs font-bold text-amber-800">ج.م</span>
                          </div>
                        </div>
                      </div>

                      {/* Optional item image preview */}
                      {item.image && (
                        <div className="mt-3 rounded-xl overflow-hidden h-36 w-full bg-stone-100 border border-stone-100">
                          <img
                            src={item.image}
                            alt={displayName}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                            onError={(e) => {
                              // Hide broken image smoothly
                              (e.target as HTMLElement).parentElement?.remove();
                            }}
                          />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            </AnimatePresence>

            {/* Empty State */}
            {filteredItems.length === 0 && (
              <div className="bg-white rounded-3xl border border-stone-200/80 py-16 px-6 text-center shadow-sm">
                <div className="w-14 h-14 bg-stone-100 text-stone-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-stone-800 mb-1">
                  لا توجد نتائج مطابقة
                </h3>
                <p className="text-stone-500 text-xs sm:text-sm max-w-sm mx-auto">
                  لم نتمكن من العثور على أي أصناف مطابقة لبحثك. يرجى تجربة كلمات بحث أخرى.
                </p>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-4 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-xl transition-colors"
                  >
                    إلغاء البحث
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-8 px-4 mt-12 border-t border-stone-200/60 relative z-10">
        <p className="text-xs font-bold text-stone-400">
          قائمة الطعام والأسعار الإلكترونية © {new Date().getFullYear()} • نتمنى لكم تجربة مميزة
        </p>
      </footer>
    </div>
  );
}
