import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getBranchConfig, setBranchConfig } from '../utils/settingsConfig';

const LS_EMAIL_KEY = 'brewmaster_remembered_email';
const LS_SESSION_KEY  = 'auth_session';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchSession {
  branchId: string;    // UUID identifying which branch this POS belongs to
  branchName: string;  // Display name (e.g., "Downtown Branch")
  authToken: string;   // Placeholder token for future server-side auth
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

export const BRANCH_ACCOUNTS = [
  {
    branchId: 'branch_1',
    branchName: 'فرع المعادي (فرع 1)',
    branchNameEn: 'Maadi Branch (Branch 1)',
    email: 'branch1@system.com',
    password: '123',
    role: 'admin' as const
  },
  {
    branchId: 'branch_2',
    branchName: 'فرع مصر الجديدة (فرع 2)',
    branchNameEn: 'Heliopolis Branch (Branch 2)',
    email: 'branch2@system.com',
    password: '123',
    role: 'admin' as const
  },
  {
    branchId: 'branch_3',
    branchName: 'فرع الزمالك (فرع 3)',
    branchNameEn: 'Zamalek Branch (Branch 3)',
    email: 'branch3@system.com',
    password: '123',
    role: 'admin' as const
  },
  {
    branchId: 'manager',
    branchName: 'الإدارة العامة',
    branchNameEn: 'General Management',
    email: 'manager@system.com',
    password: '123',
    role: 'manager' as const
  }
];

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // ── Synchronous init: restore session from storage on page load/refresh ──
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const saved =
        localStorage.getItem(LS_SESSION_KEY) ||
        sessionStorage.getItem(LS_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredSession;
        // Validate it has the new structure
        if (parsed.user && parsed.branch) return parsed;
        // Legacy format (just User object) — clear it
        localStorage.removeItem(LS_SESSION_KEY);
        sessionStorage.removeItem(LS_SESSION_KEY);
      }
      return null;
    } catch {
      return null;
    }
  });

  const login = async (email: string, password: string, rememberMe?: boolean) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    // ── Validate against branch account credentials ──
    const targetEmail = email.trim().toLowerCase();
    const matchedAccount = BRANCH_ACCOUNTS.find(
      acc => acc.email.toLowerCase() === targetEmail && acc.password === password
    );

    if (!matchedAccount) {
      throw new Error('Invalid email or password');
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
      authToken: `local-${crypto.randomUUID?.() || Math.random().toString(36).substr(2, 16)}`,
    };

    const sessionData: StoredSession = { user: userData, branch: branchSession };

    // ── Persist branch_id to settings so database.cjs picks it up ──
    setBranchConfig({
      branchId: matchedAccount.branchId,
      branchName: matchedAccount.branchNameEn,
      email: matchedAccount.email,
      password: matchedAccount.password,
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
