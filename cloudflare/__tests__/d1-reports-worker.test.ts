import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  timingSafeEqual,
  issueViewerToken,
  verifyViewerToken,
  __testing,
} from '../d1-reports-worker.js';

const { SYNC_TABLES, assertItems, MAX_BATCH, TOKEN_TTL_MS, LOGIN_MAX_ATTEMPTS } = __testing;

const SECRET = 'reports-token-secret-for-tests';

describe('mirror targets', () => {
  it('covers every collection the POS mirrors', () => {
    expect(Object.keys(SYNC_TABLES).sort()).toEqual([
      'customers',
      'inventory',
      'inventory-transactions',
      'menu-items',
      'orders',
      'points-transactions',
    ]);
  });

  it('never emits a destructive verb or reaches the SQLite catalogue', () => {
    // The old guard let `SELECT * FROM sqlite_master WHERE name LIKE '%orders%'` through,
    // because the word "orders" appeared anywhere in the string. There is no client SQL to
    // guard now, so the property to assert is about the statements this worker itself owns.
    for (const spec of Object.values(SYNC_TABLES)) {
      const sql = spec.upsert.toUpperCase();
      expect(sql).not.toMatch(/\bDROP\b/);
      expect(sql).not.toMatch(/\bDELETE\b/);
      expect(sql).not.toMatch(/\bATTACH\b/);
      expect(sql).not.toMatch(/\bPRAGMA\b/);
      expect(sql).not.toContain('SQLITE_MASTER');
    }
  });

  it('writes each target only to its own table', () => {
    for (const spec of Object.values(SYNC_TABLES)) {
      expect(spec.upsert).toContain(spec.table);
    }
  });

  it('binds one parameter per placeholder', () => {
    // A mismatch here is a silent column shift: values land in the wrong columns.
    for (const [target, spec] of Object.entries(SYNC_TABLES)) {
      const placeholders = (spec.upsert.match(/\?/g) || []).length;
      const bound = spec.params({ id: 'x' }).length;
      expect(bound, `${target} parameter count`).toBe(placeholders);
    }
  });
});

describe('assertItems', () => {
  it('accepts an array within the batch cap', () => {
    expect(assertItems([])).toEqual([]);
    expect(assertItems(new Array(MAX_BATCH).fill({ id: 'x' }))).toHaveLength(MAX_BATCH);
  });

  it('rejects a non-array payload and an oversized batch', () => {
    expect(() => assertItems('orders')).toThrow(/items/);
    expect(() => assertItems(new Array(MAX_BATCH + 1).fill({ id: 'x' }))).toThrow(/max/);
  });
});

describe('viewer tokens', () => {
  it('issues a token that verifies against the same secret', async () => {
    const { token, expiresAt } = await issueViewerToken(SECRET);
    expect(expiresAt).toBeGreaterThan(Date.now());
    await expect(verifyViewerToken(SECRET, token)).resolves.toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    // This is what makes the token unforgeable by the static site that carries it.
    const { token } = await issueViewerToken(SECRET);
    await expect(verifyViewerToken('another-secret', token)).resolves.toBe(false);
  });

  it('rejects a token whose payload was edited', async () => {
    const { token } = await issueViewerToken(SECRET);
    const [payload, signature] = token.split('.');
    const forgedPayload = btoa(JSON.stringify({ scope: 'read', expiresAt: Date.now() + 10 ** 12 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await expect(verifyViewerToken(SECRET, `${forgedPayload}.${signature}`)).resolves.toBe(false);
  });

  it('rejects an expired token', async () => {
    const issuedAt = Date.now() - TOKEN_TTL_MS - 1000;
    const { token } = await issueViewerToken(SECRET, issuedAt);
    await expect(verifyViewerToken(SECRET, token)).resolves.toBe(false);
  });

  it('rejects malformed input rather than throwing', async () => {
    for (const bad of ['', 'no-dot', 'a.b', '.', null, undefined, 123]) {
      await expect(verifyViewerToken(SECRET, bad as string)).resolves.toBe(false);
    }
  });

  it('expires within the documented window', async () => {
    const now = 1_700_000_000_000;
    const { expiresAt } = await issueViewerToken(SECRET, now);
    expect(expiresAt).toBe(now + TOKEN_TTL_MS);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(timingSafeEqual('key', 'key')).toBe(true);
    expect(timingSafeEqual('key', 'keys')).toBe(false);
    expect(timingSafeEqual('key', 'ke')).toBe(false);
    expect(timingSafeEqual(null as unknown as string, 'key')).toBe(false);
  });
});

describe('checkRateLimit', () => {
  it('gives the login path a much tighter budget than reads', () => {
    // Guessing a password only pays off if you can guess many times.
    expect(LOGIN_MAX_ATTEMPTS).toBeLessThan(30);
  });

  it('blocks a client that exhausts its login attempts', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now, buckets).allowed).toBe(true);
    }
    expect(checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now, buckets).allowed).toBe(false);
  });

  it('keeps the login budget separate from the read budget', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now, buckets);
    // Exhausting login attempts must not lock the same visitor out of reading reports.
    expect(checkRateLimit('1.2.3.4', 120, now, buckets).allowed).toBe(true);
  });

  it('resets in the next window', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i <= LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now, buckets);
    }
    expect(checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now, buckets).allowed).toBe(false);
    expect(checkRateLimit('login:1.2.3.4', LOGIN_MAX_ATTEMPTS, now + 61_000, buckets).allowed).toBe(true);
  });
});
