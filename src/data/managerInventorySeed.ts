/**
 * Fallback catalogue for the manager dashboard.
 *
 * Used only when the central database returns no stock rows or no recipes, so the
 * inventory tab can still show consumption instead of an empty table. Live rows always
 * take precedence.
 */

export interface ManagerInventoryItem {
  id: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  unitAr: string;
  costPerUnit: number;
  startingStock: Record<string, number>;
  minStock: number;
}

/** Quantity of each stock item consumed by one unit of a menu product. */
export type ItemRecipes = Record<string, Record<string, number>>;

/** Opening stock per item id, used to derive consumption from the current level. */
export const INITIAL_STOCKS: Record<string, number> = {
  'inv-beans': 50.0,
  'inv-milk': 100.0,
  'inv-sugar': 50.0,
  'inv-caramel': 20.0,
  'inv-vanilla': 20.0,
  'inv-cups': 1000.0,
  'inv-beef': 200.0,
  'inv-buns': 200.0,
  'inv-cheese': 300.0,
  'inv-fries': 100.0,
  'inv-chicken': 80.0,
  'inv-bread': 500.0,
  'inv-lettuce': 30.0,
  'inv-tomato': 40.0,
  'inv-mayo': 15.0,
  'inv-croissant': 150.0,
  'inv-turkey': 200.0,
  'inv-mozzarella': 25.0,
  'inv-flour': 50.0,
  'inv-chocolate': 30.0,
  'inv-tea': 15.0,
  'inv-peach': 10.0,
  'inv-mint': 5.0,
  'inv-lemon': 500.0,
  'inv-soda': 120.0,
  'inv-passion': 10.0,
  'inv-oreo': 800.0,
  'inv-strawberry': 20.0,
  'inv-mango': 25.0,
  'inv-icecream': 40.0,
};

