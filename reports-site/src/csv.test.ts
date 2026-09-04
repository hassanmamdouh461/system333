import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  buildCsv,
  csvCell,
  exportFileName,
  exportRowCount,
  toCsv,
  type ExportScope,
} from './csv';
import type { CustomerRow, InventoryRow, MenuItemRow, OrderRow } from './analytics';

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o1',
    orderNumber: 'A-1001',
    createdAt: '2026-09-01T10:00:00.000Z',
    branch_id: 'branch-1',
    totalAmount: 100,
    grandTotal: 100,
    subtotal: 90,
    taxAmount: 10,
    paidAmount: 100,
    paymentStatus: 'Paid',
    paymentMethod: 'Cash',
    customerPhone: '01000000000',
    items: null,
    ...overrides,
  };
}

function material(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'i1',
    name: 'دقيق',
    unit: 'كجم',
    stock: 10,
    minStock: 4,
    costPerUnit: 25,
    branch_id: 'branch-1',
    ...overrides,
  };
}

function menuItem(overrides: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: 'm1',
    name: 'لاتيه',
    category: 'مشروبات|ساخن',
    price: 45,
    available: 1,
    branch_id: 'branch-1',
    ...overrides,
  };
}

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'c1',
    name: 'أحمد',
    phone: '01000000000',
    points: 120.4,
    createdAt: '2026-08-20T08:00:00.000Z',
    branch_id: 'branch-1',
    ...overrides,
  };
}

function scope(overrides: Partial<ExportScope> = {}): ExportScope {
  return {
    orders: [],
    menuItems: [],
    inventory: [],
    customers: [],
    soldByName: new Map(),
    ...overrides,
  };
}

/** Header row plus data rows, split the way a spreadsheet reads the file. */
function lines(csv: string): string[] {
  return csv.split('\r\n');
}

describe('csvCell', () => {
  it('leaves an ordinary value untouched', () => {
    expect(csvCell('لاتيه')).toBe('لاتيه');
    expect(csvCell(45)).toBe('45');
  });

  it('renders a missing value as an empty cell rather than the word null', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value containing a comma, quote or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('neutralises a leading formula character', () => {
    // A product name typed as `=1+1` would otherwise evaluate when the file is opened.
    for (const text of ['=1+1', '+x', '-x', '@x']) {
      const cell = csvCell(text);
      expect(cell.startsWith('"\t')).toBe(true);
      expect(cell).toContain(text);
    }
  });

  it('does not treat a minus inside a value as a formula', () => {
    expect(csvCell('sub-total')).toBe('sub-total');
  });
});

describe('toCsv', () => {
  it('writes the header first and separates rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2');
  });

  it('writes only the header when there are no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});

describe('buildCsv', () => {
  it('exports an order with its lines, tax and collected amount', () => {
    const csv = buildCsv(
      'orders',
      scope({
        orders: [order({ items: JSON.stringify([{ name: 'لاتيه', quantity: 2, price: 45 }]) })],
      })
    );

    const [header, row] = lines(csv);
    expect(header.startsWith('رقم الطلب')).toBe(true);
    expect(row).toContain('A-1001');
    expect(row).toContain('لاتيه ×2');
    expect(row).toContain('مدفوع');
    expect(row.endsWith('100.00')).toBe(true);
  });

  it('falls back to the row id when an order has no number', () => {
    expect(buildCsv('orders', scope({ orders: [order({ orderNumber: null })] }))).toContain('o1');
  });

  it('reports what an unpaid order still owes', () => {
    const csv = buildCsv(
      'orders',
      scope({ orders: [order({ paymentStatus: 'Unpaid', paidAmount: 30, grandTotal: 100 })] })
    );
    const row = lines(csv)[1].split(',');
    expect(row.slice(-2)).toEqual(['70.00', '30.00']);
    expect(csv).toContain('غير مدفوع');
  });

  it('exports the menu with the quantity sold in scope', () => {
    const csv = buildCsv(
      'menu',
      scope({ menuItems: [menuItem()], soldByName: new Map([['لاتيه', 3]]) })
    );
    const row = lines(csv)[1];
    // The category column carries only the category, not the `category|preparation` pair.
    expect(row).toContain('مشروبات');
    expect(row).not.toContain('ساخن');
    expect(row).toContain('135.00');
    expect(row).toContain('متوفر');
  });

  it('labels an unsold item with a zero rather than an empty cell', () => {
    expect(buildCsv('menu', scope({ menuItems: [menuItem()] }))).toContain(',0,');
  });

  it('exports stock with its value and a low-stock label', () => {
    const csv = buildCsv(
      'inventory',
      scope({ inventory: [material({ stock: 2, minStock: 4 }), material({ id: 'i2', name: 'سكر' })] })
    );
    const [, low, fine] = lines(csv);
    expect(low).toContain('منخفض');
    expect(low).toContain('50.00');
    expect(fine).toContain('كافٍ');
    expect(fine).toContain('250.00');
  });

  it('totals a customer spend from the orders in scope, matched by phone', () => {
    const csv = buildCsv(
      'customers',
      scope({
        customers: [customer(), customer({ id: 'c2', name: 'سارة', phone: '01111111111' })],
        orders: [order({ paidAmount: 80 }), order({ id: 'o2', paidAmount: 20 })],
      })
    );

    const [, first, second] = lines(csv);
    expect(first).toContain('100.00');
    expect(first).toContain(',2,');
    // A customer with no order in the period exports as zero, not as a missing row.
    expect(second).toContain('سارة');
    expect(second).toContain('0.00');
  });

  it('rounds loyalty points to a whole number', () => {
    expect(buildCsv('customers', scope({ customers: [customer({ points: 120.4 })] }))).toContain(
      '120'
    );
  });

  it('ignores an order with no phone when totalling customer spend', () => {
    const csv = buildCsv(
      'customers',
      scope({ customers: [customer()], orders: [order({ customerPhone: null })] })
    );
    expect(lines(csv)[1]).toContain('0.00');
  });
});

describe('exportRowCount', () => {
  it('counts the rows the matching export would write', () => {
    const filled = scope({
      orders: [order()],
      menuItems: [menuItem(), menuItem({ id: 'm2' })],
      inventory: [material()],
      customers: [],
    });

    expect(exportRowCount('orders', filled)).toBe(1);
    expect(exportRowCount('menu', filled)).toBe(2);
    expect(exportRowCount('inventory', filled)).toBe(1);
    expect(exportRowCount('customers', filled)).toBe(0);
  });
});

describe('exportFileName', () => {
  it('carries the scope and the date, so two exports do not collide', () => {
    expect(exportFileName('orders', 'branch-1', 'week', new Date(2026, 8, 4))).toBe(
      'engaz-orders-branch-1-week-2026-09-04.csv'
    );
  });
});

describe('CSV_BOM', () => {
  it('is the byte-order mark Excel needs to read Arabic as UTF-8', () => {
    expect(CSV_BOM).toBe('\uFEFF');
  });
});
