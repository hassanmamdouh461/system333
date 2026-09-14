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

export function bool01(value) {
  return value ? 1 : 0;
}

export function nowIso() {
  return new Date().toISOString();
}

// ─── Field bounds ────────────────────────────────────────────────────────────
// Unbounded text is the cheapest way to hurt these workers: at 200 records a batch, a single
// authenticated call could otherwise carry tens of megabytes into D1.

export const MAX_TEXT_BYTES = 4_000;
export const MAX_IMAGE_BYTES = 400_000;
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
