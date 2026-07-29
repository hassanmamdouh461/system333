/**
 * Generate PBKDF2 password hashes for seeding the D1 users table.
 *
 * Usage (in worker/tools/):
 *   node hash-password.js <password>
 *
 * Copy the printed hash + salt into an INSERT statement in the users table.
 * Uses the same format as worker/index.js (PBKDF2-SHA256, 100k iterations,
 * base64url-encoded hash and salt).
 */
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node hash-password.js <password>');
  process.exit(1);
}

const base64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const salt = crypto.randomBytes(16);
const iterations = 100000;
const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');

console.log('password_hash:', base64url(hash));
console.log('password_salt:', base64url(salt));
console.log('iterations:   ', iterations);
console.log('');
console.log('Example INSERT:');
console.log(
  `INSERT INTO users (id, email, branch_id, role, password_hash, password_salt, iterations)\n` +
  `VALUES ('u-branch1', 'branch1@system.com', 'branch_1', 'admin', '${base64url(hash)}', '${base64url(salt)}', ${iterations});`
);
