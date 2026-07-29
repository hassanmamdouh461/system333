<div align="center">

# ☕ BrewMaster
### Multi-Branch Coffee Shop Point-of-Sale System

*Electron desktop POS per branch · local SQLite · secure Cloudflare D1 central sync*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare_Workers_%2B_D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

---

## ✨ Features

### 🏪 Business Features
- **Live Kanban Board** — Visual order pipeline: `New → Preparing → Ready`, split by Kitchen/Drinks sections
- **Cashier Payment Flow** — Sortable unpaid orders, cash/card tracking, manual-collection confirmation, receipt printing
- **Analytics Dashboard** — Revenue, order count, and peak-hour insights (Today / Week / Month)
- **Menu Management** — Full CRUD with images, categories, and prep-destination routing
- **Inventory & Recipes** — Stock levels, min-stock alerts, ingredient recipes with automatic deduction on order
- **Customer Loyalty** — Egyptian mobile-validated profiles, points earn/redeem on every order
- **Manager Portal** — Cross-branch analytics, customers, and inventory (JWT-authenticated web access)
- **Telegram Daily Reports** — Scheduled Arabic sales summaries per branch (bot token stored OS-encrypted)
- **QR Public Menu** — Customer-facing menu served from the cloud with edge caching
- **Arabic-first RTL UI** with English support, works on desktop, tablet, and phone

### ⚙️ Technical Features
- **Offline-first desktop**: every branch runs on a local SQLite DB (`better-sqlite3`, WAL mode) and keeps working without internet
- **Secure cloud sync**: per-branch API keys (SHA-256 hashed), incremental push/pull, branch scope enforced server-side
- **Real authentication**: scrypt-hashed local users + PBKDF2-hashed cloud users, JWT sessions with expiry
- **Secrets at rest**: OS-keychain encryption (`safeStorage`) for bot tokens and API keys
- **Resilience**: adaptive sync pacing, daily SQLite backups, rotating file logs, auto-update via GitHub releases

---

## 🏗️ Architecture

```
┌────────────────────────┐         ┌─────────────────────────────┐
│  Branch POS (Electron) │         │   Manager Portal (Web)      │
│  React + SQLite local  │         │   React (JWT-authenticated) │
└──────────┬─────────────┘         └──────────────┬──────────────┘
           │ per-branch API key                   │ JWT (manager role)
           │ /sync/push · /sync/pull-orders       │ /analytics/*
           ▼                                      ▼
┌──────────────────────────────────────────────────────────────┐
│        Cloudflare Worker (cloudflare/d1-proxy-worker.js)     │
│  auth (PBKDF2+JWT) · branch-scoped sync · rate limiting      │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
                  Cloudflare D1 (brewmaster-db)
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 20+** (see `.nvmrc`)
- npm 10+

### Install & run (desktop POS)
```bash
npm install          # postinstall rebuilds better-sqlite3 for Electron automatically
npm run electron:dev # starts Vite + Electron together
```

### Web (manager portal / QR menu)
```bash
npm run dev          # Vite dev server on :5173
npm run build        # production bundle in dist/
npm run preview      # preview the production build
```

### Tests & checks
```bash
npm test             # vitest unit tests
npm run lint         # ESLint (config: .eslintrc.cjs)
npm run format       # Prettier
npx tsc --noEmit     # type check
```

---

## ☁️ Cloud Setup (Cloudflare D1 + Worker)

One-time setup — see `cloudflare/schema.sql` header for details:

```bash
# 1. Create/upgrade the D1 schema (users, api_keys, indexes)
wrangler d1 execute brewmaster-db --file=cloudflare/schema.sql

# 2. Generate a real API key per branch and store ONLY its SHA-256 hash
node -e "const c=require('crypto');const k='bm-'+c.randomBytes(24).toString('hex');console.log('KEY (to branch):',k);console.log('HASH (to D1):',c.createHash('sha256').update(k).digest('hex'))"

# 3. Set the session-signing secret
wrangler secret put JWT_SECRET

# 4. Deploy the Worker
wrangler deploy cloudflare/d1-proxy-worker.js --name brewmaster-api
```

Then enter each branch's key in the POS: **Settings → Branch Configuration → Cloud Sync API Key** (stored OS-encrypted).

> ⚠️ The legacy shared key `brewmaster-pos-2026` is retired — revoke it anywhere it still exists.

---

## 📁 Project Structure

```
cloudflare/          Worker source + D1 schema (schema.sql)
electron/            Main process: windows, IPC, SQLite repos, sync engine, auth
src/
  components/        UI (orders, payment, menu, settings, layout)
  context/           AuthContext (sessions), DataContext (menu/orders), LanguageContext
  pages/             Dashboard, Orders, Payment, Reports, Manager, Customers, Inventory…
  repositories/      Renderer-side data access (IPC → SQLite)
  services/          Shared services (menu/orders/customers/inventory)
  utils/             format.ts (money/phone), logger.ts, receipts, sections
.github/workflows/   CI: typecheck → lint → tests → build
```

## 📦 Building the desktop installer
```bash
npm run electron:build   # NSIS installer in dist-electron/
```

## 🔐 Security Notes
- Passwords are never stored in source or plaintext — see `electron/authService.cjs` and `cloudflare/schema.sql`.
- Branch API keys are stored hashed server-side and encrypted client-side.
- Report issues via GitHub Issues; see `CHANGELOG.md` for the v1.1.0 security overhaul.
