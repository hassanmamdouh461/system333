/**
 * Local credential store for a branch device.
 *
 * Passwords are never persisted in plaintext, and never in a form that is reproducible
 * across installs. Each record carries its own random salt and an iteration count, so two
 * devices with the same password store different digests and a stolen database cannot be
 * matched against a precomputed table.
 *
 * The previous scheme was a single global salt with one round of SHA-256, which is fast
 * enough to brute-force a four-digit password in well under a second.
 */

const ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;
/** Prefix identifying the format, so a future change can be detected rather than guessed. */
const SCHEME = 'pbkdf2-sha256';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(
  plain: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return toHex(new Uint8Array(bits));
}

/**
 * Hashes a password into a self-describing string:
 * `pbkdf2-sha256$<iterations>$<salt hex>$<derived key hex>`.
 *
 * Everything needed to verify travels with the digest, so raising the iteration count later
 * does not invalidate credentials already stored.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(plain, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${toHex(salt)}$${derived}`;
}

/** Constant-time comparison so a partial match cannot be detected from response timing. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    // Not our format. Refuse rather than guess: a legacy digest that happens to match a
    // weak hash of the input must not be treated as a valid credential.
    return false;
  }

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  try {
    const candidate = await derive(plain, fromHex(parts[2]), iterations);
    return constantTimeEqual(candidate, parts[3]);
  } catch {
    return false;
  }
}

/** True when a stored value is a digest this module produced, rather than a plaintext leftover. */
export function isHashed(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(`${SCHEME}$`);
}
