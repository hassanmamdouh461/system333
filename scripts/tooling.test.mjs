import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprint } from './build-freshness.mjs';
import { scanBundle } from './build-reports.mjs';

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
