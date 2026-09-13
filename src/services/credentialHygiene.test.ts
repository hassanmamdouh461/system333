import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * Guards the fix for the leaked write key.
 *
 * The root bundle built from src/ is served to the public on menu.engaz.tech, so any
 * `import.meta.env.VITE_*` reference inlined there is published to every visitor. These
 * tests keep the credential variables out of the renderer sources, and keep the bundle
 * scan honest about what the built output actually contains.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Variables whose value must never be referenced from the renderer sources. */
const CREDENTIAL_VARS = [
  'VITE_CF_WORKER_API_KEY',
  'VITE_REPORTS_API_KEY',
];

/** Variables that are safe to reference (public URLs only). */
const PUBLIC_URL_VARS = [
  'VITE_CF_WORKER_URL',
  'VITE_REPORTS_WORKER_URL',
  'VITE_PUBLIC_MENU_URL',
];

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      listSourceFiles(path, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(path);
    }
  }
  return acc;
}

describe('renderer credential hygiene', () => {
  it('no src/ file references a credential variable through import.meta.env', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const name of CREDENTIAL_VARS) {
        if (text.includes(name)) offenders.push(`${file} references ${name}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the only env-typed references are public URLs', () => {
    const seen = new Set<string>();
    const pattern = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;
    for (const file of listSourceFiles(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(pattern)) {
        seen.add(match[1]);
      }
    }
    const unexpected = [...seen].filter(name => !PUBLIC_URL_VARS.includes(name));
    expect(unexpected, `unexpected import.meta.env references: ${unexpected.join(', ')}`).toEqual([]);
  });

  it('workerClient exposes no key-bearing request path', () => {
    const text = readFileSync(join(root, 'src', 'services', 'workerClient.ts'), 'utf8');
    expect(text).not.toMatch(/X-API-Key/i);
    expect(text).not.toMatch(/apiKey\s*\(/);
    // The health probe is the module's only request and it sends no credential.
    expect(text).toMatch(/\/health/);
  });
});
