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

/**
 * How long a request may hang before the viewer is told.
 *
 * Without it a request that never settles leaves the dashboard on its loading state with no
 * error and no way to recover short of reloading the page. The snapshot is the largest
 * response the portal asks for, so the budget is set for it and shared by everything.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A message the viewer can act on, in Arabic, for whatever went wrong.
 *
 * The raw text is deliberately not shown. A proxy or a CDN error page answers with HTML, and
 * `res.json()` would then fail with an English parser message — which is what a manager would
 * otherwise be left reading on an Arabic interface.
 */
function friendlyError(res: Response): string {
  if (res.status === 401) return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى';
  if (res.status === 429) return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة';
  if (res.status === 503) return 'الخدمة غير متاحة مؤقتًا، أعد المحاولة بعد قليل';
  if (res.status >= 500) return 'حدث خطأ في الخادم، أعد المحاولة بعد قليل';
  if (res.status === 413) return 'البيانات المرسلة أكبر من المسموح';
  if (res.status >= 400) return 'تعذر تنفيذ الطلب';
  return `تعذر الاتصال بالخادم (${res.status})`;
}

async function post<T>(endpoint: string, body: unknown, token?: string): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL.replace(/\/+$/, '')}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: timeout.signal,
    });
  } catch {
    clearTimeout(timer);
    // An abort is this client's own timeout, not a network failure the viewer caused.
    if (timeout.signal.aborted) {
      throw new Error('استغرق الخادم وقتًا أطول من المتوقع، أعد المحاولة');
    }
    throw new Error('تعذر الوصول إلى الخادم، تحقق من الاتصال');
  }
  clearTimeout(timer);

  if (!res.ok) {
    if (res.status === 401) throw new AuthError(friendlyError(res));
    throw new Error(friendlyError(res));
  }

  const data = await res.json().catch(() => {
    throw new Error(friendlyError(res));
  });
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
  /** Branch registry, so a branch can be shown by name instead of by its id. */
  branches: SnapshotRow[];
  /** Cashiers list if provided by the reports worker. */
  cashiers?: SnapshotRow[];
  /**
   * Collections the worker stopped short of, because they hit its page cap.
   *
   * Any figure computed over a truncated collection is a lower bound, not a total.
   */
  truncated: Partial<Record<'orders' | 'customers' | 'inventory' | 'menuItems' | 'movements' | 'branches', true>>;
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
    branches: data.branches || [],
    cashiers: data.cashiers || [],
    // Absent on an older worker; the portal treats that as "nothing was reported short".
    truncated: data.truncated || {},
    serverTime: data.serverTime || new Date().toISOString(),
  };
}

/**
 * Registers or renames one branch.
 *
 * The only write the portal performs. It carries no sales figure and no customer detail, and
 * the worker re-validates the record: this client cannot be trusted about what a valid branch
 * id is, whatever the form checked first.
 */
export async function saveBranch(
  token: string,
  branch: { id: string; name: string; phone: string; address: string; active: boolean }
): Promise<SnapshotRow[]> {
  const data = await post<{ branches?: SnapshotRow[] }>('/branches/save', { branch }, token);
  return data.branches || [];
}

/**
 * Soft-deletes one branch. The id is tombstoned on the server rather than dropped, so rows
 * stamped with that id keep their history readable.
 */
export async function deleteBranch(token: string, id: string): Promise<SnapshotRow[]> {
  const data = await post<{ branches?: SnapshotRow[] }>('/branches/delete', { id }, token);
  return data.branches || [];
}
