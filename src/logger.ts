/**
 * Concise logger for pipeline scripts.
 * Set LOG_LEVEL=warn to reduce volume; LOG_LEVEL=debug for full detail.
 * LOG_CONCISE=1 or RAILWAY_CRON=true → shorter one-line format.
 */

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase() as 'error' | 'warn' | 'info' | 'debug';
const CONCISE = process.env.LOG_CONCISE === '1' || process.env.RAILWAY_CRON === 'true';

const levels = { error: 0, warn: 1, info: 2, debug: 3 };

function shouldLog(level: 'error' | 'warn' | 'info' | 'debug'): boolean {
  return levels[level] <= levels[LOG_LEVEL];
}

export function logError(...args: unknown[]): void {
  if (shouldLog('error')) console.error(...args);
}

export function logWarn(...args: unknown[]): void {
  if (shouldLog('warn')) console.warn(...args);
}

export function logInfo(...args: unknown[]): void {
  if (shouldLog('info')) console.log(...args);
}

export function logDebug(...args: unknown[]): void {
  if (shouldLog('debug')) console.log(...args);
}

/** One-line summary (always concise) */
export function logLine(msg: string): void {
  if (shouldLog('info')) console.log(msg);
}

export { CONCISE, LOG_LEVEL };
