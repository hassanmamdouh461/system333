/**
 * Portal preferences.
 *
 * Every value here is a display or polling choice, so it stays on the viewer's machine in
 * localStorage: the reports database holds no per-user record, and a preference is not worth
 * a round trip to the worker. Nothing here is a credential.
 *
 * Anything read back from storage is normalized before use. Stored preferences outlive the
 * code that wrote them, so a value from an older build — or one edited by hand — must degrade
 * to the default instead of reaching the UI as an unknown theme or a zero-second poll.
 */

import { ALL_BRANCHES, PERIOD_ORDER, type Period } from './analytics';

export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

export interface PortalSettings {
  theme: Theme;
  density: Density;
  /** Whether the portal re-reads the database on a timer. */
  autoRefresh: boolean;
  refreshSeconds: number;
  /** When set, the branch and period picked in the topbar become the stored defaults. */
  rememberScope: boolean;
  /** Branch selected when the portal opens. */
  defaultBranch: string;
  /** Period selected when the portal opens. */
  defaultPeriod: Period;
}

/** Poll intervals offered, in seconds. A shorter one is a heavier load on the worker. */
export const REFRESH_CHOICES = [10, 20, 60, 300];

export const THEMES: Theme[] = ['light', 'dark', 'system'];
export const DENSITIES: Density[] = ['comfortable', 'compact'];

export const THEME_LABELS: Record<Theme, string> = {
  light: 'فاتح',
  dark: 'داكن',
  system: 'حسب النظام',
};

export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'مريح',
  compact: 'مضغوط',
};

export const REFRESH_LABELS: Record<number, string> = {
  10: 'كل ١٠ ثوانٍ',
  20: 'كل ٢٠ ثانية',
  60: 'كل دقيقة',
  300: 'كل ٥ دقائق',
};

/** Light, not system, so an existing viewer's portal looks the same after this update. */
export const DEFAULT_SETTINGS: PortalSettings = {
  theme: 'light',
  density: 'comfortable',
  autoRefresh: true,
  refreshSeconds: 20,
  rememberScope: true,
  defaultBranch: ALL_BRANCHES,
  defaultPeriod: 'week',
};

const SETTINGS_KEY = 'engaz_reports_settings';

/** Keys the portal used before preferences were grouped into one record. */
const LEGACY_BRANCH_KEY = 'engaz_reports_branch';
const LEGACY_PERIOD_KEY = 'engaz_reports_period';

/** The slice of `Storage` this module needs, so a test can pass a plain object. */
export type PreferenceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeSettings(raw: unknown): PortalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const input = raw as Record<string, unknown>;

  return {
    theme: pick(input.theme, THEMES, DEFAULT_SETTINGS.theme),
    density: pick(input.density, DENSITIES, DEFAULT_SETTINGS.density),
    autoRefresh:
      typeof input.autoRefresh === 'boolean' ? input.autoRefresh : DEFAULT_SETTINGS.autoRefresh,
    refreshSeconds: REFRESH_CHOICES.includes(Number(input.refreshSeconds))
      ? Number(input.refreshSeconds)
      : DEFAULT_SETTINGS.refreshSeconds,
    rememberScope:
      typeof input.rememberScope === 'boolean'
        ? input.rememberScope
        : DEFAULT_SETTINGS.rememberScope,
    // A branch id cannot be validated here: the list of branches comes from the snapshot,
    // which is not loaded yet. A branch that no longer exists simply filters to nothing.
    defaultBranch:
      typeof input.defaultBranch === 'string' && input.defaultBranch
        ? input.defaultBranch
        : DEFAULT_SETTINGS.defaultBranch,
    defaultPeriod: pick(input.defaultPeriod, PERIOD_ORDER, DEFAULT_SETTINGS.defaultPeriod),
  };
}

export function readSettings(store: PreferenceStore): PortalSettings {
  let stored: unknown = null;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    // Unparseable preferences are not worth reporting: the defaults are a valid portal.
    stored = null;
  }

  const settings = normalizeSettings(stored);
  return stored === null ? adoptLegacyScope(settings, store) : settings;
}

/**
 * Folds the branch and period a returning viewer last chose into the new record, so this
 * update does not reset the scope they were working in.
 */
function adoptLegacyScope(settings: PortalSettings, store: PreferenceStore): PortalSettings {
  const branch = store.getItem(LEGACY_BRANCH_KEY);
  const period = store.getItem(LEGACY_PERIOD_KEY);
  if (branch === null && period === null) return settings;

  const adopted = normalizeSettings({
    ...settings,
    defaultBranch: branch ?? settings.defaultBranch,
    defaultPeriod: period ?? settings.defaultPeriod,
  });

  writeSettings(adopted, store);
  store.removeItem(LEGACY_BRANCH_KEY);
  store.removeItem(LEGACY_PERIOD_KEY);
  return adopted;
}

export function writeSettings(settings: PortalSettings, store: PreferenceStore) {
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or blocked by the browser. The portal keeps the choice for this
    // visit either way, so failing to persist it is not worth interrupting the viewer.
  }
}

/** The palette to render: `system` follows the operating system, the others are explicit. */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
