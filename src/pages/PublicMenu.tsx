import { useState, useEffect, useMemo } from 'react';
import { Search, AlertCircle, UtensilsCrossed, X, RefreshCw, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { menuService } from '../services/menuService';
import { menuBrandingService } from '../services/menuBrandingService';
import { MenuItem } from '../types/menu';
import { PublicMenuConfig, MenuTheme } from '../types/menuBranding';

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

const THEME_STYLES: Record<
  MenuTheme,
  {
    headerGradient: string;
    accentText: string;
    accentGlow: string;
    priceBadge: string;
    activeTab: string;
    bg: string;
  }
> = {
  dark: {
    headerGradient: 'from-stone-950 via-stone-900 to-neutral-900',
    accentText: 'text-amber-400',
    accentGlow: 'bg-amber-500/10',
    priceBadge: 'bg-amber-500/10 text-amber-950 border-amber-500/20',
    activeTab: 'bg-stone-900 text-white shadow-stone-900/20',
    bg: 'bg-[#f8f7f5]',
  },
  amber: {
    headerGradient: 'from-[#2C1810] via-[#3D2314] to-[#1F110B]',
    accentText: 'text-amber-300',
    accentGlow: 'bg-amber-500/15',
    priceBadge: 'bg-[#3D2314]/10 text-[#3D2314] border-[#3D2314]/20',
    activeTab: 'bg-[#3D2314] text-white shadow-[#3D2314]/20',
    bg: 'bg-[#faf7f2]',
  },
  emerald: {
    headerGradient: 'from-[#062c1e] via-[#0b3d2b] to-[#041a12]',
    accentText: 'text-emerald-300',
    accentGlow: 'bg-emerald-500/15',
    priceBadge: 'bg-emerald-500/10 text-emerald-950 border-emerald-500/20',
    activeTab: 'bg-[#0b3d2b] text-white shadow-[#0b3d2b]/20',
    bg: 'bg-[#f4f8f5]',
  },
  burgundy: {
    headerGradient: 'from-[#380e15] via-[#4d131d] to-[#24080d]',
    accentText: 'text-rose-300',
    accentGlow: 'bg-rose-500/15',
    priceBadge: 'bg-rose-500/10 text-rose-950 border-rose-500/20',
    activeTab: 'bg-[#4d131d] text-white shadow-[#4d131d]/20',
    bg: 'bg-[#f9f5f6]',
  },
  navy: {
    headerGradient: 'from-[#0b1b36] via-[#12284d] to-[#060f21]',
    accentText: 'text-sky-300',
    accentGlow: 'bg-sky-500/15',
    priceBadge: 'bg-sky-500/10 text-sky-950 border-sky-500/20',
    activeTab: 'bg-[#12284d] text-white shadow-[#12284d]/20',
    bg: 'bg-[#f4f6fa]',
  },
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
  const [config, setConfig] = useState<PublicMenuConfig>(() => menuBrandingService.getLocalConfig());

  const themeStyle = THEME_STYLES[config.theme] || THEME_STYLES.dark;
  const storeDisplayName = config.storeName?.trim() || 'قائمة الطعام والأسعار';
  const subtitle = config.subtitle?.trim() || 'أهلاً بكم • تصفح أحدث الأصناف والأسعار';
  const footerText = config.footerText?.trim() || 'نتمنى لكم تجربة مميزة وبالهناء والشفاء';

  const loadMenu = async () => {
    try {
      setLoading(true);
      setError(null);
      const { menuItems, config: remoteConfig } = await menuService.getPublicMenuData();
      setItems(menuItems);
      if (remoteConfig && typeof remoteConfig === 'object') {
        setConfig(prev => ({
          ...prev,
          ...remoteConfig,
        }));
      }
    } catch (err) {
      console.error('Error fetching public menu:', err);
      setError('تعذر تحميل القائمة. يرجى التحقق من الاتصال بالإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = `${storeDisplayName} | المنيو الإلكتروني`;
  }, [storeDisplayName]);

  useEffect(() => {
    loadMenu();
  }, []);

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
    <div className={`min-h-screen ${themeStyle.bg} text-stone-800 font-sans flex flex-col antialiased selection:bg-amber-100 selection:text-amber-900 transition-colors duration-300`} dir="rtl">
      {/* Top Banner / Header */}
      <header className={`relative bg-gradient-to-br ${themeStyle.headerGradient} text-white pt-8 pb-14 px-4 sm:px-8 rounded-b-[2rem] sm:rounded-b-[2.5rem] shadow-xl overflow-hidden z-0`}>
        {/* Custom Banner Cover Image (if set by owner) */}
        {config.bannerUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30 pointer-events-none transition-opacity duration-700"
            style={{ backgroundImage: `url(${config.bannerUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none" />

        {/* Decorative background glow accents */}
        <div className={`absolute -top-24 -right-24 w-72 h-72 ${themeStyle.accentGlow} rounded-full blur-3xl pointer-events-none`} />

        <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
          {/* Logo / Badge */}
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/10 border border-white/20 rounded-2xl sm:rounded-3xl flex items-center justify-center mb-3.5 shadow-xl backdrop-blur-md overflow-hidden shrink-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt={storeDisplayName} className="w-full h-full object-cover" />
            ) : (
              <UtensilsCrossed className={`w-8 h-8 sm:w-9 sm:h-9 ${themeStyle.accentText}`} />
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight mb-2 text-white">
            {storeDisplayName}
          </h1>
          <p className="text-stone-300 text-xs sm:text-sm font-medium max-w-md leading-relaxed">
            {subtitle}
          </p>

          {!loading && !error && activeItems.length > 0 && (
            <div className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/10 text-stone-200 text-xs font-semibold backdrop-blur-sm border border-white/10">
              <Sparkles className={`w-3.5 h-3.5 ${themeStyle.accentText}`} />
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
              className={`mb-4 ${themeStyle.accentText}`}
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
                      ? `${themeStyle.activeTab} scale-[1.02]`
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
                          ? `${themeStyle.activeTab} scale-[1.02]`
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
                          <div className={`${themeStyle.priceBadge} px-3 py-1.5 rounded-xl font-black text-sm sm:text-base whitespace-nowrap shadow-sm`}>
                            {Number(item.price).toFixed(2)}{' '}
                            <span className="text-xs font-bold opacity-80">ج.م</span>
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
          {footerText} • {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
