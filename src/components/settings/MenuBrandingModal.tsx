import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Palette,
  Type,
  Image as ImageIcon,
  Sparkles,
  LayoutGrid,
  ListOrdered,
  RefreshCw,
  Check,
  Eye,
  CloudOff,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDialog } from '../../hooks/useDialog';
import { useMenu } from '../../hooks/useMenu';
import { menuBrandingService } from '../../services/menuBrandingService';
import { PublicMenuConfig } from '../../types/menuBranding';
import { normalizeMenuConfig } from '../../utils/menuConfig';
import { IdentityTab, ImagesTab, ThemeTab } from './menuPanel/IdentityTabs';
import { DisplayTab } from './menuPanel/DisplayTab';
import { CategoriesTab } from './menuPanel/CategoriesTab';
import { MenuPreview } from './menuPanel/MenuPreview';

interface MenuBrandingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type TabId = 'identity' | 'images' | 'theme' | 'display' | 'categories';

const TABS: { id: TabId; label: string; icon: typeof Type }[] = [
  { id: 'identity', label: 'النصوص والهوية', icon: Type },
  { id: 'images', label: 'الصور والشعار', icon: ImageIcon },
  { id: 'theme', label: 'المظهر والألوان', icon: Sparkles },
  { id: 'display', label: 'طريقة العرض', icon: LayoutGrid },
  { id: 'categories', label: 'التصنيفات', icon: ListOrdered },
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
  const { items } = useMenu();

  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const [config, setConfig] = useState<PublicMenuConfig>(() => menuBrandingService.getLocalConfig());
  // What is live, so the footer can say whether the draft differs from the published menu.
  const [published, setPublished] = useState<PublicMenuConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  // The panel opens on the local draft so it paints immediately, then reconciles with what
  // customers are actually being served.
  useEffect(() => {
    let cancelled = false;
    menuBrandingService.fetchPublishedConfig().then(remote => {
      if (cancelled || !remote) return;
      setPublished(remote);
      setConfig(current =>
        JSON.stringify(current) === JSON.stringify(menuBrandingService.getLocalConfig())
          ? remote
          : current
      );
    });
    return () => { cancelled = true; };
  }, []);

  const patch = (change: Partial<PublicMenuConfig>) => {
    setConfig(current => ({ ...current, ...change }));
    setStatus(null);
  };

  const dirty = useMemo(() => {
    if (!published) return true;
    const strip = ({ updatedAt: _ignored, ...rest }: PublicMenuConfig) => rest;
    return JSON.stringify(strip(config)) !== JSON.stringify(strip(published));
  }, [config, published]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    // Normalised before publishing so the draft cannot carry a value the page would drop.
    const clean = normalizeMenuConfig(config);
    setConfig(clean);

    const result = await menuBrandingService.publishConfig(clean);
    setSaving(false);

    if (result.published) {
      setPublished(clean);
      setStatus({ tone: 'ok', text: 'تم نشر المنيو، والعملاء يرون التعديلات الآن' });
      onSaved?.();
      setTimeout(onClose, 1200);
      return;
    }

    setStatus({
      tone: 'warn',
      text: result.error
        ? `حُفظ على الجهاز ولم يُنشر: ${result.error}`
        : 'حُفظ على الجهاز ولم يُنشر',
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <motion.div
        ref={panelRef}
        {...dialogProps}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        dir="rtl"
        className="relative bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden outline-none flex flex-col max-h-[94vh] border border-gray-100"
      >
        <header className="bg-gradient-to-r from-stone-900 to-stone-800 px-5 sm:px-6 py-4 flex items-center justify-between shrink-0 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Palette size={22} />
            </div>
            <div>
              <h2 id={titleId} className="text-base sm:text-lg font-black leading-tight">
                التحكم في المنيو الإلكتروني
              </h2>
              <p className="text-stone-300 text-[11px] sm:text-xs mt-0.5 font-medium">
                الهوية والألوان، وما يظهر للعملاء من تصنيفات وأصناف وأسعار
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="text-stone-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="flex border-b border-gray-100 bg-gray-50/70 px-4 sm:px-6 pt-2 shrink-0 gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={`pb-3 px-3 text-[11px] sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-amber-600 text-stone-900'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <tab.icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 p-5 sm:p-6">
            <div className="min-w-0 text-stone-800">
              {activeTab === 'identity' && <IdentityTab config={config} patch={patch} />}
              {activeTab === 'images' && (
                <ImagesTab
                  config={config}
                  patch={patch}
                  onError={(text) => setStatus({ tone: 'error', text })}
                />
              )}
              {activeTab === 'theme' && <ThemeTab config={config} patch={patch} />}
              {activeTab === 'display' && <DisplayTab config={config} patch={patch} />}
              {activeTab === 'categories' && (
                <CategoriesTab config={config} items={items} patch={patch} />
              )}
            </div>

            <aside className="lg:sticky lg:top-0 self-start w-full min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-stone-500 mb-2">
                <Eye size={13} />
                <span>معاينة صفحة العميل</span>
              </div>
              <MenuPreview config={config} items={items} />
            </aside>
          </div>
        </div>

        <footer className="p-4 sm:px-6 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <StatusLine status={status} dirty={dirty} published={published} />
          <div className="flex items-center gap-2 shrink-0">
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
                  <span>جاري النشر...</span>
                </>
              ) : (
                <span>حفظ ونشر التعديلات</span>
              )}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function StatusLine({
  status,
  dirty,
  published,
}: {
  status: { tone: 'ok' | 'warn' | 'error'; text: string } | null;
  dirty: boolean;
  published: PublicMenuConfig | null;
}) {
  if (status) {
    const tone =
      status.tone === 'ok'
        ? 'text-emerald-700'
        : status.tone === 'warn'
          ? 'text-amber-700'
          : 'text-red-600';
    const Icon = status.tone === 'ok' ? Check : status.tone === 'warn' ? CloudOff : AlertTriangle;
    return (
      <p className={`text-[11px] sm:text-xs font-bold flex items-start gap-1.5 min-w-0 ${tone}`}>
        <Icon size={14} className="shrink-0 mt-0.5" />
        <span>{status.text}</span>
      </p>
    );
  }

  if (dirty) {
    return (
      <p className="text-[11px] sm:text-xs font-bold text-stone-500">
        تعديلات لم تُنشر بعد. العملاء يرون النسخة السابقة حتى تضغط النشر.
      </p>
    );
  }

  return (
    <p className="text-[11px] sm:text-xs font-bold text-stone-400">
      المنشور مطابق لما تراه هنا{published?.updatedAt ? ` • آخر نشر ${formatStamp(published.updatedAt)}` : ''}
    </p>
  );
}

/** Latin digits, because Arabic-Indic digits beside a Latin token invert the reading order. */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });
}
