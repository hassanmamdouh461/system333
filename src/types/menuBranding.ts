/**
 * The public menu's identity and display rules.
 *
 * One record describes everything the owner controls about the customer-facing menu: its
 * wording, its images, its colours, which categories and items are shown, in what order,
 * and how much of each item is printed. It is published to the reports database and read
 * back by the public page, so every field must survive a JSON round trip and must have a
 * default — an older desktop build publishes fewer fields than a newer page reads.
 */

export type MenuTheme = 'dark' | 'amber' | 'emerald' | 'burgundy' | 'navy';
export type MenuLayout = 'grid' | 'list';
export type MenuSortOrder = 'category' | 'price-asc' | 'price-desc' | 'name';

export const MENU_THEMES: readonly MenuTheme[] = ['dark', 'amber', 'emerald', 'burgundy', 'navy'];
export const MENU_LAYOUTS: readonly MenuLayout[] = ['grid', 'list'];
export const MENU_SORT_ORDERS: readonly MenuSortOrder[] = ['category', 'price-asc', 'price-desc', 'name'];

/** How one menu category is presented, keyed by the id stored on the item. */
export interface MenuCategoryRule {
  id: string;
  /** Owner-supplied name; empty falls back to the built-in dictionary, then to the id. */
  label: string;
  /** A hidden category keeps selling in the POS but never reaches the public page. */
  hidden: boolean;
}

export interface MenuContactInfo {
  phone: string;
  whatsapp: string;
  address: string;
  instagram: string;
}

export interface PublicMenuConfig {
  storeName: string;
  subtitle: string;
  logoUrl: string;
  bannerUrl: string;
  theme: MenuTheme;
  footerText: string;
  /** Printed after every price. The POS itself always works in one currency. */
  currency: string;
  layout: MenuLayout;
  sortOrder: MenuSortOrder;
  showPrices: boolean;
  showImages: boolean;
  showDescriptions: boolean;
  showItemCount: boolean;
  showSearch: boolean;
  /** A short offer strip above the items; empty hides it. */
  announcement: string;
  /** Ordered. A category missing from this list keeps its natural place after the listed ones. */
  categories: MenuCategoryRule[];
  /** Hidden from the public page only — availability still governs the POS. */
  hiddenItemIds: string[];
  /** Pinned above everything else, in this order. */
  featuredItemIds: string[];
  contact: MenuContactInfo;
  /** ISO timestamp of the last publish, so the panel can show what is live. */
  updatedAt: string;
}

/**
 * What the public page shows before anyone opens the panel. `storeName` is deliberately
 * empty: a shipped brand name would appear on every customer's screen as if the owner had
 * chosen it.
 */
export const DEFAULT_MENU_CONFIG: PublicMenuConfig = {
  storeName: '',
  subtitle: 'أهلاً بكم • تصفح أحدث الأصناف والأسعار',
  logoUrl: '',
  bannerUrl: '',
  theme: 'dark',
  footerText: 'نتمنى لكم تجربة مميزة',
  currency: 'ج.م',
  layout: 'grid',
  sortOrder: 'category',
  showPrices: true,
  showImages: true,
  showDescriptions: true,
  showItemCount: true,
  showSearch: true,
  announcement: '',
  categories: [],
  hiddenItemIds: [],
  featuredItemIds: [],
  contact: { phone: '', whatsapp: '', address: '', instagram: '' },
  updatedAt: '',
};
