/**
 * Wording, images and colours: what the customer's page says and how it looks.
 */

import { useRef } from 'react';
import { Trash2, Upload, UtensilsCrossed, Check, AlertTriangle } from 'lucide-react';
import { PublicMenuConfig } from '../../../types/menuBranding';
import { CONFIG_LIMITS, safeImageUrl } from '../../../utils/menuConfig';
import { MENU_THEME_LIST } from '../../../utils/menuThemes';
import { menuBrandingService } from '../../../services/menuBrandingService';
import { PanelField, PanelInput, PanelSection } from './PanelControls';

type Patch = (patch: Partial<PublicMenuConfig>) => void;

const PRESET_COVERS = [
  { name: 'مشويات ومأكولات', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000' },
  { name: 'قهوة وكافيه', url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?q=80&w=1000' },
  { name: 'برجر ووجبات', url: 'https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=1000' },
  { name: 'مأكولات صحية', url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=1000' },
];

export function IdentityTab({
  config,
  patch,
}: {
  config: PublicMenuConfig;
  patch: Patch;
}) {
  return (
    <div className="space-y-4">
      <PanelField
        label="اسم المنيو أو المطعم"
        hint="يظهر أعلى الصفحة وعلى تبويب المتصفح. اتركه فارغاً لعرض «قائمة الطعام والأسعار»."
      >
        <PanelInput
          value={config.storeName}
          onChange={(storeName) => patch({ storeName })}
          placeholder="مثال: مطعم الأصالة"
          maxLength={CONFIG_LIMITS.storeName}
        />
      </PanelField>

      <PanelField label="الوصف الترحيبي" hint="سطر واحد تحت الاسم.">
        <PanelInput
          value={config.subtitle}
          onChange={(subtitle) => patch({ subtitle })}
          placeholder="أهلاً بكم • تصفح أحدث الأصناف والأسعار"
          maxLength={CONFIG_LIMITS.subtitle}
        />
      </PanelField>

      <PanelField
        label="شريط إعلان أو عرض"
        hint="يظهر فوق الأصناف بلون بارز. اتركه فارغاً لإخفائه."
      >
        <PanelInput
          value={config.announcement}
          onChange={(announcement) => patch({ announcement })}
          placeholder="مثال: خصم ٢٠٪ على المشروبات الباردة حتى نهاية الأسبوع"
          maxLength={CONFIG_LIMITS.announcement}
        />
      </PanelField>

      <PanelField label="رسالة التذييل أسفل المنيو">
        <PanelInput
          value={config.footerText}
          onChange={(footerText) => patch({ footerText })}
          placeholder="نتمنى لكم تجربة مميزة"
          maxLength={CONFIG_LIMITS.footerText}
        />
      </PanelField>

      <PanelSection title="بيانات التواصل" hint="تظهر أسفل المنيو، وكل حقل فارغ لا يظهر أصلاً.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PanelField label="رقم الهاتف">
            <PanelInput
              value={config.contact.phone}
              onChange={(phone) => patch({ contact: { ...config.contact, phone } })}
              placeholder="01000000000"
              dir="ltr"
              maxLength={CONFIG_LIMITS.contactField}
            />
          </PanelField>
          <PanelField label="واتساب">
            <PanelInput
              value={config.contact.whatsapp}
              onChange={(whatsapp) => patch({ contact: { ...config.contact, whatsapp } })}
              placeholder="01000000000"
              dir="ltr"
              maxLength={CONFIG_LIMITS.contactField}
            />
          </PanelField>
          <PanelField label="العنوان">
            <PanelInput
              value={config.contact.address}
              onChange={(address) => patch({ contact: { ...config.contact, address } })}
              placeholder="القاهرة - مصر"
              maxLength={CONFIG_LIMITS.contactField}
            />
          </PanelField>
          <PanelField label="إنستجرام">
            <PanelInput
              value={config.contact.instagram}
              onChange={(instagram) => patch({ contact: { ...config.contact, instagram } })}
              placeholder="@your_account"
              dir="ltr"
              maxLength={CONFIG_LIMITS.contactField}
            />
          </PanelField>
        </div>
      </PanelSection>
    </div>
  );
}

export function ImagesTab({
  config,
  patch,
  onError,
}: {
  config: PublicMenuConfig;
  patch: Patch;
  onError: (message: string) => void;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const upload = async (
    file: File | undefined,
    maxWidth: number,
    maxHeight: number,
    quality: number,
    apply: (dataUrl: string) => void
  ) => {
    if (!file) return;
    try {
      apply(await menuBrandingService.compressImage(file, maxWidth, maxHeight, quality));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر قراءة ملف الصورة');
    }
  };

  // A pasted link is checked as it is typed so the field reports a bad value while the owner
  // is looking at it, rather than being silently dropped when the page reads the record.
  const linkValue = (url: string) => (url.startsWith('data:') ? '' : url);

  const logoRejected = config.logoUrl !== '' && safeImageUrl(config.logoUrl) === '';
  const bannerRejected = config.bannerUrl !== '' && safeImageUrl(config.bannerUrl) === '';

  return (
    <div className="space-y-4">
      <PanelSection
        title="شعار المنيو"
        hint="يظهر في دائرة أعلى الصفحة. الصورة المربعة تعطي أفضل نتيجة."
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-stone-900 border border-stone-300 flex items-center justify-center overflow-hidden shrink-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <UtensilsCrossed className="w-8 h-8 text-amber-400" />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <input
              type="file"
              ref={logoInput}
              accept="image/*"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0], 256, 256, 0.85, (logoUrl) => patch({ logoUrl }))}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                className="px-4 py-2 bg-white hover:bg-stone-100 border border-gray-300 rounded-xl text-xs font-bold text-stone-800 shadow-sm flex items-center gap-1.5"
              >
                <Upload size={14} />
                <span>رفع صورة من الجهاز</span>
              </button>
              {config.logoUrl && (
                <button
                  type="button"
                  onClick={() => patch({ logoUrl: '' })}
                  className="px-3 py-2 text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1"
                >
                  <Trash2 size={13} />
                  <span>إزالة</span>
                </button>
              )}
            </div>
            <PanelInput
              value={linkValue(config.logoUrl)}
              onChange={(logoUrl) => patch({ logoUrl: logoUrl.trim() })}
              placeholder="أو الصق رابط صورة"
              dir="ltr"
            />
            {logoRejected && <RejectedImageNote />}
          </div>
        </div>
      </PanelSection>

      <PanelSection title="صورة الغلاف" hint="خلفية شفافة وراء اسم المطعم أعلى الصفحة.">
        <input
          type="file"
          ref={bannerInput}
          accept="image/*"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0], 1200, 400, 0.8, (bannerUrl) => patch({ bannerUrl }))}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            className="px-4 py-2 bg-white hover:bg-stone-100 border border-gray-300 rounded-xl text-xs font-bold text-stone-800 shadow-sm flex items-center gap-1.5"
          >
            <Upload size={14} />
            <span>رفع غلاف مخصص</span>
          </button>
          {config.bannerUrl && (
            <button
              type="button"
              onClick={() => patch({ bannerUrl: '' })}
              className="px-3 py-2 text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1"
            >
              <Trash2 size={13} />
              <span>إزالة الغلاف</span>
            </button>
          )}
        </div>

        <div>
          <span className="text-[11px] font-bold text-stone-500 block mb-1.5">
            أو اختر خلفية جاهزة:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRESET_COVERS.map(preset => (
              <button
                key={preset.name}
                type="button"
                onClick={() => patch({ bannerUrl: preset.url })}
                aria-pressed={config.bannerUrl === preset.url}
                className={`group relative h-16 rounded-xl overflow-hidden border-2 transition-all ${
                  config.bannerUrl === preset.url
                    ? 'border-amber-500 ring-2 ring-amber-500/30'
                    : 'border-transparent hover:border-stone-400'
                }`}
              >
                <img src={preset.url} alt="" className="w-full h-full object-cover" />
                <span className="absolute inset-0 bg-black/50 flex items-center justify-center p-1 text-[11px] font-black text-white text-center leading-tight">
                  {preset.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        <PanelInput
          value={linkValue(config.bannerUrl)}
          onChange={(bannerUrl) => patch({ bannerUrl: bannerUrl.trim() })}
          placeholder="أو الصق رابط صورة الغلاف"
          dir="ltr"
        />
        {bannerRejected && <RejectedImageNote />}
      </PanelSection>
    </div>
  );
}

function RejectedImageNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] font-bold text-red-600">
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>
        هذا الرابط غير مقبول ولن يُنشر. المقبول رابط يبدأ بـ
        <span dir="ltr"> https:// </span>
        بلا مسافات أو أقواس.
      </span>
    </p>
  );
}

