/**
 * Shared primitives for the Engaz workers.
 *
 * Both workers guard a database that is reachable from the internet, and both had grown
 * their own copies of the same few functions. A timing-safe comparison with two
 * implementations is one copy that can drift, and a rate limiter with two is a budget that
 * can be fixed on one side and left broken on the other — which is exactly what happened.
 *
 * Everything here is pure: no bindings, no request, no I/O. It exists so that the two
 * workers cannot disagree about what a safe value or a fair budget looks like.
 */

// ─── Constant-time comparison ────────────────────────────────────────────────

/** Length-independent comparison so a key check does not leak length via timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return diff === 0;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Fixed window per client, held in isolate memory. Cloudflare may run several isolates per
// colo, so the effective ceiling is a multiple of this — it is a brake on scripted abuse,
// not a precise quota. A precise one needs a Durable Object; this needs no binding and
// cannot fail open.

const RATE_WINDOW_MS = 60_000;

/** Budget for a caller that has not identified itself. */
export const RATE_MAX_REQUESTS = 120;

/**
 * Budget for a caller that already holds a valid API key.
 *
 * A till syncs every 30 seconds and pages through its backlog, so a cold or busy branch
 * legitimately sends several hundred requests a minute — and several tills can share one
 * public address. At the anonymous budget the limiter reads that as abuse and answers 429,
 * which the client answers by backing off, so the branch falls further behind.
 *
 * Bucketing stays by address rather than by key: one write key is shared by every install,
 * so a per-key bucket would put the whole estate in a single bucket and throttle the busiest
 * branch against the quietest.
 */
export const SYNC_RATE_MAX_REQUESTS = 600;

/**
 * A rate budget, unless the deployment has overridden it.
 *
 * These defaults are a guess against traffic nobody can predict from here; being able to set
 * them means a branch reporting spurious 429s can be unblocked without a code change.
 */
export function budgetFor(env, name, fallback) {
  const configured = Number(env && env[name]);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

export function checkRateLimit(clientId, max = RATE_MAX_REQUESTS, now = Date.now(), buckets) {
  const bucket = buckets.get(clientId);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Drop expired buckets so a long-lived isolate cannot grow unboundedly.
    if (buckets.size > 10_000) {
      for (const [id, b] of buckets) if (now >= b.resetAt) buckets.delete(id);
    }
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

// ─── Input coercion ──────────────────────────────────────────────────────────
// Values arrive over the network and go straight into bind parameters. D1 rejects undefined
// and objects, and a NaN would be stored as a number that poisons every sum downstream, so
// each field is coerced to the exact type its column expects.

export function str(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function num(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerces a value D1 will store in an INTEGER flag column.
 *
 * A plain truthiness test is wrong for the one shape this actually receives: JSON booleans
 * arrive as booleans, but a client that serialises form data — or a row replayed from a
 * backup — sends the *string* `"false"`, and `"false"` is truthy. Every such item was stored
 * as available = 1, so an item the manager had unpublished appeared on the public menu.
 *
 * Anything unrecognised keeps the old truthiness behaviour rather than guessing: the column
 * is an integer flag, and a value that is neither a known false nor a known true is treated
 * the way it always was.
 */
export function bool01(value) {
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === '' || text === 'false' || text === '0' || text === 'no' || text === 'off') return 0;
    if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return 1;
  }
  return value ? 1 : 0;
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * What an error response may tell the caller.
 *
 * A raw D1 message carries the schema with it: `no such table: customers`,
 * `table orders has no column named paidAt`, and the constraint names behind a failed write.
 * Handing that to whoever knocked on a public endpoint is a free map of the database, and
 * one unauthenticated read path used to do exactly that.
 *
 * A 4xx is the caller's fault and they need the detail to fix it, so those pass through. A
 * 5xx is ours: the caller can act on "try again", not on the name of a missing index, so the
 * real message goes to the worker log where an operator can read it.
 */
export function clientError(err, status) {
  const message = String((err && err.message) || err || 'Unknown error');
  if (status >= 400 && status < 500 && err?.isRejection === true) return message;
  console.error('[worker] internal error:', message);
  return 'Internal server error';
}

/**
 * Drops inline image data from the rows that overflow a byte budget.
 *
 * Returns the rows in their original order, so the menu does not reshuffle when part of it
 * loses its pictures, and a flag telling the caller that it happened — a silent truncation
 * is indistinguishable from a menu that genuinely has no photos.
 *
 * @param {Array<object>} rows
 * @param {string} field the column holding the inline data URI
 * @param {number} budget total bytes of inline image data allowed in one response
 */
export function boundInlineImages(rows, field, budget = MAX_PUBLIC_IMAGE_TOTAL_BYTES) {
  if (!Array.isArray(rows)) return { rows: [], imagesTruncated: false };

  let remaining = Number.isFinite(budget) ? budget : 0;
  let imagesTruncated = false;

  const bounded = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const value = row[field];
    if (typeof value !== 'string' || value === '') return row;

    const size = new TextEncoder().encode(value).byteLength;
    if (size > remaining) {
      imagesTruncated = true;
      const { [field]: _omitted, ...rest } = row;
      return rest;
    }
    remaining -= size;
    return row;
  });

  return { rows: bounded, imagesTruncated };
}

/**
 * Removes columns a caller has no use for.
 *
 * `/read/snapshot` returns `SELECT *`, so every avatar and product photo on every row
 * travelled to a portal that renders analytics and never draws either one. A thousand orders
 * each carrying a 400 kB avatar is 400 MB of JSON per poll, paid by the manager's browser and
 * by the worker's memory limit.
 *
 * @param {Array<object>} rows
 * @param {string[]} fields columns to drop
 */
export function omitFields(rows, fields) {
  if (!Array.isArray(rows)) return [];
  const drop = new Set(Array.isArray(fields) ? fields : []);
  if (drop.size === 0) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const kept = {};
    for (const [key, value] of Object.entries(row)) {
      if (!drop.has(key)) kept[key] = value;
    }
    return kept;
  });
}

