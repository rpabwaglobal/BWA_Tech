import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { authService } from '../services/authService';
import type { User, RegisterData } from '../services/authService';
import { userService } from '../services/userService';
import { setCargoCatalog, setSetorCatalog } from '../lib/catalog-style';

/** Popula o cache de cor/rótulo de cargos e setores (best-effort — falha
 * silenciosa não bloqueia o login; os helpers têm fallback legado). */
async function loadCatalogStyles(): Promise<void> {
  try {
    const [cargos, setores] = await Promise.all([userService.getCargos(), userService.getSetores()]);
    setCargoCatalog(cargos);
    setSetorCatalog(setores);
  } catch {
    /* ignora — fallback legado cobre */
  }
}

type AuthContextType = {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  profilePictureUrl: string | null;
  login: (email: string, password: string) => Promise<void>;
  /** Registra o usuário e retorna user + recovery_code SEM autenticar. Chamar finalizeAuth(user) depois. */
  register: (data: RegisterData) => Promise<{ recovery_code: string; user: User }>;
  /** Conclui a autenticação após o usuário ter visto o código de recuperação. */
  finalizeAuth: (user: User) => void;
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
    // Rede de segurança dupla: `authService.logout` já não rejeita, mas quem
    // chama aqui usa `void performLogout()` (timer de expiração, WebSocket de
    // conta desativada) e uma rejeição solta viraria "Uncaught (in promise)"
    // sem ninguém para tratá-la. Encerrar a sessão local é o que importa.
    try {
      await authService.logout();
    } catch {
      // já tratado lá dentro; aqui só garantimos que o estado local caia
    }
    setUser(null);
  }, []);

  const checkAuth = useCallback(async () => {
    if (!authService.isLoggedIn()) {
      setLoading(false);
      return;
    }

    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      void loadCatalogStyles();
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

  /** Refaz `/users/me/` — é o que faz cargo, permissões e setores novos
   * valerem sem F5. Precisa de identidade ESTÁVEL (`useCallback` sem deps):
   * o NotificationContext a usa como dependência do handler de
   * `permissions_changed` e, por tabela, das callbacks do WebSocket. Se mudasse
   * a cada render, cada refresh derrubaria e reabriria o socket — e os eventos
   * empurrados durante a reconexão se perdem, que é justamente o que não pode
   * acontecer com permissão. */
  const refreshUser = useCallback(async () => {
    if (!authService.isLoggedIn()) return;
    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      // Quem mexeu nas permissões pode ter criado o cargo/setor agora mesmo;
      // sem recarregar o catálogo, a tag do item novo sairia com cor e rótulo
      // de reserva até o próximo F5.
      void loadCatalogStyles();
    } catch {
      // Falha de rede NÃO derruba a sessão. Quando o servidor de fato recusa o
      // token (401), o interceptor do axios já limpa o storage e manda para
      // /entrar. Zerar o `user` aqui deslogava a pessoa por um blip — e este
      // método roda a cada evento de permissão, então blip é questão de tempo.
    }
  }, []);

  // Quando o utilizador volta à aba após o browser estar suspenso (laptop fechado,
  // aba em background), o setTimeout pode ter disparado com atraso ou nem disparado.
  // Este listener garante o logout imediato ao voltar ao foco.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!authService.isLoggedIn()) {
        void performLogout();
        return;
      }
      // Rede de segurança do tempo real: enquanto a aba esteve fora, o
      // WebSocket pode ter caído, e o `permissions_changed` empurrado nesse
      // intervalo não é reenviado. Ressincronizar ao voltar garante que
      // ninguém fique operando com a permissão velha.
      void refreshUser();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [performLogout, refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authService.login({ email, password });
    setUser(response.user);
    void loadCatalogStyles();
    scheduleExpiryLogout(() => void performLogout());
  }, [scheduleExpiryLogout, performLogout]);

  const register = useCallback(async (data: RegisterData): Promise<{ recovery_code: string; user: User }> => {
    const response = await authService.register(data);
    // Não chama setUser aqui: o modal de código de recuperação precisa aparecer
    // antes de PublicRoute redirecionar (isAuthenticated=true causa redirect imediato).
    return { recovery_code: response.recovery_code, user: response.user };
  }, []);

  const finalizeAuth = useCallback((newUser: User) => {
    setUser(newUser);
    scheduleExpiryLogout(() => void performLogout());
  }, [scheduleExpiryLogout, performLogout]);

  const logout = useCallback(async () => {
    await performLogout();
  }, [performLogout]);

  // O objeto do contexto é memoizado pelo mesmo motivo das callbacks: um objeto
  // novo a cada render invalida as dependências de quem consome o contexto.
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,
      profilePictureUrl,
      login,
      register,
      finalizeAuth,
      logout,
      refreshUser,
    }),
    [user, loading, profilePictureUrl, login, register, finalizeAuth, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
