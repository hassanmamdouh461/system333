import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Fail closed: a loaded .node DLL must never be replaced under a running POS.
if (process.platform === 'win32') {
  const query = "Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(electron|Engaz POS)\\.exe$' } | Select-Object -ExpandProperty ProcessId";
  const running = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8' }).trim();
  if (running) throw new Error(`Close all Electron/Engaz windows before native rebuild (PIDs: ${running.replace(/\s+/g, ', ')}). Nothing was stopped.`);
} else {
  const running = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' });
  if (/electron|Engaz POS/i.test(running)) throw new Error('Close Electron/Engaz before native rebuild. Nothing was stopped.');
}
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), 'install-app-deps'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
