import { describe, it, expect } from 'vitest';
import validate from '../validate.cjs';

const {
  ValidationError,
  validateNewOrder,
  validateOrderItems,
  validateOrderUpdate,
  validateMenuItem,
  validateInventoryItem,
  validateStockMovement,
  validateCustomer,
  validateRecipe,
  validateSettingValue,
  requirePhone,
  requireId,
  requireMoney,
  MAX_ORDER_ITEMS,
  MAX_MONEY,
} = validate;

/** A minimal valid order, so each test can vary one field. */
function order(overrides = {}) {
  return {
    tableId: 'Takeaway',
    items: [{ id: 'm1', name: 'Latte', price: 60, quantity: 2 }],
    totalAmount: 132,
    ...overrides,
  };
}

describe('order items', () => {
  it('accepts a well-formed line', () => {
    const [item] = validateOrderItems([{ id: 'm1', name: 'Latte', price: 60, quantity: 2 }]);
    expect(item).toMatchObject({ id: 'm1', name: 'Latte', price: 60, quantity: 2 });
  });

  it('rejects a price that is not a finite number', () => {
    // One NaN stored in a money column turns every later SUM into NaN on screen.
    for (const price of ['abc', NaN, Infinity, {}, null]) {
      expect(() => validateOrderItems([{ id: 'm1', name: 'Latte', price, quantity: 1 }])).toThrow();
    }
  });

  it('rejects a quantity of zero or below', () => {
    // A negative quantity would credit stock instead of consuming it.
    expect(() => validateOrderItems([{ id: 'm1', name: 'x', price: 5, quantity: 0 }])).toThrow(/quantity/);
    expect(() => validateOrderItems([{ id: 'm1', name: 'x', price: 5, quantity: -3 }])).toThrow(/quantity/);
  });

  it('rejects a negative price', () => {
    expect(() => validateOrderItems([{ id: 'm1', name: 'x', price: -5, quantity: 1 }])).toThrow(/price/);
  });

  it('requires at least one line', () => {
    expect(() => validateOrderItems([])).toThrow(/at least one/);
  });

  it('rejects a batch over the cap', () => {
    const many = new Array(MAX_ORDER_ITEMS + 1).fill({ id: 'm1', name: 'x', price: 1, quantity: 1 });
    expect(() => validateOrderItems(many)).toThrow(/at most/);
  });

  it('rejects a non-array', () => {
    expect(() => validateOrderItems('Latte')).toThrow(/array/);
    expect(() => validateOrderItems(undefined)).toThrow(/array/);
  });

  it('names the offending line in the message', () => {
    expect(() => validateOrderItems([
      { id: 'm1', name: 'ok', price: 5, quantity: 1 },
      { id: 'm2', name: 'bad', price: 'x', quantity: 1 },
    ])).toThrow(/items\[1\]\.price/);
  });
});

