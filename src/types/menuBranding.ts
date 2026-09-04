export type MenuTheme = 'dark' | 'amber' | 'emerald' | 'burgundy' | 'navy';

export interface PublicMenuConfig {
  storeName: string;
  subtitle: string;
  logoUrl?: string;
  bannerUrl?: string;
  theme: MenuTheme;
  footerText?: string;
}

export const DEFAULT_MENU_CONFIG: PublicMenuConfig = {
  storeName: '',
  subtitle: 'أهلاً بكم • تصفح أحدث الأصناف والأسعار',
  logoUrl: '',
  bannerUrl: '',
  theme: 'dark',
  footerText: 'نتمنى لكم تجربة مميزة',
};
