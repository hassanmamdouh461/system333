import { describe, it, expect } from 'vitest';
import { getItemSection, filterItemsBySection } from './orderSection';

describe('getItemSection', () => {
  it('routes Bar/Drinks categories to drinks', () => {
    expect(getItemSection('Hot Coffee|Bar', 'إسبيريسو')).toBe('drinks');
    expect(getItemSection('Iced Coffee|Drinks', 'Iced Latte')).toBe('drinks');
  });

  it('routes Kitchen categories to kitchen', () => {
    expect(getItemSection('Kitchen|Kitchen', 'Club Sandwich')).toBe('kitchen');
  });

  it('falls back to name keywords for legacy categories', () => {
    expect(getItemSection('Misc', 'Caramel Latte')).toBe('drinks');
    expect(getItemSection('Misc', 'Grilled Panini')).toBe('kitchen');
  });
});

describe('filterItemsBySection', () => {
  const items = [
    { id: '1', name: 'Latte', quantity: 1, price: 50, category: 'Hot Coffee|Bar' },
    { id: '2', name: 'Croissant', quantity: 1, price: 40, category: 'Kitchen|Kitchen' },
  ];

  it('returns everything for "all"', () => {
    expect(filterItemsBySection(items as any, 'all')).toHaveLength(2);
  });

  it('splits drinks from kitchen items', () => {
    expect(filterItemsBySection(items as any, 'drinks')).toHaveLength(1);
    expect(filterItemsBySection(items as any, 'kitchen')).toHaveLength(1);
  });
});
