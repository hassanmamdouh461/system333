/**
 * CSV export of what the portal has loaded.
 *
 * The rows exported are the ones on screen: already narrowed to the selected branch and
 * period, so a file matches the figures it was exported next to.
 *
 * Two hazards are handled here rather than at the call sites. Excel reads a file without a
 * byte-order mark as the system code page, which turns every Arabic name into mojibake; and a
 * field starting with `=`, `+`, `-`, `@` is read as a formula, so a product name typed into
 * the point-of-sale could otherwise execute in a manager's spreadsheet.
 */

import {
  formatMoney,
  orderBilled,
  orderLines,
  orderRevenue,
  toNum,
  type CustomerRow,
  type InventoryRow,
  type MenuItemRow,
  type OrderRow,
} from './analytics';

export const CSV_BOM = '\uFEFF';

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading formula character is neutralised with a tab: the cell still reads as its text,
  // and unlike a quote the tab does not show up as part of the value.
  const safe = /^[=+\-@]/.test(text) ? `\t${text}` : text;
  return /[",\n\r\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF, because that is the line ending Excel expects in a .csv.
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export type ExportKind = 'orders' | 'menu' | 'inventory' | 'customers';

export const EXPORT_LABELS: Record<ExportKind, string> = {
  orders: 'الطلبات',
  menu: 'أصناف القائمة',
  inventory: 'أصناف المخزون',
  customers: 'العملاء',
};

export interface ExportScope {
  orders: OrderRow[];
  menuItems: MenuItemRow[];
  inventory: InventoryRow[];
  customers: CustomerRow[];
  /** Quantity sold per product name, over the same scope. */
  soldByName: Map<string, number>;
  /** Display name per branch id, so a column reads as a branch rather than as a slug. */
  branchNames: Map<string, string>;
}

/** Branch as the manager knows it; an unregistered id exports as itself, not as blank. */
function branchCell(id: string | null, names: Map<string, string>): string {
  if (!id) return '';
  return names.get(id) ?? id;
}

/** A local timestamp, since a viewer reads these against their own working day. */
function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { hour12: false });
}

function ordersCsv(orders: OrderRow[], names: Map<string, string>): string {
  return toCsv(
    ['رقم الطلب', 'التاريخ', 'الفرع', 'حالة الدفع', 'طريقة الدفع', 'الأصناف', 'الضريبة', 'المستحق', 'المحصل'],
    orders.map((order) => [
      order.orderNumber || order.id,
      localDateTime(order.createdAt),
      branchCell(order.branch_id, names),
      order.paymentStatus === 'Paid' ? 'مدفوع' : 'غير مدفوع',
      order.paymentMethod || '',
      orderLines(order)
        .map((line) => `${line.name} ×${line.quantity}`)
        .join(' | '),
      formatMoney(toNum(order.taxAmount)),
      formatMoney(Math.max(orderBilled(order) - toNum(order.paidAmount), 0)),
      formatMoney(orderRevenue(order)),
    ])
  );
}

function menuCsv(
  menuItems: MenuItemRow[],
  soldByName: Map<string, number>,
  names: Map<string, string>
): string {
  return toCsv(
    ['الصنف', 'القسم', 'السعر', 'الكمية المباعة', 'إيراد الفترة', 'الحالة', 'الفرع'],
    menuItems.map((item) => {
      const sold = soldByName.get(item.name) ?? 0;
      return [
        item.name,
        (item.category || '').split('|')[0] || 'غير مصنف',
        formatMoney(toNum(item.price)),
        sold,
        formatMoney(sold * toNum(item.price)),
        toNum(item.available) === 1 ? 'متوفر' : 'غير متوفر',
        branchCell(item.branch_id, names),
      ];
    })
  );
}

function inventoryCsv(inventory: InventoryRow[], names: Map<string, string>): string {
  return toCsv(
    ['اسم الصنف', 'الوحدة', 'المخزون الحالي', 'حد التنبيه', 'سعر الوحدة', 'قيمة المخزون', 'الحالة', 'الفرع'],
    inventory.map((item) => [
      item.name,
      item.unit || '',
      formatMoney(toNum(item.stock)),
      formatMoney(toNum(item.minStock)),
      formatMoney(toNum(item.costPerUnit)),
      formatMoney(toNum(item.stock) * toNum(item.costPerUnit)),
      toNum(item.stock) <= toNum(item.minStock) ? 'منخفض' : 'كافٍ',
      branchCell(item.branch_id, names),
    ])
  );
}

function customersCsv(
  customers: CustomerRow[],
  orders: OrderRow[],
  names: Map<string, string>
): string {
  const byPhone = new Map<string, { spend: number; orders: number }>();
  for (const order of orders) {
    const phone = order.customerPhone || '';
    if (!phone) continue;
    const existing = byPhone.get(phone) ?? { spend: 0, orders: 0 };
    existing.spend += orderRevenue(order);
    existing.orders += 1;
    byPhone.set(phone, existing);
  }

  return toCsv(
    ['الاسم', 'الهاتف', 'النقاط', 'تاريخ التسجيل', 'طلبات الفترة', 'إنفاق الفترة', 'الفرع'],
    customers.map((customer) => {
      const totals = byPhone.get(customer.phone || '') ?? { spend: 0, orders: 0 };
      return [
        customer.name,
        customer.phone || '',
        formatCountCell(customer.points),
        localDateTime(customer.createdAt),
        totals.orders,
        formatMoney(totals.spend),
        branchCell(customer.branch_id, names),
      ];
    })
  );
}

/** Points are whole numbers; two decimals would only add noise to the column. */
function formatCountCell(value: unknown): number {
  return Math.round(toNum(value));
}

export function buildCsv(kind: ExportKind, scope: ExportScope): string {
  const names = scope.branchNames;
  if (kind === 'orders') return ordersCsv(scope.orders, names);
  if (kind === 'menu') return menuCsv(scope.menuItems, scope.soldByName, names);
  if (kind === 'inventory') return inventoryCsv(scope.inventory, names);
  return customersCsv(scope.customers, scope.orders, names);
}

/** File name carrying the scope, so several exports do not overwrite each other. */
export function exportFileName(kind: ExportKind, branch: string, period: string, now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `engaz-${kind}-${branch}-${period}-${stamp}.csv`;
}

/** How many rows an export would contain, so the button can say so before it is pressed. */
export function exportRowCount(kind: ExportKind, scope: ExportScope): number {
  if (kind === 'orders') return scope.orders.length;
  if (kind === 'menu') return scope.menuItems.length;
  if (kind === 'inventory') return scope.inventory.length;
  return scope.customers.length;
}

/** Hands the browser a file. Nothing leaves the machine: the blob is built locally. */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
