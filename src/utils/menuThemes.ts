/**
 * The five colour schemes the public menu can wear.
 *
 * Both the customer page and the settings panel that previews it read this table, so a
 * theme cannot look one way in the preview and another way to the customer — which is what
 * happened while each side kept its own copy of the gradients.
 */

import { MenuTheme } from '../types/menuBranding';

export interface MenuThemeStyle {
  id: MenuTheme;
  name: string;
  /** Applied to the page header, behind the banner image when one is set. */
  headerGradient: string;
  accentText: string;
  accentGlow: string;
  priceBadge: string;
  /** The selected category pill. */
  activeTab: string;
  pageBg: string;
  /** Solid colour used for the swatch beside the theme name in the panel. */
  swatch: string;
}

export const MENU_THEME_STYLES: Record<MenuTheme, MenuThemeStyle> = {
  dark: {
    id: 'dark',
    name: 'داكن ملكي',
    headerGradient: 'from-stone-950 via-stone-900 to-neutral-900',
    accentText: 'text-amber-400',
    accentGlow: 'bg-amber-500/10',
    priceBadge: 'bg-amber-500/10 text-amber-950 border-amber-500/20',
    activeTab: 'bg-stone-900 text-white shadow-stone-900/20',
    pageBg: 'bg-[#f8f7f5]',
    swatch: 'bg-stone-900',
  },
  amber: {
    id: 'amber',
    name: 'بني وعسلي دافئ',
    headerGradient: 'from-[#2C1810] via-[#3D2314] to-[#1F110B]',
    accentText: 'text-amber-300',
    accentGlow: 'bg-amber-500/15',
    priceBadge: 'bg-[#3D2314]/10 text-[#3D2314] border-[#3D2314]/20',
    activeTab: 'bg-[#3D2314] text-white shadow-[#3D2314]/20',
    pageBg: 'bg-[#faf7f2]',
    swatch: 'bg-[#3D2314]',
  },
  emerald: {
    id: 'emerald',
    name: 'أخضر زمردي راقي',
    headerGradient: 'from-[#062c1e] via-[#0b3d2b] to-[#041a12]',
    accentText: 'text-emerald-300',
    accentGlow: 'bg-emerald-500/15',
    priceBadge: 'bg-emerald-500/10 text-emerald-950 border-emerald-500/20',
    activeTab: 'bg-[#0b3d2b] text-white shadow-[#0b3d2b]/20',
    pageBg: 'bg-[#f4f8f5]',
    swatch: 'bg-[#0b3d2b]',
  },
  burgundy: {
    id: 'burgundy',
    name: 'عنابي ملوكي فاخر',
    headerGradient: 'from-[#380e15] via-[#4d131d] to-[#24080d]',
    accentText: 'text-rose-300',
    accentGlow: 'bg-rose-500/15',
    priceBadge: 'bg-rose-500/10 text-rose-950 border-rose-500/20',
    activeTab: 'bg-[#4d131d] text-white shadow-[#4d131d]/20',
    pageBg: 'bg-[#f9f5f6]',
    swatch: 'bg-[#4d131d]',
  },
  navy: {
    id: 'navy',
    name: 'أزرق نيلي هادئ',
    headerGradient: 'from-[#0b1b36] via-[#12284d] to-[#060f21]',
    accentText: 'text-sky-300',
    accentGlow: 'bg-sky-500/15',
    priceBadge: 'bg-sky-500/10 text-sky-950 border-sky-500/20',
    activeTab: 'bg-[#12284d] text-white shadow-[#12284d]/20',
    pageBg: 'bg-[#f4f6fa]',
    swatch: 'bg-[#12284d]',
  },
};

export function menuThemeStyle(theme: MenuTheme): MenuThemeStyle {
  return MENU_THEME_STYLES[theme] || MENU_THEME_STYLES.dark;
}

export const MENU_THEME_LIST: MenuThemeStyle[] = Object.values(MENU_THEME_STYLES);
