import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Palette,
  Type,
  Image as ImageIcon,
  Sparkles,
  Upload,
  Trash2,
  Check,
  RefreshCw,
  UtensilsCrossed,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDialog } from '../../hooks/useDialog';
import { menuBrandingService } from '../../services/menuBrandingService';
import { PublicMenuConfig, MenuTheme, DEFAULT_MENU_CONFIG } from '../../types/menuBranding';

interface MenuBrandingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const PRESET_COVERS = [
  {
    name: 'مشويات ومأكولات',
    url: 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000',
  },
  {
    name: 'قهوة وكافيه',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?q=80&w=1000',
  },
  {
    name: 'برجر ووجبات',
    url: 'https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=1000',
  },
  {
    name: 'مأكولات صحية',
    url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=1000',
  },
];

const THEMES: { id: MenuTheme; name: string; gradient: string; accent: string; previewColor: string }[] = [
  {
    id: 'dark',
    name: 'داكن ملكي (الافتراضي)',
    gradient: 'from-stone-950 via-stone-900 to-neutral-900',
    accent: 'text-amber-400',
    previewColor: 'bg-stone-900',
  },
  {
    id: 'amber',
    name: 'بني وعسلي دافئ',
    gradient: 'from-[#2C1810] via-[#3D2314] to-[#1F110B]',
    accent: 'text-amber-300',
    previewColor: 'bg-[#3D2314]',
  },
  {
    id: 'emerald',
    name: 'أخضر زمردي راقي',
    gradient: 'from-[#062c1e] via-[#0b3d2b] to-[#041a12]',
    accent: 'text-emerald-300',
    previewColor: 'bg-[#0b3d2b]',
  },
  {
    id: 'burgundy',
    name: 'عنابي ملوكي فاخر',
    gradient: 'from-[#380e15] via-[#4d131d] to-[#24080d]',
    accent: 'text-rose-300',
    previewColor: 'bg-[#4d131d]',
  },
  {
    id: 'navy',
    name: 'أزرق نيلي هادئ',
    gradient: 'from-[#0b1b36] via-[#12284d] to-[#060f21]',
    accent: 'text-sky-300',
    previewColor: 'bg-[#12284d]',
  },
];

export function MenuBrandingModal({ isOpen, onClose, onSaved }: MenuBrandingModalProps) {
  return (
    <AnimatePresence>
      {isOpen && <MenuBrandingModalBody onClose={onClose} onSaved={onSaved} />}
    </AnimatePresence>
  );
}

