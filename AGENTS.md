# Engaz (system333) — project notes for agents

## Repository

```text
https://github.com/hassanmamdouh461/system333.git
```

Default branch is `main`. Pushes go to a feature branch, never straight to `main`.

Pushing needs the Windows credential helper forced on, because the user-level git config
clears `credential.helper` and git then tries to prompt on a tty that does not exist here:

```bash
git -c credential.helper=manager push -u origin <branch>
```

## Layout

| Part | Location |
|---|---|
| Desktop POS app (React + Electron) | `src/`, `electron/` |
| Manager statistics portal (separate SPA) | `reports-site/` |
| Production POS worker | `cloudflare/d1-proxy-worker.js` |
| Reports worker (isolated database) | `cloudflare/d1-reports-worker.js` |
| Worker tests | `cloudflare/__tests__/` |
| Deploy script for the portal + its worker | `deploy-reports.ps1` |
| Portal deploy guide | `DEPLOY.md` |

## Live endpoints

| Purpose | Host |
|---|---|
| Manager statistics portal | `reporting.engaz.tech` |
| Reports worker API | `api-reports.engaz.tech` |
| Production POS worker API | `api.engaz.tech` (a *different* service — do not claim its route) |

**The POS worker is not deployed on `api-pos.engaz.tech` yet.** Source is configured for it and the
desktop allowlist accepts it, but the route does not exist. Until the cutover is done, devices still
dial the legacy `*.workers.dev` URL. The procedure, including rollback, is in
`docs/CUTOVER_RUNBOOK.md` — read it before deploying, because the order matters.

Other hosts that exist and are easy to forget: `manager.engaz.tech` and `pos.engaz.tech` (legacy
frontends), `menu.engaz.tech` (public menu), `engaz.tech` (marketing). Inventory DNS against the
services you actually run; anything else is unmonitored surface.

## Environment variables

Defined in `.env.example` (root) unless noted. Variables marked *worker secret* are set with
`npx wrangler secret put` and never live in a file that gets committed.

| Variable | Where | Purpose |
|---|---|---|
| `VITE_CF_WORKER_URL` | desktop `.env` | POS worker URL; must be on the allowlist in `electron/workerHostPolicy.cjs` |
| `VITE_CF_WORKER_API_KEY` | desktop `.env` | POS worker key |
| `ENGAZ_REPORTS_API_KEY` | desktop `.env` | **Preferred** reports write key; read before `VITE_REPORTS_API_KEY` |
| `VITE_REPORTS_API_KEY` | desktop `.env` | Legacy fallback for the above. `VITE_`-prefixed, so never let it reach a bundle |
| `ENGAZ_ALLOWED_WORKER_HOSTS` | desktop env | Comma-separated extra hosts allowed to receive the key |
| `ENGAZ_DEV`, `ENGAZ_DEV_LOAD_URL` | desktop env | Dev only. `ENGAZ_DEV_LOAD_URL` attaches the preload to an arbitrary URL — never on a till |
| `ENGAZ_DNS_SERVERS` | desktop env | Resolver override for networks that cannot resolve the worker |
| `WORKER_API_KEY` | POS worker secret | Shared POS write key |
| `REQUIRE_BRANCH_KEYS` | POS worker secret | `"true"` stops honouring the shared key for keys with no `api_keys` row |
| `REPORTS_API_KEY` | reports worker secret | Reports write key |
| `REPORTS_VIEWER_PASSWORD` | reports worker secret | Portal sign-in (read scope) |
| `REPORTS_BRANCH_PASSWORD` | reports worker secret | Portal sign-in for **branch registry writes**. While unset, the viewer password also grants write scope |
| `REPORTS_TOKEN_SECRET` | reports worker secret | Signs viewer tokens; rotating it signs everyone out |
| `ALLOW_DEV_ORIGINS` | POS worker secret | `"true"` adds localhost to CORS. Never in production |
| `RATE_MAX_REQUESTS`, `SYNC_RATE_MAX_REQUESTS` | either worker secret | Per-minute budgets (defaults 120 / 600) |

## Verification commands

Root project:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Portal, which has its own stricter TypeScript config that `vite build` does not apply:

```bash
cd reports-site && npx tsc --noEmit -p tsconfig.json && npm run build
```

Continuous integration runs exactly these two sets, defined in:

```text
.github/workflows/ci.yml
```

## Secrets

Never commit a real value. Both env files are gitignored:

```text
.env
reports-site/.env
```

Any variable prefixed `VITE_` is inlined into the built bundle at build time, so it is public
in whatever bundle is built with it. Only the desktop build may carry a key; the portal bundle
must ship none. A key found inside a served portal bundle is a live leak, not a style problem.

Cloudflare deploys authenticate through the stored wrangler OAuth token at:

```text
C:\Users\Lenovo\AppData\Roaming\xdg.config\.wrangler\config\default.toml
```

(the path in older versions of this file pointed at `C:\Users\hassa\...`, which does not exist on the
machine the work is done from).

`wrangler` is not a project dependency, so deploy commands fetch it on demand and need the
install prompt answered.
