/**
 * Browser-side client for the Engaz Cloudflare worker.
 *
 * The worker exposes named endpoints and owns every SQL statement, so this module sends
 * data and filters only. It is used by the web build; the desktop build goes through the
 * Electron main process instead.
 *
 * This module deliberately holds no API key. The root bundle built from these sources is
 * served to the public (menu.engaz.tech), so anything it references through
 * `import.meta.env.VITE_*` is published to every visitor. The write key lives only in the
 * Electron main process, which reads it from the .env file at runtime.
 */

const DEFAULT_WORKER_URL = 'https://api.engaz.tech';

export function workerUrl(): string {
  return import.meta.env.VITE_CF_WORKER_URL || DEFAULT_WORKER_URL;
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
