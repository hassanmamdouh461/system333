-- BrewMaster D1 Schema (v2 — secure auth)
-- ─────────────────────────────────────────────────────────────
-- Apply with:  wrangler d1 execute brewmaster-db --file=cloudflare/schema.sql
--
-- ⚠️  POST-INSTALL SECURITY TASKS:
--   1. Change every seeded user password (all are '123' below — see hashes note).
--   2. Generate a strong API key per branch, store ONLY its SHA-256 hash in
--      api_keys (a helper is provided at the bottom as a comment).
--   3. Set the Worker secret:  wrangler secret put JWT_SECRET

-- ─── Data tables (unchanged from v1) ───
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  orderNumber TEXT,
  tableId TEXT,
  items TEXT,               -- JSON array of order items
  status TEXT,
  paymentStatus TEXT,
  paymentMethod TEXT,
  totalAmount REAL,
  createdAt TEXT,
  paidAt TEXT,
  branch_id TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  points REAL DEFAULT 0,
  createdAt TEXT,
  branch_id TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  stock REAL DEFAULT 0,
  minStock REAL DEFAULT 0,
  costPerUnit REAL DEFAULT 0,
  branch_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- ─── Auth: users (password = PBKDF2-SHA256, 100k iterations) ───
-- All seeded accounts below start with password '123' so existing staff can
-- log in after the upgrade — CHANGE THEM IMMEDIATELY via the app or:
--   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');
--     console.log(s, c.pbkdf2Sync('NEWPASSWORD', s, 100000, 32, 'sha256').toString('hex'))"
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'manager')),
  branch_id TEXT,
  branch_name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

-- salt=06b840028e6d12e6801d0f43502f0fc6  hash=PBKDF2('123', salt, 100k, sha256)
INSERT OR IGNORE INTO users (id, email, name, role, branch_id, branch_name, password_hash, password_salt, must_change_password) VALUES
  ('usr-branch-1', 'branch1@system.com', 'فرع المعادي (فرع 1)',  'admin',   'branch_1', 'فرع المعادي (فرع 1)',  '8b6a77eb1f5cec76d5e98fb6cd49801ee0ff08455759df868dc6c7cd8d3d31f8', '06b840028e6d12e6801d0f43502f0fc6', 1),
  ('usr-branch-2', 'branch2@system.com', 'فرع مصر الجديدة (فرع 2)', 'admin', 'branch_2', 'فرع مصر الجديدة (فرع 2)', '8b6a77eb1f5cec76d5e98fb6cd49801ee0ff08455759df868dc6c7cd8d3d31f8', '06b840028e6d12e6801d0f43502f0fc6', 1),
  ('usr-branch-3', 'branch3@system.com', 'فرع الزمالك (فرع 3)', 'admin',   'branch_3', 'فرع الزمالك (فرع 3)',  '8b6a77eb1f5cec76d5e98fb6cd49801ee0ff08455759df868dc6c7cd8d3d31f8', '06b840028e6d12e6801d0f43502f0fc6', 1),
  ('usr-manager',  'manager@system.com', 'الإدارة العامة',        'manager', 'manager',  'الإدارة العامة',        '8b6a77eb1f5cec76d5e98fb6cd49801ee0ff08455759df868dc6c7cd8d3d31f8', '06b840028e6d12e6801d0f43502f0fc6', 1);

-- ─── Auth: per-branch API keys (store SHA-256 hash ONLY) ───
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  label TEXT,
  created_at TEXT,
  revoked INTEGER DEFAULT 0
);

-- ⚠️  These rows are placeholders — generate real keys per branch:
--   node -e "const c=require('crypto');const k='bm-'+c.randomBytes(24).toString('hex');
--     console.log('KEY (give to branch):', k);
--     console.log('HASH (insert here):', c.createHash('sha256').update(k).digest('hex'))"
-- Then:  INSERT INTO api_keys (id, branch_id, key_hash, label, created_at) VALUES
--          ('key-branch-1', 'branch_1', '<HASH>', 'Maadi POS', datetime('now'));
INSERT OR IGNORE INTO api_keys (id, branch_id, key_hash, label, created_at) VALUES
  ('key-branch-1', 'branch_1', 'REPLACE_WITH_SHA256_OF_REAL_KEY_1', 'Maadi POS — REPLACE ME', datetime('now')),
  ('key-branch-2', 'branch_2', 'REPLACE_WITH_SHA256_OF_REAL_KEY_2', 'Heliopolis POS — REPLACE ME', datetime('now')),
  ('key-branch-3', 'branch_3', 'REPLACE_WITH_SHA256_OF_REAL_KEY_3', 'Zamalek POS — REPLACE ME', datetime('now'));

-- ─── Indexes for hot paths ───
CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders (branch_id, createdAt);
CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory (branch_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_branch ON menu_items (branch_id);
