import { useCallback, useEffect, useId, useRef } from 'react';

/** Elements that can receive keyboard focus inside a dialog. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseDialogOptions {
  onClose: () => void;
  /** Whether the dialog has a description element to announce alongside its title. */
  hasDescription?: boolean;
  /**
   * False while the dialog is mounted but not visible. Components that keep their state
   * across open/close call this hook before their `isOpen` early return, and focus must not
   * be captured — nor page scroll locked — while nothing is on screen.
   */
  enabled?: boolean;
}

export interface UseDialogResult<T extends HTMLElement> {
  panelRef: React.RefObject<T>;
  titleId: string;
  descriptionId: string;
  /** Spread onto the dialog panel element. */
  dialogProps: {
    role: 'dialog';
    'aria-modal': true;
    'aria-labelledby': string;
    'aria-describedby': string | undefined;
    tabIndex: -1;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
}

/**
 * Keyboard and screen-reader behaviour for a modal dialog.
 *
 * Owns the four things a dialog must do and that were missing everywhere: announce itself
 * as a dialog, move focus inside and keep it there, close on Escape, and hand focus back to
 * whatever opened it. Components keep their own visual chrome and spread `dialogProps` onto
 * their panel.
 */
export function useDialog<T extends HTMLElement>({
  onClose,
  hasDescription = false,
  enabled = true,
}: UseDialogOptions): UseDialogResult<T> {
  const panelRef = useRef<T>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Whatever had focus when the dialog opened, so it can be restored on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const focusableElements = useCallback(() => {
    if (!panelRef.current) return [] as HTMLElement[];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(el => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Focus the first control, or the panel itself when the dialog is read-only.
    const [first] = focusableElements();
    (first ?? panelRef.current)?.focus();

    // A dialog over a scrolling page is disorienting, and on mobile the page scrolls
    // instead of the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [enabled, focusableElements]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    // Focus trap: wrap at both ends so Tab cannot reach the page behind the dialog.
    const elements = focusableElements();
    if (elements.length === 0) {
      event.preventDefault();
      return;
    }

    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [focusableElements, onClose]);

  return {
    panelRef,
    titleId,
    descriptionId,
    dialogProps: {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': titleId,
      'aria-describedby': hasDescription ? descriptionId : undefined,
      tabIndex: -1,
      onKeyDown,
    },
  };
}
