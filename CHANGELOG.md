# Changelog

All notable changes to BrewMaster POS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] — 2026-07-29

### 🔒 Security (14 critical fixes — PR #4)
- **Replaced hardcoded `123` passwords** with scrypt-hashed local users (Electron) and PBKDF2-hashed cloud users (D1 `users` table) + JWT sessions (12h expiry).
- **Retired the raw-SQL Worker proxy** — explicit authenticated endpoints only (`/auth/login`, `/sync/*`, `/analytics/*`, `/menu/public`).
- **Per-branch API keys** (SHA-256 hashed, `api_keys` table); branch scope enforced server-side.
- **CORS rejects unknown origins** (no first-origin fallback); **rate limiting** (120 req/min per identity).
- **Secrets encrypted at rest** via Electron `safeStorage` (Telegram bot token, worker API key) with legacy plaintext migration.
- **Removed exposed Appwrite credentials** from the web bundle; `.env.example` reduced to a template.
- **Electron hardening**: navigation/window guards, deny-all permission requests, CSP meta tag, `crypto.randomUUID()` record IDs.
- **localStorage→SQLite sync restricted to a whitelist** — no tokens, secrets, or POS drafts in the settings table.
- Session tokens now live in `sessionStorage` (cleared on app close); `localStorage` only with "remember me".

### 🔄 Sync integrity (partial — bundled with PR #4)
- Pulled orders **keep their real status/payment/orderNumber** (no more forced `Ready`/`Paid` renumbering).
- Cloud upsert **never overwrites records with unsynced local changes** (`WHERE is_synced = 1`).
- **Incremental pull** with a last-pull watermark instead of full 1000-row scans every 30s.

### ✨ Improvements & fixes (this release)
- **Adaptive sync pacing**: 30s while records are pending, 5 min when idle.
- **SQLite indexes** on hot query paths (orders/menu/customers/inventory branch + sync columns).
- **Daily SQLite backups** (keep 7) and **rotating file logs** (keep 14) under `userData`.
- **Auto-update support** (electron-updater, packaged builds, GitHub releases).
- **Unit tests** (vitest) for money formatting, Egyptian phone validation, and order-section routing.
- **ESLint + Prettier configs** added (the lint script previously pointed at a missing config).
- **Leveled logger** replaces raw `console.*` across the renderer (debug silent in production).
- **Egyptian phone validation** (`01xxxxxxxxx`) for customers and loyalty enrolment.
- **Manual-payment notice** on the payment screen (no live terminal integration).
- **CI workflow** (typecheck → lint → tests → build) on every PR.
- `package.json` version now tracked (semver), `engines.node >= 20`, `.nvmrc`, `postinstall` rebuilds native deps.
- `run.bat` checks for Node.js and fails with a clear message; `dist-deploy.zip` removed from the repo.

### ⚠️ Deployment actions required (one-time)
1. `wrangler d1 execute brewmaster-db --file=cloudflare/schema.sql`
2. Generate real per-branch API keys; replace placeholders in `api_keys` (helper in schema.sql).
3. `wrangler secret put JWT_SECRET`
4. Deploy the updated Worker; **revoke the old shared key `brewmaster-pos-2026` (compromised)**.
5. Change seeded passwords on first login (web `123`, desktop bootstrap `12345678`).

## [1.0.0] — 2026-07-02
- Initial multi-branch POS: React + Electron + SQLite with Cloudflare D1 sync.
