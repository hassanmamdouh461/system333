/**
 * Live preview of the customer's page, rendered from the draft configuration.
 *
 * It shares the theme table and the visibility, ordering and formatting helpers with the
 * real page, so what the owner sees here is what the page renders — the earlier preview
 * only drew the banner and kept its own copy of the gradients.
 */

import { UtensilsCrossed, Search, Star } from 'lucide-react';
import { MenuItem } from '../../../types/menu';
import { PublicMenuConfig } from '../../../types/menuBranding';
import { menuThemeStyle } from '../../../utils/menuThemes';
import { categoryLabel, itemCategoryId, itemDisplay, sortMenuItems, visibleCategories, visibleMenuItems } from '../../../utils/menuConfig';

const PREVIEW_ITEM_LIMIT = 3;

export function MenuPreview({ config, items }: { config: PublicMenuConfig; items: MenuItem[] }) {
  const theme = menuThemeStyle(config.theme);
  const visible = visibleMenuItems(items, config);
  const categories = visibleCategories(items, config);
  const shown = sortMenuItems(visible, config).slice(0, PREVIEW_ITEM_LIMIT);
  const featured = new Set(config.featuredItemIds);

  return (
    <div className={`rounded-2xl overflow-hidden border border-stone-200 ${theme.pageBg}`}>
      {/* Header */}
      <div className={`relative px-5 pt-5 pb-7 text-center text-white bg-gradient-to-br ${theme.headerGradient}`}>
        {config.bannerUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30"
            style={{ backgroundImage: `url(${config.bannerUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-black/25" />

        <div className="relative flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center mb-2 overflow-hidden backdrop-blur-md">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <UtensilsCrossed className={`w-6 h-6 ${theme.accentText}`} />
            )}
          </div>
          <p className="text-lg font-black leading-tight">
            {config.storeName || 'قائمة الطعام والأسعار'}
          </p>
          <p className="text-stone-300 text-[11px] font-medium mt-0.5">{config.subtitle}</p>
          {config.showItemCount && (
            <span className="mt-2 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-[10px] font-bold text-stone-200">
              {visible.length} صنف متاح
            </span>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 -mt-4 space-y-2.5">
        {config.announcement && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-bold text-amber-900 text-center">
            {config.announcement}
          </div>
        )}

        {config.showSearch && (
          <div className="bg-white rounded-xl border border-stone-200 px-3 py-2 flex items-center gap-2 text-stone-400">
            <Search className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold">ابحث عن صنف...</span>
          </div>
        )}

        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-hidden">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black shrink-0 ${theme.activeTab}`}>
              الكل ({visible.length})
            </span>
            {categories.slice(0, 2).map(cat => (
              <span
                key={cat.id}
                className="px-3 py-1 rounded-full text-[10px] font-black bg-white text-stone-700 border border-stone-200 shrink-0 truncate"
              >
                {cat.label} ({cat.count})
              </span>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="bg-white rounded-xl border border-stone-200 py-6 text-center text-[11px] font-bold text-stone-400">
            لا توجد أصناف ظاهرة للعملاء بالإعدادات الحالية
          </p>
        ) : (
          <div className={config.layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
            {shown.map(item => (
              <PreviewCard
                key={item.id}
                item={item}
                config={config}
                priceBadge={theme.priceBadge}
                pinned={featured.has(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCard({
  item,
  config,
  priceBadge,
  pinned,
}: {
  item: MenuItem;
  config: PublicMenuConfig;
  priceBadge: string;
  pinned: boolean;
}) {
  const display = itemDisplay(item);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-2.5">
      {config.showImages && item.image && (
        <div className="h-12 w-full rounded-lg overflow-hidden mb-1.5 bg-stone-100">
          <img src={item.image} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold text-stone-900 truncate flex items-center gap-1">
            {pinned && <Star size={10} className="text-amber-500 shrink-0" />}
            <span className="truncate">{display.name}</span>
          </p>
          <p className="text-[9px] font-bold text-stone-400 mt-0.5">
            {categoryLabel(itemCategoryId(item), config)}
          </p>
          {config.showDescriptions && display.description && (
            <p className="text-[9px] text-stone-500 mt-0.5 line-clamp-1">{display.description}</p>
          )}
        </div>
        {config.showPrices && (
          <span className={`${priceBadge} shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-black border`}>
            {item.price.toFixed(2)} {config.currency}
          </span>
        )}
      </div>
    </div>
  );
}
