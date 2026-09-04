export type UnitCategory = 'weight' | 'volume' | 'count';

export interface UnitDefinition {
  id: string;
  category: UnitCategory;
  baseRatio: number;
  labelAr: string;
  labelEn: string;
}

export const SUPPORTED_UNITS: UnitDefinition[] = [
  // Weights (base: g)
  { id: 'g', category: 'weight', baseRatio: 1, labelAr: 'جرام (g)', labelEn: 'g (Grams)' },
  { id: 'kg', category: 'weight', baseRatio: 1000, labelAr: 'كجم (kg)', labelEn: 'kg (Kilograms)' },

  // Volumes (base: ml)
  { id: 'ml', category: 'volume', baseRatio: 1, labelAr: 'مل (ml)', labelEn: 'ml (Milliliters)' },
  { id: 'liter', category: 'volume', baseRatio: 1000, labelAr: 'لتر (L)', labelEn: 'liter (Liters)' },
  { id: 'cup', category: 'volume', baseRatio: 240, labelAr: 'كوب (Cup)', labelEn: 'cup (Cup)' },
  { id: 'shot', category: 'volume', baseRatio: 30, labelAr: 'شوت (Shot)', labelEn: 'shot (Shot)' },

  // Count / Discrete (base: piece)
  { id: 'piece', category: 'count', baseRatio: 1, labelAr: 'قطعة (Piece)', labelEn: 'piece' },
  { id: 'portion', category: 'count', baseRatio: 1, labelAr: 'حصة / وجبة', labelEn: 'portion' },
  { id: 'can', category: 'count', baseRatio: 1, labelAr: 'علبة / كانز', labelEn: 'can' },
];

export const UNIT_MAP = new Map<string, UnitDefinition>(
  SUPPORTED_UNITS.map(u => [u.id.toLowerCase(), u])
);

export function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return 'piece';
  const u = rawUnit.trim().toLowerCase();
  if (u === 'kg' || u === 'كجم' || u === 'كيلو' || u === 'كيلوجرام') return 'kg';
  if (u === 'g' || u === 'gm' || u === 'جرام' || u === 'جم') return 'g';
  if (u === 'liter' || u === 'l' || u === 'لتر' || u === 'ليتر') return 'liter';
  if (u === 'ml' || u === 'مل' || u === 'ملل' || u === 'مليلتر') return 'ml';
  if (u === 'piece' || u === 'قطعة' || u === 'حبه' || u === 'حبة') return 'piece';
  if (u === 'portion' || u === 'وجبة' || u === 'حصة') return 'portion';
  if (u === 'cup' || u === 'كوب' || u === 'كوبايه') return 'cup';
  if (u === 'shot' || u === 'شوت') return 'shot';
  if (u === 'can' || u === 'علبة' || u === 'كانز') return 'can';
  return u;
}

export function convertToBaseQuantity(
  amount: number,
  displayUnit: string,
  baseInventoryUnit: string
): number {
  if (!amount || isNaN(amount) || amount <= 0) return 0;
  const from = UNIT_MAP.get(normalizeUnit(displayUnit));
  const to = UNIT_MAP.get(normalizeUnit(baseInventoryUnit));

  if (!from || !to) return amount;
  if (from.id === to.id) return amount;

  if (from.category === 'weight' && to.category === 'weight') {
    return (amount * from.baseRatio) / to.baseRatio;
  }

  if (from.category === 'volume' && to.category === 'volume') {
    return (amount * from.baseRatio) / to.baseRatio;
  }

  if (
    (from.category === 'weight' && to.category === 'volume') ||
    (from.category === 'volume' && to.category === 'weight')
  ) {
    return (amount * from.baseRatio) / to.baseRatio;
  }

  return amount;
}

export function convertFromBaseQuantity(
  baseAmount: number,
  baseInventoryUnit: string,
  targetDisplayUnit: string
): number {
  if (!baseAmount || isNaN(baseAmount) || baseAmount <= 0) return 0;
  const from = UNIT_MAP.get(normalizeUnit(baseInventoryUnit));
  const to = UNIT_MAP.get(normalizeUnit(targetDisplayUnit));

  if (!from || !to) return baseAmount;
  if (from.id === to.id) return baseAmount;

  if (
    from.category === to.category ||
    (from.category === 'weight' && to.category === 'volume') ||
    (from.category === 'volume' && to.category === 'weight')
  ) {
    return (baseAmount * from.baseRatio) / to.baseRatio;
  }

  return baseAmount;
}

export function getInitialDisplayUnitAndQty(
  baseQty: number,
  rawBaseUnit: string
): { displayQty: number; displayUnit: string } {
  const norm = normalizeUnit(rawBaseUnit);
  if (norm === 'kg') {
    if (baseQty > 0 && baseQty < 1) {
      return {
        displayQty: Math.round(baseQty * 1000 * 1000) / 1000,
        displayUnit: 'g',
      };
    }
    return {
      displayQty: baseQty,
      displayUnit: baseQty === 0 ? 'g' : 'kg',
    };
  }
  if (norm === 'liter') {
    if (baseQty > 0 && baseQty < 1) {
      return {
        displayQty: Math.round(baseQty * 1000 * 1000) / 1000,
        displayUnit: 'ml',
      };
    }
    return {
      displayQty: baseQty,
      displayUnit: baseQty === 0 ? 'ml' : 'liter',
    };
  }
  return {
    displayQty: baseQty,
    displayUnit: norm,
  };
}
