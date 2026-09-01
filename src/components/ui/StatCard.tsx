import { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

export type StatTone = 'mocha' | 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'orange';

const TONES: Record<StatTone, { icon: string; accent: string }> = {
  mocha:  { icon: 'bg-mocha-50 text-mocha-700',   accent: 'text-mocha-700' },
  green:  { icon: 'bg-green-50 text-green-700',   accent: 'text-green-700' },
  blue:   { icon: 'bg-blue-50 text-blue-700',     accent: 'text-blue-700' },
  amber:  { icon: 'bg-amber-50 text-amber-700',   accent: 'text-amber-700' },
  // Retained as an alias so existing call sites keep their intended warm tone.
  orange: { icon: 'bg-amber-50 text-amber-700',   accent: 'text-amber-700' },
  purple: { icon: 'bg-purple-50 text-purple-700', accent: 'text-purple-700' },
  red:    { icon: 'bg-red-50 text-red-700',       accent: 'text-red-700' },
};

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Secondary line: what the number counts, or over what period. */
  trend?: string;
  color?: StatTone | string;
  /** Draws attention to a figure that needs action, such as a low-stock count. */
  emphasis?: boolean;
}

/**
 * One headline figure.
 *
 * The value is the largest element and uses tabular figures, so a row of cards lines up and
 * a changing number does not shift the layout. Label above, value, then hint below — the
 * order they are actually read.
 *
 * The previous version put the hint in a green "trend" badge regardless of meaning, so a
 * low-stock warning was styled as good news.
 */
export function StatCard({ label, value, icon: Icon, trend, color = 'mocha', emphasis = false }: StatCardProps) {
  const colors = TONES[color as StatTone] ?? TONES.mocha;

  return (
    <div
      className={clsx(
        'bg-white rounded-2xl border p-4 md:p-5 shadow-sm transition-shadow hover:shadow-md',
        emphasis ? 'border-red-200 bg-red-50/40' : 'border-gray-200'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[11px] md:text-xs font-semibold text-gray-500 uppercase tracking-wide leading-snug">
          {label}
        </p>
        <div className={clsx('p-2 rounded-xl shrink-0', colors.icon)}>
          <Icon className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2} aria-hidden="true" />
        </div>
      </div>

      <p
        className={clsx(
          'text-xl md:text-2xl font-bold tabular-nums leading-none',
          emphasis ? colors.accent : 'text-gray-900'
        )}
      >
        {value}
      </p>

      {trend && <p className="text-[11px] text-gray-500 mt-2 leading-snug">{trend}</p>}
    </div>
  );
}
