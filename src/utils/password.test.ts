import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isHashed } from './password';

/**
 * PBKDF2 with a real iteration count is deliberately slow — that is the point — so these
 * tests get a longer budget than the default.
 */
const TIMEOUT = 20_000;

describe('hashPassword', () => {
  it('produces a self-describing digest', async () => {
    const digest = await hashPassword('correct horse battery');
    const [scheme, iterations, salt, key] = digest.split('$');

    expect(scheme).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBeGreaterThan(100_000);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  }, TIMEOUT);

  it('never stores the password itself', async () => {
    const digest = await hashPassword('hunter2');
    expect(digest).not.toContain('hunter2');
  }, TIMEOUT);

  it('salts each digest, so the same password hashes differently twice', async () => {
    // This is what defeats a precomputed table: two devices with the same password must
    // not produce the same stored value.
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
  }, TIMEOUT);
});

describe('verifyPassword', () => {
  it('accepts the password it was derived from', async () => {
    const digest = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphrase', digest)).resolves.toBe(true);
  }, TIMEOUT);

  it('rejects a wrong password', async () => {
    const digest = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphras', digest)).resolves.toBe(false);
    await expect(verifyPassword('S3cret-passphrase', digest)).resolves.toBe(false);
    await expect(verifyPassword('', digest)).resolves.toBe(false);
  }, TIMEOUT);

  it('rejects a digest in any other format', async () => {
    // A legacy unsalted SHA-256 digest must not verify: accepting one would keep the old
    // weak credentials alive after the upgrade.
    const legacySha256 = 'a'.repeat(64);
    await expect(verifyPassword('anything', legacySha256)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'pbkdf2-sha256$notanumber$aa$bb')).resolves.toBe(false);
  }, TIMEOUT);

  it('rejects a digest whose salt is malformed rather than throwing', async () => {
    await expect(verifyPassword('anything', 'pbkdf2-sha256$210000$zz$bb')).resolves.toBe(false);
  }, TIMEOUT);
});

describe('isHashed', () => {
  it('recognises digests this module produced', async () => {
    expect(isHashed(await hashPassword('abc123'))).toBe(true);
  }, TIMEOUT);

  it('rejects plaintext leftovers and empty values', () => {
    // The upgrade path depends on this: a stored '123' is a leftover, not a credential.
    expect(isHashed('123')).toBe(false);
    expect(isHashed('a'.repeat(64))).toBe(false);
    expect(isHashed('')).toBe(false);
    expect(isHashed(null)).toBe(false);
    expect(isHashed(undefined)).toBe(false);
  });
});
