// Starts ONLY the helper app, never electron/main.cjs or the normal POS entry point.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const expected = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version;
const installed = require('electron/package.json').version;
if (installed !== expected && !process.argv.includes('--allow-installed')) {
  throw new Error(`Electron ${installed} installed, lock expects ${expected}. Close POS, then npm ci and npm run native:rebuild. No files were rebuilt.`);
}
const modulePath = packaged
  ? join(root, 'dist-electron/win-unpacked/resources/app.asar/electron/database.cjs')
  : join(root, 'electron/database.cjs');
if (packaged && !existsSync(join(root, 'dist-electron/win-unpacked/resources/app.asar'))) throw new Error('Run npm run electron:package first.');
const temp = mkdtempSync(join(tmpdir(), 'engaz-native-smoke-'));
try {
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ name: 'engaz-isolated-smoke', version: '1.0.0', main: 'main.cjs' }));
  copyFileSync(join(root, 'scripts/electron-smoke-main.cjs'), join(temp, 'main.cjs'));
  // Allowlist environment: do not pass POS credentials, dev URLs, proxy config or NODE_OPTIONS.
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DISPLAY', 'XAUTHORITY']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { ENGAZ_SMOKE_TEMP: temp, ENGAZ_SMOKE_DATABASE: modulePath, ENGAZ_SMOKE_ELECTRON: installed });
  const result = spawnSync(require('electron'), [temp, '--disable-background-networking', '--disable-component-update', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'], {
    cwd: temp, env, encoding: 'utf8', timeout: 60000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout?.includes('ENGAZ_NATIVE_SMOKE_OK')) throw new Error(`Isolated SQLite smoke failed (${result.status}). Close POS before npm run native:rebuild; browser fallback has no native SQLite.`);
} finally {
  // Cleanup must not fail the probe: Windows can keep a handle on the temp dir briefly
  // (antivirus, indexing), and an EPERM here used to turn a PASSED smoke into a
  // launcher fallback to the browser. A leftover temp dir is harmless by comparison.
  try {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`Smoke passed but its temp dir could not be removed: ${err.code || err.message}`);
  }
}

