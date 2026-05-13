import api from './api';

export type Notification = {
  id: string;
  tipo: string;
  tipo_display?: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  data_criacao: string;
  card_id?: number | null;
  sprint_id?: number | null;
  project_id?: number | null;
  metadata?: Record<string, any>;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type NotificationsPage = {
  results: Notification[];
  /** Total absoluto no servidor (após filtros). */
  count: number;
  /** Path relativo para a próxima página (ex: "/notifications/?page=2"), ou null. */
  next: string | null;
};

type UnreadCountResponse = {
  total: number;
  mine: number;
};

export type NotificationPreferences = {
  // 7 default ON
  card_updated: boolean;
  card_deleted: boolean;
  project_created: boolean;
  card_overdue: boolean;
  card_due_24h: boolean;
  card_due_1h: boolean;
  card_due_10min: boolean;
  // 4 default OFF (opt-in)
  card_created: boolean;
  card_moved: boolean;
  sprint_created: boolean;
  role_changed: boolean;
  // read-only
  updated_at?: string;
};

export type NotificationTypeSlug = keyof Omit<NotificationPreferences, 'updated_at'>;

export const notificationService = {
  /**
   * Busca UMA página de notificações. Para a primeira página, passe `page=1`
   * (ou omita). Para próxima, passe o `next` retornado anteriormente em `pageUrl`.
   *
   * Retorna `{results, count, next}` onde `next` é o path relativo da próxima
   * página (ou null se acabou). Use com `loadMore` no contexto.
   */
  async getPage(params?: {
    tipo?: string;
    lida?: boolean;
    page?: number;
    pageUrl?: string | null;
  }): Promise<NotificationsPage> {
    let url: string;
    if (params?.pageUrl) {
      url = params.pageUrl;
    } else {
      const qp = new URLSearchParams();
      if (params?.tipo) qp.append('tipo', params.tipo);
      if (params?.lida !== undefined) qp.append('lida', String(params.lida));
      if (params?.page) qp.append('page', String(params.page));
      url = `/notifications/${qp.toString() ? `?${qp.toString()}` : ''}`;
    }
    const response = await api.get<PaginatedResponse<Notification> | Notification[]>(url);

    // Fallback: endpoint pode retornar array sem paginação em alguns casos
    if (Array.isArray(response.data)) {
      return { results: response.data, count: response.data.length, next: null };
    }

    const paginated = response.data as PaginatedResponse<Notification>;
    let nextPath: string | null = null;
    if (paginated.next) {
      try {
        const u = new URL(paginated.next);
        let pathname = u.pathname;
        if (pathname.startsWith('/api/')) pathname = pathname.substring(4);
        nextPath = pathname + u.search;
      } catch {
        nextPath = paginated.next;
      }
    }
    return { results: paginated.results ?? [], count: paginated.count ?? 0, next: nextPath };
  },

  async getUnreadCount(): Promise<UnreadCountResponse> {
    const response = await api.get<UnreadCountResponse>('/notifications/unread_count/');
    return response.data;
  },

  async markAsRead(id: string): Promise<Notification> {
    const response = await api.post<Notification>(`/notifications/${id}/mark_as_read/`);
    return response.data;
  },

  async markAllAsRead(): Promise<{ count: number }> {
    const response = await api.post<{ count: number }>('/notifications/mark_all_as_read/');
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/notifications/${id}/`);
  },

  async getPreferences(): Promise<NotificationPreferences> {
    const response = await api.get<NotificationPreferences>('/notifications/preferences/');
    return response.data;
  },

  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const response = await api.patch<NotificationPreferences>('/notifications/preferences/', patch);
    return response.data;
  },
};