function MenuBrandingModalBody({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { panelRef, titleId, dialogProps } = useDialog<HTMLDivElement>({ onClose });
  const [activeTab, setActiveTab] = useState<'identity' | 'images' | 'theme'>('identity');
  const [config, setConfig] = useState<PublicMenuConfig>(DEFAULT_MENU_CONFIG);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const local = menuBrandingService.getLocalConfig();
    setConfig(local);
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await menuBrandingService.compressImage(file, 256, 256, 0.85);
      setConfig(prev => ({ ...prev, logoUrl: compressed }));
    } catch (err) {
      alert('تعذر قراءة ملف الصورة المحدد');
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await menuBrandingService.compressImage(file, 1200, 400, 0.8);
      setConfig(prev => ({ ...prev, bannerUrl: compressed }));
    } catch (err) {
      alert('تعذر قراءة ملف الصورة المحدد');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg('جاري الحفظ ونشر التعديلات...');
    try {
      const result = await menuBrandingService.publishConfig(config);
      setSavedSuccess(true);
      if (result.success) {
        setStatusMsg('تم حفظ ونشر هوية المنيو بنجاح ✨');
      } else {
        setStatusMsg('تم الحفظ محلياً بنجاح ✨');
      }
      onSaved?.();
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      setStatusMsg('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const currentTheme = THEMES.find(t => t.id === config.theme) || THEMES[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <motion.div
        ref={panelRef}
        {...dialogProps}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        dir="rtl"
        className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden outline-none flex flex-col max-h-[92vh] border border-gray-100"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 px-6 py-4 flex items-center justify-between shrink-0 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Palette size={22} />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-black text-white leading-tight">
                هوية وتصميم المنيو الإلكتروني
              </h2>
              <p className="text-stone-300 text-xs mt-0.5 font-medium">
                تخصيص الاسم، الشعار، البانر، والألوان العامة لصفحة المنيو
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="text-stone-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-gray-100 bg-gray-50/70 px-6 pt-2 shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('identity')}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'identity'
                ? 'border-amber-600 text-stone-900'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Type size={16} />
            <span>النصوص والهوية</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('images')}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'images'
                ? 'border-amber-600 text-stone-900'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <ImageIcon size={16} />
            <span>الصور والشعار</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('theme')}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all ${
              activeTab === 'theme'
                ? 'border-amber-600 text-stone-900'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Sparkles size={16} />
            <span>المظهر والألوان</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(92vh-170px)] text-stone-800">
          {/* TAB 1: Identity & Text */}
          {activeTab === 'identity' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-bold text-stone-800 mb-1.5">
                  اسم المنيو / المطعم
                </label>
                <input
                  type="text"
                  value={config.storeName}
                  onChange={(e) => setConfig({ ...config, storeName: e.target.value })}
                  placeholder="مثال: مطعم الأصالة (يتركه فارغاً لعرض 'قائمة الطعام والأسعار')"
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm font-semibold text-stone-900 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-all text-right shadow-sm"
                />
                <p className="text-[11px] text-stone-400 mt-1">
                  الاسم الرئيسي الذي سيظهر في أعلى صفحة المنيو وعلى تبويب المتصفح.
                </p>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold text-stone-800 mb-1.5">
                  الوصف الترحيبي (السلوجان)
                </label>
                <input
                  type="text"
                  value={config.subtitle}
                  onChange={(e) => setConfig({ ...config, subtitle: e.target.value })}
                  placeholder="أهلاً بكم • تصفح أحدث الأصناف والأسعار"
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm font-semibold text-stone-900 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-all text-right shadow-sm"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold text-stone-800 mb-1.5">
                  رسالة التذييل أسفل المنيو
                </label>
                <input
                  type="text"
                  value={config.footerText || ''}
                  onChange={(e) => setConfig({ ...config, footerText: e.target.value })}
                  placeholder="نتمنى لكم تجربة مميزة وبالهناء والشفاء"
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm font-semibold text-stone-900 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-all text-right shadow-sm"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Images & Logo */}
          {activeTab === 'images' && (
            <div className="space-y-6">
              {/* Logo Section */}
              <div className="bg-stone-50/70 border border-stone-200/60 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-bold text-stone-800 flex items-center gap-1.5">
                    <UtensilsCrossed size={16} className="text-amber-600" />
                    <span>شعار المنيو (Logo)</span>
                  </span>
                  {config.logoUrl && (
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, logoUrl: '' })}
                      className="text-xs text-red-500 hover:text-red-600 font-bold flex items-center gap-1"
                    >
                      <Trash2 size={13} />
                      <span>إزالة الشعار</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {/* Logo Preview Box */}
                  <div className="w-16 h-16 rounded-2xl bg-stone-900 border border-stone-300 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                    {config.logoUrl ? (
                      <img src={config.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                    ) : (
                      <UtensilsCrossed className="w-8 h-8 text-amber-400" />
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      ref={logoFileInputRef}
                      onChange={handleLogoUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoFileInputRef.current?.click()}
                      className="px-4 py-2 bg-white hover:bg-stone-100 border border-gray-300 rounded-xl text-xs font-bold text-stone-800 shadow-sm transition-all flex items-center gap-1.5"
                    >
                      <Upload size={14} />
                      <span>رفع صورة الشعار من جهازك</span>
                    </button>
                    <input
                      type="text"
                      value={config.logoUrl?.startsWith('data:') ? '' : config.logoUrl || ''}
                      onChange={(e) => setConfig({ ...config, logoUrl: e.target.value })}
                      placeholder="أو الصق رابط صورة الشعار هنا..."
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-stone-900 outline-none text-right"
                    />
                  </div>
                </div>
              </div>

              {/* Banner Cover Section */}
              <div className="bg-stone-50/70 border border-stone-200/60 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-bold text-stone-800 flex items-center gap-1.5">
                    <ImageIcon size={16} className="text-amber-600" />
                    <span>صورة الغلاف والبانر العلوي (Banner Cover)</span>
                  </span>
                  {config.bannerUrl && (
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, bannerUrl: '' })}
                      className="text-xs text-red-500 hover:text-red-600 font-bold flex items-center gap-1"
                    >
                      <Trash2 size={13} />
                      <span>إزالة الغلاف</span>
                    </button>
                  )}
                </div>

                <input
                  type="file"
                  ref={bannerFileInputRef}
                  onChange={handleBannerUpload}
                  accept="image/*"
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bannerFileInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-stone-100 border border-gray-300 rounded-xl text-xs font-bold text-stone-800 shadow-sm transition-all flex items-center gap-1.5"
                  >
                    <Upload size={14} />
                    <span>رفع صورة غلاف مخصصة</span>
                  </button>
                </div>

                {/* Preset Cover Selector */}
                <div>
                  <span className="text-[11px] font-bold text-stone-500 block mb-1.5">
                    أو اختر من خلفيات جاهزة عالية الدقة:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {PRESET_COVERS.map(preset => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => setConfig({ ...config, bannerUrl: preset.url })}
                        className={`group relative h-16 rounded-xl overflow-hidden border-2 transition-all ${
                          config.bannerUrl === preset.url
                            ? 'border-amber-500 ring-2 ring-amber-500/30'
                            : 'border-transparent hover:border-stone-400'
                        }`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-1">
                          <span className="text-[11px] font-black text-white text-center leading-tight">
                            {preset.name}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Theme & Colors */}
          {activeTab === 'theme' && (
            <div className="space-y-3">
              <span className="text-xs sm:text-sm font-bold text-stone-800 block">
                اختر النمط اللوني المناسب لنشاطك:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {THEMES.map(theme => {
                  const isSelected = config.theme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setConfig({ ...config, theme: theme.id })}
                      className={`p-4 rounded-2xl border-2 text-right transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50/20 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl ${theme.previewColor} shadow-inner shrink-0`} />
                        <div>
                          <div className="text-xs sm:text-sm font-extrabold text-stone-900">
                            {theme.name}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center">
                          <Check size={13} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* LIVE PREVIEW SECTION */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-xs font-black text-stone-500 mb-2">
              <Eye size={14} />
              <span>معاينة حية لشكل البانر العلوي:</span>
            </div>

            <div
              className={`relative rounded-2xl overflow-hidden p-6 text-white text-center shadow-md bg-gradient-to-br ${currentTheme.gradient}`}
            >
              {config.bannerUrl && (
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-30"
                  style={{ backgroundImage: `url(${config.bannerUrl})` }}
                />
              )}
              <div className="absolute inset-0 bg-black/30 pointer-events-none" />

              <div className="relative z-10 flex flex-col items-center">
                <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center mb-2 overflow-hidden shadow-sm backdrop-blur-md">
                  {config.logoUrl ? (
                    <img src={config.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <UtensilsCrossed className={`w-6 h-6 ${currentTheme.accent}`} />
                  )}
                </div>
                <h4 className="text-lg font-black text-white">
                  {config.storeName.trim() || 'قائمة الطعام والأسعار'}
                </h4>
                <p className="text-stone-300 text-xs font-medium mt-0.5">
                  {config.subtitle.trim() || 'أهلاً بكم • تصفح أحدث الأصناف والأسعار'}
                </p>
                <div className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/10 text-stone-200 text-[10px] font-bold border border-white/10">
                  <Sparkles size={11} className={currentTheme.accent} />
                  <span>معاينة المظهر المختار</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-6 bg-gray-50 border-t border-gray-100 flex items-center justify-between shrink-0">
          <span className="text-xs font-bold text-emerald-700">
            {statusMsg}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-stone-600 text-xs sm:text-sm font-bold hover:bg-gray-100 transition-colors"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check size={16} className="text-emerald-400" />
                  <span>تم الحفظ!</span>
                </>
              ) : (
                <span>حفظ ونشر التعديلات</span>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
