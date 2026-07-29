/**
 * Centralised leveled logger.
 * Debug logs are silent in production builds; warnings and errors always surface.
 */

const IS_DEV = import.meta.env?.DEV ?? false;

/* eslint-disable no-console */
export const logger = {
  debug: (...args: unknown[]) => {
    if (IS_DEV) logger.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (IS_DEV) logger.info(...args);
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
/* eslint-enable no-console */
