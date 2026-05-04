import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authService } from '../services/authService';
import type { User, RegisterData } from '../services/authService';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  profilePictureUrl: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const profilePictureUrl = user?.profile_picture_url ?? null;
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Agenda (ou re-agenda) o timer de logout automático com base em auth_expires_at. */
  const scheduleExpiryLogout = useCallback((onExpire: () => void) => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    const ms = authService.msUntilExpiry();
    if (ms <= 0) return;
    expiryTimerRef.current = setTimeout(onExpire, ms);
  }, []);

  const performLogout = useCallback(async () => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    try {
      await authService.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    if (!authService.isLoggedIn()) {
      setLoading(false);
      return;
    }

    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      scheduleExpiryLogout(() => void performLogout());
    } catch {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_expires_at');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [scheduleExpiryLogout, performLogout]);

  useEffect(() => {
    void checkAuth();
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, [checkAuth]);

  // Quando o utilizador volta à aba após o browser estar suspenso (laptop fechado,
  // aba em background), o setTimeout pode ter disparado com atraso ou nem disparado.
  // Este listener garante o logout imediato ao voltar ao foco.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!authService.isLoggedIn()) {
        void performLogout();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [performLogout]);

  const login = async (username: string, password: string) => {
    const response = await authService.login({ username, password });
    setUser(response.user);
    scheduleExpiryLogout(() => void performLogout());
  };

  const register = async (data: RegisterData) => {
    const response = await authService.register(data);
    setUser(response.user);
    scheduleExpiryLogout(() => void performLogout());
  };

  const logout = async () => {
    await performLogout();
  };

  const refreshUser = async () => {
    if (!authService.isLoggedIn()) return;
    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        profilePictureUrl,
        login,
        register,
        logout,
        refreshUser,
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
