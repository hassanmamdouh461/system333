import React, { createContext, useContext, useState, ReactNode } from 'react';

// ─── Storage keys ────────────────────────────────────────────────────────────
const LS_EMAIL_KEY = 'brewmaster_remembered_email';
const LS_SESSION_KEY = 'auth_session'; // legacy display snapshot (user + branch only)
const LS_TOKEN_KEY = 'auth_token';     // HMAC-signed session token (Electron) / JWT (web)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchSession {
  branchId: string;
  branchName: string;
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
  authToken: string | null;
  mustChangePassword: boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI && typeof window.electronAPI.authLogin === 'function';
}

function getWorkerUrl(): string {
  return (import.meta.env.VITE_CF_WORKER_URL || 'https://api.engaz.tech').replace(/\/+$/, '');
}

function readStoredToken(): string | null {
  try {
    // Session-first: sessionStorage survives refresh but dies with the app;
    // localStorage is only used when the user chose "remember me".
    return sessionStorage.getItem(LS_TOKEN_KEY) || localStorage.getItem(LS_TOKEN_KEY);
  } catch {
    return null;
  }
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(LS_SESSION_KEY) || localStorage.getItem(LS_SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restore session snapshot + token on page load/refresh
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [authToken, setAuthToken] = useState<string | null>(() => readStoredToken());
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(false);

  const login = async (email: string, password: string, rememberMe = false): Promise<User> => {
    if (isElectron()) {
      // ── Desktop: verify against local SQLite users table (scrypt hashes) ──
      const result = await window.electronAPI.authLogin(email.trim(), password);
      const next: StoredSession = {
        user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
        branch: { branchId: result.branch.branchId, branchName: result.branch.branchName },
      };
      applySession(next, result.token, Boolean(result.mustChangePassword), rememberMe, email);
      return next.user;
    }

    // ── Web (manager portal): verify against the cloud auth API ──
    const res = await fetch(`${getWorkerUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Invalid credentials');
    }
    const next: StoredSession = {
      user: { id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role },
      branch: { branchId: data.user.branchId, branchName: data.user.branchName },
    };
    applySession(next, data.token, Boolean(data.user.mustChangePassword), rememberMe, email);
    return next.user;
  };

  const applySession = (
    next: StoredSession,
    token: string,
    mustChange: boolean,
    rememberMe: boolean,
    email: string
  ) => {
    setSession(next);
    setAuthToken(token);
    setMustChangePassword(mustChange);

    // Clear both stores first, then write to the right one
    try {
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_TOKEN_KEY);
      sessionStorage.removeItem(LS_SESSION_KEY);
      sessionStorage.removeItem(LS_TOKEN_KEY);

      const store = rememberMe ? localStorage : sessionStorage;
      store.setItem(LS_SESSION_KEY, JSON.stringify(next));
      store.setItem(LS_TOKEN_KEY, token);

      if (rememberMe) {
        localStorage.setItem(LS_EMAIL_KEY, email.trim());
      } else {
        localStorage.removeItem(LS_EMAIL_KEY);
      }
    } catch {
      // Storage unavailable (private mode) — session lives in memory only
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    const token = readStoredToken();
    if (!token) throw new Error('Session expired — please log in again');

    if (isElectron()) {
      await window.electronAPI.authChangePassword(token, currentPassword, newPassword);
    } else {
      const res = await fetch(`${getWorkerUrl()}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Password change failed');
      }
    }
    setMustChangePassword(false);
  };

  const logout = () => {
    try {
      sessionStorage.removeItem(LS_SESSION_KEY);
      sessionStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_TOKEN_KEY);
    } catch {}
    setSession(null);
    setAuthToken(null);
    setMustChangePassword(false);
  };

  const value: AuthContextType = {
    user: session?.user ?? null,
    branch: session?.branch ?? null,
    login,
    logout,
    isAuthenticated: !!session && !!authToken,
    authToken,
    mustChangePassword,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