export const FALLBACK_INVENTORY_ITEMS: ManagerInventoryItem[] = [
  { id: 'inv-beans', nameAr: 'حبوب القهوة إسبريسو', nameEn: 'Espresso Coffee Beans', unit: 'kg', unitAr: 'كجم', costPerUnit: 25.00, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
  { id: 'inv-milk', nameAr: 'حليب كامل الدسم', nameEn: 'Whole Milk', unit: 'liter', unitAr: 'لتر', costPerUnit: 1.50, startingStock: { branch_1: 100.0, branch_2: 100.0, branch_3: 100.0 }, minStock: 10.0 },
  { id: 'inv-sugar', nameAr: 'سكر أبيض', nameEn: 'White Sugar', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.10, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
  { id: 'inv-caramel', nameAr: 'صوص كراميل', nameEn: 'Caramel Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 12.00, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
  { id: 'inv-vanilla', nameAr: 'سيروب فانيليا', nameEn: 'Vanilla Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 12.00, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
  { id: 'inv-cups', nameAr: 'أكواب ورقية (12 أونص)', nameEn: 'Paper Cups (12oz)', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.15, startingStock: { branch_1: 1000.0, branch_2: 1000.0, branch_3: 1000.0 }, minStock: 100.0 },
  { id: 'inv-beef', nameAr: 'شريحة لحم بقري بريميوم (150 جم)', nameEn: 'Prime Beef Patty (150g)', unit: 'piece', unitAr: 'قطعة', costPerUnit: 2.50, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
  { id: 'inv-buns', nameAr: 'خبز البرجر', nameEn: 'Burger Buns', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.50, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
  { id: 'inv-cheese', nameAr: 'شرائح جبن شيدر', nameEn: 'Cheddar Cheese Slices', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.30, startingStock: { branch_1: 300.0, branch_2: 300.0, branch_3: 300.0 }, minStock: 30.0 },
  { id: 'inv-fries', nameAr: 'بطاطس مقلية', nameEn: 'Potato Fries', unit: 'kg', unitAr: 'كجم', costPerUnit: 2.00, startingStock: { branch_1: 100.0, branch_2: 100.0, branch_3: 100.0 }, minStock: 10.0 },
  { id: 'inv-chicken', nameAr: 'صدور دجاج', nameEn: 'Chicken Breast', unit: 'kg', unitAr: 'كجم', costPerUnit: 4.50, startingStock: { branch_1: 80.0, branch_2: 80.0, branch_3: 80.0 }, minStock: 10.0 },
  { id: 'inv-bread', nameAr: 'توست خبز', nameEn: 'Bread Toast', unit: 'slice', unitAr: 'شريحة', costPerUnit: 0.05, startingStock: { branch_1: 500.0, branch_2: 500.0, branch_3: 500.0 }, minStock: 5.0 },
  { id: 'inv-lettuce', nameAr: 'خس', nameEn: 'Lettuce', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.20, startingStock: { branch_1: 30.0, branch_2: 30.0, branch_3: 30.0 }, minStock: 5.0 },
  { id: 'inv-tomato', nameAr: 'طماطم', nameEn: 'Tomato', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.00, startingStock: { branch_1: 40.0, branch_2: 40.0, branch_3: 40.0 }, minStock: 5.0 },
  { id: 'inv-mayo', nameAr: 'مايونيز', nameEn: 'Mayonnaise', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.00, startingStock: { branch_1: 15.0, branch_2: 15.0, branch_3: 15.0 }, minStock: 2.0 },
  { id: 'inv-croissant', nameAr: 'كرواسون سادة', nameEn: 'Croissant Plain', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.80, startingStock: { branch_1: 150.0, branch_2: 150.0, branch_3: 150.0 }, minStock: 15.0 },
  { id: 'inv-turkey', nameAr: 'شريحة ديك رومي', nameEn: 'Turkey Slice', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.40, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
  { id: 'inv-mozzarella', nameAr: 'جبن موزاريلا', nameEn: 'Mozzarella', unit: 'kg', unitAr: 'كجم', costPerUnit: 6.00, startingStock: { branch_1: 25.0, branch_2: 25.0, branch_3: 25.0 }, minStock: 3.0 },
  { id: 'inv-flour', nameAr: 'دقيق', nameEn: 'Flour', unit: 'kg', unitAr: 'كجم', costPerUnit: 0.80, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
  { id: 'inv-chocolate', nameAr: 'شوكولاتة فادج', nameEn: 'Chocolate Fudge', unit: 'kg', unitAr: 'كجم', costPerUnit: 5.00, startingStock: { branch_1: 30.0, branch_2: 30.0, branch_3: 30.0 }, minStock: 3.0 },
  { id: 'inv-tea', nameAr: 'أوراق شاي', nameEn: 'Tea Leaves', unit: 'kg', unitAr: 'كجم', costPerUnit: 8.00, startingStock: { branch_1: 15.0, branch_2: 15.0, branch_3: 15.0 }, minStock: 2.0 },
  { id: 'inv-peach', nameAr: 'سيروب خوخ', nameEn: 'Peach Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 10.00, startingStock: { branch_1: 10.0, branch_2: 10.0, branch_3: 10.0 }, minStock: 1.0 },
  { id: 'inv-mint', nameAr: 'أوراق نعناع', nameEn: 'Mint Leaves', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.00, startingStock: { branch_1: 5.0, branch_2: 5.0, branch_3: 5.0 }, minStock: 0.5 },
  { id: 'inv-lemon', nameAr: 'ليمون', nameEn: 'Lemon', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.10, startingStock: { branch_1: 500.0, branch_2: 500.0, branch_3: 500.0 }, minStock: 50.0 },
  { id: 'inv-soda', nameAr: 'مياه صودا', nameEn: 'Soda Water', unit: 'liter', unitAr: 'لتر', costPerUnit: 0.50, startingStock: { branch_1: 120.0, branch_2: 120.0, branch_3: 120.0 }, minStock: 12.0 },
  { id: 'inv-passion', nameAr: 'سيروب فواكه الاستوائية', nameEn: 'Passion Fruit Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 15.00, startingStock: { branch_1: 10.0, branch_2: 10.0, branch_3: 10.0 }, minStock: 1.0 },
  { id: 'inv-oreo', nameAr: 'بسكويت أوريو', nameEn: 'Oreo Biscuits', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.20, startingStock: { branch_1: 800.0, branch_2: 800.0, branch_3: 800.0 }, minStock: 50.0 },
  { id: 'inv-strawberry', nameAr: 'فراولة', nameEn: 'Strawberry', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.50, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
  { id: 'inv-mango', nameAr: 'مانجو', nameEn: 'Mango', unit: 'kg', unitAr: 'كجم', costPerUnit: 4.00, startingStock: { branch_1: 25.0, branch_2: 25.0, branch_3: 25.0 }, minStock: 2.0 },
  { id: 'inv-icecream', nameAr: 'أيس كريم فانيليا', nameEn: 'Vanilla Ice Cream', unit: 'kg', unitAr: 'كجم', costPerUnit: 6.00, startingStock: { branch_1: 40.0, branch_2: 40.0, branch_3: 40.0 }, minStock: 5.0 }
];

export const FALLBACK_ITEM_RECIPES: ItemRecipes = {
  'Espresso': { 'inv-beans': 0.009, 'inv-cups': 1 },
  'Double Espresso': { 'inv-beans': 0.018, 'inv-cups': 1 },
  'Cortado': { 'inv-beans': 0.012, 'inv-milk': 0.05, 'inv-cups': 1 },
  'Flat White': { 'inv-beans': 0.018, 'inv-milk': 0.12, 'inv-cups': 1 },
  'Cafe Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-cups': 1 },
  'Cappuccino': { 'inv-beans': 0.015, 'inv-milk': 0.18, 'inv-cups': 1 },
  'Spanish Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-cups': 1 },
  'Americano': { 'inv-beans': 0.015, 'inv-cups': 1 },
  'Cafe Mocha': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-chocolate': 0.02, 'inv-cups': 1 },
  'Turkish Coffee': { 'inv-beans': 0.008, 'inv-cups': 1 },
  'French Coffee': { 'inv-beans': 0.008, 'inv-milk': 0.10, 'inv-cups': 1 },
  'Iced Americano': { 'inv-beans': 0.015, 'inv-cups': 1 },
  'Iced Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-cups': 1 },
  'Iced Spanish Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-cups': 1 },
  'Iced Caramel Macchiato': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-vanilla': 0.01, 'inv-cups': 1 },
  'Iced Mocha': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-chocolate': 0.02, 'inv-cups': 1 },
  'Cold Brew': { 'inv-beans': 0.020, 'inv-cups': 1 },
  'Iced Pistachio Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-vanilla': 0.02, 'inv-cups': 1 },
  'Mocha Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-chocolate': 0.03, 'inv-icecream': 0.05, 'inv-cups': 1 },
  'Caramel Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-caramel': 0.03, 'inv-icecream': 0.05, 'inv-cups': 1 },
  'Coffee Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-icecream': 0.05, 'inv-cups': 1 },
  'Oreo Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-oreo': 3, 'inv-cups': 1 },
  'Oreo Milkshake': { 'inv-milk': 0.25, 'inv-oreo': 4, 'inv-icecream': 0.10, 'inv-cups': 1 },
  'Strawberry Milkshake': { 'inv-milk': 0.20, 'inv-strawberry': 0.10, 'inv-icecream': 0.10, 'inv-cups': 1 },
  'Chocolate Milkshake': { 'inv-milk': 0.20, 'inv-chocolate': 0.03, 'inv-icecream': 0.10, 'inv-cups': 1 },
  'Vanilla Milkshake': { 'inv-milk': 0.20, 'inv-vanilla': 0.02, 'inv-icecream': 0.15, 'inv-cups': 1 },
  'Mango Milkshake': { 'inv-milk': 0.20, 'inv-mango': 0.10, 'inv-icecream': 0.10, 'inv-cups': 1 },
  'Green Tea': { 'inv-tea': 0.005, 'inv-cups': 1 },
  'Karak Tea': { 'inv-tea': 0.006, 'inv-milk': 0.05, 'inv-cups': 1 },
  'Mint Lemonade': { 'inv-lemon': 2, 'inv-mint': 0.01, 'inv-soda': 0.20, 'inv-cups': 1 },
  'Peach Iced Tea': { 'inv-tea': 0.005, 'inv-peach': 0.03, 'inv-cups': 1 },
  'Passion Fruit Mojito': { 'inv-lemon': 1, 'inv-mint': 0.01, 'inv-passion': 0.03, 'inv-soda': 0.25, 'inv-cups': 1 },
  'Classic Club Sandwich': { 'inv-bread': 3, 'inv-chicken': 0.10, 'inv-lettuce': 0.02, 'inv-tomato': 0.03, 'inv-mayo': 0.01 },
  'Prime Beef Cheeseburger': { 'inv-beef': 1, 'inv-buns': 1, 'inv-cheese': 1, 'inv-lettuce': 0.01, 'inv-tomato': 0.02 },
  'Chicken Pane Sandwich': { 'inv-chicken': 0.12, 'inv-bread': 2, 'inv-lettuce': 0.01, 'inv-cheese': 1, 'inv-mayo': 0.01 },
  'Turkey & Cheese Croissant': { 'inv-croissant': 1, 'inv-turkey': 2, 'inv-cheese': 1 },
  'Grilled Cheese Sandwich': { 'inv-bread': 2, 'inv-cheese': 2, 'inv-mozzarella': 0.05 },
  'Cheese Fries': { 'inv-fries': 0.20, 'inv-cheese': 1 },
  'Chocolate Fudge Cake': { 'inv-flour': 0.05, 'inv-chocolate': 0.04, 'inv-sugar': 0.03 },
  'Warm Chocolate Brownie': { 'inv-flour': 0.03, 'inv-chocolate': 0.03, 'inv-icecream': 0.05 }
};
