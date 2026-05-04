import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Check, Trash2, Filter } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import { formatDateTime } from '@/lib/dateUtils';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/routes';

interface NotificationsPanelProps {
  onClose: () => void;
}

export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const {
    notifications,
    loading,
    filter,
    setFilter,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();
  const navigate = useNavigate();

  // Filtrar notificações
  const filteredNotifications = useMemo(() => {
    let filtered = [...notifications];

    if (filter === 'mine') {
      // Excluir notificações gerais
      filtered = filtered.filter(
        (n) => !['sprint_created'].includes(n.tipo)
      );
    } else if (filter === 'unread') {
      filtered = filtered.filter((n) => !n.lida);
    }

    return filtered;
  }, [notifications, filter]);

  // Obter cor baseada no tipo de notificação
  const getNotificationColor = (tipo: string) => {
    switch (tipo) {
      case 'card_created':
        return 'bg-green-500';
      case 'card_updated':
        return 'bg-blue-500';
      case 'card_deleted':
        return 'bg-red-500';
      case 'card_moved':
        return 'bg-purple-500';
      case 'sprint_created':
        return 'bg-indigo-500';
      case 'project_created':
        return 'bg-cyan-500';
      case 'role_changed':
        return 'bg-yellow-500';
      case 'card_overdue':
        return 'bg-red-600';
      case 'card_due_24h':
        return 'bg-orange-500';
      case 'card_due_1h':
        return 'bg-orange-600';
      case 'card_due_10min':
        return 'bg-red-700';
      case 'log_created':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  // Obter ícone baseado no tipo
  const getNotificationIcon = (tipo: string) => {
    return null;
  };

  // Navegar para o item relacionado
  const handleNotificationClick = (notification: typeof notifications[0]) => {
    if (notification.lida) {
      markAsRead(notification.id);
    }

    // Navegar baseado no tipo e referências
    if (notification.card_id && notification.project_id) {
      navigate(ROUTES.projetoCard(String(notification.project_id), String(notification.card_id)));
    } else if (notification.sprint_id) {
      navigate(ROUTES.sprintPorId(String(notification.sprint_id)));
    } else if (notification.project_id) {
      navigate(ROUTES.projeto(String(notification.project_id)));
    } else if (notification.tipo === 'role_changed') {
      navigate(ROUTES.pessoas);
    }

    onClose();
  };

  return (
    <div
      className={cn(
        'w-[480px] max-h-[600px]',
        'bg-[var(--color-background)]',
        'border border-[var(--color-border)]',
        'rounded-[8px] shadow-2xl',
        'flex flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-[16px] border-b border-[var(--color-border)] flex-shrink-0">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
          Notificações
        </h2>
        <div className="flex items-center gap-[8px]">
          <Button
            variant="ghost"
            size="icon"
            onClick={markAllAsRead}
            className="h-[32px] w-[32px]"
            title="Marcar todas como lidas"
          >
            <Check className="h-[16px] w-[16px]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-[32px] w-[32px]"
          >
            <X className="h-[16px] w-[16px]" />
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-[8px] p-[16px] border-b border-[var(--color-border)] flex-shrink-0">
        <Filter className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
        <div className="flex gap-[8px] flex-1">
          <Button
            variant={filter === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter('all')}
            className="h-[28px] text-xs"
          >
            Todas
          </Button>
          <Button
            variant={filter === 'mine' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter('mine')}
            className="h-[28px] text-xs"
          >
            Minhas
          </Button>
          <Button
            variant={filter === 'unread' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter('unread')}
            className="h-[28px] text-xs"
          >
            Não lidas
          </Button>
        </div>
      </div>

      {/* Lista de notificações */}
      <div className="flex-1 overflow-y-auto p-[16px]">
        {loading ? (
          <div className="flex items-center justify-center py-[32px]">
            <div className="text-[var(--color-muted-foreground)]">Carregando...</div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex items-center justify-center py-[32px]">
            <div className="text-[var(--color-muted-foreground)] text-center">
              Nenhuma notificação encontrada
            </div>
          </div>
        ) : (
          <div className="relative pl-[48px]">
            {/* Linha vertical da timeline */}
            <div className="absolute left-[15px] top-0 bottom-0 w-[2px] bg-[var(--color-border)]" />

            {/* Notificações */}
            <div className="space-y-[40px]">
              {filteredNotifications.map((notification) => (
                <div key={notification.id} className="relative">
                  {/* Ponto da timeline */}
                  <div className="absolute left-[-48px] top-[2px] z-10 flex-shrink-0">
                    <div
                      className={cn(
                        'w-[32px] h-[32px] rounded-full',
                        getNotificationColor(notification.tipo),
                        'flex items-center justify-center',
                        'border-4 border-[var(--color-background)] shadow-sm',
                        !notification.lida && 'ring-2 ring-offset-2 ring-offset-[var(--color-background)] ring-[var(--color-primary)]'
                      )}
                    />
                  </div>

                  {/* Conteúdo da notificação */}
                  <div
                    className={cn(
                      'flex-1 min-w-0 cursor-pointer',
                      'hover:bg-[var(--color-accent)] rounded-[8px] p-[8px] -ml-[8px] transition-colors',
                      !notification.lida && 'bg-[var(--color-accent)]/50'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start justify-between gap-[8px] mb-[8px]">
                      <h3
                        className={cn(
                          'text-sm font-semibold text-[var(--color-foreground)]',
                          !notification.lida && 'font-bold'
                        )}
                      >
                        {notification.titulo}
                      </h3>
                      <div className="flex items-center gap-[4px] flex-shrink-0">
                        {!notification.lida && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-[24px] w-[24px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(notification.id);
                            }}
                          >
                            <Check className="h-[12px] w-[12px]" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-[24px] w-[24px] text-[var(--color-destructive)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                        >
                          <Trash2 className="h-[12px] w-[12px]" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-sm text-[var(--color-foreground)] mb-[8px] whitespace-pre-wrap leading-relaxed">
                      {notification.mensagem}
                    </p>

                    <div className="flex items-center gap-[8px] text-xs text-[var(--color-muted-foreground)]">
                      <Clock className="h-[12px] w-[12px]" />
                      <span>{formatDateTime(notification.data_criacao)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
