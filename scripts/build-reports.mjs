import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portal = join(root, 'reports-site');
const sensitiveName = /(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i;

// A credential shorter than this is not a credential. The distinction matters because the
// caller sweeps the whole environment, which routinely carries variables whose *name* merely
// looks sensitive while the value is trivial — for example "..._API_KEY_HELPER_DISABLED=1".
// Treating "1" as a secret makes the scan match every file, so the build passes or fails
// depending on which shell happens to run it. Detection by name below still covers those.
const MIN_SECRET_LENGTH = 8;

export function scanBundle(directory, secrets) {
  let files = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      const text = readFileSync(path, 'utf8');
      files++;
      if (secrets.some(value => value && value.length >= MIN_SECRET_LENGTH && text.includes(value))
          || /VITE_[A-Z_]*(?:API_KEY|SECRET|PASSWORD|TOKEN)|X-API-Key/i.test(text)) {
        // Never echo matched values or bundle source; either can contain credentials.
        throw new Error(`Portal secret scan failed in ${entry.name}`);
      }
    }
  };
  visit(directory);
  // Any top-level HTML entry counts, not just index.html. The public menu is built with
  // public-menu.html, so requiring index.html silently exempted the one bundle served to
  // customers — the most exposed artefact there is — from the very scan meant to catch a
  // leaked key. An empty or entry-less directory is still a failure.
  const hasEntry = existsSync(directory) &&
    readdirSync(directory, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith('.html'));
  if (!files || !hasEntry) throw new Error('Portal bundle missing/empty');
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
