import React, { useState, useEffect } from 'react';
import { Coffee, Search, Globe, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { menuService } from '../services/menuService';
import { MenuItem } from '../types/menu';

const TRANSLATIONS = {
  en: {
    title: 'BrewMaster',
    subtitle: 'Premium Coffee & Treats Menu',
    searchPlaceholder: 'Search for coffee, shakes...',
    available: 'Available',
    outOfStock: 'Out of Stock',
    all: 'All',
    hotCoffee: 'Hot Coffee',
    icedCoffee: 'Iced Coffee',
    frappe: 'Frappe',
    milkshakes: 'Milkshakes',
    noItems: 'No items found',
    tryAgain: 'Try searching for something else.',
    loading: 'Brewing your menu...',
    errorMsg: 'Could not load the menu. Please try again.',
  },
  ar: {
    title: 'بروماستر',
    subtitle: 'قائمة القهوة والحلويات الفاخرة',
    searchPlaceholder: 'ابحث عن قهوة، ميلك شيك...',
    available: 'متوفر',
    outOfStock: 'غير متوفر حالياً',
    all: 'الكل',
    hotCoffee: 'قهوة ساخنة',
    icedCoffee: 'قهوة باردة',
    frappe: 'فرابيه',
    milkshakes: 'ميلك شيك',
    noItems: 'لم يتم العثور على أصناف',
    tryAgain: 'جرب البحث عن صنف آخر.',
    loading: 'جاري تحضير القائمة...',
    errorMsg: 'تعذر تحميل القائمة. يرجى المحاولة مرة أخرى.',
  }
};

const CATEGORY_TRANSLATIONS: Record<string, { en: string; ar: string }> = {
  'All': { en: 'All', ar: 'الكل' },
  'Hot Coffee': { en: 'Hot Coffee', ar: 'قهوة ساخنة' },
  'Iced Coffee': { en: 'Iced Coffee', ar: 'قهوة باردة' },
  'Frappe': { en: 'Frappe', ar: 'فرابيه' },
  'Milkshakes': { en: 'Milkshakes', ar: 'ميلك شيك' }
};

export default function PublicMenu() {
  const [lang, setLang] = useState<'ar' | 'en'>('ar'); // Default to Arabic as requested by user's context
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const t = TRANSLATIONS[lang];
  const isRtl = lang === 'ar';

  useEffect(() => {
    async function loadMenu() {
      try {
        setLoading(true);
        const fetchedItems = await menuService.getAll();
        setItems(fetchedItems);
      } catch (err) {
        console.error('Error fetching public menu:', err);
        setError(t.errorMsg);
      } finally {
        setLoading(false);
      }
    }
    loadMenu();
  }, [t.errorMsg]);

  const filteredItems = items.filter(item => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const categories = ['All', 'Hot Coffee', 'Iced Coffee', 'Frappe', 'Milkshakes'];

  if (loading) {
    return (
      <div className="min-h-screen bg-mocha-50 flex flex-col items-center justify-center p-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="mb-4"
        >
          <Coffee className="w-12 h-12 text-mocha-600" />
        </motion.div>
        <p className="text-mocha-800 font-medium animate-pulse">{t.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-mocha-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t.errorMsg}</h2>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-6 py-2.5 bg-mocha-700 text-white rounded-xl font-medium shadow-md hover:bg-mocha-800 transition-colors"
        >
          {lang === 'ar' ? 'إعادة المحاولة' : 'Try Again'}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mocha-50 pb-12 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Banner / Hero */}
      <header className="relative bg-gradient-to-b from-mocha-900 to-mocha-800 text-white py-12 px-6 overflow-hidden rounded-b-[2.5rem] shadow-xl">
        {/* Floating background blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-caramel-light/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-mocha-400/10 rounded-full blur-2xl -ml-16 -mb-16"></div>

        <div className="max-w-md mx-auto flex flex-col items-center text-center relative z-10">
          {/* Language Toggle */}
          <button
            onClick={() => setLang(prev => prev === 'ar' ? 'en' : 'ar')}
            className="absolute top-0 right-0 bg-white/10 hover:bg-white/20 backdrop-blur text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all text-white border border-white/10"
          >
            <Globe size={14} />
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>

          {/* Logo */}
          <div className="w-16 h-16 bg-white/10 border border-white/20 rounded-full flex items-center justify-center mb-4 shadow-inner backdrop-blur-sm">
            <Coffee className="w-9 h-9 text-caramel" />
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-white">
            {t.title}
          </h1>
          <p className="text-mocha-200 text-sm max-w-xs font-light">
            {t.subtitle}
          </p>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md mx-auto px-4 mt-6">
        {/* Search */}
        <div className="relative mb-6 shadow-sm">
          <div className={`absolute inset-y-0 ${isRtl ? 'right-3' : 'left-3'} flex items-center pointer-events-none`}>
            <Search className="h-5 w-5 text-mocha-400" />
          </div>
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full py-3 bg-white border border-mocha-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm shadow-inner transition-all ${
              isRtl ? 'pr-10 pl-4 text-right' : 'pl-10 pr-4 text-left'
            }`}
          />
        </div>

        {/* Categories Carousel */}
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-3 mb-6 scroll-smooth">
          {categories.map(category => {
            const label = CATEGORY_TRANSLATIONS[category]?.[lang] || category;
            const isSelected = selectedCategory === category;
            return (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  isSelected
                    ? 'bg-mocha-700 text-white shadow-md shadow-mocha-700/25 scale-105'
                    : 'bg-white text-mocha-800 border border-mocha-100/50 hover:bg-mocha-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Menu Items List */}
        <motion.div layout className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filteredItems.map(item => (
              <motion.div
                layout
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className="bg-white rounded-2xl border border-mocha-100/40 p-3.5 shadow-sm relative overflow-hidden flex gap-4 transition-all hover:shadow-md"
              >
                {/* Image */}
                {item.image && (
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-mocha-50 flex-shrink-0 relative border border-mocha-100/30">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Details */}
                <div className="flex-1 flex flex-col justify-between min-w-0">
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-bold text-gray-900 text-base truncate">
                        {item.name}
                      </h3>
                      <span className="font-extrabold text-mocha-700 text-base">
                        ${item.price.toFixed(2)}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-gray-500 text-xs mt-1 font-sans leading-relaxed">
                        {item.description}
                      </p>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-mocha-50/50">
                    <span className="text-[10px] text-mocha-400 font-medium px-2 py-0.5 bg-mocha-50 rounded-full border border-mocha-100/20">
                      {CATEGORY_TRANSLATIONS[item.category]?.[lang] || item.category}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {/* Empty State */}
        {filteredItems.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 px-4"
          >
            <div className="bg-mocha-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-mocha-200">
              <Search className="w-8 h-8 text-mocha-500" />
            </div>
            <p className="text-base font-bold text-mocha-900">{t.noItems}</p>
            <p className="text-xs text-mocha-400 mt-1">{t.tryAgain}</p>
          </motion.div>
        )}
      </main>

      {/* Footer / Powered by */}
      <footer className="text-center mt-12 px-4">
        <p className="text-xs text-mocha-400 font-medium">
          {lang === 'ar' ? 'بروماستر © ٢٠٢٦ - تم الصنع بحب ☕' : 'BrewMaster © 2026 - Made with Love ☕'}
        </p>
      </footer>
    </div>
  );
}
