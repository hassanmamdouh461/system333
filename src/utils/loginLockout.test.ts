// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LOCKOUT_FREE_ATTEMPTS,
  LOCKOUT_MAX_MS,
  clearLockout,
  isLockedOut,
  lockoutDelayMs,
  registerFailedAttempt,
  remainingLockoutMs,
} from './loginLockout';

const KEY = 'engaz_login_lockout';

beforeEach(() => {
  localStorage.clear();
});

describe('lockoutDelayMs', () => {
  it('does not delay the first guesses', () => {
    for (let n = 0; n <= LOCKOUT_FREE_ATTEMPTS; n++) {
      expect(lockoutDelayMs(n), `failures=${n}`).toBe(0);
    }
  });

  it('doubles from one second, so a guesser runs out of attempts quickly', () => {
    expect(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS + 1)).toBe(1000);
    expect(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS + 2)).toBe(2000);
    expect(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS + 3)).toBe(4000);
  });

  it('caps the delay so a device is never locked out for hours', () => {
    expect(lockoutDelayMs(500)).toBe(LOCKOUT_MAX_MS);
  });
});

describe('registerFailedAttempt', () => {
  it('locks the device once the free attempts are spent', () => {
    const now = Date.now();
    let result = { failures: 0, remainingMs: 0 };
    for (let n = 0; n < LOCKOUT_FREE_ATTEMPTS; n++) {
      result = registerFailedAttempt(now);
      expect(isLockedOut(now)).toBe(false);
    }
    expect(result.failures).toBe(LOCKOUT_FREE_ATTEMPTS);

    result = registerFailedAttempt(now);
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(isLockedOut(now)).toBe(true);
    expect(remainingLockoutMs(now)).toBe(result.remainingMs);
  });

  it('expires on its own once the delay has passed', () => {
    const now = Date.now();
    for (let n = 0; n <= LOCKOUT_FREE_ATTEMPTS; n++) registerFailedAttempt(now);
    expect(isLockedOut(now)).toBe(true);
    expect(isLockedOut(now + LOCKOUT_MAX_MS + 1)).toBe(false);
  });

  it('is cleared by a successful sign-in', () => {
    const now = Date.now();
    for (let n = 0; n <= LOCKOUT_FREE_ATTEMPTS; n++) registerFailedAttempt(now);
    clearLockout();
    expect(isLockedOut(now)).toBe(false);
    expect(remainingLockoutMs(now)).toBe(0);
  });
});

describe('corrupt or hostile stored state', () => {
  it('fails open rather than locking the till out forever', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(isLockedOut()).toBe(false);
  });

  it('ignores a timestamp far in the future', () => {
    localStorage.setItem(KEY, JSON.stringify({ failures: 99, lockedUntil: Date.now() + 1e12 }));
    // A clock moved forwards must not turn into a decades-long lockout.
    expect(remainingLockoutMs()).toBeLessThanOrEqual(LOCKOUT_MAX_MS);
  });
});
