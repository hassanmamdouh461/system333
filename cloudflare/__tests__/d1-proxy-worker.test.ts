import { describe, it, expect } from 'vitest';
import { checkRateLimit, timingSafeEqual, RATE_MAX_REQUESTS, SYNC_RATE_MAX_REQUESTS, __testing } from '../d1-proxy-worker.js';

const {
  SYNC_TABLES, buildSyncStatements, buildSyncBatch, summariseBatch, countWritten, assertItems, MAX_BATCH,
  MAX_TEXT_BYTES, MAX_IMAGE_BYTES, MAX_JSON_BYTES, BRANCH_ID_MAX,
} = __testing;

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
  it('exposes exactly the seven tables the POS syncs', () => {
    // A new target must be added deliberately: an unlisted path 404s rather than silently
    // writing somewhere unexpected.
    expect(Object.keys(SYNC_TABLES).sort()).toEqual([
      'cashiers',
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

  it('guards a soft delete with the same last-writer-wins predicate as an upsert', () => {
    // A tombstone that ignores timestamps lets a stale delete from an offline branch
    // erase a row another branch edited more recently.
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', deletedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const { sql, params } = db.prepared[0];
    expect(sql).toContain('SET deleted_at = ?');
    expect(sql).toMatch(/AND \(updated_at IS NULL OR \? > updated_at\)/);

    // The guard is compared against the incoming timestamp, not against NULL.
    expect(params[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(params[2]).toBe('o1');
    expect(params[3]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to deletedAt when a delete carries no updatedAt', () => {
    // The tombstone still needs a comparable timestamp, otherwise the guard would compare
    // against NULL and silently drop every delete that omits one.
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(db.prepared[0].params[1]).toBe('2026-01-01T00:00:00.000Z');
    expect(db.prepared[0].params[3]).toBe('2026-01-01T00:00:00.000Z');
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

describe('sync field size limits', () => {
  /**
   * Every one of these is about the same failure: one authenticated call carries up to
   * MAX_BATCH records, so an unbounded field multiplies into tens of megabytes in a single
   * request, and one oversized record fails the batch for everyone in it.
   */
  it('truncates an oversized menu text field instead of failing the batch', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES['menu-items'], [
      { id: 'm1', name: 'x'.repeat(MAX_TEXT_BYTES + 500), description: 'ي'.repeat(MAX_TEXT_BYTES + 1) },
    ]);
    const params = db.prepared[0].params;
    expect(params[1]).toHaveLength(MAX_TEXT_BYTES);
    expect(params[2]).toHaveLength(MAX_TEXT_BYTES);
  });

  it('truncates a menu image to its own larger cap', () => {
    // A base64 photo is legitimately bigger than a name, so it has a separate limit.
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES['menu-items'], [
      { id: 'm1', image: 'A'.repeat(MAX_IMAGE_BYTES + 10) },
    ]);
    expect(db.prepared[0].params[5]).toHaveLength(MAX_IMAGE_BYTES);
  });

  it('leaves a field under the cap untouched', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES['menu-items'], [{ id: 'm1', name: 'Latte' }]);
    expect(db.prepared[0].params[1]).toBe('Latte');
  });

  it('refuses order items too large to store rather than writing corrupt JSON', () => {
    // Truncating JSON produces an unparseable column, which breaks the order on every
    // screen that reads it. Refusing leaves the row unsynced and readable.
    const db = fakeDb();
    const huge = [{ name: 'x'.repeat(MAX_JSON_BYTES), quantity: 1 }];
    expect(() => buildSyncStatements(db, SYNC_TABLES.orders, [{ id: 'o1', items: huge }]))
      .toThrow(/items/i);
    // The statement was prepared but never bound, so nothing reaches D1 for this record.
    expect(db.prepared[0].params).toHaveLength(0);
  });

  it('accepts order items within the cap', () => {
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', items: [{ name: 'x'.repeat(100), quantity: 1 }] },
    ]);
    expect(db.prepared).toHaveLength(1);
  });

  it('rejects a branch id too long to be a real branch', () => {
    // The id is copied onto every row the branch writes, so an oversized one is not just a
    // bad value — it is stored thousands of times and matched by nothing.
    const db = fakeDb();
    expect(() => buildSyncStatements(db, SYNC_TABLES.orders, [
      { id: 'o1', branchId: 'b'.repeat(BRANCH_ID_MAX + 1) },
    ])).toThrow(/branchId/i);
  });

  it('still accepts a short branch id and a missing one', () => {
    // A row written before the branch feature existed has no branch; NULL means shared and
    // must keep syncing, otherwise every legacy row would be stranded.
    const db = fakeDb();
    buildSyncStatements(db, SYNC_TABLES.orders, [{ id: 'o1', branchId: 'maadi-2' }]);
    expect(db.prepared[0].params[18]).toBe('maadi-2');

    const db2 = fakeDb();
    buildSyncStatements(db2, SYNC_TABLES.orders, [{ id: 'o2' }]);
    expect(db2.prepared[0].params[18]).toBeNull();
  });

  it('bounds the free-text fields of every table that has one', () => {
    const cases: Array<[keyof typeof SYNC_TABLES, Record<string, unknown>, number]> = [
      ['orders', { id: 'o1', customerPhone: 'p'.repeat(9999), orderNumber: 'n'.repeat(9999) }, MAX_TEXT_BYTES],
      ['customers', { id: 'c1', name: 'n'.repeat(9999), phone: 'p'.repeat(9999) }, MAX_TEXT_BYTES],
      ['inventory', { id: 'i1', name: 'n'.repeat(9999), unit: 'u'.repeat(9999) }, MAX_TEXT_BYTES],
      ['inventory-transactions', { id: 't1', notes: 'n'.repeat(9999) }, MAX_TEXT_BYTES],
    ];
    for (const [target, record, cap] of cases) {
      const db = fakeDb();
      buildSyncStatements(db, SYNC_TABLES[target], [record]);
      for (const param of db.prepared[0].params) {
        if (typeof param === 'string') expect(param.length).toBeLessThanOrEqual(cap);
      }
    }
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
  // The budget is an explicit argument now: the limiter is shared with the reports worker,
  // which meters sync traffic against a different number from anonymous traffic.
  const limit = (clientId: string, now: number, buckets: Map<string, unknown>, max = RATE_MAX_REQUESTS) =>
    checkRateLimit(clientId, max, now, buckets as never);

  it('allows a client under the limit', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) {
      expect(limit('1.2.3.4', now, buckets).allowed).toBe(true);
    }
  });

  it('blocks a client once it exceeds the window budget', () => {
    const buckets = new Map();
    const now = 1_000_000;
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      if (!limit('1.2.3.4', now, buckets).allowed) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('honours the budget it is given rather than a fixed one', () => {
    // This is the whole reason the budget is a parameter: a till is allowed far more than an
    // anonymous caller, and the same limiter serves both.
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) limit('1.2.3.4', now, buckets, SYNC_RATE_MAX_REQUESTS);
    expect(limit('1.2.3.4', now, buckets, SYNC_RATE_MAX_REQUESTS).allowed).toBe(true);

    const tight = new Map();
    for (let i = 0; i < 200; i++) limit('1.2.3.4', now, tight, RATE_MAX_REQUESTS);
    expect(limit('1.2.3.4', now, tight, RATE_MAX_REQUESTS).allowed).toBe(false);
  });

  it('reports how long the caller must wait', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) limit('1.2.3.4', now, buckets);
    const result = limit('1.2.3.4', now, buckets);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) limit('1.2.3.4', now, buckets);
    // One noisy client must not lock out every other branch.
    expect(limit('5.6.7.8', now, buckets).allowed).toBe(true);
  });

  it('lets a blocked client through again in the next window', () => {
    const buckets = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 200; i++) limit('1.2.3.4', now, buckets);
    expect(limit('1.2.3.4', now, buckets).allowed).toBe(false);
    expect(limit('1.2.3.4', now + 61_000, buckets).allowed).toBe(true);
  });
});

