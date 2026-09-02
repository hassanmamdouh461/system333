import { describe, it, expect } from 'vitest';
import {
  costRecipes,
  draftRecipeCost,
  groupRecipesByInventoryItem,
  groupRecipesByMenuItem,
  summarizeRecipes,
} from './recipeMath';
import { InventoryItem, RecipeIngredient } from '../global';
import { MenuItem } from '../types/menu';

function material(
  id: string,
  overrides: Partial<InventoryItem> = {}
): InventoryItem {
  return {
    id,
    name: id,
    unit: 'kg',
    stock: 10,
    minStock: 1,
    costPerUnit: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function product(id: string, price: number, name = id): MenuItem {
  return {
    id,
    name,
    description: '',
    price,
    category: 'Hot Coffee|Bar',
    image: '',
    available: true,
  };
}

function line(
  menuItemId: string,
  inventoryItemId: string,
  quantity: number
): RecipeIngredient {
  return { menuItemId, inventoryItemId, quantity };
}

describe('groupRecipesByMenuItem', () => {
  it('groups every line under its menu item', () => {
    const grouped = groupRecipesByMenuItem([
      line('m1', 'beans', 0.02),
      line('m1', 'cups', 1),
      line('m2', 'beans', 0.01),
    ]);

    expect(grouped.get('m1')).toHaveLength(2);
    expect(grouped.get('m2')).toHaveLength(1);
  });

  it('drops a line with no menu item, since it cannot be costed', () => {
    const grouped = groupRecipesByMenuItem([
      { inventoryItemId: 'beans', quantity: 0.02 },
      line('m1', 'cups', 1),
    ]);

    expect(grouped.size).toBe(1);
    expect(grouped.has('m1')).toBe(true);
  });
});

describe('groupRecipesByInventoryItem', () => {
  it('keeps a raw material used by several products', () => {
    const grouped = groupRecipesByInventoryItem([
      line('m1', 'beans', 0.02),
      line('m2', 'beans', 0.01),
      line('m2', 'milk', 0.2),
    ]);

    expect(grouped.get('beans')).toHaveLength(2);
    expect(grouped.get('milk')).toHaveLength(1);
  });

  it('keeps a line with no menu item, because the material is still referenced', () => {
    const grouped = groupRecipesByInventoryItem([
      { inventoryItemId: 'beans', quantity: 0.02 },
    ]);

    expect(grouped.get('beans')).toHaveLength(1);
  });
});

describe('costRecipes', () => {
  it('sums cost per portion and derives profit and margin', () => {
    const [costing] = costRecipes(
      [product('m1', 50)],
      [line('m1', 'beans', 0.1), line('m1', 'cups', 1)],
      [material('beans', { costPerUnit: 200 }), material('cups', { costPerUnit: 2 })]
    );

    expect(costing.cost).toBeCloseTo(22);
    expect(costing.profit).toBeCloseTo(28);
    expect(costing.marginPercent).toBeCloseTo(56);
    expect(costing.ingredientCount).toBe(2);
  });

  it('reports a negative profit when a recipe costs more than its price', () => {
    const [costing] = costRecipes(
      [product('m1', 10)],
      [line('m1', 'beans', 0.1)],
      [material('beans', { costPerUnit: 500 })]
    );

    expect(costing.cost).toBeCloseTo(50);
    expect(costing.profit).toBeCloseTo(-40);
    expect(costing.marginPercent).toBeCloseTo(-400);
  });

  it('limits buildable portions by the scarcest ingredient and names it', () => {
    const [costing] = costRecipes(
      [product('m1', 50)],
      [line('m1', 'beans', 0.1), line('m1', 'cups', 1)],
      [
        material('beans', { stock: 5 }), // 50 portions
        material('cups', { name: 'Paper Cups', stock: 8, unit: 'piece' }), // 8 portions
      ]
    );

    expect(costing.buildablePortions).toBe(8);
    expect(costing.limitingItemId).toBe('cups');
    expect(costing.limitingItemName).toBe('Paper Cups');
  });

  it('floors partial portions, since half a drink cannot be sold', () => {
    const [costing] = costRecipes(
      [product('m1', 50)],
      [line('m1', 'beans', 0.3)],
      [material('beans', { stock: 1 })]
    );

    expect(costing.buildablePortions).toBe(3);
  });

  it('distinguishes an unmapped item from one that can build nothing', () => {
    const [unmapped, empty] = costRecipes(
      [product('m1', 50), product('m2', 50)],
      [line('m2', 'beans', 1)],
      [material('beans', { stock: 0 })]
    );

    expect(unmapped.ingredientCount).toBe(0);
    expect(unmapped.buildablePortions).toBeNull();
    expect(empty.buildablePortions).toBe(0);
  });

  it('skips a line whose material is missing rather than costing it as free', () => {
    const [costing] = costRecipes(
      [product('m1', 50)],
      [line('m1', 'beans', 0.1), line('m1', 'deleted-item', 5)],
      [material('beans', { costPerUnit: 100 })]
    );

    expect(costing.ingredientCount).toBe(1);
    expect(costing.cost).toBeCloseTo(10);
  });

  it('ignores a zero quantity line, which would divide by zero', () => {
    const [costing] = costRecipes(
      [product('m1', 50)],
      [line('m1', 'beans', 0)],
      [material('beans')]
    );

    expect(costing.ingredientCount).toBe(0);
    expect(costing.buildablePortions).toBeNull();
  });

  it('reports zero margin for a free item instead of dividing by zero', () => {
    const [costing] = costRecipes(
      [product('m1', 0)],
      [line('m1', 'beans', 0.1)],
      [material('beans', { costPerUnit: 100 })]
    );

    expect(costing.marginPercent).toBe(0);
    expect(costing.profit).toBeCloseTo(-10);
  });
});

describe('summarizeRecipes', () => {
  it('counts mapped, unmapped, out of stock and unprofitable items', () => {
    const costings = costRecipes(
      [product('m1', 50), product('m2', 10), product('m3', 50), product('m4', 50)],
      [
        line('m1', 'beans', 0.1), // healthy
        line('m2', 'beans', 0.1), // costs 20, sells for 10
        line('m3', 'cups', 1), // no stock left
      ],
      [
        material('beans', { stock: 10, costPerUnit: 200 }),
        material('cups', { stock: 0, costPerUnit: 2 }),
      ]
    );

    const summary = summarizeRecipes(costings);
    expect(summary.mappedCount).toBe(3);
    expect(summary.unmappedCount).toBe(1);
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.losingMoneyCount).toBe(1);
  });

  it('averages margin over mapped priced items only', () => {
    const costings = costRecipes(
      [product('m1', 100), product('m2', 100), product('m3', 100)],
      [line('m1', 'beans', 0.1), line('m2', 'beans', 0.2)],
      [material('beans', { costPerUnit: 100 })]
    );

    // 90% and 80%, with the unmapped third item excluded.
    expect(summarizeRecipes(costings).averageMarginPercent).toBeCloseTo(85);
  });

  it('returns zeroes for an empty catalogue', () => {
    expect(summarizeRecipes([])).toEqual({
      mappedCount: 0,
      unmappedCount: 0,
      outOfStockCount: 0,
      losingMoneyCount: 0,
      averageMarginPercent: 0,
    });
  });
});

describe('draftRecipeCost', () => {
  it('totals the cost of the lines being edited', () => {
    const cost = draftRecipeCost(
      [
        { inventoryItemId: 'beans', quantity: 0.02 },
        { inventoryItemId: 'cups', quantity: 1 },
      ],
      [material('beans', { costPerUnit: 500 }), material('cups', { costPerUnit: 3 })]
    );

    expect(cost).toBeCloseTo(13);
  });

  it('ignores a line whose material is not in the list', () => {
    expect(
      draftRecipeCost([{ inventoryItemId: 'ghost', quantity: 5 }], [material('beans')])
    ).toBe(0);
  });
});
