/**
 * Categories the cashier can filter by: everything, or one of the two preparation
 * destinations a menu item can be routed to.
 */
export const POS_CATEGORIES = ['All', 'Bar', 'Kitchen'] as const;

export type PosCategory = (typeof POS_CATEGORIES)[number];
