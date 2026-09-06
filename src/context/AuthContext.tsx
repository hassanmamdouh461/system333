import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { getBranchConfig, setBranchConfig, verifyPassword, hashPassword } from '../utils/settingsConfig';

const LS_EMAIL_KEY = 'engaz_remembered_email';
const LS_SESSION_KEY = 'auth_session';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchSession {
  branchId: string;    // identifies which branch this POS belongs to
  branchName: string;  // display name
  authToken: string;   // local session marker; not a server credential
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff';
}

interface AuthContextType {
  user: User | null;
  branch: BranchSession | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
  /** True when this device has no password yet and the next sign-in will set one. */
  needsPasswordSetup: (email: string) => boolean;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

/**
 * The account this till signs in with.
 *
 * This install is one branch. The identity lives in the branch configuration — which the
 * settings page edits — and the password is set on first sign-in and stored as a PBKDF2
 * digest on that device. The old three-branch list shipped three addresses that every copy of
 * the bundle recognised, and a branch registry is now managed from the reports portal anyway:
 * the till only needs to know which one it is.
 */
export function getBranchAccount(): BranchAccount {
  const config = getBranchConfig();
  return {
    branchId: config.branchId,
    branchName: config.branchName,
    email: config.email,
    role: 'admin' as const,
  };
}

export interface BranchAccount {
  branchId: string;
  branchName: string;
  email: string;
  role: 'admin' | 'staff';
}

/** Minimum length accepted when a device sets its password for the first time. */
const MIN_PASSWORD_LENGTH = 6;

function findAccount(email: string) {
  const account = getBranchAccount();
  // The configured address is the only one this till accepts: same rejection for an unknown
  // address and a wrong password, so an attacker cannot enumerate anything.
  return account.email.trim().toLowerCase() === email.trim().toLowerCase() ? account : null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronous init so a refresh does not flash the login screen before restoring.
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const saved =
        localStorage.getItem(LS_SESSION_KEY) ||
        sessionStorage.getItem(LS_SESSION_KEY);
      if (!saved) return null;

      const parsed = JSON.parse(saved) as StoredSession;
      if (parsed.user && parsed.branch) return parsed;

      // Legacy shape (a bare User object) — clear it rather than half-restoring.
      localStorage.removeItem(LS_SESSION_KEY);
      sessionStorage.removeItem(LS_SESSION_KEY);
      return null;
    } catch {
      return null;
    }
  });

  /**
   * True when the named account has no stored password on this device. The login form uses
   * this to explain that the password being typed will become the device password.
   */
  const needsPasswordSetup = useCallback((email: string) => {
    const account = findAccount(email);
    if (!account) return false;
    const config = getBranchConfig();
    return !(config.branchId === account.branchId && config.password);
  }, []);
  const login = async (email: string, password: string, rememberMe?: boolean) => {
    const account = findAccount(email);
    // Same rejection for an unknown address and a wrong password: telling them apart lets
    // an attacker enumerate valid accounts.
    if (!account) {
      throw new Error('بيانات الدخول غير صحيحة');
    }

    const config = getBranchConfig();
    const storedHash = config.branchId === account.branchId ? config.password : null;

    if (storedHash) {
      if (!(await verifyPassword(password, storedHash))) {
        throw new Error('بيانات الدخول غير صحيحة');
      }
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      // First sign-in on this device sets the password, so it has to be worth keeping.
      throw new Error(
        `هذا أول تسجيل دخول على هذا الجهاز؛ اختر كلمة مرور من ${MIN_PASSWORD_LENGTH} أحرف على الأقل`
      );
    }

    const userData: User = {
      id: account.branchId,
      name: account.branchName,
      email: account.email,
      role: account.role,
    };

    const branchSession: BranchSession = {
      branchId: account.branchId,
      branchName: account.branchName,
      authToken: `local-${crypto.randomUUID()}`,
    };

    const sessionData: StoredSession = { user: userData, branch: branchSession };

    // Write the branch identity so the Electron layer can scope its queries. The password
    // is only written on first sign-in: re-writing it on every login is what used to reset
    // a changed password back to the shipped default.
    await setBranchConfig({
      branchId: account.branchId,
      branchName: account.branchName,
      email: account.email,
      ...(storedHash ? {} : { password: await hashPassword(password) }),
    });

    if (rememberMe) {
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(sessionData));
      localStorage.setItem(LS_EMAIL_KEY, email.trim());
      sessionStorage.removeItem(LS_SESSION_KEY);
    } else {
      sessionStorage.setItem(LS_SESSION_KEY, JSON.stringify(sessionData));
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_EMAIL_KEY);
    }

    setSession(sessionData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem(LS_SESSION_KEY);
    localStorage.removeItem(LS_EMAIL_KEY);
    sessionStorage.removeItem(LS_SESSION_KEY);
    // Clear the register draft too: it belongs to the cashier who was signed in, and the
    // next person to sign in should not inherit a half-rung sale.
    localStorage.removeItem('pos_draft');
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        branch: session?.branch ?? null,
        login,
        logout,
        isAuthenticated: !!session,
        needsPasswordSetup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
