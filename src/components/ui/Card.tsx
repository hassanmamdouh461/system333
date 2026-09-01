import React from 'react';
import { clsx } from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Removes the default padding for panels that host a flush table or list. */
  flush?: boolean;
}

/**
 * The single surface every panel sits on.
 *
 * Panels were previously assembled inline with slightly different radii, borders and
 * shadows in each file — and several used border shades that did not exist, so those
 * panels had no border at all.
 */
export function Card({ children, className, flush = false }: CardProps) {
  return (
    <div
      className={clsx(
        'bg-white rounded-2xl border border-gray-200 shadow-sm',
        !flush && 'p-4 md:p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned slot for a badge, count, or small action. */
  action?: React.ReactNode;
  className?: string;
}

/** Panel heading: a title, an optional explanatory line, and an optional trailing slot. */
export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={clsx('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base md:text-lg font-bold text-gray-900 leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  hint?: string;
  className?: string;
}

/**
 * What a panel shows when it has nothing to show.
 *
 * An empty panel and a broken panel look identical without this, which is the difference
 * between "no sales yet today" and "the query failed".
 */
export function EmptyState({ icon: Icon, title, hint, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center py-10 px-4', className)}>
      {Icon && <Icon size={32} className="text-gray-300 mb-3" aria-hidden="true" />}
      <p className="text-sm font-semibold text-gray-500">{title}</p>
      {hint && <p className="text-xs text-gray-400 mt-1 max-w-[24ch]">{hint}</p>}
    </div>
  );
}

export type BarTone = 'mocha' | 'caramel' | 'green' | 'amber' | 'blue' | 'emerald' | 'red';

const BAR_TONES: Record<BarTone, { track: string; fill: string; text: string }> = {
  mocha:   { track: 'bg-mocha-100',   fill: 'bg-mocha-600',   text: 'text-mocha-700' },
  caramel: { track: 'bg-caramel-100', fill: 'bg-caramel-500', text: 'text-caramel-700' },
  green:   { track: 'bg-green-100',   fill: 'bg-green-600',   text: 'text-green-700' },
  amber:   { track: 'bg-amber-100',   fill: 'bg-amber-500',   text: 'text-amber-700' },
  blue:    { track: 'bg-blue-100',    fill: 'bg-blue-600',    text: 'text-blue-700' },
  emerald: { track: 'bg-emerald-100', fill: 'bg-emerald-600', text: 'text-emerald-700' },
  red:     { track: 'bg-red-100',     fill: 'bg-red-600',     text: 'text-red-700' },
};

interface MeterProps {
  label: string;
  /** Figure shown at the end of the label row, e.g. "12 orders (40%)". */
  value: string;
  /** Fill width as a percentage, clamped to 0–100. */
  percent: number;
  tone?: BarTone;
  /** Small line under the bar, typically the money behind the percentage. */
  footnote?: string;
  icon?: React.ReactNode;
}

/**
 * A labelled proportion bar.
 *
 * Exposed as a progressbar with its value, because the number was previously conveyed by
 * bar width alone and was invisible to a screen reader.
 */
export function Meter({ label, value, percent, tone = 'mocha', footnote, icon }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const colors = BAR_TONES[tone];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs md:text-sm">
        <span className="flex items-center gap-2 font-semibold text-gray-700 min-w-0">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className={clsx('font-bold shrink-0 tabular-nums', colors.text)}>{value}</span>
      </div>

      <div
        className={clsx('w-full h-2.5 rounded-full overflow-hidden', colors.track)}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', colors.fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>

      {footnote && <p className="text-[11px] text-gray-500 tabular-nums">{footnote}</p>}
    </div>
  );
}
