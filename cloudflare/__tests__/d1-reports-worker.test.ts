import { describe, it, expect } from 'vitest';
import worker, {
  checkRateLimit,
  timingSafeEqual,
  issueViewerToken,
  verifyViewerToken,
  parseBranch,
  parseBranchId,
  DEFAULT_BRANCH,
  revokeSession,
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
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_JSON_BYTES,
  SYNC_RATE_MAX_REQUESTS,
  RATE_MAX_REQUESTS,
  budgetFor,
  readBranches,
  saveBranch,
  deleteBranch,
  BRANCH_NAME_MAX,
} = __testing;

const SECRET = 'reports-token-secret-for-tests';

describe('mirror targets', () => {
  it('covers every collection the POS mirrors', () => {
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

describe('mirror field bounds', () => {
  // The mirror has to bound fields the same way the POS worker does. If it does not, the two
  // databases drift apart and the manager portal shows a different record from the till that
  // took the order, with nothing to say which one is right.
  const paramsFor = (target: string, record: Record<string, unknown>) =>
    SYNC_TABLES[target as keyof typeof SYNC_TABLES].params(record) as unknown[];

  it('trims an oversized text field instead of storing it whole', () => {
    const [id, name] = paramsFor('menu-items', { id: 'm1', name: 'ن'.repeat(MAX_TEXT_BYTES + 500) });
    expect(id).toBe('m1');
    expect(name).toHaveLength(MAX_TEXT_BYTES);
  });

  it('trims an oversized image rather than dropping the record', () => {
    const image = paramsFor('menu-items', { id: 'm1', image: 'x'.repeat(MAX_IMAGE_BYTES + 10) })[5];
    expect(image).toHaveLength(MAX_IMAGE_BYTES);
  });

  it('stores the string "false" as unavailable, the way the POS worker does', () => {
    // The mirror used raw truthiness here, and "false" is truthy: an item the manager
    // unpublished reappeared on the public menu through the mirror path, and the two
    // databases disagreed about the same record.
    expect(paramsFor('menu-items', { id: 'm1', available: 'false' })[6]).toBe(0);
    expect(paramsFor('menu-items', { id: 'm1', available: '0' })[6]).toBe(0);
    expect(paramsFor('menu-items', { id: 'm1', available: false })[6]).toBe(0);
    expect(paramsFor('menu-items', { id: 'm1', available: 'true' })[6]).toBe(1);
    expect(paramsFor('menu-items', { id: 'm1', available: true })[6]).toBe(1);
  });

  it('matches the bounds the POS worker applies', () => {
    // Deliberate: these three numbers are copied from d1-proxy-worker.js on purpose. If one
    // side is tightened, this fails rather than letting the mirror drift silently.
    expect([MAX_TEXT_BYTES, MAX_IMAGE_BYTES, MAX_JSON_BYTES]).toEqual([4_000, 400_000, 64_000]);
  });

  it('refuses an order whose line items are too large rather than storing a truncated one', () => {
    // Cutting JSON at an arbitrary byte leaves an unparseable order, which is worse for the
    // manager reading it than an order that simply has not arrived yet.
    const oversized = [{ id: 'i1', name: 'x'.repeat(MAX_JSON_BYTES) }];
    expect(() => paramsFor('orders', { id: 'o1', items: oversized })).toThrow(/exceed/i);
  });

  it('still accepts an order whose line items fit', () => {
    const items = paramsFor('orders', { id: 'o1', items: [{ id: 'i1', name: 'شاي' }] });
    expect(items[0]).toBe('o1');
    expect(JSON.parse(items[12] as string)).toEqual([{ id: 'i1', name: 'شاي' }]);
  });

  it('leaves a record with no oversized fields untouched', () => {
    const [id, name, phone] = paramsFor('customers', { id: 'c1', name: 'أحمد', phone: '010' });
    expect([id, name, phone]).toEqual(['c1', 'أحمد', '010']);
  });
});

describe('viewer tokens', () => {
  it('issues a token that verifies against the same secret', async () => {
    const { token, expiresAt } = await issueViewerToken(SECRET);
    expect(expiresAt).toBeGreaterThan(Date.now());
    await expect(verifyViewerToken(SECRET, token)).resolves.toBe('read');
  });

  it('rejects a token signed with a different secret', async () => {
    // This is what makes the token unforgeable by the static site that carries it.
    const { token } = await issueViewerToken(SECRET);
    await expect(verifyViewerToken('another-secret', token)).resolves.toBeNull();
  });

  it('rejects a token whose payload was edited', async () => {
    const { token } = await issueViewerToken(SECRET);
    const [, signature] = token.split('.');
    const forgedPayload = btoa(JSON.stringify({ scope: 'read', expiresAt: Date.now() + 10 ** 12 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await expect(verifyViewerToken(SECRET, `${forgedPayload}.${signature}`)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const issuedAt = Date.now() - TOKEN_TTL_MS - 1000;
    const { token } = await issueViewerToken(SECRET, { now: issuedAt });
    await expect(verifyViewerToken(SECRET, token)).resolves.toBeNull();
  });

  it('rejects malformed input rather than throwing', async () => {
    for (const bad of ['', 'no-dot', 'a.b', '.', null, undefined, 123]) {
      await expect(verifyViewerToken(SECRET, bad as string)).resolves.toBeNull();
    }
  });

  it('expires within the documented window', async () => {
    const now = 1_700_000_000_000;
    const { expiresAt } = await issueViewerToken(SECRET, { now });
    expect(expiresAt).toBe(now + TOKEN_TTL_MS);
  });

  it('reports the write scope, so a branch edit is not satisfied by a read token', async () => {
    const { token } = await issueViewerToken(SECRET, { scope: 'write' });
    await expect(verifyViewerToken(SECRET, token)).resolves.toBe('write');
  });

  it('gives a write token a much shorter life than a read token', async () => {
    const now = 1_700_000_000_000;
    const read = await issueViewerToken(SECRET, { now });
    const write = await issueViewerToken(SECRET, { now, scope: 'write' });
    expect(write.expiresAt).toBeLessThan(read.expiresAt);
  });

  it('mints a distinct jti per token, so one can be revoked without another', async () => {
    // Revocation is not implemented yet, but without a jti it could never be added without
    // invalidating every live session.
    const a = await issueViewerToken(SECRET);
    const b = await issueViewerToken(SECRET);
    const claims = (t: string) => JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims(a.token).jti).toBeTruthy();
    expect(claims(a.token).jti).not.toBe(claims(b.token).jti);
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

  it('gives a caller holding the write key room for a real backlog', () => {
    // A till syncs every 30 seconds and pages through a backlog, so the anonymous budget is
    // not enough for one busy branch, let alone several sharing an address.
    expect(SYNC_RATE_MAX_REQUESTS).toBeGreaterThan(RATE_MAX_REQUESTS * 4);
  });

  it('lets a deployment raise the budget without a code change', () => {
    // The default is a guess; being able to override it is what stops a branch reporting
    // spurious 429s from needing a redeploy to be unblocked.
    expect(budgetFor({ RATE_MAX_REQUESTS: 900 }, 'RATE_MAX_REQUESTS', 120)).toBe(900);
    expect(budgetFor({ SYNC_RATE_MAX_REQUESTS: 5000 }, 'SYNC_RATE_MAX_REQUESTS', 600)).toBe(5000);
  });

  it('falls back to the default when the override is missing or unusable', () => {
    // A mistyped variable must not silently remove the brake, which is what `Number()` would
    // turn into a 0 budget if it were trusted.
    for (const env of [{}, null, undefined, { RATE_MAX_REQUESTS: '0' }, { RATE_MAX_REQUESTS: 'abc' }]) {
      expect(budgetFor(env as never, 'RATE_MAX_REQUESTS', 120)).toBe(120);
    }
  });

  it('lets an authenticated branch page through a backlog without being throttled', async () => {
    // RATE_MAX_REQUESTS + 10 in one window is what a cold branch walking its first sync
    // looks like. At the anonymous budget the tail of that walk gets 429, the client backs
    // off, and the branch falls further behind rather than catching up.
    const env = { REPORTS_API_KEY: 'write-key', DB: {} };
    const statuses: number[] = [];

    for (let i = 0; i < RATE_MAX_REQUESTS + 10; i++) {
      const res = await worker.fetch(
        new Request('https://api-reports.engaz.tech/not-an-endpoint', {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': 'write-key', 'CF-Connecting-IP': '10.0.0.99' },
        }),
        env as never
      );
      await res.text();
      statuses.push(res.status);
    }

    // 404, not 401: the key was accepted, and the request reached the router.
    expect(new Set(statuses)).toEqual(new Set([404]));
  });

  it('still throttles the same volume from a caller with no valid key', async () => {
    // The wider budget is granted on proof of the key, not on the presence of a header.
    const env = { REPORTS_API_KEY: 'write-key', DB: {} };
    let throttled = false;

    for (let i = 0; i < RATE_MAX_REQUESTS + 10; i++) {
      const res = await worker.fetch(
        new Request('https://api-reports.engaz.tech/not-an-endpoint', {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': 'not-the-key', 'CF-Connecting-IP': '10.0.0.100' },
        }),
        env as never
      );
      await res.text();
      if (res.status === 429) throttled = true;
    }

    expect(throttled).toBe(true);
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
    // Orders are read on their own because they are walked by cursor; everything else comes
    // back from one batch. The first result set belongs to the orders query.
    const [orders = [], ...rest] = resultSets;
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
          async all() {
            return { results: orders };
          },
        };
      },
      async batch() {
        return rest.map((results) => ({ results }));
      },
    };
  }

  // Orders first (its own query), then four business collections, then the branch registry
  // pair — live rows and the ids of entries a manager hid.
  const EMPTY = [[], [], [], [], [], [], []];

  it('returns every collection the portal reads, including the stock ledger', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(Object.keys(snapshot).sort()).toEqual([
      'branches',
      'customers',
      'deletedBranchIds',
      'inventory',
      'menuItems',
      'movements',
      'orders',
      'ordersNextCursor',
      'serverTime',
      'truncated',
    ]);
  });

  it('walks the orders by cursor instead of capping them', async () => {
    // Revenue, best sellers and the daily chart are all computed over orders, so a page cap
    // there did not hide rows so much as make every total a lower bound. A full page must
    // now come back with a cursor rather than a silent stop.
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `o${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 3 - i)).toISOString(),
    }));
    const snapshot = await readSnapshot(fakeDb([rows, [], [], [], [], [], []]), { ordersLimit: 2 });

    expect(snapshot.orders).toHaveLength(2, 'the probe row is never shown');
    // The cursor is (createdAt, id) so the walk is stable across identical timestamps.
    expect(snapshot.ordersNextCursor).toEqual({
      createdAt: rows[1].createdAt,
      id: rows[1].id,
    });
    // Nothing was cut short: orders are no longer reported as a truncated collection.
    expect(snapshot.truncated.orders).toBeUndefined();
  });

  it('hands back a keyset query when a cursor is supplied', async () => {
    const db = fakeDb([[], [], [], [], [], [], []]);
    await readSnapshot(db, { ordersCursor: { createdAt: '2026-01-02T00:00:00.000Z', id: 'o9' } });

    const statement = db.seen.find((s) => s.sql.includes('FROM orders'));
    expect(statement.sql).toMatch(/createdAt < \?/);
    expect(statement.bindings.slice(0, 3)).toEqual(['2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'o9']);
  });

  it('says when there is nothing left to fetch', async () => {
    // A short final page is how the caller knows to stop, rather than inferring it from a
    // row count that could legitimately be an exact multiple of the page size.
    const snapshot = await readSnapshot(fakeDb([[{ id: 'o1' }], [], [], [], [], [], []]), { ordersLimit: 10 });
    expect(snapshot.ordersNextCursor).toBeNull();
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
        [{ id: 'old-till' }],
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
    expect(snapshot.deletedBranchIds).toEqual(['old-till']);
  });

  it('stamps the server time so the portal can show data age', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(Number.isNaN(new Date(snapshot.serverTime).getTime())).toBe(false);
  });

  it('reports nothing truncated while every table fits its page', async () => {
    const snapshot = await readSnapshot(fakeDb(EMPTY));
    expect(snapshot.truncated).toEqual({});
  });

  it('flags a collection that hit its cap instead of returning a quiet partial page', async () => {
    // The portal sums revenue over these rows. A page that stopped at the cap without saying
    // so understates every figure on screen and looks exactly like a complete one.
    const full = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    const snapshot = await readSnapshot(fakeDb([
      [],                  // orders: paged by cursor, so it is never reported short
      full(1001),          // customers: probe row present
      [], [], [], [], [],
    ]));

    expect(snapshot.truncated).toEqual({ customers: true });
    // The probe row is never shown.
    expect(snapshot.customers).toHaveLength(1000);
  });

  it('flags the movement ledger against its own larger cap', async () => {
    const full = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    const snapshot = await readSnapshot(fakeDb([[], [], [], [], full(MOVEMENT_LIMIT + 1), [], []]));
    expect(snapshot.truncated).toEqual({ movements: true });
    expect(snapshot.movements).toHaveLength(MOVEMENT_LIMIT);
  });

  it('gives the movement ledger a larger cap than the row tables', async () => {
    // One order writes one movement per ingredient, so sharing READ_LIMIT would drop the
    // older sales from the cost of goods while their orders were still listed.
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    const ledger = db.seen.find((s) => s.sql.includes('inventory_transactions'));
    // One past the cap: the probe row is how truncation is detected without a COUNT.
    expect(ledger.bindings).toEqual([MOVEMENT_LIMIT + 1]);
    expect(MOVEMENT_LIMIT).toBeGreaterThan(1000);
  });

  it('reads only, and never reaches the SQLite catalogue', async () => {
    const db = fakeDb(EMPTY);
    await readSnapshot(db);
    expect(db.seen).toHaveLength(7);
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

  /**
   * These two used to be the same code path. A config that is missing and a config that
   * cannot be read both produced `null`, and `null` was treated as "nothing is hidden" — so
   * one corrupt blob published every item the manager had hidden, silently, on a public page.
   */
  it('withholds the whole menu when the stored config will not parse', async () => {
    const rows = [
      { id: 'm1', category: 'Hot Coffee' },
      { id: 'm2', category: 'Hot Coffee' },
    ];
    const db = {
      prepare() {
        const chain = {
          bind: () => chain,
          async all() {
            return { results: rows };
          },
          async first() {
            return { data: '{not json' };
          },
        };
        return chain;
      },
    };

    const res = await readPublicMenu(db as any);
    // The hidden set is unknown, so there is no safe subset to serve.
    expect(res.menuItems).toEqual([]);
    expect(res.config).toBeNull();
    expect(res.unavailable).toBe(true);
  });

  it('withholds the whole menu when a config row exists but is not an object', async () => {
    // `JSON.parse('"just a string"')` succeeds and yields a non-object, which is just as
    // unreadable as a parse error.
    const res = await readPublicMenu(menuDb({ config: 'a string', items: [{ id: 'm1' }] }) as any);
    expect(res.unavailable).toBe(true);
    expect(res.menuItems).toEqual([]);
  });

  it('withholds the whole menu when reading the config row throws', async () => {
    // A failing database read is not the same as an absent config: the hidden set is unknown.
    const db = {
      prepare() {
        const chain = {
          bind: () => chain,
          async all() {
            return { results: [{ id: 'm1' }] };
          },
          async first() {
            throw new Error('no such table: public_menu_config');
          },
        };
        return chain;
      },
    };
    const res = await readPublicMenu(db as any);
    expect(res.unavailable).toBe(true);
    expect(res.menuItems).toEqual([]);
  });

  it('still serves every item when nothing has ever been published', async () => {
    // Genuinely distinct from the cases above: no configuration means nothing is hidden,
    // and blanking the menu here would be an outage with no cause.
    const rows = [{ id: 'm1', category: 'Hot Coffee' }];
    const res = await readPublicMenu(menuDb({ items: rows }) as any);
    expect(res.menuItems).toEqual(rows);
    expect(res.unavailable).toBeUndefined();
  });

  it('does not mark a readable config as unavailable', async () => {
    const res = await readPublicMenu(
      menuDb({ config: { hiddenItemIds: [] }, items: [{ id: 'm1', category: 'Hot Coffee' }] }) as any
    );
    expect(res.unavailable).toBeUndefined();
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
  /**
   * Records what was prepared and bound, so the SQL itself can be asserted.
   *
   * `returning` is what the `RETURNING id` clause yields: a row when the write landed,
   * `null` when the id is already reserved by a tombstone.
   */
  function recordingDb({ rows = [], deletedRows = [], returning = { id: 'main' } } = {}) {
    const seen: { sql: string; bindings: unknown[] }[] = [];
    return {
      seen,
      prepare(sql: string) {
        const statement: { sql: string; bindings: unknown[] } = { sql, bindings: [] };
        seen.push(statement);
        const chain = {
          bind(...args: unknown[]) {
            statement.bindings = args;
            return chain;
          },
          async all() {
            return { results: rows };
          },
          async run() {
            return { success: true };
          },
          async first() {
            return returning;
          },
        };
        return chain;
      },
      /** Replays the registry pair in the order `branchRegistryStatements` issues it. */
      async batch(statements: unknown[]) {
        return statements.map((_, index) => ({ results: index === 0 ? rows : deletedRows }));
      },
    };
  }

  it('reads live branches and the ids a manager hid, in one batch', async () => {
    const db = recordingDb({
      rows: [{ id: 'main', name: 'الفرع الرئيسي' }],
      deletedRows: [{ id: 'old-till' }],
    });

    expect(await readBranches(db)).toEqual({
      branches: [{ id: 'main', name: 'الفرع الرئيسي' }],
      deletedBranchIds: ['old-till'],
    });

    expect(db.seen).toHaveLength(2);
    expect(db.seen[0].sql).toContain('deleted_at IS NULL');
    expect(db.seen[0].sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    expect(db.seen[1].sql).toContain('deleted_at IS NOT NULL');
    // One row past the cap: the probe is how a full registry is told from a complete one.
    expect(db.seen[0].bindings).toEqual([1001]);
  });

  it('fails loudly rather than reporting an incomplete registry as a complete one', async () => {
    // A registry missing its tombstone set is indistinguishable from "nothing was ever
    // hidden", and the portal would then present a hidden till as an unregistered one.
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      async batch() {
        return [{ results: [] }];
      },
    };
    await expect(readBranches(db as never)).rejects.toThrow(/could not be read completely/i);
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

  it('refuses to resurrect a hidden id, so a delete cannot be undone by a rename', async () => {
    // The `WHERE branches.deleted_at IS NULL ... RETURNING id` pair makes the reserve check
    // atomic: a separate existence check could be passed by a delete landing straight after.
    const db = recordingDb({ returning: null });
    await expect(
      saveBranch(db, { id: 'old-till', name: 'فرع قديم', phone: '', address: '', active: 1 })
    ).rejects.toThrow(/deleted and is reserved/i);
  });
});

describe('deleteBranch', () => {
  function recordingDb(changes = 1) {
    const seen: { sql: string; bindings: unknown[] }[] = [];
    return {
      seen,
      prepare(sql: string) {
        const statement: { sql: string; bindings: unknown[] } = { sql, bindings: [] };
        seen.push(statement);
        const chain = {
          bind(...args: unknown[]) {
            statement.bindings = args;
            return chain;
          },
          async run() {
            return { success: true, meta: { changes } };
          },
          async all() {
            return { results: [] };
          },
        };
        return chain;
      },
    };
  }

  it('tombstones the row rather than dropping it, so history keeps its ids', async () => {
    const db = recordingDb();
    await deleteBranch(db, 'main');

    const { sql, bindings } = db.seen[0];
    // The branches table is read by id everywhere; the registry must keep a tombstoned row
    // so already-mirrored sales stay matched to it.
    expect(sql.trim().toUpperCase()).toMatch(/^UPDATE\s+BRANCHES\b/);
    expect(sql).toContain('deleted_at');
    expect(sql).not.toMatch(/^DELETE\b/i);
    // The id is the third binding: timestamp, updated_at, id.
    expect(bindings[2]).toBe('main');
  });

  it('refuses to report success when no row carried that id', async () => {
    // The old version discarded the result, so deleting a nonexistent id told the portal
    // the branch was gone. That is the message a stale tab acts on.
    await expect(deleteBranch(recordingDb(0), 'ghost')).rejects.toThrow(/No branch with id/);
    await expect(deleteBranch(recordingDb(0), 'ghost')).rejects.toMatchObject({ isRejection: true });
  });
});

describe('parseBranchId', () => {
  it('normalizes the id, the same way saveBranch does', () => {
    expect(parseBranchId({ id: '  Maadi_2 ' })).toEqual({ id: 'maadi_2' });
  });

  it('rejects an id that could never appear on a branch_id column', () => {
    for (const id of ['', '  ', "main'", 'فرع', '-main', 'a'.repeat(41)]) {
      expect(parseBranchId({ id }).error, id).toBeTruthy();
    }
  });

  it('accepts a bare string for callers that send only the id', () => {
    expect(parseBranchId('main')).toEqual({ id: 'main' });
  });
});

describe('DEFAULT_BRANCH', () => {
  it('is a valid branch, so a fresh database is never branchless', () => {
    expect(parseBranch(DEFAULT_BRANCH).error).toBeUndefined();
  });
});

describe('branch registry authorization', () => {
  // The portal a manager signs into holds a viewer token. It must never be enough to rewrite
  // the branch list: that registry decides which tills exist and what their rows are filed
  // under, so write access to it is administrative.
  const postBranch = (env: Record<string, unknown>, headers: Record<string, string>) =>
    worker.fetch(
      new Request('https://api-reports.engaz.tech/branches/save', {
        method: 'POST',
        body: JSON.stringify({ branch: { id: 'branch-1', name: 'Branch 1' } }),
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
      env as never
    );

  it('refuses a read-scoped viewer token even when no write password is configured', async () => {
    // This is the case that used to be allowed: with REPORTS_BRANCH_PASSWORD unset, any
    // valid token was accepted, so the split between read and write depended entirely on an
    // operator setting a secret. Read scope is now refused unconditionally.
    const { token } = await issueViewerToken(SECRET, { scope: 'read' });
    const res = await postBranch(
      { REPORTS_API_KEY: 'write-key', REPORTS_TOKEN_SECRET: SECRET, DB: {} },
      { Authorization: `Bearer ${token}` }
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ success: false });
  });

  it('still allows the write key, so the desktop can register its own till', async () => {
    // The shared write credential keeps working: refusing it would take the POS offline.
    const res = await postBranch(
      { REPORTS_API_KEY: 'write-key', REPORTS_TOKEN_SECRET: SECRET, DB: {} },
      { 'X-API-Key': 'write-key' }
    );
    expect(res.status).not.toBe(401);
  });
});

describe('session revocation', () => {
  // A signed token cannot be taken back by wishing. These tests prove the jti is honoured
  // against a store, so "log out" actually ends the session rather than clearing a flag in
  // one browser while the token stays valid elsewhere for the rest of its life.
  const sessions = () => {
    const rows = new Map<string, number>();
    const db = {
      prepare: (sql: string) => {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind: (...args: unknown[]) => { statement.bindings = args; return statement; },
          run: async () => {
            if (/CREATE TABLE/i.test(sql)) return { success: true, meta: { changes: 0 } };
            if (/INSERT/i.test(sql)) {
              rows.set(String(statement.bindings[0]), Number(statement.bindings[1]));
              return { success: true, meta: { changes: 1 } };
            }
            if (/DELETE/i.test(sql)) {
              const had = rows.delete(String(statement.bindings[0]));
              return { success: true, meta: { changes: had ? 1 : 0 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
          first: async () => {
            if (/SELECT/i.test(sql)) {
              const jti = String(statement.bindings[0]);
              return rows.has(jti) ? { ok: 1 } : null;
            }
            return null;
          },
        };
        return statement;
      },
    };
    return { db, rows };
  };

  const readSnapshotWith = (token: string, db: unknown) =>
    worker.fetch(
      new Request('https://api-reports.engaz.tech/read/snapshot', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      }),
      { REPORTS_API_KEY: 'write-key', REPORTS_TOKEN_SECRET: SECRET, DB: db } as never
    );

  it('a token works until it is revoked, and is refused afterwards', async () => {
    const { db } = sessions();
    const { token, jti } = await issueViewerToken(SECRET, { db: db as never });
    expect(jti).toBeTruthy();

    // Sanity: an unrevoked session is accepted, so the test below proves revocation and not
    // some unrelated rejection.
    expect((await readSnapshotWith(token as string, db)).status).not.toBe(401);

    await revokeSession(db as never, jti as string);
    // 401, not 500: a revoked token is answered like a forged one.
    expect((await readSnapshotWith(token as string, db)).status).toBe(401);
  });

  it('revoking one session does not sign out another', async () => {
    const { db } = sessions();
    const a = await issueViewerToken(SECRET, { db: db as never });
    const b = await issueViewerToken(SECRET, { db: db as never });

    await revokeSession(db as never, a.jti as string);

    expect((await readSnapshotWith(a.token, db)).status).toBe(401);
    expect((await readSnapshotWith(b.token, db)).status).not.toBe(401);
  });

  it('logging out ends the session that called it', async () => {
    const { db } = sessions();
    const { token } = await issueViewerToken(SECRET, { db: db as never });

    const res = await worker.fetch(
      new Request('https://api-reports.engaz.tech/logout', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      }),
      { REPORTS_API_KEY: 'write-key', REPORTS_TOKEN_SECRET: SECRET, DB: db } as never
    );
    expect(res.status).toBe(200);

    expect((await readSnapshotWith(token, db)).status).toBe(401);
  });

  it('does not lock everyone out when the store cannot be read', async () => {
    // Fail-open here is deliberate and narrow: a broken session table must not sign the whole
    // portal out. Tokens still expire on their own, which is the guarantee that existed
    // before revocation was added.
    const brokenDb = {
      prepare: () => ({
        bind: () => ({
          run: async () => { throw new Error('no such table: viewer_sessions'); },
          first: async () => { throw new Error('no such table: viewer_sessions'); },
        }),
        run: async () => { throw new Error('no such table: viewer_sessions'); },
        first: async () => { throw new Error('no such table: viewer_sessions'); },
      }),
    };
    const { token } = await issueViewerToken(SECRET, { db: brokenDb as never });
    expect((await readSnapshotWith(token, brokenDb)).status).not.toBe(401);
  });
});

describe('request body limits', () => {
  const MAX_BODY_BYTES = 2 * 1024 * 1024;
  const env = { REPORTS_API_KEY: 'write-key', REPORTS_TOKEN_SECRET: SECRET, DB: {} };

  const post = (body: string) =>
    worker.fetch(
      new Request('https://api-reports.engaz.tech/migrate', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'write-key' },
      }),
      env as never
    );

  it('rejects an oversized body that declares no Content-Length', async () => {
    // A chunked request carries no Content-Length, so a header-only check never sees it and
    // the body is buffered into the isolate unchecked. The measured length has to be the
    // backstop, and this is the case that reaches it.
    const res = await post('x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ success: false });
  });

  it('lets a normal-sized body through to the router', async () => {
    // The ceiling must not swallow ordinary traffic: a healthy request has to reach the
    // endpoint, not be turned away at the door.
    const res = await post('{"items":[]}');
    expect(res.status).not.toBe(413);
  });
});
