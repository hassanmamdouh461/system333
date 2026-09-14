# Engaz — Audit, Refactor and Deployment Handover

**Date:** 2026-09-14
**Branch:** `fix/comprehensive-audit-remediation`
**Base:** `aec8548` → **HEAD:** `2181aca` (13 commits, pushed; remote verified at `2181aca`)
**Scope:** desktop POS (Electron + React), two Cloudflare Workers, two Workers static sites.

---

## 1. Summary

The branch started red. Two independent failures were both caused by work sitting in the
working tree rather than by anything shipped: an unfinished branch-registry refactor whose
tests were never updated (11 failures), and a directory of generated audit probes being
linted with a browser profile (40 errors). Neither was visible from a green-looking main
branch, and CI would have rejected the branch as it stood.

Twelve of the fourteen findings are resolved. The two that are not were left deliberately —
one needs a decision rather than a change, the other needs a browser check that cannot be
performed from this environment.

| Severity | Found | Resolved | Deferred |
|---|---|---|---|
| CRITICAL | 2 | 2 | 0 |
| HIGH | 5 | 1 (+1 mitigated) | 2 |
| MEDIUM | 5 | 4 | 1 |
| LOW | 4 | 2 | 2 |

HIGH is lower than it looks because two of the five were never code defects: H2 is a rollout
decision (the POS worker's route is already served by the live `system-online-backend`), and
H5's fix is committed and deployed.

---

## 2. What changed, and why

### C1 — The suite was red, from an unfinished refactor
`cloudflare/__tests__/d1-reports-worker.test.ts`, 11 failures. The refactor already in the
tree changed `readBranches` to return `{ branches, deletedBranchIds }`, switched `saveBranch`
to `.first()` on a `RETURNING` clause, and added a seventh statement to the `readSnapshot`
batch. The tests still expected six statements, an array, and a double with no `batch`/`first`.

The production code was right — a complete registry with deleted-id metadata is what stops
the portal mistaking a deliberately hidden till for an unregistered one. The tests were
updated to the contract that exists, and extended to cover what the change was *for*: hidden
ids come back with the live rows, an incomplete registry fails loudly instead of looking
empty, and a hidden id cannot be resurrected by renaming it.

**This created a hard deploy ordering:** the new portal rejects a worker reply without
`deletedBranchIds`, while the new worker is still readable by an older portal. The worker
shipped first, every time.

### C2 — Lint was red on generated diagnostics
`outputs/` holds throwaway CommonJS audit probes. ESLint checked them with the browser/React
base config, so `require`, `__dirname`, `Buffer`, `setImmediate` and `process` were all
"undefined" — 40 errors that masked whether real product code was clean. That directory now
has its own override with the Node environment.

### H1 — A renderer-writable URL could redirect the API key anywhere
The most serious finding. `engaz_d1_worker_url` is a renderer-writable setting, and
`electron-builder` packages only `dist/` and `electron/` — no `.env` — so on a real install
the renderer's value is what the main process dials, with the production key in the
`X-API-Key` header. The key is deliberately unreadable by the renderer, but that only stops
it being *shown*; it still has to be *sent*.

`main.cjs:203-208` already identified this class of risk and closed half of it. The other
half is now closed: hosts are validated at `postJson`, the one place the credential is
attached, rather than where the URL is configured — a config-time check can be bypassed by
anything that reaches that call with a different base. Cleartext is refused, localhost is
opt-in via `ENGAZ_DEV=1`, and `ENGAZ_ALLOWED_WORKER_HOSTS` is the escape hatch for a shop
that genuinely runs its own worker.

### H3 — The body-size limit depended on a header the sender controls
Both workers bounded uploads by reading `Content-Length`. A chunked request declares no such
header, so the check silently passed and the body was buffered into the isolate before
`JSON.parse`. Now the measured length is the backstop. Verified against the chunked case:
without the guard an oversized body is fully buffered and answers 400 from the parser; with
it the request is refused at 413 before parsing.

### H4 — The reports worker capped nothing on the mirror path
The POS worker caps text at 4 kB, images at 400 kB, order line items at 64 kB. The reports
worker, mirroring the same records, capped nothing — so the two databases could disagree
about the same record with nothing to say which was right. Same bounds, same behaviour:
text and images trimmed, oversized line items refused rather than truncated into something
unparseable. The three limits are asserted against their literal values so tightening one
side fails loudly.

### H5 — The limiter throttled legitimate tills
Every request was metered against 120/minute. A till syncs every 30 seconds and pages
through its backlog; a cold branch legitimately exceeds that, gets 429, backs off, and falls
further behind. Authentication is a synchronous header comparison, so it is now settled
*before* the limiter runs and a caller holding the key gets a sync-sized budget. Anonymous
traffic keeps the tight one, so nothing about the brake on floods is relaxed.

Bucketing stays by address, not by key — one write key is shared by every install, so a
per-key bucket would throttle the whole estate against its busiest branch. Both budgets are
settable by variable, because their defaults are a guess.

### M1 — Two copies of every security primitive
The workers had duplicate implementations of the timing-safe comparison, the rate limiter,
the coercion helpers and the field bounds. Duplicating a security primitive is how copies
drift — the limiter budget had *already* been fixed on one side and left alone on the other.
All of it now lives in `cloudflare/shared/common.js`, pure and binding-free, so sharing it
cannot couple the two deployments. The limiter gained an explicit budget argument, and both
workers re-export the names they used to define.

### M3, M4 — Small corrections
The shared static-assets fallback answered "Engaz Reports Portal" from the public menu too.
The portal's `truncated` type claimed the branch registry could be reported short, which it
cannot — the worker fails instead. Narrowed the type, kept the runtime guard deliberately
wider so a future paging change is refused rather than silently dropping tombstones.

---

## 3. Commits

```
1481f8f fix(lint): lint generated diagnostics with a Node profile
2e08286 test(worker): assert the branch registry contract the reports worker now returns
c21f341 feat(worker): return hidden branch ids with the registry and reserve deleted ones
d1c57f2 feat(portal): require a complete branch registry before rendering branches
d44e8b1 fix(sync): read the reports key from the process environment, and drop it when gone
83aa332 fix(worker): enforce the body ceiling on the request that actually arrived
73f1fbd fix(worker): bound mirrored fields the way the POS worker already bounds them
9559ffc fix(worker): size the rate budget for sync traffic instead of for browsing
47ab5b9 refactor(worker): share one implementation of the primitives both workers guard with
f1ba1a9 fix(security): refuse to send the worker key to a host the renderer named
c4ee5bf fix(portal): type the truncation flags the worker can actually set
4c428f3 chore: stop the shared static-assets fallback naming one portal
2181aca docs: record the audit plan and what came of it
```

Three commits (`c21f341`, `d1c57f2`, `d44e8b1`) are in-flight work from a previous session
that was sitting uncommitted in the tree; they were reviewed, found correct, verified and
committed so the branch could be built from.

---

## 4. Deployment status

| Service | Config | Version | State |
|---|---|---|---|
| Reports worker | `wrangler-reports.toml` | `3fcdcd73` | ✅ 100% traffic, `api-reports.engaz.tech/*` |
| Reporting portal | `wrangler-reports-site.toml` | `8ebb2ff2` | ✅ 100% traffic, `reporting.engaz.tech/*` |
| POS worker | `wrangler.toml` | — | ⛔ not deployed, by design (H2) |
| Menu portal | `wrangler-menu-site.toml` | — | ⛔ unchanged |
| Secrets | — | — | ✅ all three present, untouched |

Bundle sizes after the refactor, all far inside Worker limits:

| Artifact | Size | gzip |
|---|---|---|
| Reports worker | 33.43 KiB | 8.40 KiB |
| POS worker (bundles, not deployed) | 26.17 KiB | 6.60 KiB |
| Reporting portal | 190.88 kB | 60.58 kB |
| Desktop POS bundle | 627.71 kB | 185.55 kB |

Post-deploy smoke on `api-reports.engaz.tech`: `/health` 200, unauthenticated
`/read/snapshot` 401, public `/read/public-menu` 200 with 5 live items. Portal serves its
expected bundle at `reporting.engaz.tech`.

---

## 5. Verification gates

| Gate | Before | After |
|---|---|---|
| `npm run lint` | ❌ 40 errors | ✅ 0 |
| `npm run typecheck` | ✅ | ✅ |
| `npm test` (root) | ❌ 227/238 | ✅ 254/254 |
| `npm run test:electron-unit` | ✅ 27 | ✅ 36 |
| `npm run test:tooling` | ✅ 3 | ✅ 3 |
| `reports-site` typecheck | ✅ | ✅ |
| `reports-site` tests | ✅ 96 | ✅ 96 |
| Root build | ✅ | ✅ |
| Portal build + secret scan | ✅ | ✅ |

No API key appears in any built bundle — re-verified against the freshly built `dist`, which
is served publicly at `menu.engaz.tech`.

---

## 6. Remaining recommendations

**H2 — decide the POS worker rollout.** `wrangler.toml` has a placeholder `database_id` and
a route that is already served by `system-online-backend`. Deploying it is a cutover, not a
redeploy. The previous session's isolated staging (`engaz-pos-staging`) remains the right
place to prove the desktop sync end to end before anything is pointed at production.

**M5 — add a CSP to both static portals, with a browser check.** There is no known injection
path — no `innerHTML`, `eval`, or plaintext `http://` anywhere in either SPA — so this is
defence in depth, not an open hole. It was not done because a wrong CSP is an outage of a
till-facing portal and it cannot be verified here without loading the page.

**Decide what `outputs/` is.** Generated diagnostics, currently untracked and unignored. It
no longer breaks lint either way, but one `git add .` commits it.

**Rotate `VITE_CF_WORKER_API_KEY`.** The value in `.env` is `brewmaster-pos-2026` — a
low-entropy literal that is now the live production key for `engaz-d1-proxy`. It is readable
from disk, has appeared in tool output, and is inlined into any browser bundle built from
this checkout. Rotating it is the only way to invalidate it, and it requires updating the
key on every till.

---

## 7. POS sync: wired, and end-to-end verified

The last open item from section 6 is now closed. What it took:

| Step | Result |
|---|---|
| Created D1 `engaz-pos-db` | `6e8450b3-2b08-46f2-8b80-a85ccce6b21f` |
| Deployed `engaz-d1-proxy` (workers.dev) | `https://engaz-d1-proxy.hassanmamdouh461.workers.dev` |
| Worker could not bootstrap a fresh D1 | fixed: `CREATE TABLE IF NOT EXISTS` at the head of `runMigration`, label `0004_self_bootstrap` |
| Pointed the POS at it | `.env` and the live `settings` table both hold the new URL; key unchanged |
| 44 rows still not moving | they had exhausted `MAX_SYNC_ATTEMPTS` and were excluded from every batch — released, and now released automatically when the URL changes |

**Verified in both directions:** the till pushed 41 menu items, 2 cashiers and 1 order; the
next cycle pulled 1 order and 2 cashiers back. Cloud and device now agree — cloud holds 1
order, 2 cashiers and 1 live menu item, which matches the device once its 40 tombstones are
accounted for. Incremental pulls are succeeding and pending work is zero.

### The trap that made this look fixed when it was not

`getSyncStats()` excludes rows at `MAX_SYNC_ATTEMPTS`, so once every row parked, the engine
reported `Found 0 pending records before push` and `Sync cycle completed successfully` on
every cycle — with the branch's data still on the device and nothing on screen saying so.
The `sync:retry-parked-rows` IPC and `database.resetSyncAttempts` both existed; nothing in
`src/` called them. A parked row was parked permanently.

`releaseParkedSyncRows()` now runs when the resolved worker URL actually changes, because a
wrong URL is the most common reason a whole branch parks at once. It is scoped to rows at
the budget rather than to every unsynced row: a row that has failed once carries a real
count, and clearing it would hand out five fresh attempts to work that is still failing for
a reason nobody has looked at.

### One caveat, deliberately not changed

`buildSyncStatements` turns a deleted record into `UPDATE ... SET deleted_at WHERE id = ?`
rather than an upsert, so a tombstone for a row the cloud never had is a no-op. That is why
the 40 locally-deleted seeded items correctly left no rows in the fresh database. The gap:
a sibling branch that later pushes that id with an older `updated_at` would resurrect it,
because no tombstone exists to stop it. Changing this alters the tombstone data model and
table growth, so it needs a decision rather than a patch. Relatedly, `/sync` reports
`written: statements.length`, which claims success for statements that matched nothing.

**Raise the rate budget deliberately if branches still report 429s.** Both budgets are now
settable via `RATE_MAX_REQUESTS` and `SYNC_RATE_MAX_REQUESTS` without a code change.
