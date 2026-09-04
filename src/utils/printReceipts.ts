import { Order } from '../types/order';
import { orderTotals, orderRevenue, roundMoney } from './orderTotals';
import { filterItemsBySection } from './orderSection';
import { getStoreConfig } from './settingsConfig';

const CURRENCY = 'ج.م';

/**
 * Open a temporary window, write receipt content, trigger print, and close.
 */
function printHtml(htmlContent: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('يرجى السماح بالنوافذ المنبثقة لطباعة الفواتير');
    return;
  }
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

/** Tables named 'Takeaway'/'Dine-in' are mode markers, not table numbers. */
function formatTable(tableId: string): string {
  if (tableId === 'Takeaway') return 'take away';
  if (tableId === 'Dine-in') return 'مطعم';
  return tableId;
}

function formatDate(createdAt: string): string {
  return new Date(createdAt).toLocaleString('ar-EG');
}

const AUTO_PRINT_SCRIPT = `
      <script>
        window.onload = () => {
          window.print();
          setTimeout(() => window.close(), 100);
        };
      </script>`;

/**
 * Print standard customer receipt
 */
export function printCustomerReceipt(order: Order) {
  const currency = CURRENCY;
  const storeConfig = getStoreConfig();
  // Read the snapshot stored with the order. Deriving tax from `totalAmount` here taxed
  // POS orders a second time, because that column already holds the tax-inclusive total.
  const { subtotal, taxRate, taxAmount, grandTotal } = orderTotals(order);
  const collected = orderRevenue(order);
  const discount = roundMoney(grandTotal - collected);
  const isPaid = order.paymentStatus === 'Paid';
  const accent = isPaid ? '#10b981' : '#ef4444';

  const title = 'فاتورة الدفع';
  const tableLabel = 'الطاولة / نوع الطلب';
  const orderLabel = 'رقم الطلب';
  const dateLabel = 'التاريخ';
  const itemLabel = 'الأصناف';
  const subtotalLabel = 'المجموع الفرعي';
  const taxLabel = `الضريبة (${taxRate * 100}%)`;
  const discountLabel = 'خصم نقاط الولاء';
  const dueLabel = 'الإجمالي';
  const totalLabel = isPaid ? 'الإجمالي المدفوع' : 'المطلوب سداده';
  const paymentMethodLabel = 'طريقة الدفع';
  const thankYou = 'شكراً لزيارتكم! بالهناء والشفاء ☕';
  const cashierStamp = isPaid ? '✓ مدفوع' : 'غير مدفوع';
  const methodLabel = order.paymentMethod === 'Cash'
    ? 'نقداً'
    : order.paymentMethod === 'Card'
      ? 'بطاقة'
      : order.paymentMethod;

  const html = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <title>${title} - ${order.orderNumber}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', 'Courier New', monospace;
          padding: 10px;
          max-width: 320px;
          margin: 0 auto;
          font-size: 13px;
          color: #000;
          background: #fff;
        }
        .header {
          text-align: center;
          border-bottom: 2px dashed #000;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .header h1 { font-size: 20px; margin-bottom: 4px; font-weight: bold; }
        .header p { font-size: 11px; color: #333; }
        .stamp {
          text-align: center;
          font-size: 22px;
          font-weight: bold;
          color: ${accent};
          border: 2px solid ${accent};
          padding: 6px;
          margin: 12px 0;
          border-radius: 6px;
          text-transform: uppercase;
        }
        .info { margin: 12px 0; font-size: 12px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
        .info-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
        }
        .items {
          padding: 8px 0;
          margin: 8px 0;
        }
        .item {
          display: flex;
          justify-content: space-between;
          margin: 6px 0;
          font-size: 12px;
        }
        .item-name { flex: 1; padding-left: 8px; }
        .totals { border-top: 1px dashed #000; padding-top: 8px; margin-top: 12px; }
        .total-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
        }
        .total-row.grand {
          font-size: 15px;
          font-weight: bold;
          border-top: 2px solid #000;
          padding-top: 6px;
          margin-top: 6px;
        }
        .payment-info {
          background: #f4f4f5;
          padding: 8px;
          border-radius: 6px;
          margin: 12px 0;
          text-align: center;
          font-size: 12px;
        }
        .footer {
          text-align: center;
          margin-top: 16px;
          padding-top: 8px;
          border-top: 1px dashed #000;
          font-size: 11px;
        }
        @media print {
          body { padding: 0; width: 100%; max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${storeConfig.storeName || 'ENGAZ'}</h1>
        ${storeConfig.tagline ? `<p>${storeConfig.tagline}</p>` : ''}
        ${storeConfig.address ? `<p>${storeConfig.address}</p>` : ''}
        ${storeConfig.phone ? `<p>Tel: ${storeConfig.phone}</p>` : ''}
      </div>

      <div class="stamp">${cashierStamp}</div>

      <div class="info">
        <div class="info-row">
          <strong>${orderLabel}:</strong>
          <span>#${order.orderNumber}</span>
        </div>
        <div class="info-row">
          <strong>${tableLabel}:</strong>
          <span>${formatTable(order.tableId)}</span>
        </div>
        <div class="info-row">
          <strong>${dateLabel}:</strong>
          <span>${formatDate(order.createdAt)}</span>
        </div>
      </div>

      <div class="items">
        <h3 style="font-size: 13px; margin-bottom: 6px;">${itemLabel}:</h3>
        ${order.items.map(item => `
          <div class="item">
            <span class="item-name">${item.quantity}x ${item.name}</span>
            <span>${roundMoney(item.price * item.quantity).toFixed(2)} ${currency}</span>
          </div>
        `).join('')}
      </div>

      <div class="totals">
        <div class="total-row">
          <span>${subtotalLabel}:</span>
          <span>${subtotal.toFixed(2)} ${currency}</span>
        </div>
        <div class="total-row">
          <span>${taxLabel}:</span>
          <span>${taxAmount.toFixed(2)} ${currency}</span>
        </div>
        ${discount > 0 ? `
        <div class="total-row">
          <span>${dueLabel}:</span>
          <span>${grandTotal.toFixed(2)} ${currency}</span>
        </div>
        <div class="total-row">
          <span>${discountLabel}:</span>
          <span>-${discount.toFixed(2)} ${currency}</span>
        </div>
        ` : ''}
        <div class="total-row grand">
          <span>${totalLabel}:</span>
          <span>${collected.toFixed(2)} ${currency}</span>
        </div>
      </div>

      ${isPaid && order.paymentMethod ? `
        <div class="payment-info">
          <strong>${paymentMethodLabel}:</strong> ${methodLabel}
        </div>
      ` : ''}

      <div class="footer">
        <p>${thankYou}</p>
        <p>Engaz POS</p>
      </div>
${AUTO_PRINT_SCRIPT}
    </body>
    </html>
  `;

  printHtml(html);
}

interface TicketStyle {
  /** Icon printed next to the ticket title. */
  icon: string;
  /** Printer name shown in the ticket footer. */
  printerName: string;
  title: string;
}

const TICKET_STYLES: Record<'kitchen' | 'drinks', TicketStyle> = {
  kitchen: {
    icon: '🍳',
    printerName: 'Engaz - Kitchen Printer',
    title: 'طلب المطبخ - أكل',
  },
  drinks: {
    icon: '☕',
    printerName: 'Engaz - Bar Printer',
    title: 'طلب المشروبات - بار',
  },
};

/**
 * Print a preparation ticket for one section of an order. Kitchen and bar tickets
 * share this layout and differ only by title, icon, printer name, and which items
 * of the order they carry.
 */
function printSectionTicket(order: Order, section: 'kitchen' | 'drinks') {
  const items = filterItemsBySection(order.items, section);
  if (items.length === 0) return;

  const style = TICKET_STYLES[section];
  const title = style.title;
  const tableLabel = 'الطاولة';
  const orderLabel = 'طلب رقم';
  const itemsCountLabel = 'عدد الأصناف';
  const dateLabel = 'التاريخ';
  const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);

  const html = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <title>${title} - ${order.orderNumber}</title>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          padding: 8px;
          max-width: 320px;
          margin: 0 auto;
          color: #000;
          background: #fff;
        }
        .header {
          text-align: center;
          border-bottom: 3px double #000;
          padding-bottom: 8px;
          margin-bottom: 8px;
        }
        .header h1 { font-size: 18px; font-weight: 900; letter-spacing: 0.5px; }
        .details-box {
          border: 2px solid #000;
          padding: 8px;
          margin-bottom: 10px;
          border-radius: 4px;
        }
        .details-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
          font-size: 14px;
        }
        .large-text {
          font-size: 26px;
          font-weight: 900;
        }
        .items-list {
          margin-top: 10px;
        }
        .item-row {
          display: flex;
          border-bottom: 1px dashed #000;
          padding: 8px 0;
          align-items: center;
        }
        .item-qty {
          font-size: 28px;
          font-weight: 900;
          margin-left: 15px;
          background: #000;
          color: #fff;
          padding: 2px 8px;
          border-radius: 4px;
          min-width: 48px;
          text-align: center;
        }
        .item-name {
          font-size: 18px;
          font-weight: bold;
          flex: 1;
        }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          border-top: 1px dashed #000;
          padding-top: 6px;
        }
        @media print {
          body { padding: 0; width: 100%; max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${style.icon} ${title}</h1>
      </div>

      <div class="details-box">
        <div class="details-row">
          <span><strong>${orderLabel}:</strong></span>
          <span class="large-text">#${order.orderNumber}</span>
        </div>
        <div class="details-row">
          <span><strong>${tableLabel}:</strong></span>
          <span class="large-text">${formatTable(order.tableId)}</span>
        </div>
        <div class="details-row" style="font-size: 11px; margin-top: 6px;">
          <span>${dateLabel}: ${formatDate(order.createdAt)}</span>
          <span>${itemsCountLabel}: ${totalQuantity}</span>
        </div>
      </div>

      <div class="items-list">
        ${items.map(item => `
          <div class="item-row">
            <span class="item-qty">${item.quantity}</span>
            <span class="item-name">${item.name}</span>
          </div>
        `).join('')}
      </div>

      <div class="footer">
        <p>${style.printerName}</p>
      </div>
${AUTO_PRINT_SCRIPT}
    </body>
    </html>
  `;

  printHtml(html);
}

/**
 * Print kitchen receipt containing food items
 */
export function printKitchenReceipt(order: Order) {
  printSectionTicket(order, 'kitchen');
}

/**
 * Print drinks/beverage receipt
 */
export function printDrinksReceipt(order: Order) {
  printSectionTicket(order, 'drinks');
}
