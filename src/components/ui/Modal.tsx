import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';

interface ModalProps {
  title: string;
  /** Optional line under the title; announced as the dialog's description. */
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  maxWidth?: string;
  /** Set false for a destructive flow that should not close on a stray backdrop click. */
  closeOnBackdrop?: boolean;
}

/**
 * Standard dialog shell: a titled panel with a close button, backed by the shared dialog
 * behaviour (focus trap, Escape to close, focus restore).
 *
 * Modals with their own header chrome use `useDialog` directly instead.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  maxWidth = 'max-w-md',
  closeOnBackdrop = true,
}: ModalProps) {
  const { t } = useLanguage();
  const { panelRef, titleId, descriptionId, dialogProps } = useDialog<HTMLDivElement>({
    onClose,
    hasDescription: Boolean(description),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeOnBackdrop ? onClose : undefined}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <motion.div
        ref={panelRef}
        {...dialogProps}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`bg-white rounded-2xl w-full ${maxWidth} shadow-xl relative z-10 overflow-hidden outline-none max-h-[90vh] flex flex-col`}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-4 bg-gray-50/50 shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">{title}</h2>
            {description && (
              <p id={descriptionId} className="text-xs text-gray-400 font-medium mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}