// ─── Field bounds ────────────────────────────────────────────────────────────
// Unbounded text is the cheapest way to hurt these workers: at 200 records a batch, a single
// authenticated call could otherwise carry tens of megabytes into D1.

export const MAX_TEXT_BYTES = 4_000;
export const MAX_IMAGE_BYTES = 400_000;

/**
 * Ceiling on inline image data in a single public response.
 *
 * One image may be `MAX_IMAGE_BYTES` (400 kB of base64) and a read may return 1000 rows, so
 * the arithmetic worst case for an unauthenticated `/read/public-menu` was ~400 MB — three
 * times the memory a Worker is allowed to use, and a denial of service available to anyone
 * who can guess the hostname.
 *
 * Images are dropped from the tail of the response once the budget is spent. Losing a picture
 * is visible and recoverable; a response the worker cannot build at all is neither, and items
 * still render without their photo.
 */
export const MAX_PUBLIC_IMAGE_TOTAL_BYTES = 8_000_000;
export const MAX_JSON_BYTES = 64_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Trims a text field to its cap rather than rejecting the record it belongs to. */
export function capped(value, max) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * An order's line items, as the JSON text the column stores.
 *
 * Already-encoded text is passed through: the desktop stores this column as a string and
 * re-sends it verbatim, so re-encoding would double-escape it.
 *
 * Unlike the text fields this is refused rather than trimmed: cutting a JSON document at an
 * arbitrary byte leaves an order nobody can parse, which is worse than one that stays
 * unsynced.
 */
export function orderItemsJson(items) {
  const text = typeof items === 'string' ? items : JSON.stringify(items ?? []);
  if (text.length > MAX_JSON_BYTES) {
    throw rejected(`Order items exceed ${MAX_JSON_BYTES} characters`);
  }
  return text;
}

// ─── Write accounting ────────────────────────────────────────────────────────
// A batch result says how many rows each statement actually changed. Reporting the number
// of statements instead is what made a till believe a write had landed when it had not:
// an upsert whose last-writer-wins predicate failed, a tombstone older than the row it
// targeted, and a ledger duplicate dropped by INSERT OR IGNORE all change zero rows while
// still being one statement that was sent.

/** Logical row changes only; physical rows_written cannot prove acceptance. */
export function countWritten(batchResults) {
  if (!Array.isArray(batchResults)) return 0;
  return batchResults.reduce((total, result) => {
    const changes = result?.meta?.changes;
    return total + (result?.success === true && Number.isSafeInteger(changes) && changes > 0 ? changes : 0);
  }, 0);
}

// A summary alone cannot acknowledge a no-op. The sync executor verifies its stored state.
export function summariseBatch(results, kinds) {
  const list = Array.isArray(results) ? results : [];
  const expected = Array.isArray(kinds) ? kinds.length : list.length;
  const accepted = list.slice(0, expected).filter((result) => countWritten([result]) > 0).length;
  return { written: countWritten(list.slice(0, expected)), expected, skipped: expected - accepted };
}

// ─── Rejections ──────────────────────────────────────────────────────────────

/**
 * An error caused by what the caller sent, rather than by the worker or its database.
 *
 * The flag is what lets the router answer 400 instead of 500. A validation failure is not a
 * server fault, and dressing it up as one hides real outages among ordinary bad input.
 */
export function rejected(message) {
  const error = new Error(message);
  error.isRejection = true;
  return error;
}
