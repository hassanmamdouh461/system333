/**
 * Money helpers for the main process.
 *
 * These must stay numerically identical to `src/utils/orderTotals.ts`; the renderer computes
 * an order's snapshot and this layer stores it, so any divergence makes the same order report
 * two different amounts depending on which side is asked.
 */

const MONEY_DECIMALS = 2;

/** Mirrors settingsConfig.DEFAULT_TAX_RATE in the renderer. */
const DEFAULT_TAX_RATE = 0.1;

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** MONEY_DECIMALS;
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * factor) / factor;
}

module.exports = { MONEY_DECIMALS, DEFAULT_TAX_RATE, roundMoney };
