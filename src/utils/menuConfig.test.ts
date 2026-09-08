import { describe, it, expect } from 'vitest';
import {
  CONFIG_LIMITS,
  UNCATEGORIZED_ID,
  categoryLabel,
  itemCategoryId,
  itemDisplay,
  mergeCategoryRules,
  normalizeMenuConfig,
  safeImageUrl,
  sortMenuItems,
  visibleCategories,
  visibleMenuItems,
} from './menuConfig';
import { DEFAULT_MENU_CONFIG, PublicMenuConfig } from '../types/menuBranding';
import { MenuItem } from '../types/menu';

function config(overrides: Partial<PublicMenuConfig> = {}): PublicMenuConfig {
  return { ...DEFAULT_MENU_CONFIG, ...overrides };
}

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'm1',
    name: 'Latte',
    description: '',
    price: 40,
    category: 'Hot Coffee|Bar',
    image: '',
    available: true,
    ...overrides,
  };
}

describe('normalizeMenuConfig', () => {
  it('fills every field from an empty or absent record', () => {
    for (const input of [undefined, null, {}, 'not an object', 42]) {
      expect(normalizeMenuConfig(input)).toEqual(DEFAULT_MENU_CONFIG);
    }
  });

  it('keeps a value the owner set', () => {
    const result = normalizeMenuConfig({
      storeName: '  مطعم الأصالة  ',
      theme: 'emerald',
      layout: 'list',
      sortOrder: 'price-desc',
      showPrices: false,
      currency: 'ر.س',
      announcement: 'خصم ٢٠٪ اليوم',
    });

    expect(result.storeName).toBe('مطعم الأصالة');
    expect(result.theme).toBe('emerald');
    expect(result.layout).toBe('list');
    expect(result.sortOrder).toBe('price-desc');
    expect(result.showPrices).toBe(false);
    expect(result.currency).toBe('ر.س');
    expect(result.announcement).toBe('خصم ٢٠٪ اليوم');
  });

  it('falls back rather than trusting an unknown enum value', () => {
    // A hand-edited localStorage key, or a record published by a newer build, must not put
    // the page into a theme or layout it has no styles for.
    const result = normalizeMenuConfig({ theme: 'neon', layout: 'carousel', sortOrder: 'random' });
    expect(result.theme).toBe(DEFAULT_MENU_CONFIG.theme);
    expect(result.layout).toBe(DEFAULT_MENU_CONFIG.layout);
    expect(result.sortOrder).toBe(DEFAULT_MENU_CONFIG.sortOrder);
  });

  it('coerces a wrongly typed field instead of passing it through', () => {
    const result = normalizeMenuConfig({
      storeName: 42,
      showPrices: 'yes',
      categories: 'Hot Coffee',
      hiddenItemIds: { id: 'm1' },
      contact: 'call us',
    });

    expect(result.storeName).toBe('');
    expect(result.showPrices).toBe(true);
    expect(result.categories).toEqual([]);
    expect(result.hiddenItemIds).toEqual([]);
    expect(result.contact).toEqual(DEFAULT_MENU_CONFIG.contact);
  });

  it('caps each text field so one publish cannot bloat the row', () => {
    const result = normalizeMenuConfig({
      storeName: 'x'.repeat(500),
      subtitle: 'y'.repeat(500),
      footerText: 'z'.repeat(500),
      announcement: 'a'.repeat(500),
      currency: 'b'.repeat(50),
    });

    expect(result.storeName).toHaveLength(CONFIG_LIMITS.storeName);
    expect(result.subtitle).toHaveLength(CONFIG_LIMITS.subtitle);
    expect(result.footerText).toHaveLength(CONFIG_LIMITS.footerText);
    expect(result.announcement).toHaveLength(CONFIG_LIMITS.announcement);
    expect(result.currency).toHaveLength(CONFIG_LIMITS.currency);
  });

  it('drops a category with no id, and de-duplicates the rest', () => {
    const result = normalizeMenuConfig({
      categories: [
        { id: 'Hot Coffee', label: 'قهوة ساخنة', hidden: false },
        { id: '', label: 'بلا معرّف' },
        { id: 'Hot Coffee', label: 'مكرر' },
        'not an object',
        { id: 'Desserts', hidden: true },
      ],
    });

    expect(result.categories).toEqual([
      { id: 'Hot Coffee', label: 'قهوة ساخنة', hidden: false },
      { id: 'Desserts', label: '', hidden: true },
    ]);
  });

  it('caps the category and item lists', () => {
    const manyCategories = Array.from({ length: CONFIG_LIMITS.categories + 20 }, (_, i) => ({
      id: `c${i}`,
    }));
    const manyIds = Array.from({ length: CONFIG_LIMITS.itemIds + 50 }, (_, i) => `i${i}`);

    const result = normalizeMenuConfig({ categories: manyCategories, hiddenItemIds: manyIds });
    expect(result.categories).toHaveLength(CONFIG_LIMITS.categories);
    expect(result.hiddenItemIds).toHaveLength(CONFIG_LIMITS.itemIds);
  });
});

