import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portal = join(root, 'reports-site');
const sensitiveName = /(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i;
export function scanBundle(directory, secrets) {
  let files = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      const text = readFileSync(path, 'utf8');
      files++;
      if (secrets.some(value => value && text.includes(value))
          || /VITE_[A-Z_]*(?:API_KEY|SECRET|PASSWORD|TOKEN)|X-API-Key/i.test(text)) {
        // Never echo matched values or bundle source; either can contain credentials.
        throw new Error(`Portal secret scan failed in ${entry.name}`);
      }
    }
  };
  visit(directory);
  if (!files || !existsSync(join(directory, 'index.html'))) throw new Error('Portal bundle missing/empty');
  return files;
}

export async function buildReports() {
  // Resolve Vite from the independent portal install, not the root node_modules.
  const { build, loadEnv } = await import(pathToFileURL(join(portal, 'node_modules/vite/dist/node/index.js')).href);
  const secrets = [];
  for (const directory of [root, portal]) {
    for (const [name, value] of Object.entries(loadEnv('production', directory, ''))) {
      if (sensitiveName.test(name) && value) secrets.push(value);
    }
  }
  // A fresh sentinel ensures a future import.meta.env spread/key reference cannot silently leak.
  const saved = new Map();
  for (const name of ['VITE_REPORTS_API_KEY', 'VITE_API_KEY', 'VITE_CLOUDFLARE_API_KEY', 'VITE_REPORTS_TOKEN_SECRET']) {
    saved.set(name, process.env[name]);
    process.env[name] = `ENGAZ_PORTAL_SENTINEL_${randomUUID()}`;
    secrets.push(process.env[name]);
  }
  try {
    await build({ root: portal, configFile: join(portal, 'vite.config.ts') });
    console.log(`Portal secret scan passed (${scanBundle(join(portal, 'dist'), secrets)} files).`);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildReports();
