/**
 * Client for the reports worker.
 *
 * This is a static site, so anything shipped in the bundle is public. It therefore holds no
 * API key: the viewer signs in with a password, the worker returns a short-lived read-only
 * token, and that token lives in session storage for the length of the visit.
 */

const WORKER_URL = import.meta.env.VITE_REPORTS_WORKER_URL || 'https://api-reports.engaz.tech';
const TOKEN_KEY = 'engaz_reports_token';

export interface StoredSession {
  token: string;
  expiresAt: number;
}

export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    // An expired token would just produce a 401 on first use; dropping it here means the
    // viewer sees the sign-in screen instead of an error.
    if (Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession) {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {}

async function post<T>(endpoint: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${WORKER_URL.replace(/\/+$/, '')}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  if (res.status === 401) throw new AuthError('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  if (res.status === 429) throw new Error('محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data && data.success === false) throw new Error(data.error || 'تعذر تنفيذ الطلب');
  return data as T;
}

export async function login(password: string): Promise<StoredSession> {
  const data = await post<{ token: string; expiresAt: number }>('/auth/login', { password });
  const session = { token: data.token, expiresAt: data.expiresAt };
  writeSession(session);
  return session;
}

export interface SnapshotRow {
  [key: string]: unknown;
}

export interface Snapshot {
  orders: SnapshotRow[];
  customers: SnapshotRow[];
  inventory: SnapshotRow[];
  menuItems: SnapshotRow[];
  /** Stock ledger, which is where cost of goods sold is derived from. */
  movements: SnapshotRow[];
  /** When the worker read these rows, so the portal can show the age of what it displays. */
  serverTime: string;
}

/** One request for the whole dashboard; the worker decides what a viewer may read. */
export async function fetchSnapshot(token: string): Promise<Snapshot> {
  const data = await post<Snapshot>('/read/snapshot', {}, token);
  return {
    orders: data.orders || [],
    customers: data.customers || [],
    inventory: data.inventory || [],
    menuItems: data.menuItems || [],
    movements: data.movements || [],
    serverTime: data.serverTime || new Date().toISOString(),
  };
}
