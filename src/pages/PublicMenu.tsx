import { useState, useEffect, useMemo } from 'react';
import { Search, AlertCircle, UtensilsCrossed, X, RefreshCw, Sparkles, Star, Phone, MapPin, Instagram, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { menuService } from '../services/menuService';
import { menuBrandingService } from '../services/menuBrandingService';
import { MenuItem } from '../types/menu';
import { PublicMenuConfig } from '../types/menuBranding';
import { normalizeMenuConfig } from '../utils/menuConfig';
import { menuThemeStyle } from '../utils/menuThemes';
import {
  categoryLabel,
  itemCategoryId,
  itemDisplay,
  sortMenuItems,
  visibleCategories,
  visibleMenuItems,
} from '../utils/menuConfig';

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

const ALL_CATEGORIES = 'ALL';

export default function PublicMenu() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [searchQuery, setSearchQuery] = useState('');
  const [config, setConfig] = useState<PublicMenuConfig>(() => menuBrandingService.getLocalConfig());

  const theme = menuThemeStyle(config.theme);
  const storeDisplayName = config.storeName || 'قائمة الطعام والأسعار';

  const loadMenu = async () => {
    try {
      setLoading(true);
      setError(null);
      const { menuItems, config: remoteConfig } = await menuService.getPublicMenuData();
      setItems(menuItems);
      // The published record wins over the cached one, and is normalised before it can
      // reach a class name or a CSS url().
      if (remoteConfig) setConfig(normalizeMenuConfig(remoteConfig));
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

  const activeItems = useMemo(() => visibleMenuItems(items, config), [items, config]);
  const categories = useMemo(() => visibleCategories(items, config), [items, config]);
  const featured = useMemo(() => new Set(config.featuredItemIds), [config.featuredItemIds]);

  // A category that disappears — hidden in the panel, or emptied in the POS — must not leave
  // the page filtered to nothing with no tab highlighted.
  useEffect(() => {
    if (selectedCategory === ALL_CATEGORIES) return;
    if (!categories.some(category => category.id === selectedCategory)) {
      setSelectedCategory(ALL_CATEGORIES);
    }
  }, [categories, selectedCategory]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const matching = activeItems.filter(item => {
      const category = itemCategoryId(item);

      if (query) {
        const display = itemDisplay(item);
        const haystack = [
          display.name,
          item.name,
          display.description,
          categoryLabel(category, config),
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      } else if (selectedCategory !== ALL_CATEGORIES && category !== selectedCategory) {
        return false;
      }

      return true;
    });

    return sortMenuItems(matching, config);
  }, [activeItems, selectedCategory, searchQuery, config]);

  const searching = searchQuery.trim() !== '';

  return (
    <div
      className={`min-h-screen ${theme.pageBg} text-stone-800 font-sans flex flex-col antialiased selection:bg-amber-100 selection:text-amber-900 transition-colors duration-300`}
      dir="rtl"
    >
      <header
        className={`relative bg-gradient-to-br ${theme.headerGradient} text-white pt-8 pb-14 px-4 sm:px-8 rounded-b-[2rem] sm:rounded-b-[2.5rem] shadow-xl overflow-hidden z-0`}
      >
        {config.bannerUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30 pointer-events-none transition-opacity duration-700"
            style={{ backgroundImage: `url(${config.bannerUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none" />
        <div className={`absolute -top-24 -right-24 w-72 h-72 ${theme.accentGlow} rounded-full blur-3xl pointer-events-none`} />

        <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/10 border border-white/20 rounded-2xl sm:rounded-3xl flex items-center justify-center mb-3.5 shadow-xl backdrop-blur-md overflow-hidden shrink-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt={storeDisplayName} className="w-full h-full object-cover" />
            ) : (
              <UtensilsCrossed className={`w-8 h-8 sm:w-9 sm:h-9 ${theme.accentText}`} />
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight mb-2 text-white">
            {storeDisplayName}
          </h1>
          {config.subtitle && (
            <p className="text-stone-300 text-xs sm:text-sm font-medium max-w-md leading-relaxed">
              {config.subtitle}
            </p>
          )}

          {config.showItemCount && !loading && !error && activeItems.length > 0 && (
            <div className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/10 text-stone-200 text-xs font-semibold backdrop-blur-sm border border-white/10">
              <Sparkles className={`w-3.5 h-3.5 ${theme.accentText}`} />
              <span>{activeItems.length} صنف متاح</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 -mt-7 relative z-10 flex-1 space-y-6">
        {config.announcement && (
          <div className="max-w-xl mx-auto rounded-2xl bg-white border border-amber-200 shadow-md px-4 py-3 text-center">
            <p className="text-xs sm:text-sm font-black text-amber-900">{config.announcement}</p>
          </div>
        )}

        {config.showSearch && (
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
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className={`mb-4 ${theme.accentText}`}
            >
              <RefreshCw className="w-10 h-10" />
            </motion.div>
            <p className="text-stone-700 font-bold text-sm sm:text-base animate-pulse text-center">
              جاري تحضير القائمة وتحديث الأسعار...
            </p>
          </div>
        )}

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

        {!loading && !error && (
          <>
            {!searching && categories.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto py-1.5 scroll-smooth no-scrollbar">
                <CategoryTab
                  label={`الكل (${activeItems.length})`}
                  selected={selectedCategory === ALL_CATEGORIES}
                  activeClass={theme.activeTab}
                  onSelect={() => setSelectedCategory(ALL_CATEGORIES)}
                />
                {categories.map(category => (
                  <CategoryTab
                    key={category.id}
                    label={`${category.label} (${category.count})`}
                    selected={selectedCategory === category.id}
                    activeClass={theme.activeTab}
                    onSelect={() => setSelectedCategory(category.id)}
                  />
                ))}
              </div>
            )}

            {searching && (
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

            <AnimatePresence mode="wait">
              <motion.div
                key={`${selectedCategory}_${config.layout}_${searching ? searchQuery : ''}`}
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className={
                  config.layout === 'grid'
                    ? 'grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4'
                    : 'flex flex-col gap-3'
                }
              >
                {filteredItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    config={config}
                    priceBadge={theme.priceBadge}
                    accentText={theme.accentText}
                    pinned={featured.has(item.id)}
                  />
                ))}
              </motion.div>
            </AnimatePresence>

            {filteredItems.length === 0 && (
              <div className="bg-white rounded-3xl border border-stone-200/80 py-16 px-6 text-center shadow-sm">
                <div className="w-14 h-14 bg-stone-100 text-stone-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-stone-800 mb-1">
                  {searching ? 'لا توجد نتائج مطابقة' : 'لا توجد أصناف معروضة حالياً'}
                </h3>
                <p className="text-stone-500 text-xs sm:text-sm max-w-sm mx-auto">
                  {searching
                    ? 'لم نتمكن من العثور على أي أصناف مطابقة لبحثك. يرجى تجربة كلمات بحث أخرى.'
                    : 'تابعنا قريباً، القائمة قيد التحديث.'}
                </p>
                {searching && (
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

      <footer className="text-center py-8 px-4 mt-12 border-t border-stone-200/60 relative z-10 space-y-3">
        <ContactRow config={config} />
        <p className="text-xs font-bold text-stone-400">
          {config.footerText} • {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}

function CategoryTab({
  label,
  selected,
  activeClass,
  onSelect,
}: {
  label: string;
  selected: boolean;
  activeClass: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`px-4 sm:px-5 py-2.5 rounded-full text-xs sm:text-sm font-black whitespace-nowrap shrink-0 transition-all duration-200 ${
        selected
          ? `${activeClass} scale-[1.02]`
          : 'bg-white text-stone-700 border border-stone-200/80 hover:bg-stone-100/80'
      }`}
    >
      {label}
    </button>
  );
}

function ItemCard({
  item,
  config,
  priceBadge,
  accentText,
  pinned,
}: {
  item: MenuItem;
  config: PublicMenuConfig;
  priceBadge: string;
  accentText: string;
  pinned: boolean;
}) {
  const category = itemCategoryId(item);
  const label = categoryLabel(category, config);
  const display = itemDisplay(item);
  const showImage = config.showImages && Boolean(item.image);

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.99 }}
      className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group ${
        pinned ? 'border-amber-300 ring-1 ring-amber-200' : 'border-stone-200/80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {pinned && (
              <span className={`flex items-center gap-1 text-[10px] font-black ${accentText} bg-stone-900 px-2 py-0.5 rounded-md`}>
                <Star size={10} />
                <span>الأكثر طلباً</span>
              </span>
            )}
            <h3 className="font-extrabold text-stone-900 text-base sm:text-lg leading-snug group-hover:text-amber-900 transition-colors">
              {display.name}
            </h3>
            <span className="text-[10px] sm:text-[11px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md">
              {label}
            </span>
          </div>
          {config.showDescriptions && display.description && (
            <p className="text-stone-500 text-xs sm:text-sm font-medium leading-relaxed line-clamp-2 mt-1">
              {display.description}
            </p>
          )}
        </div>

        {config.showPrices && (
          <div className="shrink-0 text-left">
            <div className={`${priceBadge} border px-3 py-1.5 rounded-xl font-black text-sm sm:text-base whitespace-nowrap shadow-sm`}>
              {Number(item.price).toFixed(2)}{' '}
              <span className="text-xs font-bold opacity-80">{config.currency}</span>
            </div>
          </div>
        )}
      </div>

      {showImage && (
        <div className="mt-3 rounded-xl overflow-hidden h-36 w-full bg-stone-100 border border-stone-100">
          <img
            src={item.image}
            alt={display.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              // Hidden rather than removed: removing the node from under React left the
              // parent's children out of step with the tree on the next re-render.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </motion.div>
  );
}

function ContactRow({ config }: { config: PublicMenuConfig }) {
  const { phone, whatsapp, address, instagram } = config.contact;
  if (!phone && !whatsapp && !address && !instagram) return null;

  const instagramHandle = instagram.replace(/^@+/, '');

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold text-stone-500">
      {phone && (
        <a href={`tel:${phone}`} className="flex items-center gap-1.5 hover:text-stone-800 transition-colors">
          <Phone size={13} />
          <span dir="ltr">{phone}</span>
        </a>
      )}
      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-emerald-700 transition-colors"
        >
          <MessageCircle size={13} />
          <span>واتساب</span>
        </a>
      )}
      {instagramHandle && (
        <a
          href={`https://instagram.com/${instagramHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-rose-700 transition-colors"
        >
          <Instagram size={13} />
          <span dir="ltr">@{instagramHandle}</span>
        </a>
      )}
      {address && (
        <span className="flex items-center gap-1.5">
          <MapPin size={13} />
          <span>{address}</span>
        </span>
      )}
    </div>
  );
}
