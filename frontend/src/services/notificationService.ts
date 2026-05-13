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
  async getAll(params?: {
    filter?: 'mine' | 'all';
    tipo?: string;
    lida?: boolean;
    page?: number;
  }): Promise<Notification[]> {
    const allNotifications: Notification[] = [];
    const queryParams = new URLSearchParams();
    
    if (params?.filter) {
      queryParams.append('filter', params.filter);
    }
    if (params?.tipo) {
      queryParams.append('tipo', params.tipo);
    }
    if (params?.lida !== undefined) {
      queryParams.append('lida', params.lida.toString());
    }
    if (params?.page) {
      queryParams.append('page', params.page.toString());
    }
    
    let nextUrl: string | null = `/notifications/${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    // Cap de segurança: limita o fetch às N páginas mais recentes. Para usuários
    // com milhares de notificações, evita esgotar a cota de rate-limit e travar
    // outros endpoints da mesma sessão. UX de "load more" cobre o restante.
    const MAX_PAGES = 5;
    let pagesFetched = 0;

    while (nextUrl && pagesFetched < MAX_PAGES) {
      const response = await api.get<PaginatedResponse<Notification> | Notification[]>(nextUrl);
      pagesFetched += 1;

      if (Array.isArray(response.data)) {
        // Se não for paginado, retornar diretamente
        return response.data;
      }

      // Se for paginado, adicionar os resultados e verificar se há próxima página
      const paginatedData = response.data as PaginatedResponse<Notification>;
      allNotifications.push(...(paginatedData.results || []));

      // Se houver próxima página, extrair o caminho da URL
      if (paginatedData.next) {
        const url = new URL(paginatedData.next);
        // Remover o /api/ do início do pathname se existir, pois a baseURL já inclui /api
        let pathname = url.pathname;
        if (pathname.startsWith('/api/')) {
          pathname = pathname.substring(4); // Remove '/api'
        }
        nextUrl = pathname + url.search;
      } else {
        nextUrl = null;
      }
    }

    return allNotifications;
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
