const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'electron', 'main.cjs');

/**
 * The settings whitelist is the only reason a renderer-writable key reaches SQLite. A key
 * that nothing reads is pure attack surface: it can be written by the same bundle that is
 * published publicly at menu.engaz.tech, it is persisted forever, and it buys nothing.
 *
 * `engaz_admin_creds` was exactly that — present in both the whitelist and the write-only
 * list with zero callers anywhere in src/ — which is why this test exists.
 */

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests are excluded: this file names the very keys it forbids, and counting that as a
      // "caller" would make the guard pass on the strength of its own comment.
      if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Pulls the literal key out of a whitelist entry such as `/^engaz_tax_rate$/`. */
function keysFromList(source, listName) {
  const start = source.indexOf(`const ${listName} = [`);
  assert.notEqual(start, -1, `${listName} not found in electron/main.cjs`);
  const end = source.indexOf('];', start);
  const block = source.slice(start, end);
  return [...block.matchAll(/\/\^([^$]+)\$\//g)].map((match) => match[1]);
}

const mainSource = fs.readFileSync(MAIN, 'utf8');
const whitelist = keysFromList(mainSource, 'SETTINGS_WHITELIST');
const writeOnly = keysFromList(mainSource, 'SETTINGS_WRITE_ONLY');

// Everything the renderer and the rest of the main process actually say, excluding main.cjs
// itself — otherwise every whitelisted key would trivially "match" its own declaration.
const consumerFiles = [
  ...sourceFiles(path.join(ROOT, 'src')),
  ...sourceFiles(path.join(ROOT, 'electron')),
].filter((file) => file !== MAIN);
const corpus = consumerFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

test('the whitelist was parsed, so a renamed constant fails loudly instead of passing', () => {
  assert.ok(whitelist.length > 0, 'no whitelist keys were found');
  assert.ok(whitelist.includes('engaz_d1_worker_url'));
});

test('every whitelisted setting key is read or written somewhere outside main.cjs', () => {
  const orphans = whitelist.filter((key) => !corpus.includes(key));
  assert.deepEqual(
    orphans,
    [],
    'whitelisted settings keys with no caller — remove them from SETTINGS_WHITELIST:\n' +
      orphans.join('\n')
  );
});

test('every write-only key is also whitelisted, otherwise it can never be saved', () => {
  for (const key of writeOnly) {
    assert.ok(
      whitelist.includes(key),
      `${key} is in SETTINGS_WRITE_ONLY but not SETTINGS_WHITELIST, so it can never be stored`
    );
  }
});

test('the dead admin-credentials key has not crept back in', () => {
  // It was whitelisted and write-only with no callers at all; see settingsConfig.ts.
  assert.equal(corpus.includes('engaz_admin_creds'), false);
  assert.equal(mainSource.includes('engaz_admin_creds'), false);
});
