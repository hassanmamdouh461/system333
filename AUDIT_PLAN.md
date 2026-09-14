# Engaz — Audit & Refactor Plan

**Date:** 2026-09-14
**Branch:** `fix/comprehensive-audit-remediation` @ `aec8548`
**Scope:** desktop POS (Electron + React), two Cloudflare Workers, two Workers static sites.
**Method:** repository mapping, `tsc --noEmit`, ESLint, 4 test suites, build + sentinel secret
scan, manual review of every network-facing route.

---

## 0. Baseline: what actually runs today

| Command | Result |
|---|---|
| `npm run typecheck` (root) | ✅ pass |
| `npm run lint` (root) | ❌ **40 errors** — all in untracked `outputs/**/*.cjs` |
| `npm test` (root vitest) | ❌ **11 failed / 227 passed** (238) |
| `npm run test:electron-unit` | ✅ 27 pass |
| `npm run test:tooling` | ✅ 3 pass |
| `reports-site` typecheck | ✅ pass |
| `reports-site` tests | ✅ 96 pass |
| `reports-site` build + secret scan | ✅ 190.88 kB JS (60.58 kB gzip), scan passed |

**The repository is in a red state.** Both failures are caused by work left in the working
tree rather than by shipped code, but CI would reject this branch as-is.

Uncommitted changes present at audit time:

```
 M cloudflare/d1-reports-worker.js   +63 / -32
 M electron/mockApiService.cjs       +8  / -2
 M reports-site/src/api.ts           +32 / -6
?? outputs/                          (untracked, not gitignored)
```

Cloudflare bindings in use: `DB` (D1, both workers), `assets` (both portals). Secrets:
`WORKER_API_KEY`, `REPORTS_API_KEY`, `REPORTS_VIEWER_PASSWORD`, `REPORTS_TOKEN_SECRET`.
No KV / R2 / Queues / Durable Objects / AI bindings anywhere.

---

## 1. [CRITICAL]

### C1 — Worker test suite is red: 11 failures from an unfinished refactor
**Where:** `cloudflare/__tests__/d1-reports-worker.test.ts` (9 + 2 failures); source
`cloudflare/d1-reports-worker.js:254-296`, `:485-511`.

The uncommitted change replaced `readBranches(): SnapshotRow[]` with
`readBranches(): { branches, deletedBranchIds }`, made `saveBranch` use `.first()` on a
`RETURNING` clause, and added a **7th** statement to the `readSnapshot` batch. The tests
were never updated:

| Test line | Failure | Cause |
|---|---|---|
| `:193` `EMPTY = [[],[],[],[],[],[]]` | `Branch registry could not be read completely` | batch now issues 7 statements, mock replays 6 |
| `:278` `expect(db.seen).toHaveLength(6)` | — | now 7 |
| `:571` `readBranches(db)` expected to equal an array | `db.batch is not a function` | `recordingDb` has no `batch` |
| `:577` `saveBranch(db, …)` | `.first is not a function` | `recordingDb` has no `first` |

**Fix strategy:** the production code is correct and intentional (a complete registry with
deleted-id metadata is what stops the portal mistaking an omitted tombstone for an
unregistered till). Update the *tests* to the new contract — 7 result sets, an object
return from `readBranches`, `batch`/`first` on the recording doubles — and add coverage for
the new guarantees: deleted-branch ids are returned, and `saveBranch` on a tombstoned id is
refused.

**Deploy ordering (hard requirement):** the new `api.ts` throws unless
`deletedBranchIds` is present. New worker + old portal is safe; **new portal + old worker is
a hard failure**. The worker must ship first.

### C2 — `npm run lint` fails on generated diagnostics in `outputs/`
**Where:** `.eslintrc.cjs:9-18` (`ignorePatterns`), untracked `outputs/*.cjs`.

`outputs/` holds throwaway audit probes (`.cjs`, CommonJS, Node globals). ESLint lints them
with the browser/browser-plus-React base config → 40 `no-undef` / `no-require-imports`
errors. `outputs/` is **not** gitignored, so `git add .` would commit them and turn CI red.

**Fix strategy:** add `outputs` to `ignorePatterns` (generated diagnostics are not product
code). Do not rewrite the probes just to satisfy a browser lint profile.

---

## 2. [HIGH]

### H1 — A renderer-writable worker URL redirects the main-process API key to any host
**Where:** `electron/main.cjs:191-201` (whitelist), `electron/mockApiService.cjs:54-82`
(`loadConfig`), `:160-166` (`postJson`).

