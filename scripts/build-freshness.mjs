import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function fingerprint(directory = root) {
  const hash = createHash('sha256');
  const walk = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else { hash.update(relative(directory, file)); hash.update(readFileSync(file)); }
    }
  };
  walk(join(directory, 'src'));
  walk(join(directory, 'public'));
  // Include local env changes without ever writing their contents to the stamp/log.
  for (const entry of readdirSync(directory).sort()) {
    if (/^(?:package(?:-lock)?\.json|index\.html|.*\.config\.(?:js|ts|cjs|mjs)|tsconfig.*\.json|\.env(?:\..*)?)$/.test(entry)) {
      hash.update(entry); hash.update(readFileSync(join(directory, entry)));
    }
  }
  return hash.digest('hex');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stamp = join(root, 'dist', '.engaz-build.json');
  if (process.argv[2] === 'stamp') {
    writeFileSync(stamp, JSON.stringify({ fingerprint: fingerprint() }) + '\n');
    console.log('Build fingerprint recorded.');
  } else if (process.argv[2] === 'check') {
    const fresh = existsSync(join(root, 'dist', 'index.html')) && existsSync(stamp)
      && JSON.parse(readFileSync(stamp, 'utf8')).fingerprint === fingerprint();
    console.log(fresh ? 'Production build is fresh.' : 'Production build is missing/stale; run npm run build.');
    process.exitCode = fresh ? 0 : 1;
  } else throw new Error('Usage: build-freshness.mjs stamp|check');
}