describe('validateNewOrder', () => {
  it('accepts a complete order and normalises it', () => {
    const result = validateNewOrder(order({
      subtotal: 120, taxRate: 0.1, taxAmount: 12, grandTotal: 132,
      paymentStatus: 'Paid', paymentMethod: 'Cash',
    }));
    expect(result.status).toBe('New');
    expect(result.pointsEarned).toBe(0);
    expect(result.items).toHaveLength(1);
  });

  it('requires a payment method once an order is marked paid', () => {
    // Without it the payment-method breakdown silently attributes the sale to cash.
    expect(() => validateNewOrder(order({ paymentStatus: 'Paid' }))).toThrow(/paymentMethod/);
  });

  it('requires a customer when points are redeemed', () => {
    expect(() => validateNewOrder(order({ pointsRedeemed: 10 }))).toThrow(/customerPhone/);
  });

  it('rejects a tax rate expressed as a percentage', () => {
    // 14 would mean a 1400% tax; the field is a fraction.
    expect(() => validateNewOrder(order({ taxRate: 14 }))).toThrow(/taxRate/);
    expect(validateNewOrder(order({ taxRate: 0.14 })).taxRate).toBe(0.14);
  });

  it('rejects an unknown status or payment status', () => {
    expect(() => validateNewOrder(order({ status: 'Shipped' }))).toThrow(/status/);
    expect(() => validateNewOrder(order({ paymentStatus: 'Partial' }))).toThrow(/paymentStatus/);
  });

  it('rejects a money figure beyond the sanity ceiling', () => {
    expect(() => validateNewOrder(order({ totalAmount: MAX_MONEY + 1 }))).toThrow(/totalAmount/);
  });

  it('requires a table identifier', () => {
    expect(() => validateNewOrder(order({ tableId: '' }))).toThrow(/tableId/);
    expect(() => validateNewOrder(order({ tableId: '   ' }))).toThrow(/tableId/);
  });

  it('normalises a customer phone to digits', () => {
    const result = validateNewOrder(order({ customerPhone: ' 010-1234-5678 ' }));
    expect(result.customerPhone).toBe('01012345678');
  });

  it('marks its failures as caller errors', () => {
    // The IPC layer answers a validation failure differently from an internal one.
    try {
      validateNewOrder(order({ tableId: '' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.isValidation).toBe(true);
    }
  });
});

describe('validateOrderUpdate', () => {
  it('returns only the keys present', () => {
    expect(validateOrderUpdate({ status: 'Ready' })).toEqual({ status: 'Ready' });
  });

  it('rejects an empty payload rather than issuing a no-op write', () => {
    expect(() => validateOrderUpdate({})).toThrow(/no known fields/);
    expect(() => validateOrderUpdate({ unknownField: 1 })).toThrow(/no known fields/);
  });

  it('validates the fields it does accept', () => {
    expect(() => validateOrderUpdate({ totalAmount: -1 })).toThrow(/totalAmount/);
    expect(() => validateOrderUpdate({ status: 'Nope' })).toThrow(/status/);
  });
});

describe('validateStockMovement', () => {
  it('accepts a positive movement of a known type', () => {
    expect(validateStockMovement({ itemId: 'inv-1', type: 'IN', quantity: 5 }))
      .toMatchObject({ itemId: 'inv-1', type: 'IN', quantity: 5 });
  });

  it('rejects a signed quantity', () => {
    // Direction comes from the type. An "IN" of -5 would read as a delivery in the ledger
    // while actually removing stock.
    expect(() => validateStockMovement({ itemId: 'inv-1', type: 'IN', quantity: -5 })).toThrow(/quantity/);
  });

  it('rejects an unknown movement type', () => {
    expect(() => validateStockMovement({ itemId: 'inv-1', type: 'TRANSFER', quantity: 5 })).toThrow(/type/);
  });

  it('requires an item', () => {
    expect(() => validateStockMovement({ type: 'IN', quantity: 5 })).toThrow(/itemId/);
  });
});

describe('validateInventoryItem', () => {
  it('accepts a complete item', () => {
    expect(validateInventoryItem({ name: 'Beans', unit: 'kg', stock: 10, minStock: 2, costPerUnit: 25 }))
      .toMatchObject({ name: 'Beans', unit: 'kg', stock: 10 });
  });

  it('rejects a negative stock level or cost', () => {
    expect(() => validateInventoryItem({ name: 'B', unit: 'kg', stock: -1, minStock: 0, costPerUnit: 1 })).toThrow(/stock/);
    expect(() => validateInventoryItem({ name: 'B', unit: 'kg', stock: 1, minStock: 0, costPerUnit: -1 })).toThrow(/costPerUnit/);
  });

  it('rejects a NaN cost', () => {
    expect(() => validateInventoryItem({ name: 'B', unit: 'kg', stock: 1, minStock: 0, costPerUnit: 'free' })).toThrow(/costPerUnit/);
  });
});

describe('validateMenuItem', () => {
  it('accepts a complete item and defaults availability', () => {
    const item = validateMenuItem({ name: 'Latte', price: 60, category: 'Bar' });
    expect(item.available).toBe(true);
    expect(item.description).toBe('');
  });

  it('preserves an existing id', () => {
    // The seed catalogue ships stable ids and the recipe table is keyed by them. Dropping
    // the id made a menu reset mint fresh ones and orphan every ingredient mapping, so the
    // stock deduction silently found no recipe and consumed nothing.
    expect(validateMenuItem({ id: '1', name: 'Espresso', price: 35, category: 'Bar' }).id).toBe('1');
  });

  it('omits the id for a newly created item', () => {
    expect('id' in validateMenuItem({ name: 'Latte', price: 60, category: 'Bar' })).toBe(false);
  });

  it('requires a name, price and category', () => {
    expect(() => validateMenuItem({ price: 60, category: 'Bar' })).toThrow(/name/);
    expect(() => validateMenuItem({ name: 'Latte', category: 'Bar' })).toThrow(/price/);
    expect(() => validateMenuItem({ name: 'Latte', price: 60 })).toThrow(/category/);
  });
});

describe('validateCustomer', () => {
  it('normalises the phone and keeps the name', () => {
    expect(validateCustomer({ phone: '(010) 123 45678', name: ' Sara ' }))
      .toMatchObject({ phone: '01012345678', name: 'Sara' });
  });

  it('rejects an implausible phone', () => {
    expect(() => validateCustomer({ phone: '123' })).toThrow(/phone/);
    expect(() => validateCustomer({ phone: '1'.repeat(20) })).toThrow(/phone/);
  });

  it('rejects negative points', () => {
    expect(() => validateCustomer({ phone: '01012345678', points: -5 })).toThrow(/points/);
  });
});

describe('validateRecipe', () => {
  it('accepts ingredient lines', () => {
    expect(validateRecipe([{ inventoryItemId: 'inv-1', quantity: 0.015 }])).toHaveLength(1);
  });

  it('accepts an empty recipe, which clears the mapping', () => {
    expect(validateRecipe([])).toEqual([]);
  });

  it('rejects a zero or negative ingredient quantity', () => {
    expect(() => validateRecipe([{ inventoryItemId: 'inv-1', quantity: 0 }])).toThrow(/quantity/);
    expect(() => validateRecipe([{ inventoryItemId: 'inv-1', quantity: -1 }])).toThrow(/quantity/);
  });
});

describe('primitives', () => {
  it('rejects an id containing control characters', () => {
    expect(() => requireId('ord\n1', 'id')).toThrow(/control characters/);
    expect(requireId('ord-1', 'id')).toBe('ord-1');
  });

  it('rejects an over-long id', () => {
    expect(() => requireId('a'.repeat(200), 'id')).toThrow(/at most/);
  });

  it('normalises a phone with separators', () => {
    expect(requirePhone('+20 100 123 4567')).toBe('201001234567');
  });

  it('treats an empty money value as invalid', () => {
    expect(() => requireMoney(null, 'price')).toThrow(/price/);
    expect(() => requireMoney('', 'price')).toThrow(/price/);
    expect(requireMoney('60.5', 'price')).toBe(60.5);
  });

  it('caps a settings value so one caller cannot bloat the row', () => {
    expect(validateSettingValue('{"enabled":true}')).toBe('{"enabled":true}');
    expect(() => validateSettingValue('x'.repeat(20_000))).toThrow(/at most/);
    expect(() => validateSettingValue(42)).toThrow(/string/);
  });
});