describe('write accounting', () => {
  // A till marks a row synced on the strength of the number the worker reports, so the
  // number has to mean "rows the database actually changed" and nothing weaker.
  const batchWith = (rows: number[]) =>
    rows.map((rows_written) => ({ success: true, meta: { rows_written, changes: rows_written } }));

  it('counts rows written, not statements sent', () => {
    // Two upserts lost on updated_at and one landed: one row, not three.
    expect(summariseBatch(batchWith([0, 0, 1]), ['verify', 'verify', 'verify']))
      .toEqual({ written: 1, expected: 3, skipped: 2 });
  });

  it('does not treat a tombstone for an unknown row as a shortfall', () => {
    // A branch deleting an item the cloud never held sends an UPDATE that matches nothing.
    // Counting that as a failure would report a shortfall on almost every sync and bury
    // the ones that matter.
    expect(summariseBatch(batchWith([0, 1]), ['tombstone', 'verify']))
      .toEqual({ written: 1, expected: 1, skipped: 0 });
  });

  it('does not treat an already-present ledger row as a shortfall', () => {
    // Append-only: INSERT OR IGNORE matching zero rows means the movement was recorded.
    expect(summariseBatch(batchWith([0]), ['append']))
      .toEqual({ written: 0, expected: 0, skipped: 0 });
  });

  it('reports zero rather than guessing when the result set is missing', () => {
    // "We cannot tell" must never be reported as "written".
    expect(summariseBatch(undefined, ['verify', 'verify']))
      .toEqual({ written: 0, expected: 2, skipped: 2 });
    expect(countWritten(undefined)).toBe(0);
  });

  it('accepts the older `changes` field as well as `rows_written`', () => {
    expect(countWritten([{ meta: { changes: 3 } }, { meta: { rows_written: 4 } }])).toBe(7);
  });
});

describe('buildSyncBatch', () => {
  it('keeps the good records when one is rejected', () => {
    const db = fakeDb();
    const huge = JSON.stringify([{ name: 'x'.repeat(70_000) }]);
    const { statements, failed } = buildSyncBatch(db, SYNC_TABLES.orders, [
      { id: 'o1' },
      { id: 'o2', items: huge },
      { id: 'o3' },
    ]);

    // One malformed record used to abort the whole batch, and `db.batch` is a single
    // transaction -- so 199 good records died with the one bad one.
    expect(statements).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('o2');
    expect(failed[0].error).toMatch(/exceed/i);
  });

  it('names a record with no id so the till can hold it back', () => {
    const db = fakeDb();
    const { statements, failed } = buildSyncBatch(db, SYNC_TABLES.orders, [{ name: 'no id' }]);
    expect(statements).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBeNull();
  });

  it('labels each statement so the shortfall skips the harmless no-ops', () => {
    const db = fakeDb();
    const { kinds } = buildSyncBatch(db, SYNC_TABLES.orders, [
      { id: 'o1' },
      { id: 'o2', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(kinds).toEqual(['verify', 'tombstone']);
  });

  it('never labels a ledger row as needing to change a row', () => {
    const db = fakeDb();
    const { kinds } = buildSyncBatch(db, SYNC_TABLES['points-transactions'], [{ id: 'p1' }]);
    expect(kinds).toEqual(['append']);
  });
});
