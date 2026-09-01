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
| Production POS worker API | `api.engaz.tech` |

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
C:\Users\hassa\AppData\Roaming\xdg.config\.wrangler\config\default.toml
```

`wrangler` is not a project dependency, so deploy commands fetch it on demand and need the
install prompt answered.
