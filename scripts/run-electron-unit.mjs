import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'electron', '__tests__');

const testFiles = readdirSync(testsDir)
  .filter(f => f.endsWith('.test.cjs'))
  .map(f => join(testsDir, f));

if (testFiles.length === 0) {
  console.log('No .test.cjs files found in electron/__tests__');
  process.exit(0);
}

const args = ['--test', ...testFiles];

// Try running with plain Node first
const nodeResult = spawnSync(process.execPath, args, {
  stdio: 'pipe',
  encoding: 'utf8',
});

if (nodeResult.status === 0) {
  if (nodeResult.stdout) process.stdout.write(nodeResult.stdout);
  if (nodeResult.stderr) process.stderr.write(nodeResult.stderr);
  process.exit(0);
}

const combinedOutput = (nodeResult.stdout || '') + (nodeResult.stderr || '');

// If it failed because better-sqlite3 was compiled for Electron (NODE_MODULE_VERSION mismatch)
if (combinedOutput.includes('NODE_MODULE_VERSION')) {
  const electronPath = require('electron');
  const electronResult = spawnSync(electronPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(electronResult.status ?? 1);
}

if (nodeResult.stdout) process.stdout.write(nodeResult.stdout);
if (nodeResult.stderr) process.stderr.write(nodeResult.stderr);
process.exit(nodeResult.status ?? 1);
