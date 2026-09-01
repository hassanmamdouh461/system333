import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit, timingSafeEqual, __testing } from '../d1-proxy-worker.js';

const { SYNC_TABLES, buildSyncStatements, assertItems, MAX_BATCH } = __testing;

/**
 * Minimal stand-in for the D1 binding. Records what each statement was and what it was
 * bound to, so a test can assert on the SQL the worker produced without a live database.
 */
function fakeDb() {
  const prepared: Array<{ sql: string; params: unknown[] }> = [];
  return {
    prepared,
    prepare(sql: string) {
      const entry = { sql, params: [] as unknown[] };
      prepared.push(entry);
      return {
        bind(...params: unknown[]) {
          entry.params = params;
          return entry;
        },
      };
    },
  };
}

describe('sync endpoint coverage', () => {
  it('exposes exactly the six tables the POS syncs', () => {
    // A new target must be added deliberately: an unlisted path 404s rather than silently
    // writing somewhere unexpected.
    expect(Object.keys(SYNC_TABLES).sort()).toEqual([
      'customers',
      'inventory',
      'inventory-transactions',
      'menu-items',
      'orders',
      'points-transactions',
    ]);
  });

  it('writes only to the table each target names', () => {
    for (const [target, spec] of Object.entries(SYNC_TABLES)) {
      expect(spec.upsert).toContain(spec.table);
      // No statement may reach a table other than its own, and none may touch SQLite's
      // internal catalogue.
      expect(spec.upsert.toLowerCase()).not.toContain('sqlite_master');
      expect(target).toBeTruthy();
    }
  });

  it('never emits a destructive verb', () => {
    for (const spec of Object.values(SYNC_TABLES)) {
      const sql = spec.upsert.toUpperCase();
      expect(sql).not.toMatch(/\bDROP\b/);
      expect(sql).not.toMatch(/\bDELETE\b/);
      expect(sql).not.toMatch(/\bATTACH\b/);
      expect(sql).not.toMatch(/\bPRAGMA\b/);
    }
  });

  it('binds every value as a parameter, never as literal SQL', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [{ id: "o1'; DROP TABLE orders; --" }]);

    // The hostile id lands in the parameter list, and the statement text is unchanged.
    expect(db.prepared).toHaveLength(1);
    expect(db.prepared[0].sql).not.toContain('DROP');
    expect(db.prepared[0].params[0]).toBe("o1'; DROP TABLE orders; --");
  });
});

describe('buildSyncStatements', () => {
  it('turns a deleted record into a soft-delete update', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(db.prepared[0].sql).toContain('SET deleted_at = ?');
    expect(db.prepared[0].sql).not.toContain('DELETE');
  });

  it('guards every upsert with a last-writer-wins predicate', () => {
    // Without this an older local row can overwrite newer cloud data, and a resurrected
    // row reappears on branches that deleted it.
    for (const target of ['orders', 'customers', 'menu-items', 'inventory'] as const) {
      expect(SYNC_TABLES[target].upsert).toContain('ON CONFLICT(id) DO UPDATE SET');
      expect(SYNC_TABLES[target].upsert).toMatch(/WHERE excluded\.updated_at > \w+\.updated_at/);
    }
  });

  it('ignores a re-sent ledger entry instead of overwriting it', () => {
    // Ledger rows are immutable: a duplicate id is a re-send, not a correction.
    for (const target of ['inventory-transactions', 'points-transactions'] as const) {
      expect(SYNC_TABLES[target].appendOnly).toBe(true);
      expect(SYNC_TABLES[target].upsert).toContain('INSERT OR IGNORE');
    }
  });

  it('never soft-deletes an append-only ledger row', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES['points-transactions'], [
      { id: 'p1', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(db.prepared[0].sql).toContain('INSERT OR IGNORE');
  });

  it('rejects a record with no id', () => {
    const db = fakeDb();
    expect(() => buildSyncStatements(db, SYNC_TABLES.orders, [{ name: 'no id' }])).toThrow(/id/);
  });

  it('coerces a non-finite number to a safe value rather than storing NaN', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [{ id: 'o1', totalAmount: 'not-a-number' }]);
    // One NaN in the column poisons every later SUM into NaN on screen.
    expect(db.prepared[0].params.some(p => Number.isNaN(p))).toBe(false);
  });

  it('serialises an items array so the column always holds JSON', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', items: [{ name: 'Latte', quantity: 2, price: 60 }] },
    ]);
    const itemsParam = db.prepared[0].params[3];
    expect(typeof itemsParam).toBe('string');
    expect(JSON.parse(itemsParam as string)).toHaveLength(1);
  });
});

describe('assertItems', () => {
  it('accepts an array within the batch cap', () => {
    expect(assertItems([])).toEqual([]);
    expect(assertItems(new Array(MAX_BATCH).fill({ id: 'x' }))).toHaveLength(MAX_BATCH);
  });

  it('rejects a non-array payload', () => {
    expect(() => assertItems(undefined)).toThrow(/items/);
    expect(() => assertItems({ id: 'x' })).toThrow(/items/);
  });

  it('rejects a batch over the cap', () => {
    expect(() => assertItems(new Array(MAX_BATCH + 1).fill({ id: 'x' }))).toThrow(/max/);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('secret-key', 'secret-key')).toBe(true);
  });

  it('rejects different strings, including a prefix and a length mismatch', () => {
    expect(timingSafeEqual('secret-key', 'secret-keys')).toBe(false);
    expect(timingSafeEqual('secret-key', 'secret-ke')).toBe(false);
    expect(timingSafeEqual('secret-key', 'Secret-key')).toBe(false);
  });

  it('rejects a missing header rather than throwing', () => {
    // A request with no X-API-Key arrives here as null.
    expect(timingSafeEqual(null as unknown as string, 'secret')).toBe(false);
    expect(timingSafeEqual(undefined as unknown as string, 'secret')).toBe(false);
  });
});

describe('checkRateLimit', () => {
  it('allows a client under the limit', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit('1.2.3.4', now, buckets).allowed).toBe(true);
    }
  });

  it('blocks a client once it exceeds the window budget', () => {
    const buckets = new Map();
    const now = 1_000_000;
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      if (!checkRateLimit('1.2.3.4', now, buckets).allowed) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('reports how long the caller must wait', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) checkRateLimit('1.2.3.4', now, buckets);
    const result = checkRateLimit('1.2.3.4', now, buckets);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) checkRateLimit('1.2.3.4', now, buckets);
    // One noisy client must not lock out every other branch.
    expect(checkRateLimit('5.6.7.8', now, buckets).allowed).toBe(true);
  });

  it('lets a blocked client through again in the next window', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) checkRateLimit('1.2.3.4', now, buckets);
    expect(checkRateLimit('1.2.3.4', now, buckets).allowed).toBe(false);
    expect(checkRateLimit('1.2.3.4', now + 61_000, buckets).allowed).toBe(true);
  });
});
