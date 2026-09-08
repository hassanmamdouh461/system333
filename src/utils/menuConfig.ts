/**
 * Reading a published menu configuration, and applying it to a list of items.
 *
 * The configuration arrives from three places that are all outside this module's control:
 * `localStorage`, the reports database, and an older desktop build that published fewer
 * fields than this build reads. So nothing here trusts its input — every value is coerced
 * to the declared type, bounded in length, and given a default — and every screen that
 * shows the public menu asks these functions rather than reading the record directly.
 */

import { MenuItem } from '../types/menu';
import {
  DEFAULT_MENU_CONFIG,
  MENU_LAYOUTS,
  MENU_SORT_ORDERS,
  MENU_THEMES,
  MenuCategoryRule,
  PublicMenuConfig,
} from '../types/menuBranding';

/** Length and count caps. The published record travels over the network on every menu view. */
export const CONFIG_LIMITS = {
  storeName: 60,
  subtitle: 140,
  footerText: 160,
  announcement: 160,
  currency: 8,
  contactField: 90,
  categoryId: 80,
  categoryLabel: 60,
  itemId: 64,
  /** A data URL for the logo or banner; ~300 KB of base64 after compression. */
  imageUrl: 400_000,
  categories: 60,
  itemIds: 500,
} as const;

/**
 * Arabic names for the categories the seed catalogue ships in English. An owner-supplied
 * label always wins over this; it exists so a fresh install reads in Arabic before anyone
 * opens the panel.
 */
