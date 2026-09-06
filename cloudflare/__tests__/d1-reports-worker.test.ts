import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  timingSafeEqual,
  issueViewerToken,
  verifyViewerToken,
  parseBranch,
  DEFAULT_BRANCH,
  __testing,
} from '../d1-reports-worker.js';

const {
  SYNC_TABLES,
  assertItems,
  MAX_BATCH,
  MOVEMENT_LIMIT,
  TOKEN_TTL_MS,
  LOGIN_MAX_ATTEMPTS,
  readSnapshot,
  readPublicMenu,
  savePublicMenuConfig,
  MAX_MENU_CONFIG_CHARS,
  readBranches,
  saveBranch,
  BRANCH_NAME_MAX,
} = __testing;

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

  const EMPTY = [[], [], [], [], [], []];

  it('returns every collection the portal reads, including the stock ledger', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(Object.keys(snapshot).sort()).toEqual([
      'branches',
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
        [{ id: 'main' }],
      ])
    );

    // A swap here would silently show orders as customers, so the mapping is asserted
    // rather than assumed from the query order.
    expect(snapshot.orders).toEqual([{ id: 'o1' }]);
    expect(snapshot.customers).toEqual([{ id: 'c1' }]);
    expect(snapshot.inventory).toEqual([{ id: 'i1' }]);
    expect(snapshot.menuItems).toEqual([{ id: 'm1' }]);
    expect(snapshot.movements).toEqual([{ id: 'tx1' }]);
    expect(snapshot.branches).toEqual([{ id: 'main' }]);
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
    expect(db.seen).toHaveLength(6);
    for (const { sql } of db.seen) {
      expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(sql.toUpperCase()).not.toContain('SQLITE_MASTER');
    }
  });

  it('hides soft-deleted rows from every table that has a tombstone', async () => {
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    for (const table of ['orders', 'customers', 'inventory', 'menu_items', 'branches']) {
      const statement = db.seen.find((s) => s.sql.includes(`FROM ${table}`));
      expect(statement.sql, `${table} tombstone filter`).toContain('deleted_at IS NULL');
    }
  });
});

describe('readPublicMenu', () => {
  /**
   * D1 stand-in for the two statements this path issues: the config row, then the items.
   * `config` is what `SELECT data` returns, already serialised the way it is stored.
   */
  function menuDb({ config = null, items = [] }: { config?: unknown; items?: unknown[] }) {
    const seen: string[] = [];
    return {
      seen,
      prepare(sql: string) {
        seen.push(sql);
        const chain = {
          bind: () => chain,
          async all() {
            return { results: items };
          },
          async first() {
            return config === null ? null : { data: JSON.stringify(config) };
          },
          async run() {
            return { success: true };
          },
        };
        return chain;
      },
    };
  }

  it('returns menu items from the database', async () => {
    const rows = [{ id: 'm1', name: 'Espresso', price: 35, category: 'Hot Coffee|Bar' }];
    const res = await readPublicMenu(menuDb({ items: rows }) as any);
    expect(res.menuItems).toEqual(rows);
    expect(res.config).toBeNull();
  });

  it('filters out soft-deleted and unavailable items', async () => {
    const db = menuDb({ items: [] });
    await readPublicMenu(db as any);
    const itemsSql = db.seen.find((sql) => sql.includes('FROM menu_items')) as string;
    expect(itemsSql).toContain('deleted_at IS NULL');
    expect(itemsSql).toContain('available = 1 OR available IS NULL');
  });

  it('withholds a hidden item and a hidden category from the response itself', async () => {
    // Filtering only in the page would still ship the hidden rows to anyone who opens the
    // endpoint, which is not what the panel promises when it says "hidden from customers".
    const res = await readPublicMenu(
      menuDb({
        config: {
          hiddenItemIds: ['m2'],
          categories: [{ id: 'Desserts', label: '', hidden: true }],
        },
        items: [
          { id: 'm1', category: 'Hot Coffee|Bar' },
          { id: 'm2', category: 'Hot Coffee|Bar' },
          { id: 'm3', category: 'Desserts|Kitchen' },
        ],
      }) as any
    );

    expect(res.menuItems.map((row: { id: string }) => row.id)).toEqual(['m1']);
  });

  it('serves the menu with default wording when the stored config will not parse', async () => {
    const db = {
      prepare() {
        const chain = {
          bind: () => chain,
          async all() {
            return { results: [{ id: 'm1', category: 'Hot Coffee' }] };
          },
          async first() {
            return { data: '{not json' };
          },
        };
        return chain;
      },
    };

    const res = await readPublicMenu(db as any);
    expect(res.config).toBeNull();
    expect(res.menuItems).toHaveLength(1);
  });
});

