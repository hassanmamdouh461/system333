import { useCallback, useEffect, useState } from 'react';
import { OrderItem } from '../types/order';

export type PaymentMethod = 'Cash' | 'Card';
export type PaymentStatus = 'Paid' | 'Unpaid';
export type OrderMode = 'Dine-in' | 'Takeaway';

/**
 * The in-progress sale, persisted so a reload or a crash mid-order does not lose the
 * basket the cashier already rang up.
 */
export interface PosDraft {
  invoiceItems: OrderItem[];
  receivedAmount: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  orderMode: OrderMode;
  tableId: string;
}

const STORAGE_KEY = 'pos_draft';

const EMPTY_DRAFT: PosDraft = {
  invoiceItems: [],
  receivedAmount: '0',
  paymentMethod: 'Cash',
  paymentStatus: 'Paid',
  orderMode: 'Takeaway',
  tableId: '',
};

function isOrderItemArray(value: unknown): value is OrderItem[] {
  return Array.isArray(value) && value.every(
    item => item && typeof item === 'object' && typeof (item as OrderItem).id === 'string'
  );
}

/**
 * Anything in storage is untrusted: it may have been written by an older build or edited
 * by hand. Each field falls back to its default rather than being cast, so a malformed
 * entry cannot put the register into a state the UI has no branch for.
 */
function parseDraft(raw: string | null): PosDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed = JSON.parse(raw) as Partial<PosDraft>;
    return {
      invoiceItems: isOrderItemArray(parsed.invoiceItems) ? parsed.invoiceItems : [],
      receivedAmount: typeof parsed.receivedAmount === 'string' ? parsed.receivedAmount : '0',
      paymentMethod: parsed.paymentMethod === 'Card' ? 'Card' : 'Cash',
      paymentStatus: parsed.paymentStatus === 'Unpaid' ? 'Unpaid' : 'Paid',
      orderMode: parsed.orderMode === 'Dine-in' ? 'Dine-in' : 'Takeaway',
      tableId: typeof parsed.tableId === 'string' ? parsed.tableId : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export interface UsePosDraftResult {
  draft: PosDraft;
  /** Merge a partial change into the draft and persist it. */
  update: (patch: Partial<PosDraft>) => void;
  setInvoiceItems: (next: OrderItem[] | ((prev: OrderItem[]) => OrderItem[])) => void;
  /** Clear the basket, keeping the order mode the cashier is working in. */
  reset: () => void;
}

export function usePosDraft(): UsePosDraftResult {
  const [draft, setDraft] = useState<PosDraft>(() => {
    try {
      return parseDraft(localStorage.getItem(STORAGE_KEY));
    } catch {
      return EMPTY_DRAFT;
    }
  });

  // One write per change instead of six separate effects racing each other.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch (err) {
      console.error('[POS] Failed to persist the in-progress sale:', err);
    }
  }, [draft]);

  const update = useCallback((patch: Partial<PosDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }));
  }, []);

  const setInvoiceItems = useCallback(
    (next: OrderItem[] | ((prev: OrderItem[]) => OrderItem[])) => {
      setDraft(prev => ({
        ...prev,
        invoiceItems: typeof next === 'function' ? next(prev.invoiceItems) : next,
      }));
    },
    []
  );

  const reset = useCallback(() => {
    setDraft(prev => ({
      ...EMPTY_DRAFT,
      orderMode: prev.orderMode,
      paymentStatus: prev.orderMode === 'Takeaway' ? 'Paid' : 'Unpaid',
    }));
  }, []);

  return { draft, update, setInvoiceItems, reset };
}
