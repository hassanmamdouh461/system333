import { useMemo } from 'react';
import { clsx } from 'clsx';
import { ChartPoint } from '../../utils/managerAnalytics';

interface RevenueChartProps {
  data: ChartPoint[];
  currency: string;
  /** Translated word for orders, used in the per-bar tooltip. */
  ordersLabel: string;
  /** Changing this replays the grow-in animation, e.g. when the period changes. */
  replayKey: string;
  isRtl: boolean;
}

/** Nice round ceiling above the tallest bar, so the axis reads in whole steps. */
function axisMax(values: number[]): number {
  const peak = Math.max(...values, 0);
  if (peak <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / magnitude) * magnitude;
}

function formatAxis(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

/**
 * Revenue per bucket as a bar chart.
 *
 * It carries a gridline scale and a value axis, because bars with no axis only convey
 * relative shape — the previous version could not be read as money without hovering each
 * bar one at a time. The whole chart is also exposed as a table to assistive technology,
 * since a row of divs conveys nothing to a screen reader.
 */
export function RevenueChart({ data, currency, ordersLabel, replayKey, isRtl }: RevenueChartProps) {
  const max = useMemo(() => axisMax(data.map(d => d.value)), [data]);
  // Four gridlines plus the baseline: enough to read a value off, few enough to stay quiet.
  const ticks = useMemo(() => [1, 0.75, 0.5, 0.25, 0].map(f => max * f), [max]);
  const busiest = useMemo(() => Math.max(...data.map(d => d.value), 0), [data]);

  return (
    <figure className="flex-1 m-0">
      <figcaption className="sr-only">
        {data.map(d => `${d.label}: ${d.value.toFixed(2)} ${currency}`).join(', ')}
      </figcaption>

      <div className="flex gap-3" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Value axis */}
        <div className="flex flex-col justify-between h-52 shrink-0 py-1 text-[10px] text-gray-400 tabular-nums text-end">
          {ticks.map(tick => <span key={tick}>{formatAxis(tick)}</span>)}
        </div>

        {/* Plot area */}
        <div className="relative flex-1 min-w-0">
          {/* Gridlines sit behind the bars and give the eye something to measure against. */}
          <div className="absolute inset-0 h-52 flex flex-col justify-between pointer-events-none" aria-hidden="true">
            {ticks.map((tick, i) => (
              <div
                key={tick}
                className={clsx('w-full border-t', i === ticks.length - 1 ? 'border-gray-300' : 'border-gray-100')}
              />
            ))}
          </div>

          <div className="relative h-52 flex items-end justify-between gap-1 md:gap-2">
            {data.map((point, idx) => {
              const heightPercent = max > 0 ? (point.value / max) * 100 : 0;
              const isBusiest = point.value > 0 && point.value === busiest;

              return (
                <div key={point.label} className="flex-1 min-w-0 h-full flex items-end justify-center group">
                  <div
                    key={`${replayKey}-${idx}`}
                    style={{
                      height: `${Math.max(heightPercent, point.value > 0 ? 2 : 0)}%`,
                      animation: 'none',
                    }}
                    className={clsx(
                      'relative w-full max-w-[30px] rounded-t-md transition-[height] duration-700 ease-out',
                      isBusiest
                        ? 'bg-gradient-to-t from-mocha-700 to-caramel-500'
                        : 'bg-gradient-to-t from-mocha-500 to-caramel-400',
                      point.value === 0 && 'bg-gray-100'
                    )}
                  >
                    <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 absolute -top-11 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] py-1.5 px-2 rounded-lg pointer-events-none transition-opacity whitespace-nowrap z-20 shadow-lg tabular-nums">
                      {point.value.toFixed(2)} {currency}
                      {point.orders > 0 && ` · ${point.orders} ${ordersLabel}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bucket labels */}
          <div className="flex justify-between gap-1 md:gap-2 mt-2">
            {data.map(point => (
              <span
                key={point.label}
                className="flex-1 min-w-0 text-center text-[10px] md:text-xs font-semibold text-gray-500 truncate"
              >
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
