/**
 * Central cloud-sync configuration — the SINGLE place that knows the Worker URL.
 *
 * Issue #15: the Worker URL used to be hardcoded in 4 different files (3 in the
 * renderer, 1 in the Electron main process) with a personal workers.dev domain.
 * Now every caller reads from here.
 *
 * Resolution order:
 *   1. VITE_CF_WORKER_URL (build-time env / .env file)
 *   2. Production default: https://api.engaz.tech
 *
 * The API key travels separately via VITE_CF_WORKER_API_KEY; in packaged
 * Electron builds both values come from the .env next to the executable or
 * from the app's settings table (see electron/mockApiService.cjs).
 */

const DEFAULT_WORKER_URL = 'https://api.engaz.tech';

export function getWorkerUrl(): string {
  const fromEnv = (import.meta as any).env?.VITE_CF_WORKER_URL;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/+$/, '');
  }
  return DEFAULT_WORKER_URL;
}

export function getWorkerApiKey(): string {
  const fromEnv = (import.meta as any).env?.VITE_CF_WORKER_API_KEY;
  return fromEnv && typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

/** Headers for a Worker request, including auth when a key is configured. */
export function workerHeaders(): Record<string, string> {
  const key = getWorkerApiKey();
  return {
    'Content-Type': 'application/json',
    ...(key ? { 'X-API-Key': key } : {}),
  };
}
