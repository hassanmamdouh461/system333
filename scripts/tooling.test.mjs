import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprint } from './build-freshness.mjs';
import { scanBundle } from './build-reports.mjs';
import { branchKeyHash, branchKeySql } from './branch-key.mjs';

test('build freshness changes with source/config/env content, not timestamps', () => {
  const root = mkdtempSync(join(tmpdir(), 'engaz-freshness-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/app.ts'), 'one');
    const before = fingerprint(root);
    assert.equal(fingerprint(root), before);
    writeFileSync(join(root, 'src/app.ts'), 'two');
    assert.notEqual(fingerprint(root), before);
    const source = fingerprint(root);
    writeFileSync(join(root, '.env'), 'VITE_URL=changed');
    assert.notEqual(fingerprint(root), source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundle scan ignores a value too short to be a credential', () => {
  // The environment routinely carries a variable whose name merely looks sensitive while the
  // value is trivial ("..._API_KEY_HELPER_DISABLED=1"). Treating "1" as a secret makes the
  // scan match every file, so the build would pass or fail depending on the shell running it.
  const dir = mkdtempSync(join(tmpdir(), 'engaz-scan-short-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'app.css'), '.a{width:1px}');
    assert.equal(scanBundle(dir, ['1', 'on']), 2);

    // A value of plausible length is still caught in the very same file.
    writeFileSync(join(dir, 'app.css'), 'ENGAZ_PORTAL_SENTINEL_0123456789');
    assert.throws(() => scanBundle(dir, ['ENGAZ_PORTAL_SENTINEL_0123456789']), /secret scan failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bundle scan rejects sentinel values and key headers, accepts public URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engaz-scan-'));
  try {
    assert.throws(() => scanBundle(dir, []), /missing/);
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'app.js'), 'https://api-reports.engaz.tech');
    assert.equal(scanBundle(dir, ['unique-canary']), 2);
    for (const text of ['unique-canary', 'X-API-Key', 'VITE_REPORTS_API_KEY']) {
      writeFileSync(join(dir, 'app.js'), text);
      assert.throws(() => scanBundle(dir, ['unique-canary']), /secret scan failed/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('branch key hashing matches what the worker computes', () => {
  // resolveKeyBranch stores SHA-256(key) as lowercase hex via WebCrypto. If this ever
  // disagrees, every registered key stops matching and every scoped till is locked out —
  // silently, because an unmatched key just means "not a branch key".
  assert.equal(
    branchKeyHash('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );

  const sql = branchKeySql({ branch: 'branch-1', key: 'a'.repeat(32), label: "O'Brien" });
  assert.match(sql, /VALUES \('[0-9a-f]{64}', 'branch-1', 'O''Brien'/);
  // Idempotent, and re-issuing must clear a previous revocation.
  assert.match(sql, /ON CONFLICT\(key_hash\) DO UPDATE/);
  assert.match(sql, /revoked_at = NULL/);

  assert.throws(() => branchKeySql({ branch: 'Not A Slug', key: 'a'.repeat(32) }), /branch id/);
  assert.throws(() => branchKeySql({ branch: 'branch-1', key: 'short' }), /at least 16/);
});

test('bundle scan covers a bundle whose entry is not index.html', () => {
  // The public menu ships as public-menu.html. Requiring index.html meant the most exposed
  // artefact in the system — the one served to customers — was never scanned, so a key
  // leaked into it would have passed the build.
  const dir = mkdtempSync(join(tmpdir(), 'engaz-scan-entry-'));
  try {
    writeFileSync(join(dir, 'public-menu.html'), '<html></html>');
    writeFileSync(join(dir, 'menu.js'), 'https://api-reports.engaz.tech');
    assert.equal(scanBundle(dir, []), 2, 'a non-index entry still counts as a bundle');

    // And it is scanned in earnest, not merely accepted.
    writeFileSync(join(dir, 'menu.js'), 'VITE_REPORTS_API_KEY');
    assert.throws(() => scanBundle(dir, []), /secret scan failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
