/**
 * Failed-sign-in throttling for the till.
 *
 * The login is entirely local: the PBKDF2 digest and its salt sit in this device's own
 * storage, so there is no server to rate-limit a guesser. Nothing was stopping someone
 * standing at the terminal — or any script that reached the renderer — from trying passwords
 * as fast as the CPU would hash them, and 210 000 iterations is a delay per guess, not a
 * defence against unlimited guesses.
 *
 * This is a brake, not a vault. It lives in localStorage because the login it guards already
 * does, and someone with that level of access to the device can clear it. What it removes is
 * the cheap attack: unattended guessing at the keyboard, and a script that can read the
 * renderer's storage but not replace the app. The real fix is moving the digest behind an
 * IPC call into the Electron-only SQLite store, which is a larger change than this one.
 */

const LS_LOCKOUT_KEY = 'engaz_login_lockout';

/** Guesses allowed before the first delay. */
export const LOCKOUT_FREE_ATTEMPTS = 5;

/** Longest lock this device will impose, reached after the backoff below. */
export const LOCKOUT_MAX_MS = 15 * 60 * 1000;

interface LockoutState {
  failures: number;
  /** Epoch ms until which sign-in is refused. */
  lockedUntil: number;
}

const EMPTY: LockoutState = { failures: 0, lockedUntil: 0 };

function readState(now: number): LockoutState {
  try {
    const raw = localStorage.getItem(LS_LOCKOUT_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<LockoutState>;
    const failures = Number(parsed.failures);
    const lockedUntil = Number(parsed.lockedUntil);
    const safeFailures = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0;
    const remaining = lockedUntil - now;
    // A clock moved forwards — or a value written by something other than this module —
    // must not turn into an open-ended lockout, so the wait is capped at the longest delay
    // this device would ever impose on its own.
    if (Number.isFinite(lockedUntil) && remaining > 0) {
      return { failures: safeFailures, lockedUntil: Math.min(lockedUntil, now + LOCKOUT_MAX_MS) };
    }
    return { failures: safeFailures, lockedUntil: 0 };
  } catch {
    return { ...EMPTY };
  }
}

function writeState(state: LockoutState): void {
  try {
    localStorage.setItem(LS_LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled or full: fail open rather than lock the till out permanently.
  }
}

/**
 * Exponential backoff: the first delay is one second, and it doubles from there.
 *
 * 5 free attempts, then 1s, 2s, 4s, 8s … capped at 15 minutes. Someone who knows the
 * password is never meaningfully delayed; a guesser goes from thousands of guesses to a
 * handful per quarter hour.
 */
export function lockoutDelayMs(failures: number): number {
  if (failures <= LOCKOUT_FREE_ATTEMPTS) return 0;
  const exponent = failures - LOCKOUT_FREE_ATTEMPTS - 1;
  return Math.min(1000 * 2 ** exponent, LOCKOUT_MAX_MS);
}

/** Milliseconds still to wait, or 0 when sign-in may proceed. */
export function remainingLockoutMs(now = Date.now()): number {
  const { lockedUntil } = readState(now);
  return lockedUntil > now ? lockedUntil - now : 0;
}

export function isLockedOut(now = Date.now()): boolean {
  return remainingLockoutMs(now) > 0;
}

/** Call after a successful sign-in: whatever was accumulated no longer applies. */
export function clearLockout(): void {
  try {
    localStorage.removeItem(LS_LOCKOUT_KEY);
  } catch {
    // Nothing to do; see writeState.
  }
}

/**
 * Records a failed attempt and returns the lock it produced.
 *
 * `remainingMs` is what the caller should tell the operator, so a locked till says how long
 * rather than just "wrong password" — an unattended cashier otherwise keeps typing.
 */
export function registerFailedAttempt(now = Date.now()): { failures: number; remainingMs: number } {
  const state = readState(now);
  const failures = state.failures + 1;
  const delay = lockoutDelayMs(failures);
  const next: LockoutState = { failures, lockedUntil: delay > 0 ? now + delay : 0 };
  writeState(next);
  return { failures, remainingMs: delay };
}
