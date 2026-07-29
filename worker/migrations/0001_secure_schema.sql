-- Migration 0001: secure schema alignment for the secured worker
-- Apply with: wrangler d1 migrations apply brewmaster-db
--
-- Adds the columns the fixed sync flow depends on (problem #5 / CF-3) and the
-- users table for server-side login (problem #2 / #4).

-- ─── orders: real state columns previously fabricated by the client ───
ALTER TABLE orders ADD COLUMN updated_at TEXT;
ALTER TABLE orders ADD COLUMN customerPhone TEXT;
ALTER TABLE orders ADD COLUMN pointsEarned INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN pointsRedeemed INTEGER DEFAULT 0;

-- Backfill updated_at for existing rows so last-write-wins comparisons work
UPDATE orders SET updated_at = createdAt WHERE updated_at IS NULL;

-- ─── users: server-side credential store (PBKDF2 hashes, never plaintext) ───
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  branch_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 100000,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed accounts: generate real PBKDF2 hashes before deploying (see README).
-- The rows below are placeholders — replace password_hash/password_salt with
-- values produced by worker/tools/hash-password.js, then CHANGE the passwords.
-- INSERT INTO users (id, email, branch_id, role, password_hash, password_salt)
-- VALUES
--   ('u-branch1', 'branch1@system.com', 'branch_1', 'admin',   '<hash>', '<salt>'),
--   ('u-branch2', 'branch2@system.com', 'branch_2', 'admin',   '<hash>', '<salt>'),
--   ('u-branch3', 'branch3@system.com', 'branch_3', 'admin',   '<hash>', '<salt>'),
--   ('u-manager', 'manager@system.com', 'manager',  'manager', '<hash>', '<salt>');

CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders (branch_id, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory (branch_id);
