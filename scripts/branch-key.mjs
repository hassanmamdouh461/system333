#!/usr/bin/env node
/**
 * Mint a per-branch POS key and print the SQL that registers it.
 *
 * Until `api_keys` has rows, one shared key reads and writes every branch: any till — or any
 * copy of that key — can act as any branch. Registering a key per branch is what turns
 * scoping on, and it is a data change, not a deploy.
 *
 * This script prints SQL; it never runs it. Writing to the production database is a decision
 * for whoever owns it, and the output is meant to be read before it is pasted anywhere.
 *
 * Usage:
 *   node scripts/branch-key.mjs --branch branch-1 --generate
 *   node scripts/branch-key.mjs --branch branch-1 --key <existing-key> --label "Main till"
 *
 * The worker stores SHA-256(key) as lowercase hex and never stores the key itself, so the
 * value printed here is safe to keep while the key itself must go to the device only.
 */

import { createHash, randomBytes } from 'node:crypto';

/** The digest the worker computes in `resolveKeyBranch`. Must stay identical to it. */
export function branchKeyHash(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A key long enough to be worth hashing and short enough to paste into a device setting. */
export function generateBranchKey() {
  return `engaz-${randomBytes(24).toString('base64url')}`;
}

const BRANCH_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function branchKeySql({ branch, key, label = null }) {
  const id = String(branch || '').trim().toLowerCase();
  if (!BRANCH_ID_RE.test(id)) {
    throw new Error(`Invalid branch id "${branch}": use a lowercase slug, max 40 characters`);
  }
  if (typeof key !== 'string' || key.length < 16) {
    throw new Error('Key must be at least 16 characters');
  }
  const hash = branchKeyHash(key);
  const now = new Date().toISOString();
  const labelValue = label ? `'${String(label).replace(/'/g, "''")}'` : 'NULL';

  return [
    `-- Branch: ${id}`,
    '-- Paste into: npx wrangler d1 execute engaz-pos-db --remote --file -',
    'INSERT INTO api_keys (key_hash, branch_id, label, created_at)',
    `VALUES ('${hash}', '${id}', ${labelValue}, '${now}')`,
    'ON CONFLICT(key_hash) DO UPDATE SET',
    "  branch_id = excluded.branch_id,",
    '  label = excluded.label,',
    '  revoked_at = NULL;',
    '',
    '-- To revoke this key later:',
    `-- UPDATE api_keys SET revoked_at = '${now}' WHERE key_hash = '${hash}';`,
  ].join('\n');
}

function parseArgs(argv) {
  const args = { branch: null, key: null, label: null, generate: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case '--branch': args.branch = value; i++; break;
      case '--key': args.key = value; i++; break;
      case '--label': args.label = value; i++; break;
      case '--generate': args.generate = true; break;
      default: break;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.branch || (!args.generate && !args.key)) {
    console.error('Usage: node scripts/branch-key.mjs --branch <slug> (--generate | --key <key>) [--label <text>]');
    process.exit(1);
  }

  const key = args.generate ? generateBranchKey() : args.key;
  console.log(branchKeySql({ branch: args.branch, key, label: args.label }));
  if (args.generate) {
    // Printed last so it is not lost above the SQL, and only when the script made the key.
    console.log('');
    console.log(`-- Device setting (engaz_d1_worker_api_key): ${key}`);
    console.log('-- Give this to the branch and store it nowhere else. It is not recoverable from the hash above.');
  }
}

// Only run the CLI when invoked directly, so the helpers stay importable in tests.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main();
}