describe('savePublicMenuConfig', () => {
  function writeDb() {
    const seen: Array<{ sql: string; bindings: unknown[] }> = [];
    return {
      seen,
      prepare(sql: string) {
        const statement = { sql, bindings: [] as unknown[] };
        seen.push(statement);
        const chain = {
          bind(...args: unknown[]) {
            statement.bindings = args;
            return chain;
          },
          async run() {
            return { success: true };
          },
        };
        return chain;
      },
    };
  }

  it('stores the configuration under a single row, without issuing DDL', async () => {
    // The table is created by /migrate. Creating it here meant every publish ran DDL on a
    // request path, and masked a database that had never been migrated.
    const db = writeDb();
    await savePublicMenuConfig(db as any, { storeName: 'مطعم الأصالة' });

    expect(db.seen).toHaveLength(1);
    expect(db.seen[0].sql).toContain('INSERT OR REPLACE INTO public_menu_config');
    expect(db.seen[0].sql.toUpperCase()).not.toContain('CREATE TABLE');
    expect(db.seen[0].bindings[0]).toBe('current');
    expect(JSON.parse(db.seen[0].bindings[1] as string)).toEqual({ storeName: 'مطعم الأصالة' });
  });

  it('rejects a non-object payload', async () => {
    for (const bad of [null, undefined, 'config', 42]) {
      await expect(savePublicMenuConfig(writeDb() as any, bad)).rejects.toThrow(/object/);
    }
  });

  it('rejects a configuration too large to serve on every menu view', async () => {
    const oversized = { bannerUrl: 'x'.repeat(MAX_MENU_CONFIG_CHARS + 100) };
    await expect(savePublicMenuConfig(writeDb() as any, oversized)).rejects.toThrow(/at most/);
  });
});

describe('parseBranch', () => {
  it('accepts a slug id with an Arabic display name', () => {
    const { branch, error } = parseBranch({ id: 'maadi_2', name: 'فرع المعادي' });
    expect(error).toBeUndefined();
    expect(branch).toEqual({
      id: 'maadi_2',
      name: 'فرع المعادي',
      phone: '',
      address: '',
      active: 1,
    });
  });

  it('lowercases the id, because branch_id comparisons are exact', () => {
    expect(parseBranch({ id: 'Main-2', name: 'x' }).branch.id).toBe('main-2');
  });

  it('rejects an id that would produce rows no filter can match', () => {
    // A space or a quote in branch_id is unreachable once it is stamped on a sale.
    for (const id of ['', ' ', 'main branch', "main'", 'فرع', '_main', 'a'.repeat(41)]) {
      expect(parseBranch({ id, name: 'x' }).error, id).toBeTruthy();
    }
  });

  it('requires a name, since the manager reads it on every screen', () => {
    expect(parseBranch({ id: 'main', name: '   ' }).error).toBeTruthy();
    expect(parseBranch({ id: 'main' }).error).toBeTruthy();
  });

  it('caps the name rather than truncating it silently', () => {
    expect(parseBranch({ id: 'main', name: 'x'.repeat(BRANCH_NAME_MAX) }).error).toBeUndefined();
    expect(parseBranch({ id: 'main', name: 'x'.repeat(BRANCH_NAME_MAX + 1) }).error).toBeTruthy();
  });

  it('trims the name and keeps optional contact details bounded', () => {
    const { branch } = parseBranch({
      id: 'main',
      name: '  الفرع الرئيسي  ',
      phone: '0'.repeat(50),
      address: 'a'.repeat(200),
    });
    expect(branch.name).toBe('الفرع الرئيسي');
    expect(branch.phone).toHaveLength(30);
    expect(branch.address).toHaveLength(120);
  });

  it('treats only an explicit false as closed, so a missing flag stays open', () => {
    expect(parseBranch({ id: 'main', name: 'x' }).branch.active).toBe(1);
    expect(parseBranch({ id: 'main', name: 'x', active: false }).branch.active).toBe(0);
    expect(parseBranch({ id: 'main', name: 'x', active: true }).branch.active).toBe(1);
  });

  it('rejects a non-object payload instead of throwing', () => {
    for (const input of [null, undefined, 'main', 42]) {
      expect(parseBranch(input).error).toBeTruthy();
    }
  });
});

describe('branch registry statements', () => {
  /** Records what was prepared and bound, so the SQL itself can be asserted. */
  function recordingDb(rows = []) {
    const seen = [];
    return {
      seen,
      prepare(sql) {
        const statement = { sql, bindings: [] };
        seen.push(statement);
        const chain = {
          bind(...args) {
            statement.bindings = args;
            return chain;
          },
          async all() {
            return { results: rows };
          },
          async run() {
            return { success: true };
          },
        };
        return chain;
      },
    };
  }

  it('reads only live branches, newest cap applied', async () => {
    const db = recordingDb([{ id: 'main', name: 'الفرع الرئيسي' }]);
    expect(await readBranches(db)).toEqual([{ id: 'main', name: 'الفرع الرئيسي' }]);
    expect(db.seen[0].sql).toContain('deleted_at IS NULL');
    expect(db.seen[0].sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
  });

  it('updates an existing branch in place rather than duplicating it', async () => {
    const db = recordingDb();
    await saveBranch(db, { id: 'main', name: 'اسم جديد', phone: '', address: '', active: 1 });

    const { sql, bindings } = db.seen[0];
    // Renaming a branch must not orphan the rows already stamped with its id.
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(bindings.slice(0, 2)).toEqual(['main', 'اسم جديد']);
  });
});

describe('DEFAULT_BRANCH', () => {
  it('is a valid branch, so a fresh database is never branchless', () => {
    expect(parseBranch(DEFAULT_BRANCH).error).toBeUndefined();
  });
});