export function ThemeTab({ config, patch }: { config: PublicMenuConfig; patch: Patch }) {
  return (
    <div className="space-y-3">
      <span className="block text-xs sm:text-sm font-bold text-stone-800">
        النمط اللوني لصفحة المنيو:
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MENU_THEME_LIST.map(theme => (
          <ThemeButton
            key={theme.id}
            name={theme.name}
            gradient={theme.headerGradient}
            selected={config.theme === theme.id}
            onSelect={() => patch({ theme: theme.id })}
          />
        ))}
      </div>

      <PanelField
        label="رمز العملة الظاهر بعد كل سعر"
        hint="النظام يعمل بعملة واحدة؛ هذا هو الرمز المطبوع في المنيو."
      >
        <PanelInput
          value={config.currency}
          onChange={(currency) => patch({ currency })}
          placeholder="ج.م"
          maxLength={CONFIG_LIMITS.currency}
        />
      </PanelField>
    </div>
  );
}

function ThemeButton({
  name,
  gradient,
  selected,
  onSelect,
}: {
  name: string;
  gradient: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`p-3 rounded-2xl border-2 text-right transition-all flex items-center justify-between gap-3 ${
        selected ? 'border-amber-500 bg-amber-50/40' : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className={`w-9 h-9 rounded-xl shrink-0 bg-gradient-to-br ${gradient} border border-black/10`} />
        <span className="text-xs sm:text-sm font-extrabold text-stone-900 truncate">{name}</span>
      </span>
      {selected && (
        <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
          <Check size={13} />
        </span>
      )}
    </button>
  );
}
