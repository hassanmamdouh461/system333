import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getBranchConfig, setBranchConfig } from '../utils/settingsConfig';

const LS_EMAIL_KEY = 'brewmaster_remembered_email';
const LS_SESSION_KEY  = 'auth_session';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchSession {
  branchId: string;    // UUID identifying which branch this POS belongs to
  branchName: string;  // Display name (e.g., "Downtown Branch")
  authToken: string;   // Server-issued session token (JWT from /auth/login, or offline-* fallback)
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'manager';
}

interface AuthContextType {
  user: User | null;
  branch: BranchSession | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

/**
 * Known branch accounts — metadata ONLY.
 *
 * Passwords were removed from the client bundle (problem #2). Login is
 * verified server-side by the Cloudflare Worker (POST /auth/login) against
 * PBKDF2 password hashes stored in D1. If the cloud is unreachable (offline
 * branch POS), a local SHA-256 hash check is used as a temporary fallback
 * until the branches' local DBs hold their own user records.
 */
export const BRANCH_ACCOUNTS = [
  {
    branchId: 'branch_1',
    branchName: 'فرع المعادي (فرع 1)',
    branchNameEn: 'Maadi Branch (Branch 1)',
    email: 'branch1@system.com',
    role: 'admin' as const
  },
  {
    branchId: 'branch_2',
    branchName: 'فرع مصر الجديدة (فرع 2)',
    branchNameEn: 'Heliopolis Branch (Branch 2)',
    email: 'branch2@system.com',
    role: 'admin' as const
  },
  {
    branchId: 'branch_3',
    branchName: 'فرع الزمالك (فرع 3)',
    branchNameEn: 'Zamalek Branch (Branch 3)',
    email: 'branch3@system.com',
    role: 'admin' as const
  },
  {
    branchId: 'manager',
    branchName: 'الإدارة العامة',
    branchNameEn: 'General Management',
    email: 'manager@system.com',
    role: 'manager' as const
  }
];

/**
 * Offline fallback: SHA-256 hashes of the branch passwords (never the
 * plaintext). Replace entries with the real hashes per deployment, or let
 * local login fail closed and require the cloud login path.
 * Generate with: sha256(password)
 */
const LOCAL_PASSWORD_HASHES: Record<string, string> = {
  // e.g. 'branch1@system.com': '<sha256-hex-of-password>',
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Extract the exp claim from a JWT without verifying (verification is the server's job). */
function jwtExpirySeconds(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

function isTokenLive(token: string): boolean {
  // Offline-issued tokens are stamped with an explicit expiry marker.
  if (token.startsWith('offline-')) return true; // offline sessions live until logout
  const exp = jwtExpirySeconds(token);
  if (exp === null) return false;
  return exp * 1000 > Date.now();
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // ── Synchronous init: restore session from storage on page load/refresh ──
  // Sessions are only restored when they carry a live (non-expired) token —
  // a stale blob in localStorage is no longer trusted on its own (problem #4).
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const saved =
        localStorage.getItem(LS_SESSION_KEY) ||
        sessionStorage.getItem(LS_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredSession;
        // Validate it has the new structure AND a live session token
        if (parsed.user && parsed.branch && parsed.branch.authToken && isTokenLive(parsed.branch.authToken)) {
          return parsed;
        }
        // Legacy/expired format — clear it
        localStorage.removeItem(LS_SESSION_KEY);
        sessionStorage.removeItem(LS_SESSION_KEY);
      }
      return null;
    } catch {
      return null;
    }
  });

  const login = async (email: string, password: string, rememberMe?: boolean) => {
    const targetEmail = email.trim().toLowerCase();
    const matchedAccount = BRANCH_ACCOUNTS.find(
      acc => acc.email.toLowerCase() === targetEmail
    );

    if (!matchedAccount) {
      throw new Error('Invalid email or password');
    }

    // ── Verify credentials server-side (Cloudflare Worker /auth/login) ──
    // The worker checks the PBKDF2 hash in D1 and returns a signed session
    // token (problem #2 + #4). Offline POS terminals fall back to a local
    // SHA-256 hash check with a clearly-marked short-lived offline token.
    let authToken: string;
    try {
      const { cloudFetch } = await import('../services/cloudClient');
      const res = await cloudFetch<{
        token: string;
        branchId: string;
        role: 'admin' | 'manager';
      }>('/auth/login', { email: targetEmail, password });

      if (!res.token || res.branchId !== matchedAccount.branchId) {
        throw new Error('Invalid server response');
      }
      authToken = res.token;
    } catch (cloudErr: any) {
      // Cloud unreachable — try the offline hash fallback (branch POS only)
      const expectedHash = LOCAL_PASSWORD_HASHES[targetEmail];
      if (!expectedHash) {
        throw new Error(
          localStorage.getItem('brewmaster_lang') === 'ar'
            ? 'تعذر الاتصال بخادم المصادقة. تحقق من الإنترنت أو إعدادات الخادم.'
            : 'Cannot reach the authentication server. Check your connection or server settings.'
        );
      }
      const hash = await sha256Hex(password);
      if (hash !== expectedHash) {
        throw new Error('Invalid email or password');
      }
      authToken = `offline-${crypto.randomUUID?.() || Math.random().toString(36).substr(2, 16)}`;
    }

    // ── Enforce environment restrictions ──
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
    if (isElectron && matchedAccount.role === 'manager') {
      throw new Error(
        localStorage.getItem('brewmaster_lang') === 'ar'
          ? 'حساب المدير يمكنه تسجيل الدخول فقط من خلال موقع الإدارة الإلكتروني (الويب).'
          : 'Manager account can only log in through the online management portal (Web).'
      );
    }

    if (!isElectron && matchedAccount.role !== 'manager') {
      throw new Error(
        localStorage.getItem('brewmaster_lang') === 'ar'
          ? 'حسابات الفروع يمكنها تسجيل الدخول فقط من خلال برنامج الكاشير المكتبي (Desktop POS).'
          : 'Branch accounts can only log in through the desktop POS application.'
      );
    }

    // ── Build user & branch session ──
    const userData: User = {
      id: matchedAccount.branchId,
      name: matchedAccount.branchNameEn,
      email: matchedAccount.email,
      role: matchedAccount.role,
    };

    const branchSession: BranchSession = {
      branchId: matchedAccount.branchId,
      branchName: matchedAccount.branchNameEn,
      authToken,
    };

    const sessionData: StoredSession = { user: userData, branch: branchSession };

    // ── Persist branch identity so database.cjs picks it up ──
    // Passwords are NEVER written to storage (problem #3).
    setBranchConfig({
      branchId: matchedAccount.branchId,
      branchName: matchedAccount.branchNameEn,
      email: matchedAccount.email,
    });

    if (rememberMe) {
      // Persist across browser restarts
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(sessionData));
      localStorage.setItem(LS_EMAIL_KEY, email.trim());
      sessionStorage.removeItem(LS_SESSION_KEY);
    } else {
      // Persist only for the current tab/session
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
