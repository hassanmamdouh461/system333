/**
 * Default categories the cashier can filter by if no items exist yet.
 */
export const DEFAULT_POS_CATEGORIES = ['All'] as const;

export const POS_CATEGORIES = DEFAULT_POS_CATEGORIES;

export type PosCategory = string;
