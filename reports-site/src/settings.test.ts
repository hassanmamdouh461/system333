import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettings,
  resolveTheme,
  writeSettings,
  type PreferenceStore,
} from './settings';

/** Stand-in for `localStorage`, so these tests need no browser. */
function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const store: PreferenceStore & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return store;
}

describe('normalizeSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const input of [null, undefined, 'dark', 42, []]) {
      expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps every valid stored value', () => {
    const stored = {
      theme: 'dark',
      density: 'compact',
      autoRefresh: false,
      refreshSeconds: 60,
      rememberScope: false,
      defaultBranch: 'branch-2',
      defaultPeriod: 'month',
    };
    expect(normalizeSettings(stored)).toEqual(stored);
  });

  it('falls back per field, so one bad value does not discard the rest', () => {
    const settings = normalizeSettings({ theme: 'neon', density: 'compact' });
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.density).toBe('compact');
  });

  it('rejects a refresh interval that is not one of the offered choices', () => {
    // A hand-edited zero would poll the worker as fast as the browser allows.
    expect(normalizeSettings({ refreshSeconds: 0 }).refreshSeconds).toBe(20);
    expect(normalizeSettings({ refreshSeconds: 7 }).refreshSeconds).toBe(20);
    expect(normalizeSettings({ refreshSeconds: '60' }).refreshSeconds).toBe(60);
  });

  it('treats a non-boolean flag as the default rather than as truthy', () => {
    expect(normalizeSettings({ autoRefresh: 'no' }).autoRefresh).toBe(true);
    expect(normalizeSettings({ autoRefresh: false }).autoRefresh).toBe(false);
  });

  it('rejects an unknown period, which would otherwise filter out every order', () => {
    expect(normalizeSettings({ defaultPeriod: 'decade' }).defaultPeriod).toBe('week');
  });

  it('ignores an empty branch id and keeps every branch selected', () => {
    expect(normalizeSettings({ defaultBranch: '' }).defaultBranch).toBe('all');
  });
});

describe('readSettings', () => {
  it('returns the defaults for an empty store', () => {
    expect(readSettings(fakeStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('reads back what was written', () => {
    const store = fakeStore();
    const settings = { ...DEFAULT_SETTINGS, theme: 'dark' as const, refreshSeconds: 300 };
    writeSettings(settings, store);
    expect(readSettings(store)).toEqual(settings);
  });

  it('survives a corrupt record instead of throwing on load', () => {
    expect(readSettings(fakeStore({ engaz_reports_settings: '{not json' }))).toEqual(
      DEFAULT_SETTINGS
    );
  });

  it('adopts the branch and period a returning viewer had chosen under the old keys', () => {
    const store = fakeStore({
      engaz_reports_branch: 'branch-7',
      engaz_reports_period: 'month',
    });

    const settings = readSettings(store);
    expect(settings.defaultBranch).toBe('branch-7');
    expect(settings.defaultPeriod).toBe('month');
    // Migrated once and persisted, so the old keys are not read again.
    expect(store.getItem('engaz_reports_branch')).toBeNull();
    expect(store.getItem('engaz_reports_period')).toBeNull();
    expect(readSettings(store)).toEqual(settings);
  });

  it('normalizes a legacy period that is no longer offered', () => {
    expect(readSettings(fakeStore({ engaz_reports_period: 'quarter' })).defaultPeriod).toBe('week');
  });

  it('leaves the old keys alone once a settings record exists', () => {
    const store = fakeStore({
      engaz_reports_settings: JSON.stringify({ ...DEFAULT_SETTINGS, defaultBranch: 'branch-1' }),
      engaz_reports_branch: 'branch-9',
    });
    expect(readSettings(store).defaultBranch).toBe('branch-1');
  });
});

describe('writeSettings', () => {
  it('does not throw when storage refuses the write', () => {
    const store: PreferenceStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(() => writeSettings(DEFAULT_SETTINGS, store)).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('follows the system only for the system choice', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