`engaz_d1_worker_url` is on the settings whitelist, so the renderer can write it. The API
key is deliberately read-only, but `loadConfig` prefers `.env` **only when `.env` exists** —
and `electron-builder` ships just `dist/**` and `electron/**`
(`package.json:35-39`), so a packaged install has no `.env` and falls back to the renderer's
setting. The main process then sends the real `X-API-Key` to whatever host the renderer
named. The key being unreadable does not help: it only has to be *sent*, not returned.

The comment at `main.cjs:203-208` already identifies this class of risk and closed only half
of it. **Fix strategy:** validate the configured URL against an explicit host allowlist
(`api.engaz.tech`, plus localhost only when `ALLOW_DEV_ORIGINS`/`ENGAZ_DEV` opts in) before
any request is built, and refuse to attach `X-API-Key` to a non-allowlisted origin.

### H2 — The POS worker cannot be deployed from this checkout
**Where:** `wrangler.toml:15`, `:32`.

Two independent blockers: `database_id = "REPLACE_WITH_D1_DATABASE_ID"` (deliberate, but it
means every deploy fails fast), and `routes = [{ pattern = "api.engaz.tech/*" }]` — that
hostname is already served by the live `system-online-backend` service, so claiming it would
be a production cutover, not a redeploy. **Fix strategy:** do not deploy `wrangler.toml`
until there is an explicit rollout decision. Everything else in this plan is deployable
without touching it.

### H3 — Body size is enforced only through the `Content-Length` header
**Where:** `cloudflare/d1-proxy-worker.js:675-691`; `cloudflare/d1-reports-worker.js:784-800`.

`request.text()` is called after a header check that silently passes when `Content-Length`
is absent (chunked transfer encoding). A chunked body is then buffered into the isolate with
no enforced ceiling before `JSON.parse`. **Fix strategy:** after reading, reject
`body.length > MAX_BODY_BYTES`, so the limit holds with or without the header.

### H4 — The reports worker applies no per-field size caps on sync
**Where:** `cloudflare/d1-reports-worker.js:900-908` vs `d1-proxy-worker.js:151-222`.

The POS worker caps text (4 kB), images (400 kB) and JSON (64 kB) per record. The reports
worker accepts raw `str()` values, so one authenticated record can carry unbounded strings
into D1 and `MAX_BATCH` of them can carry a lot further. **Fix strategy:** extract the shared
coercion/capping helpers and apply the same bounds on the mirror path.

### H5 — Rate limit is per-IP with no allowance for branches behind one NAT
**Where:** `cloudflare/d1-proxy-worker.js:101-102`, `d1-reports-worker.js:99-100`.

120 requests/minute per `CF-Connecting-IP`. A sync cycle runs every 30 s
(`electron/syncEngine.cjs:4`) and a cold or backlogged branch walks `MAX_PAGES = 50`
(`mockApiService.cjs:385,450`) — a single large initial pull can exceed the whole minute's
budget and earn a 429, which the engine answers with backoff. Several tills on one
connection share one bucket. **Fix strategy:** make the budget configurable per deployment
and raise it for authenticated write traffic, or key on the API key identity rather than the
IP.

---

## 3. [MEDIUM]

### M1 — Duplicated security primitives across the two workers
`timingSafeEqual`, `checkRateLimit`, `corsHeaders`, `str`, `num`, `nowIso` are copy-pasted
into both workers. Two copies of a timing-safe comparison is one copy that can drift.
**Fix:** extract to a shared module imported by both.

### M2 — No revocation for viewer tokens
`d1-reports-worker.js:151-172`. An 8-hour HMAC token is unforgeable but cannot be revoked;
a stolen token is valid until it expires. Acceptable for now — noted so the portal can move
to a shorter TTL or a server-side session list later.

### M3 — `empty-worker.js` is shared by both portals and names only one
`wrangler-menu-site.toml:15` and `wrangler-reports-site.toml:18` both point at
`reports-site/empty-worker.js`, whose fallback body reads `Engaz Reports Portal`. Cosmetic,
but it makes the menu portal's diagnostics misleading.

### M4 — Dead truncation guard in the portal
`reports-site/src/api.ts:127-134` still tests `truncated.branches`, but `readSnapshot` no
longer pages the registry (`d1-reports-worker.js:498-504`) — it fails loudly instead. Either
the guard is dead code or the worker is missing a cap; decide which.

### M5 — No Content-Security-Policy on either static portal
Both Workers static sites serve SPAs with no CSP header. There is no `innerHTML`/`eval`
anywhere in the source (verified), so there is no known injection path today, but a CSP is
the cheap backstop.

