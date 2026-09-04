import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  timingSafeEqual,
  issueViewerToken,
  verifyViewerToken,
  __testing,
} from '../d1-reports-worker.js';

const { SYNC_TABLES, assertItems, MAX_BATCH, MOVEMENT_LIMIT, TOKEN_TTL_MS, LOGIN_MAX_ATTEMPTS, readSnapshot, readPublicMenu } =
  __testing;

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

describe('readSnapshot', () => {
  /** Minimal D1 stand-in: records the statements and replays canned rows in order. */
  function fakeDb(resultSets) {
    const seen = [];
    return {
      seen,
      prepare(sql) {
        const statement = { sql, bindings: [] };
        seen.push(statement);
        return {
          bind(...args) {
            statement.bindings = args;
            return this;
          },
        };
      },
      async batch() {
        return resultSets.map((results) => ({ results }));
      },
    };
  }

  const EMPTY = [[], [], [], [], []];

  it('returns every collection the portal reads, including the stock ledger', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(Object.keys(snapshot).sort()).toEqual([
      'customers',
      'inventory',
      'menuItems',
      'movements',
      'orders',
      'serverTime',
    ]);
  });

  it('maps each result set to its own collection, in order', async () => {
    const snapshot = await readSnapshot(
      fakeDb([
        [{ id: 'o1' }],
        [{ id: 'c1' }],
        [{ id: 'i1' }],
        [{ id: 'm1' }],
        [{ id: 'tx1' }],
      ])
    );

    // A swap here would silently show orders as customers, so the mapping is asserted
    // rather than assumed from the query order.
    expect(snapshot.orders).toEqual([{ id: 'o1' }]);
    expect(snapshot.customers).toEqual([{ id: 'c1' }]);
    expect(snapshot.inventory).toEqual([{ id: 'i1' }]);
    expect(snapshot.menuItems).toEqual([{ id: 'm1' }]);
    expect(snapshot.movements).toEqual([{ id: 'tx1' }]);
  });

  it('stamps the server time so the portal can show data age', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(Number.isNaN(new Date(snapshot.serverTime).getTime())).toBe(false);
  });

  it('gives the movement ledger a larger cap than the row tables', async () => {
    // One order writes one movement per ingredient, so sharing READ_LIMIT would drop the
    // older sales from the cost of goods while their orders were still listed.
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    const ledger = db.seen.find((s) => s.sql.includes('inventory_transactions'));
    expect(ledger.bindings).toEqual([MOVEMENT_LIMIT]);
    expect(MOVEMENT_LIMIT).toBeGreaterThan(1000);
  });

  it('reads only, and never reaches the SQLite catalogue', async () => {
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    expect(db.seen).toHaveLength(5);
    for (const { sql } of db.seen) {
      expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(sql.toUpperCase()).not.toContain('SQLITE_MASTER');
    }
  });

  it('hides soft-deleted rows from every table that has a tombstone', async () => {
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    for (const table of ['orders', 'customers', 'inventory', 'menu_items']) {
      const statement = db.seen.find((s) => s.sql.includes(`FROM ${table}`));
      expect(statement.sql, `${table} tombstone filter`).toContain('deleted_at IS NULL');
    }
  });
});

describe('readPublicMenu', () => {
  it('returns menu items from the database', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                return { results: [{ id: 'm1', name: 'Espresso', price: 35, category: 'Hot Coffee|Bar' }] };
              },
            };
          },
        };
      },
    };
    const res = await readPublicMenu(db as any);
    expect(res.menuItems).toEqual([{ id: 'm1', name: 'Espresso', price: 35, category: 'Hot Coffee|Bar' }]);
  });

  it('filters out soft-deleted and unavailable items', async () => {
    let capturedSql = '';
    const db = {
      prepare(sql: string) {
        capturedSql = sql;
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    };
    await readPublicMenu(db as any);
    expect(capturedSql).toContain('deleted_at IS NULL');
    expect(capturedSql).toContain('available = 1 OR available IS NULL');
  });
});
