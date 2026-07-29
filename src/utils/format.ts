/**
 * Centralised formatting helpers — one place for money, numbers, and phone validation.
 */

const CURRENCY_CODE = 'EGP';

/**
 * Format a monetary amount for display, honouring the active UI language.
 * Uses Intl.NumberFormat so thousands separators and numerals follow the locale.
 */
export function formatMoney(amount: number, lang: 'en' | 'ar' = 'en'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-EG';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: CURRENCY_CODE,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for environments without full ICU data
    const formatted = (Number(amount) || 0).toFixed(2);
    return lang === 'ar' ? `${formatted} ج.م` : `EGP ${formatted}`;
  }
}

/** Format a plain number with locale-appropriate grouping. */
export function formatNumber(value: number, lang: 'en' | 'ar' = 'en'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-EG';
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** Egyptian mobile numbers: 11 digits starting with 01 (e.g. 01012345678). */
const EGYPT_PHONE_REGEX = /^01[0-2,5][0-9]{8}$/;

/** Normalise a phone input (strip spaces/dashes) and return it, or null if invalid. */
export function normalizeEgyptPhone(input: string): string | null {
  const cleaned = String(input || '').replace(/[\s\-()]/g, '');
  return EGYPT_PHONE_REGEX.test(cleaned) ? cleaned : null;
}

/** True when the input is a valid Egyptian mobile number. */
export function isValidEgyptPhone(input: string): boolean {
  return normalizeEgyptPhone(input) !== null;
}
