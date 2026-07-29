/**
 * BrewMaster Local Auth Service (Electron main process)
 * ─────────────────────────────────────────────────────────────
 * Passwords are hashed with scrypt (per-user random salt) and stored in the
 * local SQLite `users` table — never in source code, never in plaintext.
 * Sessions are HMAC-signed tokens with a 12-hour expiry; the renderer stores
 * only the token string (in sessionStorage by default — survives refresh,
 * cleared when the app closes; localStorage only when "remember me" is on).
 */

const crypto = require('crypto');
const database = require('./database.cjs');

const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MIN_PASSWORD_LENGTH = 8;

// ─── Password hashing ────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
}

function verifyPassword(password, salt, expectedHashHex) {
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  const expected = Buffer.from(expectedHashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ─── Session secret (generated once per install, kept in settings) ───
function getSessionSecret() {
  const db = database.getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth_session_secret'").get();
  if (row && row.value) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('auth_session_secret', secret);
  return secret;
}

// ─── Token signing (HMAC-SHA256, JSON payload) ───────────────
function signSession(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_TTL_MS }), 'utf8')
    .toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expected = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── User seeding (first run only — staff must change these passwords) ───
const DEFAULT_USERS = [
  { id: 'usr-branch-1', email: 'branch1@system.com', name: 'فرع المعادي (فرع 1)', role: 'admin', branchId: 'branch_1', branchName: 'فرع المعادي (فرع 1)' },
  { id: 'usr-branch-2', email: 'branch2@system.com', name: 'فرع مصر الجديدة (فرع 2)', role: 'admin', branchId: 'branch_2', branchName: 'فرع مصر الجديدة (فرع 2)' },
  { id: 'usr-branch-3', email: 'branch3@system.com', name: 'فرع الزمالك (فرع 3)', role: 'admin', branchId: 'branch_3', branchName: 'فرع الزمالك (فرع 3)' },
  { id: 'usr-manager', email: 'manager@system.com', name: 'الإدارة العامة', role: 'manager', branchId: 'manager', branchName: 'الإدارة العامة' },
];

// One-time bootstrap password so existing staff can log in after upgrade.
// MUST be changed on first login (must_change_password = 1).
const BOOTSTRAP_PASSWORD = '12345678';

function ensureSeedUsers() {
  const db = database.getDb();
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;
  const insert = db.prepare(`
    INSERT INTO users (id, email, name, role, branch_id, branch_name, password_hash, password_salt, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of DEFAULT_USERS) {
      const salt = crypto.randomBytes(16).toString('hex');
      insert.run(u.id, u.email, u.name, u.role, u.branchId, u.branchName, hashPassword(BOOTSTRAP_PASSWORD, salt), salt, now);
    }
  });
  tx();
  console.log('[authService] Seeded default users (bootstrap password in effect — must be changed on first login).');
}

// ─── Public API ──────────────────────────────────────────────
function login(email, password) {
  const db = database.getDb();
  const user = db.prepare(
    'SELECT id, email, name, role, branch_id AS branchId, branch_name AS branchName, password_hash, password_salt, must_change_password AS mustChangePassword FROM users WHERE email = ?'
  ).get(String(email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.password_salt, user.password_hash)) {
    throw new Error('Invalid credentials');
  }
  const sessionPayload = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    branch: { branchId: user.branchId, branchName: user.branchName },
  };
  return {
    token: signSession(sessionPayload),
    ...sessionPayload,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function validateToken(token) {
  return verifySession(token);
}

function changePassword(token, currentPassword, newPassword) {
  const session = verifySession(token);
  if (!session || !session.user) throw new Error('Session expired — please log in again');
  const db = database.getDb();
  const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(session.user.id);
  if (!user || !verifyPassword(String(currentPassword || ''), user.password_salt, user.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  if (String(newPassword || '').length < MIN_PASSWORD_LENGTH) {
    throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword, salt), salt, session.user.id);
  return { success: true };
}

module.exports = { login, validateToken, changePassword, ensureSeedUsers };
