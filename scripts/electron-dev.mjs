import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const child = spawn(require('electron'), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ENGAZ_DEV: '1', ENGAZ_DEV_LOAD_URL: 'http://127.0.0.1:5173' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
