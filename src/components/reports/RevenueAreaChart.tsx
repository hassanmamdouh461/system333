import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChartPoint } from '../../hooks/useAnalytics';
import { useLanguage } from '../../context/LanguageContext';
import { Sparkles, TrendingUp } from 'lucide-react';

interface RevenueAreaChartProps {
  data: ChartPoint[];
  maxSale: number;
  totalRevenue: number;
  currencyStr: string;
  periodLabel: string;
  dateRange: string;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 280;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 30;
const PADDING_TOP = 45;
const PADDING_BOTTOM = 40;

function formatShortMoney(val: number): string {
  if (val <= 0) return '0';
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k`;
  return Math.round(val).toString();
}

export const RevenueAreaChart: React.FC<RevenueAreaChartProps> = ({
  data,
  maxSale,
  totalRevenue,
  currencyStr,
  periodLabel,
  dateRange,
}) => {
  const { t, language } = useLanguage();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartWidth = VIEW_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const chartHeight = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = PADDING_TOP + chartHeight;

  // Compute (x, y) coordinates for each data point
  const points = useMemo(() => {
    if (!data || data.length === 0) return [];
    const count = data.length;
    const safeMax = maxSale > 0 ? maxSale : 1;

    return data.map((d, i) => {
      const x = PADDING_LEFT + (count > 1 ? (i / (count - 1)) * chartWidth : chartWidth / 2);
      const ratio = Math.max(0, Math.min(1, d.value / safeMax));
      const y = baselineY - ratio * chartHeight;
      return {
        ...d,
        index: i,
        x,
        y,
        ratio,
      };
    });
  }, [data, maxSale, chartWidth, chartHeight, baselineY]);

  // Identify peak point
  const peakPoint = useMemo(() => {
    if (points.length === 0 || maxSale <= 0) return null;
    let highest = points[0];
    for (const p of points) {
      if (p.value > highest.value) highest = p;
    }
    return highest.value > 0 ? highest : null;
  }, [points, maxSale]);

  // Smooth Catmull-Rom to Cubic Bézier Spline generator
  const { linePath, areaPath } = useMemo(() => {
    if (points.length === 0) return { linePath: '', areaPath: '' };
    if (points.length === 1) {
      const p = points[0];
      return {
        linePath: `M ${p.x - 20} ${p.y} L ${p.x + 20} ${p.y}`,
        areaPath: `M ${p.x - 20} ${baselineY} L ${p.x - 20} ${p.y} L ${p.x + 20} ${p.y} L ${p.x + 20} ${baselineY} Z`,
      };
    }

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const tension = 0.22;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      const clampedCp1y = Math.min(baselineY, Math.max(PADDING_TOP - 15, cp1y));
      const clampedCp2y = Math.min(baselineY, Math.max(PADDING_TOP - 15, cp2y));

      d += ` C ${cp1x.toFixed(1)} ${clampedCp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${clampedCp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    const firstX = points[0].x.toFixed(1);
    const lastX = points[points.length - 1].x.toFixed(1);
    const aPath = `${d} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;

    return { linePath: d, areaPath: aPath };
  }, [points, baselineY]);

  // Y-axis grid lines (100%, 50%, 0%)
  const gridLines = useMemo(() => {
    const safeMax = maxSale > 0 ? maxSale : 100;
    return [
      { y: PADDING_TOP, label: formatShortMoney(safeMax) },
      { y: PADDING_TOP + chartHeight * 0.5, label: formatShortMoney(safeMax * 0.5) },
      { y: baselineY, label: '0' },
    ];
  }, [maxSale, chartHeight, baselineY]);

  const activePoint = hoveredIndex !== null && points[hoveredIndex] ? points[hoveredIndex] : null;

  return (
    <div className="lg:col-span-2 bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 flex flex-col relative select-none">
      {/* Chart Header */}
      <div className="flex items-center justify-between mb-3 md:mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-mocha-50 text-mocha-700 flex items-center justify-center">
            <TrendingUp size={18} />
          </div>
          <div>
            <h2 className="text-sm md:text-lg font-bold text-gray-900 leading-tight">{t('Revenue Trend')}</h2>
            <p className="text-[11px] text-gray-400">
              {language === 'ar' ? 'توزيع المبيعات وتدفق الإيرادات عبر الفترات الزمنية' : 'Sales volume and revenue flow over time'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {totalRevenue > 0 && (
            <span className="text-xs text-green-700 bg-green-50 border border-green-100 px-3 py-1 rounded-full font-bold flex items-center gap-1 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyStr} {periodLabel}
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full flex-1 flex flex-col justify-center min-h-[220px] md:min-h-[260px]">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            {/* Area Fill Linear Gradient */}
            <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c8956c" stopOpacity="0.42" />
              <stop offset="40%" stopColor="#c8956c" stopOpacity="0.18" />
              <stop offset="85%" stopColor="#c8956c" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#c8956c" stopOpacity="0.0" />
            </linearGradient>

            {/* Line Stroke Gradient */}
            <linearGradient id="revLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#b07a52" />
              <stop offset="50%" stopColor="#c8956c" />
              <stop offset="100%" stopColor="#dba67d" />
            </linearGradient>

            {/* Soft Drop Shadow for the line */}
            <filter id="lineShadow" x="-5%" y="-10%" width="110%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#c8956c" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Horizontal Grid Lines and Y-Axis Labels */}
          {gridLines.map((grid, idx) => (
            <g key={`grid-${idx}`}>
              <line
                x1={PADDING_LEFT}
                y1={grid.y}
                x2={VIEW_WIDTH - PADDING_RIGHT}
                y2={grid.y}
                stroke="#f3f4f6"
                strokeWidth="1.5"
                strokeDasharray={idx === 2 ? 'none' : '4,4'}
              />
              <text
                x={PADDING_LEFT - 10}
                y={grid.y + 3.5}
                textAnchor="end"
                fill="#9ca3af"
                fontSize="11"
                fontWeight="600"
                fontFamily="sans-serif"
              >
                {grid.label}
              </text>
            </g>
          ))}

          {/* Area Gradient Path */}
          {areaPath && (
            <motion.path
              key={`area-${dateRange}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              d={areaPath}
              fill="url(#revAreaGrad)"
            />
          )}

          {/* Curved Line Path */}
          {linePath && (
            <motion.path
              key={`line-${dateRange}`}
              initial={{ pathLength: 0, opacity: 0.3 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              d={linePath}
              fill="none"
              stroke="url(#revLineGrad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#lineShadow)"
            />
          )}

          {/* Glowing Points on the line for hours with sales */}
          {points.map((p, idx) => {
            if (p.value <= 0) return null;
            const isPeak = peakPoint && peakPoint.index === p.index;
            const isHovered = hoveredIndex === idx;

            return (
              <g key={`point-${idx}`}>
                {/* Outer halo */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 9 : isPeak ? 7 : 5}
                  fill="#c8956c"
                  fillOpacity={isHovered ? 0.35 : 0.2}
                  className="transition-all duration-200"
                />
                {/* Core dot */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 5.5 : isPeak ? 4.5 : 3.5}
                  fill="#ffffff"
                  stroke="#a36e43"
                  strokeWidth={isHovered ? 3 : 2}
                  className="transition-all duration-200"
                />
              </g>
            );
          })}

          {/* Active Hover Guideline and Dot */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={PADDING_TOP - 10}
                x2={activePoint.x}
                y2={baselineY}
                stroke="#c8956c"
                strokeWidth="1.5"
                strokeDasharray="3,3"
                strokeOpacity="0.7"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="11"
                fill="#c8956c"
                fillOpacity="0.25"
                className="animate-ping"
              />
            </g>
          )}

          {/* Interactive Hover Columns (Invisible hover zones across the width) */}
          {points.map((p, idx) => {
            const count = points.length;
            const step = count > 1 ? chartWidth / (count - 1) : chartWidth;
            const rectX = p.x - step / 2;
            const rectW = step;

            return (
              <rect
                key={`hit-${idx}`}
                x={Math.max(0, rectX)}
                y={PADDING_TOP - 20}
                width={rectW}
                height={chartHeight + 50}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}

          {/* X-Axis Time Labels */}
          {points.map((p, idx) => (
            <text
              key={`label-${idx}`}
              x={p.x}
              y={baselineY + 22}
              textAnchor="middle"
              fill={hoveredIndex === idx ? '#4b2c20' : '#6b7280'}
              fontWeight={hoveredIndex === idx ? '700' : '500'}
              fontSize="11"
              fontFamily="sans-serif"
              className="transition-colors duration-150"
            >
              {t(p.label)}
            </text>
          ))}
        </svg>

        {/* Floating Tooltip Card */}
        <AnimatePresence>
          {activePoint && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute pointer-events-none z-20"
              style={{
                left: `${(activePoint.x / VIEW_WIDTH) * 100}%`,
                top: `${(activePoint.y / VIEW_HEIGHT) * 100}%`,
                transform: 'translate(-50%, -120%)',
              }}
            >
              <div className="bg-gray-900/95 text-white backdrop-blur-md px-3 py-2 rounded-xl shadow-xl border border-white/10 text-center min-w-[125px]">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-mocha-200 font-medium border-b border-white/10 pb-1 mb-1">
                  <span>{t(activePoint.label)}</span>
                  {peakPoint && peakPoint.index === activePoint.index && (
                    <span className="bg-amber-500/30 text-amber-300 text-[9px] px-1.5 py-0.2 rounded-full font-bold">
                      {language === 'ar' ? 'الذروة' : 'Peak'}
                    </span>
                  )}
                </div>
                <div className="text-sm font-black text-white tracking-wide">
                  {activePoint.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyStr}
                </div>
                <div className="text-[10px] text-gray-300 mt-0.5">
                  {activePoint.orders > 0 
                    ? `${activePoint.orders} ${t('orders')}` 
                    : (language === 'ar' ? 'لا توجد طلبات' : 'No orders')}
                </div>
                {/* Little triangle arrow */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-gray-900/95" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modern Footer Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-1.5 rounded-full bg-caramel shadow-xs" />
            <span>{language === 'ar' ? 'منحنى الإيرادات التراكمي' : 'Revenue Curve'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-white border-2 border-mocha-600" />
            <span>{language === 'ar' ? 'ساعات البيع الفعلي' : 'Active Sales'}</span>
          </div>
        </div>

        {peakPoint && peakPoint.value > 0 && (
          <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100/80 font-medium text-[11px]">
            <Sparkles size={13} className="text-amber-600" />
            <span>
              {language === 'ar' 
                ? `ساعة الذروة: ${t(peakPoint.label)} (${peakPoint.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currencyStr})`
                : `Peak hour: ${t(peakPoint.label)} (${peakPoint.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currencyStr})`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
