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
  if (res.status === 409) return 'This branch id was deleted and is reserved; choose a new id';
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

export interface BranchRegistry {
  /** Live registry rows; the worker keeps the existing array shape. */
  branches: SnapshotRow[];
  /** Reserved, hidden registry ids, not business-row tombstones. */
  deletedBranchIds: string[];
}

/**
 * Older or partial replies cannot distinguish unknown tills from deleted branches.
 *
 * The truncation check is deliberately wider than what the worker can currently report: the
 * registry is never paged, because `completeBranchRegistry` fails rather than returning a
 * short page. It stays here so that a worker which starts paging the registry again is
 * refused at the portal instead of quietly losing tombstones.
 */
function readBranchRegistry(data: Partial<BranchRegistry> & { truncated?: Record<string, unknown> }): BranchRegistry {
  if (!Array.isArray(data.branches) || !Array.isArray(data.deletedBranchIds)
    || data.deletedBranchIds.some((id) => typeof id !== 'string' || !id)
    || data.truncated?.branches || data.truncated?.deletedBranchIds) {
    throw new Error('A complete branch registry with deletion metadata is required; refresh after the worker is updated');
  }
  return { branches: data.branches, deletedBranchIds: data.deletedBranchIds };
}

export interface Snapshot extends BranchRegistry {
  orders: SnapshotRow[];
  customers: SnapshotRow[];
  inventory: SnapshotRow[];
  menuItems: SnapshotRow[];
  /** Stock ledger, which is where cost of goods sold is derived from. */
  movements: SnapshotRow[];
  /** Cashiers list if provided by the reports worker. */
  cashiers?: SnapshotRow[];
  /**
   * Collections the worker stopped short of, because they hit its page cap.
   *
   * Any figure computed over a truncated collection is a lower bound, not a total.
   *
   * The branch registry is not listed here: the worker refuses an incomplete registry
   * outright rather than reporting it short, so there is no partial page to warn about.
   */
  truncated: Partial<Record<'orders' | 'customers' | 'inventory' | 'menuItems' | 'movements', true>>;
  /** When the worker read these rows, so the portal can show the age of what it displays. */
  serverTime: string;
}

/** The most pages a single dashboard load will walk before giving up. */
const MAX_SNAPSHOT_PAGES = 200;

/** A cursor returned by the worker, or anything a hostile response might put there. */
function isCursor(value: unknown): value is { createdAt: string; id: string } {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { createdAt?: unknown }).createdAt === 'string'
    && typeof (value as { id?: unknown }).id === 'string';
}

/**
 * The whole dashboard, walking the orders collection by cursor.
 *
 * Revenue, best sellers and the daily chart are computed over orders, so a page cap there
 * did not hide rows so much as make every total on screen a lower bound. The worker now
 * pages them and hands back a cursor, and this walks it until the worker says there is
 * nothing left.
 *
 * A worker that predates cursors simply returns no cursor, so this fetches exactly one page
 * and behaves as before — the truncation banner still covers that case.
 */
export async function fetchSnapshot(token: string): Promise<Snapshot> {
  const orders: SnapshotRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  let first: (Snapshot & { ordersNextCursor?: unknown }) | null = null;

  for (let page = 0; page < MAX_SNAPSHOT_PAGES; page++) {
    // Annotated rather than inferred: without it the compiler cannot resolve the type of
    // this binding, because the cursor read from it feeds the next request's body.
    const data: Snapshot & { ordersNextCursor?: unknown } = await post<Snapshot & { ordersNextCursor?: unknown }>(
      '/read/snapshot',
      cursor ? { ordersCursor: cursor } : {},
      token
    );
    orders.push(...(data.orders || []));
    if (!first) first = data;
    // Anything unexpected stops the walk rather than looping on a malformed value.
    cursor = isCursor(data.ordersNextCursor) ? data.ordersNextCursor : null;
    if (!cursor) break;
  }

  const data = (first || {}) as Snapshot;
  return {
    orders,
    customers: data.customers || [],
    inventory: data.inventory || [],
    menuItems: data.menuItems || [],
    movements: data.movements || [],
    ...readBranchRegistry(data),
    cashiers: data.cashiers || [],
    // Orders are no longer capped, so they cannot be in this set. The other collections
    // still can be; the portal says so when they are.
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
): Promise<BranchRegistry> {
  const data = await post<BranchRegistry>('/branches/save', { branch }, token);
  return readBranchRegistry(data);
}

/**
 * Soft-deletes one branch. The id is tombstoned on the server rather than dropped, so rows
 * stamped with that id keep their history readable.
 */
export async function deleteBranch(token: string, id: string): Promise<SnapshotRow[]> {
  const data = await post<{ branches?: SnapshotRow[] }>('/branches/delete', { id }, token);
  return data.branches || [];
}
