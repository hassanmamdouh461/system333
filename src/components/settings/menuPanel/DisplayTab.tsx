/**
 * How the menu is laid out and how much of each item is printed.
 */

import { PublicMenuConfig } from '../../../types/menuBranding';
import { PanelChoice, PanelToggle } from './PanelControls';

export function DisplayTab({
  config,
  patch,
}: {
  config: PublicMenuConfig;
  patch: (patch: Partial<PublicMenuConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <PanelChoice
        label="شكل عرض الأصناف"
        value={config.layout}
        onChange={(layout) => patch({ layout })}
        options={[
          { id: 'grid', label: 'شبكة بطاقتين' },
          { id: 'list', label: 'قائمة طويلة' },
        ]}
      />

      <PanelChoice
        label="ترتيب الأصناف"
        value={config.sortOrder}
        onChange={(sortOrder) => patch({ sortOrder })}
        options={[
          { id: 'category', label: 'حسب ترتيب التصنيفات' },
          { id: 'price-asc', label: 'الأرخص أولاً' },
          { id: 'price-desc', label: 'الأغلى أولاً' },
          { id: 'name', label: 'أبجدياً' },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <PanelToggle
          label="إظهار الأسعار"
          hint="إخفاؤها يحول المنيو إلى قائمة أصناف بلا أرقام."
          checked={config.showPrices}
          onChange={(showPrices) => patch({ showPrices })}
        />
        <PanelToggle
          label="إظهار صور الأصناف"
          checked={config.showImages}
          onChange={(showImages) => patch({ showImages })}
        />
        <PanelToggle
          label="إظهار وصف الصنف"
          checked={config.showDescriptions}
          onChange={(showDescriptions) => patch({ showDescriptions })}
        />
        <PanelToggle
          label="إظهار عدد الأصناف المتاحة"
          checked={config.showItemCount}
          onChange={(showItemCount) => patch({ showItemCount })}
        />
        <PanelToggle
          label="إظهار مربع البحث"
          hint="مفيد للقوائم الطويلة."
          checked={config.showSearch}
          onChange={(showSearch) => patch({ showSearch })}
        />
      </div>
    </div>
  );
}