---

## 4. [LOW]

- **`outputs/` is untracked and unignored** — decide explicitly: gitignore it, or commit it
  deliberately. Right now it is one `git add .` away from CI.
- **`deploy-reports.ps1` re-sets secrets on every run** (`:158-189`). Known hazard: rotating
  `REPORTS_API_KEY` silently breaks POS mirroring.
- **`compatibility_date = "2025-01-01"`** on all four configs — fine today, worth a periodic
  bump.
- **Bundle sizes are healthy:** POS worker 33.2 kB, reports worker 42.3 kB, portal 190.9 kB
  (60.6 kB gzip). Nowhere near the 1 MB / 10 MB Worker limits.

---

## 5. What is *not* broken

Recorded so the next audit does not re-litigate it:

- Electron hardening is correct: `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`, `webSecurity: true`, navigation and window-open both denied.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` anywhere.
- No credential is logged; no plaintext `http://` endpoint outside localhost.
- **No API key in any built bundle.** Verified: the `.env` value does not appear in
  `dist/assets/*.js` (served publicly at `menu.engaz.tech`), and `reports-site` ships with a
  passing sentinel scan. `credentialHygiene.test.ts` guards this.
- IPC is validated at every handler via `validate.cjs`; secrets are write-only.
- Both workers are statement-side only — no client-supplied SQL reaches D1.
- TypeScript: zero `any` in `src/` (17,314 lines), one in `reports-site/src` (a comment).
- Pull pagination is keyset-based and tombstone-aware; upserts are last-writer-wins on
  `updated_at`; ledger tables are `INSERT OR IGNORE`.

---

## 6. Execution order and outcome

| # | Item | Commit | Deployed |
|---|---|---|---|
| 1 | C2 — lint the right files | `1481f8f` | — |
| 2 | C1 — finish the branch-registry refactor (tests) | `2e08286` | — |
| — | (worker side of C1, committed from in-flight work) | `c21f341` | ✅ reports worker |
| — | (portal side of C1, committed from in-flight work) | `d1c57f2` | ✅ portal |
| — | (reports key loading, committed from in-flight work) | `d44e8b1` | — |
| 3 | H3 — enforce body size after read | `83aa332` | ✅ reports worker |
| 4 | H4 — cap mirrored fields | `73f1fbd` | ✅ reports worker |
| 5 | H5 — size the rate budget for sync traffic | `9559ffc` | ✅ reports worker |
| 6 | M1 — share security primitives | `47ab5b9` | ✅ reports worker |
| 7 | H1 — worker URL allowlist | `f1ba1a9` | ships in the desktop app |
| 8a | M4 — type the flags the worker can actually set | `c4ee5bf` | ✅ portal |
| 8b | M3 — fallback no longer names one portal | `4c428f3` | — |

**Not done, and why**

- **H2 (POS worker deployable).** Needs a rollout decision, not a code change. Its route is
  already served by the live `system-online-backend`; deploying `wrangler.toml` is a
  production cutover. Left untouched.
- **M5 (CSP on the static portals).** Deferred deliberately. There is no known injection
  path — no `innerHTML`, `eval` or plaintext `http://` anywhere in either SPA — but a CSP
  that is wrong is an outage of the till-facing portal, and it cannot be verified from here
  without loading the page in a browser. It needs a deliberate change with a browser check.
- **`outputs/` untracked.** Flagged, not decided. It is generated diagnostics; whether it is
  committed or ignored is the team's call. It no longer breaks lint either way.

**Deploy ordering was honoured throughout:** the reports worker went out before the portal
every time, because the new portal rejects a worker reply that lacks `deletedBranchIds`
while the new worker is still readable by an older portal.

### Final state

| Gate | Before | After |
|---|---|---|
| `npm run lint` | ❌ 40 errors | ✅ 0 |
| `npm test` (root) | ❌ 227/238 | ✅ 254/254 |
| `test:electron-unit` | ✅ 27 | ✅ 36 |
| `test:tooling` | ✅ 3 | ✅ 3 |
| `reports-site` tests | ✅ 96 | ✅ 96 |
| root + portal typecheck | ✅ | ✅ |
| root build | ✅ | ✅ 627.71 kB (185.55 kB gzip) |
| portal build + secret scan | ✅ | ✅ 190.88 kB (60.58 kB gzip) |

Live at 100% traffic: reports worker `3fcdcd73`, reporting portal `8ebb2ff2`.
POS worker (`wrangler.toml`), the menu portal and all secrets were left unchanged.