const BUILT_IN_CATEGORY_LABELS: Record<string, string> = {
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

/** Category id used for an item whose category is empty or the catch-all `All`. */
export const UNCATEGORIZED_ID = 'أخرى';

/**
 * Arabic names for the seed catalogue's English items.
 *
 * The POS accepts whatever name the owner types, and a menu seeded in English would
 * otherwise be shown in English to an Arabic-reading customer. A stored description always
 * wins over the one here; only a missing description falls back to it.
 */
const BUILT_IN_ITEM_NAMES: Record<string, { name: string; description: string }> = {
  'espresso': { name: 'إسبيريسو', description: 'جرعة مركزة وغنية من حبوب البن الفاخرة.' },
  'double espresso': { name: 'إسبيريسو دبل', description: 'جرعة مزدوجة من الإسبريسو الغني والمركز.' },
  'cortado': { name: 'كورتادو', description: 'أجزاء متساوية من الإسبريسو والحليب الدافئ الناعم.' },
  'flat white': { name: 'فلات وايت', description: 'جرعة مزدوجة من الإسبريسو مع طبقة رقيقة من رغوة الحليب.' },
  'cafe latte': { name: 'لاتيه', description: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'latte': { name: 'لاتيه', description: 'جرعة إسبريسو مع الحليب المبخر وطبقة خفيفة من الرغوة.' },
  'cappuccino': { name: 'كابوتشينو', description: 'قهوة كلاسيكية مع رغوة حليب كثيفة وغنية.' },
  'spanish latte': { name: 'سبانش لاتيه', description: 'إسبريسو مع الحليب المكثف المحلى والحليب المبخر.' },
  'americano': { name: 'أمريكانو', description: 'جرعات إسبريسو مخففة بالماء الساخن لمذاق ناعم.' },
  'cafe mocha': { name: 'كافيه موكا', description: 'إسبريسو ممزوج بالشوكولاتة الغنية والحليب الساخن.' },
  'turkish coffee': { name: 'قهوة تركي', description: 'بن مطحون ناعم ومحضر على الطريقة التقليدية.' },
  'french coffee': { name: 'قهوة فرنساوي', description: 'قهوة تقليدية محضرة بالحليب المبخر.' },
};

/** How one item reads on the customer's page. */
export function itemDisplay(item: Pick<MenuItem, 'name' | 'description'>): {
  name: string;
  description: string;
} {
  const known = BUILT_IN_ITEM_NAMES[item.name.trim().toLowerCase()];
  return {
    name: known ? known.name : item.name,
    description: item.description || known?.description || '',
  };
}

function text(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * An image reference safe to place in `src` and in a CSS `url()`.
 *
 * The banner is interpolated into `background-image: url(...)`, where a quote or a closing
 * paren ends the value and starts a new declaration, and any scheme other than http(s) or
 * an inline image has no business being loaded at all.
 *
 * An oversized value is dropped whole rather than truncated: half a data URL is a broken
 * image, and the caps elsewhere in this module truncate because half a name still reads.
 */
export function safeImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > CONFIG_LIMITS.imageUrl) return '';
  if (/["'()\\\s]/.test(raw)) return '';
  if (/^https?:\/\/\S+$/i.test(raw)) return raw;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(raw)) return raw;
  return '';
}

function normalizeCategories(value: unknown): MenuCategoryRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: MenuCategoryRule[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = text(raw.id, CONFIG_LIMITS.categoryId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rules.push({
      id,
      label: text(raw.label, CONFIG_LIMITS.categoryLabel),
      hidden: flag(raw.hidden, false),
    });
    if (rules.length >= CONFIG_LIMITS.categories) break;
  }

  return rules;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = text(entry, CONFIG_LIMITS.itemId);
    if (id) seen.add(id);
    if (seen.size >= CONFIG_LIMITS.itemIds) break;
  }
  return Array.from(seen);
}

/** A complete, bounded configuration from anything at all. */
export function normalizeMenuConfig(raw: unknown): PublicMenuConfig {
  const source: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const contact =
    source.contact && typeof source.contact === 'object'
      ? (source.contact as Record<string, unknown>)
      : {};

  return {
    storeName: text(source.storeName, CONFIG_LIMITS.storeName),
    subtitle: text(source.subtitle, CONFIG_LIMITS.subtitle, DEFAULT_MENU_CONFIG.subtitle),
    logoUrl: safeImageUrl(source.logoUrl),
    bannerUrl: safeImageUrl(source.bannerUrl),
    theme: oneOf(source.theme, MENU_THEMES, DEFAULT_MENU_CONFIG.theme),
    footerText: text(source.footerText, CONFIG_LIMITS.footerText, DEFAULT_MENU_CONFIG.footerText),
    currency: text(source.currency, CONFIG_LIMITS.currency, DEFAULT_MENU_CONFIG.currency),
    layout: oneOf(source.layout, MENU_LAYOUTS, DEFAULT_MENU_CONFIG.layout),
    sortOrder: oneOf(source.sortOrder, MENU_SORT_ORDERS, DEFAULT_MENU_CONFIG.sortOrder),
    showPrices: flag(source.showPrices, DEFAULT_MENU_CONFIG.showPrices),
    showImages: flag(source.showImages, DEFAULT_MENU_CONFIG.showImages),
    showDescriptions: flag(source.showDescriptions, DEFAULT_MENU_CONFIG.showDescriptions),
    showItemCount: flag(source.showItemCount, DEFAULT_MENU_CONFIG.showItemCount),
    showSearch: flag(source.showSearch, DEFAULT_MENU_CONFIG.showSearch),
    announcement: text(source.announcement, CONFIG_LIMITS.announcement),
    categories: normalizeCategories(source.categories),
    hiddenItemIds: normalizeIds(source.hiddenItemIds),
    featuredItemIds: normalizeIds(source.featuredItemIds),
    contact: {
      phone: text(contact.phone, CONFIG_LIMITS.contactField),
      whatsapp: text(contact.whatsapp, CONFIG_LIMITS.contactField),
      address: text(contact.address, CONFIG_LIMITS.contactField),
      instagram: text(contact.instagram, CONFIG_LIMITS.contactField),
    },
    updatedAt: text(source.updatedAt, 40),
  };
}

// ─── Applying a configuration to a menu ──────────────────────────────────────

export interface ResolvedCategory {
  id: string;
  label: string;
  /** Visible items in this category, so the page can print a count beside the name. */
  count: number;
}

/**
 * The category id stored on an item. The column packs two values — `"Hot Coffee|Bar"` is
 * the menu category and the preparation area — and only the first belongs to a customer.
 */
export function itemCategoryId(item: Pick<MenuItem, 'category'>): string {
  const first = (item.category || '').split('|')[0].trim();
  return first && first !== 'All' ? first : UNCATEGORIZED_ID;
}

/** An owner-supplied label wins, then the built-in Arabic name, then the raw id. */
export function categoryLabel(id: string, config: PublicMenuConfig): string {
  const rule = config.categories.find(c => c.id === id);
  if (rule?.label) return rule.label;
  return BUILT_IN_CATEGORY_LABELS[id] || id;
}

/**
 * True when the POS considers the item sellable. The flag arrives as a boolean from SQLite
 * and as 0/1 from D1, and `0` is truthy in neither but was compared as a boolean.
 */
function isAvailable(item: MenuItem): boolean {
  return item.available !== false && (item.available as unknown) !== 0;
}

/**
 * The items a customer may see: sellable, not individually hidden, and not inside a hidden
 * category. Hiding is a display decision only — the cashier keeps selling all of them.
 */
export function visibleMenuItems(items: MenuItem[], config: PublicMenuConfig): MenuItem[] {
  const hiddenItems = new Set(config.hiddenItemIds);
  const hiddenCategories = new Set(config.categories.filter(c => c.hidden).map(c => c.id));

  return items.filter(item =>
    isAvailable(item) &&
    !hiddenItems.has(item.id) &&
    !hiddenCategories.has(itemCategoryId(item))
  );
}

/**
 * Every category rule needed to describe the current menu: the stored ones in their stored
 * order, then any category that has appeared since the last publish. New categories are
 * appended rather than sorted in, so adding one item cannot reshuffle a menu the owner
 * arranged by hand.
 */
export function mergeCategoryRules(items: MenuItem[], config: PublicMenuConfig): MenuCategoryRule[] {
  const present = new Set(items.map(itemCategoryId));
  const merged = config.categories.filter(rule => present.has(rule.id));
  const known = new Set(merged.map(rule => rule.id));

  for (const item of items) {
    const id = itemCategoryId(item);
    if (known.has(id)) continue;
    known.add(id);
    merged.push({ id, label: '', hidden: false });
  }

  return merged;
}

/** Visible categories in the owner's order, each with its visible item count. */
export function visibleCategories(items: MenuItem[], config: PublicMenuConfig): ResolvedCategory[] {
  const visible = visibleMenuItems(items, config);
  const counts = new Map<string, number>();
  for (const item of visible) {
    const id = itemCategoryId(item);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return mergeCategoryRules(visible, config)
    .filter(rule => (counts.get(rule.id) || 0) > 0)
    .map(rule => ({
      id: rule.id,
      label: rule.label || categoryLabel(rule.id, config),
      count: counts.get(rule.id) || 0,
    }));
}

/**
 * Items in display order: featured first in the order they were pinned, then the rest by the
 * chosen rule. Category order follows the owner's arrangement, not the alphabet, so the
 * public page reads in the sequence the panel shows.
 */
export function sortMenuItems(items: MenuItem[], config: PublicMenuConfig): MenuItem[] {
  const featuredRank = new Map(config.featuredItemIds.map((id, index) => [id, index]));
  const categoryRank = new Map(
    mergeCategoryRules(items, config).map((rule, index) => [rule.id, index])
  );
  const rankOf = (item: MenuItem) => categoryRank.get(itemCategoryId(item)) ?? Number.MAX_SAFE_INTEGER;
  const byName = (a: MenuItem, b: MenuItem) => a.name.localeCompare(b.name, 'ar');

  const compare = (a: MenuItem, b: MenuItem): number => {
    const featuredA = featuredRank.get(a.id);
    const featuredB = featuredRank.get(b.id);
    if (featuredA !== undefined || featuredB !== undefined) {
      if (featuredA === undefined) return 1;
      if (featuredB === undefined) return -1;
      return featuredA - featuredB;
    }

    switch (config.sortOrder) {
      case 'price-asc':
        return a.price - b.price || byName(a, b);
      case 'price-desc':
        return b.price - a.price || byName(a, b);
      case 'name':
        return byName(a, b);
      default:
        return rankOf(a) - rankOf(b) || byName(a, b);
    }
  };

  // Copied first: sorting the caller's array in place mutated the shared menu list.
  return [...items].sort(compare);
}

