import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { notificationService, type Notification } from '@/services/notificationService';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuth } from './AuthContext';

type NotificationFilter = 'all' | 'unread';

type NotificationContextType = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  filter: NotificationFilter;
  setFilter: (filter: NotificationFilter) => void;
  loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  /** Path da próxima página (DRF paginated `next` normalizado). null = fim. */
  const nextPageRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Carrega APENAS a primeira página. Páginas adicionais via loadMore().
  const loadFirstPage = useCallback(async () => {
    if (!isAuthenticated) {
      setNotifications([]);
      setLoading(false);
      setHasMore(false);
      nextPageRef.current = null;
      return;
    }
    try {
      setLoading(true);
      const params: Parameters<typeof notificationService.getPage>[0] = {};
      if (filter === 'unread') {
        params.lida = false;
      }
      const page = await notificationService.getPage(params);
      setNotifications(page.results);
      nextPageRef.current = page.next;
      setHasMore(!!page.next);
    } catch (error) {
      console.error('Erro ao carregar notificações:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, filter]);

  const loadMore = useCallback(async () => {
    if (!nextPageRef.current || loadingMore) return;
    try {
      setLoadingMore(true);
      const page = await notificationService.getPage({ pageUrl: nextPageRef.current });
      // Append único — não duplica se WS já trouxe a notificação
      setNotifications((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const fresh = page.results.filter((n) => !existing.has(n.id));
        return [...prev, ...fresh];
      });
      nextPageRef.current = page.next;
      setHasMore(!!page.next);
    } catch (error) {
      console.error('Erro ao carregar mais notificações:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // Carregar contadores
  const loadCounts = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const counts = await notificationService.getUnreadCount();
      setUnreadCount(counts.total);
    } catch (error) {
      console.error('Erro ao carregar contadores:', error);
    }
  }, [isAuthenticated]);

  // Handler para notificações recebidas via WebSocket
  const handleNotification = useCallback((notification: Notification) => {
    // Adicionar nova notificação no início (evita duplicatas)
    setNotifications((prev) => {
      const exists = prev.some((n) => n.id === notification.id);
      if (exists) {
        return prev.map((n) => (n.id === notification.id ? notification : n));
      }
      return [notification, ...prev];
    });
    if (!notification.lida) {
      setUnreadCount((prev) => prev + 1);
    }
    // Disparar evento para outras páginas reagirem
    window.dispatchEvent(new CustomEvent('notificationReceived', { detail: notification }));
  }, []);

  // Conectar WebSocket
  useWebSocket({
    onNotification: handleNotification,
    enabled: isAuthenticated,
  });

  // Carregar quando autenticado ou filtro mudar
  useEffect(() => {
    if (isAuthenticated) {
      loadFirstPage();
      loadCounts();
    } else {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      setHasMore(false);
      nextPageRef.current = null;
    }
  }, [isAuthenticated, filter, loadFirstPage, loadCounts]);

  // Recarregar contadores a cada 30s
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      loadCounts();
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadCounts]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Erro ao marcar notificação como lida:', error);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, lida: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error);
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    try {
      await notificationService.delete(id);
      setNotifications((prev) => {
        const deleted = prev.find((n) => n.id === id);
        if (deleted && !deleted.lida) {
          setUnreadCount((u) => Math.max(0, u - 1));
        }
        return prev.filter((n) => n.id !== id);
      });
    } catch (error) {
      console.error('Erro ao deletar notificação:', error);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    await Promise.all([loadFirstPage(), loadCounts()]);
  }, [loadFirstPage, loadCounts]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        loadingMore,
        hasMore,
        filter,
        setFilter,
        loadMore,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        refreshNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications deve ser usado dentro de NotificationProvider');
  }
  return context;
}
