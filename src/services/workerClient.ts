/**
 * Browser-side client for the Engaz Cloudflare worker.
 *
 * The worker exposes named endpoints and owns every SQL statement, so this module sends
 * data and filters only. It is used by the web build; the desktop build goes through the
 * Electron main process instead.
 */

const DEFAULT_WORKER_URL = 'https://api.engaz.tech';

export function workerUrl(): string {
  return import.meta.env.VITE_CF_WORKER_URL || DEFAULT_WORKER_URL;
}

function apiKey(): string {
  return import.meta.env.VITE_CF_WORKER_API_KEY || '';
}

export class WorkerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WorkerError';
  }
}

/**
 * Calls one worker endpoint. A rate-limited response is reported distinctly so callers can
 * tell "slow down" apart from "broken".
 */
export async function callWorker<T>(endpoint: string, body: unknown = {}): Promise<T> {
  const key = apiKey();
  const res = await fetch(`${workerUrl().replace(/\/+$/, '')}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new WorkerError('Too many requests; please retry shortly', 429);
  }
  if (!res.ok) {
    throw new WorkerError(`HTTP ${res.status}`, res.status);
  }

  const data = await res.json();
  if (data && data.success === false) {
    throw new WorkerError(data.error || `Worker rejected ${endpoint}`, res.status);
  }
  return data as T;
}

/** Liveness probe; unauthenticated by design so a bad key still reports reachability. */
export async function checkWorkerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl().replace(/\/+$/, '')}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
