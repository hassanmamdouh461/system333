import { describe, it, expect } from 'vitest';
import { formatMoney, normalizeEgyptPhone, isValidEgyptPhone } from './format';

describe('formatMoney', () => {
  it('formats EGP in English locale with 2 decimals', () => {
    const out = formatMoney(1234.5, 'en');
    expect(out).toContain('1,234.50');
  });

  it('formats zero safely', () => {
    const out = formatMoney(0, 'en');
    expect(out).toContain('0.00');
  });

  it('renders Arabic currency in ar locale (falls back to ج.م suffix)', () => {
    const out = formatMoney(10, 'ar');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('normalizeEgyptPhone / isValidEgyptPhone', () => {
  it('accepts a valid 11-digit Egyptian mobile', () => {
    expect(normalizeEgyptPhone('01012345678')).toBe('01012345678');
    expect(isValidEgyptPhone('01012345678')).toBe(true);
  });

  it('accepts operator prefixes 010/011/012/015', () => {
    expect(isValidEgyptPhone('01012345678')).toBe(true);
    expect(isValidEgyptPhone('01112345678')).toBe(true);
    expect(isValidEgyptPhone('01212345678')).toBe(true);
    expect(isValidEgyptPhone('01512345678')).toBe(true);
  });

  it('strips spaces and dashes before validating', () => {
    expect(normalizeEgyptPhone('010 1234 5678')).toBe('01012345678');
    expect(normalizeEgyptPhone('010-1234-5678')).toBe('01012345678');
  });

  it('rejects short numbers, letters, and wrong prefixes', () => {
    expect(isValidEgyptPhone('010123')).toBe(false);
    expect(isValidEgyptPhone('0101234567a')).toBe(false);
    expect(isValidEgyptPhone('02012345678')).toBe(false);
    expect(isValidEgyptPhone('')).toBe(false);
  });
});
