/**
 * Cloud Client — single source of truth for talking to the Cloudflare D1 Worker.
 *
 * Replaces the old pattern of POSTing raw SQL strings to the worker from
 * scattered call sites. All cloud traffic now:
 *   1. Goes through versioned endpoints (the worker owns the SQL, not the client).
 *   2. Carries an API key (X-API-Key header).
 *   3. Carries the session auth token (Authorization: Bearer) for manager routes.
 */

const LEGACY_DEFAULT_WORKER_URL = 'https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev';
const LS_API_KEY = 'brewmaster_cf_api_key';

/** Resolve the worker base URL: env first, then legacy fallback (kept for migration). */
export function getWorkerUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_CF_WORKER_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return LEGACY_DEFAULT_WORKER_URL;
}

/** The shared API key stored locally (entered once in Settings or seeded from env). */
export function getApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_CF_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) return envKey.trim();
  try {
    return localStorage.getItem(LS_API_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(LS_API_KEY, key.trim());
  } catch {
    // storage unavailable — ignore
  }
}

/** Session auth token issued by POST /auth/login (problem #4). */
export function getAuthToken(): string {
  try {
    const raw = localStorage.getItem('auth_session') || sessionStorage.getItem('auth_session');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return parsed?.branch?.authToken || '';
  } catch {
    return '';
  }
}

interface CloudRequestOptions {
  /** Attach Authorization: Bearer <session token> — required for /manager/* routes. */
  auth?: boolean;
}

/**
 * POST to a versioned worker endpoint and return the parsed JSON payload.
 * Throws on network errors, non-2xx responses, or { success: false } bodies.
 */
export async function cloudFetch<T = any>(
  path: string,
  body: unknown = {},
  options: CloudRequestOptions = {},
): Promise<T> {
  const url = `${getWorkerUrl()}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const apiKey = getApiKey();
  if (apiKey) headers['X-API-Key'] = apiKey;

  if (options.auth) {
    const token = getAuthToken();
    if (!token) {
      throw new Error('لا توجد جلسة دخول صالحة — سجّل الدخول أولاً');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`استجابة غير صالحة من الخادم (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  if (data && data.success === false) {
    throw new Error(data.error || 'فشل الطلب من الخادم');
  }
  return data as T;
}
