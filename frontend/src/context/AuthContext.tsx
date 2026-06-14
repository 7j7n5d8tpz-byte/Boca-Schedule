import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { api } from '../api/client';

const INACTIVITY_MS = 60 * 60 * 1000; // 1 hour
const ACTIVITY_KEY  = 'lastActivity';

function isExpired(): boolean {
  const last = localStorage.getItem(ACTIVITY_KEY);
  return !!last && Date.now() - Number(last) > INACTIVITY_MS;
}

function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem(ACTIVITY_KEY);
}

interface User {
  userId: string;
  email: string;
  name: string;
  role: 'player' | 'coach' | 'admin';
  preferredPositions: string[];
  avatarUrl?: string | null;
  isFineAdmin?: boolean;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    if (!stored) return null;
    // Synchronously reject expired sessions before the first render
    if (isExpired()) { clearSession(); return null; }
    // Opening the app counts as activity — reset the timer
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    return JSON.parse(stored);
  });

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clearSession();
    setUser(null);
  }, []);

  // Patch the in-memory user and persist it, so changes like a new avatar show
  // immediately across the app without a re-login.
  const updateUser = useCallback((patch: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string> => {
    const { data } = await api.post('/auth/login', { email, password });
    const { user: u, tokens } = data.data;
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    setUser(u);
    return u.role;
  }, []);

  // Update lastActivity on any user interaction (throttled to once per minute)
  useEffect(() => {
    if (!user) return;
    let lastWrite = Date.now();
    function onActivity() {
      const now = Date.now();
      if (now - lastWrite > 60_000) {
        lastWrite = now;
        localStorage.setItem(ACTIVITY_KEY, String(now));
      }
    }
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, onActivity));
  }, [user]);

  // Periodically check whether the session has gone idle while the tab is open
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (isExpired()) logout();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