describe('safeImageUrl', () => {
  it('accepts an http(s) URL and an inline image', () => {
    expect(safeImageUrl('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
    expect(safeImageUrl('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('rejects a value that would break out of a CSS url() or run script', () => {
    // The banner is interpolated into `background-image: url(<value>)`, where a quote or a
    // closing paren ends the value and begins a new declaration.
    for (const bad of [
      'https://a.example/x.png") ; background: url("javascript:alert(1)',
      "https://a.example/x.png'",
      'https://a.example/x(1).png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///C:/secrets.png',
      42,
      null,
    ]) {
      expect(safeImageUrl(bad)).toBe('');
    }
  });
});

describe('itemCategoryId', () => {
  it('reads the menu category and ignores the preparation area', () => {
    expect(itemCategoryId({ category: 'Hot Coffee|Bar' })).toBe('Hot Coffee');
  });

  it('treats an empty or catch-all category as uncategorised', () => {
    expect(itemCategoryId({ category: '' })).toBe(UNCATEGORIZED_ID);
    expect(itemCategoryId({ category: 'All|Kitchen' })).toBe(UNCATEGORIZED_ID);
  });
});

describe('itemDisplay', () => {
  it('shows the Arabic name for a seeded English item', () => {
    expect(itemDisplay({ name: 'Cappuccino', description: '' })).toEqual({
      name: 'كابوتشينو',
      description: 'قهوة كلاسيكية مع رغوة حليب كثيفة وغنية.',
    });
  });

  it('keeps the owner description over the built-in one', () => {
    expect(itemDisplay({ name: 'Latte', description: 'وصفنا الخاص' }).description).toBe('وصفنا الخاص');
  });

  it('leaves an unknown name exactly as entered', () => {
    expect(itemDisplay({ name: 'مشاوي مشكلة', description: '' })).toEqual({
      name: 'مشاوي مشكلة',
      description: '',
    });
  });
});

describe('categoryLabel', () => {  it('prefers the owner label over the built-in Arabic name', () => {
    const cfg = config({ categories: [{ id: 'Hot Coffee', label: 'مشروبات ساخنة', hidden: false }] });
    expect(categoryLabel('Hot Coffee', cfg)).toBe('مشروبات ساخنة');
  });

  it('falls back to the built-in name, then to the id', () => {
    expect(categoryLabel('Hot Coffee', config())).toBe('قهوة ساخنة');
    expect(categoryLabel('Shisha', config())).toBe('Shisha');
  });
});

describe('visibleMenuItems', () => {
  it('hides an unavailable item however the flag arrived', () => {
    // SQLite returns a boolean and D1 returns 0/1; the numeric form was compared as a boolean.
    const items = [
      item({ id: 'a' }),
      item({ id: 'b', available: false }),
      item({ id: 'c', available: 0 as unknown as boolean }),
    ];
    expect(visibleMenuItems(items, config()).map(i => i.id)).toEqual(['a']);
  });

  it('hides an individually hidden item and a hidden category', () => {
    const items = [
      item({ id: 'a', category: 'Hot Coffee' }),
      item({ id: 'b', category: 'Hot Coffee' }),
      item({ id: 'c', category: 'Desserts' }),
    ];
    const cfg = config({
      hiddenItemIds: ['b'],
      categories: [{ id: 'Desserts', label: '', hidden: true }],
    });
    expect(visibleMenuItems(items, cfg).map(i => i.id)).toEqual(['a']);
  });

  it('does not change availability, which is what the POS sells on', () => {
    const items = [item({ id: 'a' })];
    const cfg = config({ hiddenItemIds: ['a'] });
    visibleMenuItems(items, cfg);
    expect(items[0].available).toBe(true);
  });
});

describe('mergeCategoryRules', () => {
  it('keeps the stored order and appends a category that appeared since', () => {
    const items = [
      item({ id: 'a', category: 'Desserts' }),
      item({ id: 'b', category: 'Hot Coffee' }),
      item({ id: 'c', category: 'Shisha' }),
    ];
    const cfg = config({
      categories: [
        { id: 'Hot Coffee', label: '', hidden: false },
        { id: 'Desserts', label: '', hidden: false },
      ],
    });

    expect(mergeCategoryRules(items, cfg).map(r => r.id)).toEqual(['Hot Coffee', 'Desserts', 'Shisha']);
  });

  it('drops a stored category that no longer has items', () => {
    const cfg = config({ categories: [{ id: 'Retired', label: '', hidden: false }] });
    expect(mergeCategoryRules([item({ category: 'Hot Coffee' })], cfg).map(r => r.id))
      .toEqual(['Hot Coffee']);
  });
});

describe('visibleCategories', () => {
  it('counts only visible items and omits an emptied category', () => {
    const items = [
      item({ id: 'a', category: 'Hot Coffee' }),
      item({ id: 'b', category: 'Hot Coffee' }),
      item({ id: 'c', category: 'Desserts' }),
    ];
    const cfg = config({ hiddenItemIds: ['c'] });

    expect(visibleCategories(items, cfg)).toEqual([
      { id: 'Hot Coffee', label: 'قهوة ساخنة', count: 2 },
    ]);
  });
});

describe('sortMenuItems', () => {
  const items = [
    item({ id: 'a', name: 'Latte', price: 40, category: 'Hot Coffee' }),
    item({ id: 'b', name: 'Cake', price: 90, category: 'Desserts' }),
    item({ id: 'c', name: 'Americano', price: 25, category: 'Hot Coffee' }),
  ];

  it('sorts by price in each direction', () => {
    expect(sortMenuItems(items, config({ sortOrder: 'price-asc' })).map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(sortMenuItems(items, config({ sortOrder: 'price-desc' })).map(i => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('follows the owner category order rather than the alphabet', () => {
    const cfg = config({
      categories: [
        { id: 'Desserts', label: '', hidden: false },
        { id: 'Hot Coffee', label: '', hidden: false },
      ],
    });
    expect(sortMenuItems(items, cfg).map(i => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('pins featured items first, in the order they were pinned', () => {
    const cfg = config({ sortOrder: 'price-asc', featuredItemIds: ['b', 'a'] });
    expect(sortMenuItems(items, cfg).map(i => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the caller array untouched', () => {
    const original = items.map(i => i.id);
    sortMenuItems(items, config({ sortOrder: 'price-desc' }));
    expect(items.map(i => i.id)).toEqual(original);
  });
});
