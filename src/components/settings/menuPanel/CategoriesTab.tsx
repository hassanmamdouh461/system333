/**
 * Which categories reach the customer, in what order, and under what name.
 *
 * Everything here is a display decision. Hiding a category does not stop the cashier from
 * selling it, which is the distinction that makes this panel safe to hand to an owner.
 */

import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { MenuItem } from '../../../types/menu';
import { MenuCategoryRule, PublicMenuConfig } from '../../../types/menuBranding';
import {
  CONFIG_LIMITS,
  categoryLabel,
  itemCategoryId,
  mergeCategoryRules,
} from '../../../utils/menuConfig';

export function CategoriesTab({
  config,
  items,
  patch,
}: {
  config: PublicMenuConfig;
  items: MenuItem[];
  patch: (patch: Partial<PublicMenuConfig>) => void;
}) {
  // Merged against the live menu, so a category added in the POS since the last publish
  // appears here without anyone having to re-open the panel.
  const rules = mergeCategoryRules(items, config);

  const counts = new Map<string, number>();
  for (const item of items) {
    const id = itemCategoryId(item);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const replace = (next: MenuCategoryRule[]) => patch({ categories: next });

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    replace(next);
  };

  const update = (index: number, change: Partial<MenuCategoryRule>) => {
    replace(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));
  };

  const hiddenCount = rules.filter(rule => rule.hidden).length;

  if (rules.length === 0) {
    return (
      <p className="bg-stone-50 border border-stone-200 rounded-2xl py-10 text-center text-xs font-bold text-stone-500">
        لا توجد تصنيفات بعد. أضف أصنافاً من صفحة القائمة وستظهر هنا.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-stone-500 font-bold leading-relaxed">
          الترتيب هنا هو ترتيب الظهور في المنيو. الإخفاء يخص صفحة العملاء فقط، والكاشير يظل
          يبيع كل شيء.
        </p>
        {(hiddenCount > 0 || rules.some(r => r.label)) && (
          <button
            type="button"
            onClick={() => replace([])}
            className="text-[11px] font-bold text-stone-600 hover:text-stone-900 flex items-center gap-1 shrink-0"
          >
            <RotateCcw size={12} />
            <span>إرجاع الترتيب والأسماء للأصل</span>
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {rules.map((rule, index) => (
          <li
            key={rule.id}
            className={`rounded-2xl border p-3 transition-colors ${
              rule.hidden ? 'bg-stone-100 border-stone-200' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`تقديم ${rule.id}`}
                  className="p-1 rounded-lg border border-gray-200 text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rules.length - 1}
                  aria-label={`تأخير ${rule.id}`}
                  className="p-1 rounded-lg border border-gray-200 text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-extrabold text-stone-900 truncate">
                    {categoryLabel(rule.id, config)}
                  </span>
                  <span className="text-[10px] font-bold text-stone-400 shrink-0">
                    {counts.get(rule.id) || 0} صنف
                  </span>
                </div>
                <input
                  type="text"
                  value={rule.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  placeholder={`الاسم المعروض للعملاء (الافتراضي: ${categoryLabel(rule.id, { ...config, categories: [] })})`}
                  maxLength={CONFIG_LIMITS.categoryLabel}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-stone-900 outline-none focus:border-amber-500 text-right"
                />
              </div>

              <button
                type="button"
                onClick={() => update(index, { hidden: !rule.hidden })}
                aria-pressed={rule.hidden}
                className={`shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border transition-colors ${
                  rule.hidden
                    ? 'bg-stone-200 text-stone-700 border-stone-300'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                {rule.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{rule.hidden ? 'مخفي' : 'ظاهر'}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
