import { useEffect, useRef } from 'react';

export type CardMovedEvent = {
  card_id: number;
  old_status: string;
  new_status: string;
  actor_user_id: number | null;
};

function buildSprintKanbanWsUrl(sprintId: number | string, token: string): string {
  const path = `/ws/sprints/${sprintId}/kanban/?token=${encodeURIComponent(token)}`;
  const viteWs = import.meta.env.VITE_WS_URL as string | undefined;
  if (viteWs) {
    const base = viteWs.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const root = base.startsWith('ws') ? base : `wss://${viteWs.replace(/^https?:\/\//, '')}`;
    return `${root.replace(/\/$/, '')}${path}`;
  }
  if (import.meta.env.DEV) {
    return `ws://127.0.0.1:8000${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Conecta ao WebSocket do Kanban de uma sprint e dispara `onCardMoved`
 * quando outro usuário move um card de coluna.
 *
 * - `enabled=false` → não conecta (use enquanto o sprintId ainda carrega).
 * - O autor da movimentação também recebe o evento; quem usa o hook deve
 *   filtrar via `actor_user_id === currentUser.id` para evitar dupla atualização.
 * - Reconecta automaticamente com backoff (até 8 tentativas).
 * - Mantém vivo com ping a cada 30s.
 */
export function useSprintKanbanWebSocket(opts: {
  sprintId: number | string | null | undefined;
  enabled: boolean;
  onCardMoved: (event: CardMovedEvent) => void;
}) {
  const { sprintId, enabled, onCardMoved } = opts;
  // Mantém a callback atual sem reabrir a conexão a cada render
  const cbRef = useRef(onCardMoved);
  cbRef.current = onCardMoved;

  useEffect(() => {
    if (!enabled || !sprintId) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    let ws: WebSocket | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 8;
    const reconnectDelayMs = 3000;

    const clearPing = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    function scheduleReconnect() {
      if (cancelled || reconnectAttempts >= maxReconnectAttempts) return;
      reconnectAttempts += 1;
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, reconnectDelayMs * reconnectAttempts);
    }

    function connect() {
      if (cancelled) return;
      try {
        ws = new WebSocket(buildSprintKanbanWsUrl(sprintId!, token!));
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        reconnectAttempts = 0;
        clearPing();
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Partial<CardMovedEvent> & {
            type?: string;
          };
          if (msg.type !== 'card_moved') return;
          if (typeof msg.card_id !== 'number' || !msg.old_status || !msg.new_status) return;
          cbRef.current({
            card_id: msg.card_id,
            old_status: msg.old_status,
            new_status: msg.new_status,
            actor_user_id: msg.actor_user_id ?? null,
          });
        } catch {
          /* ignora payload malformado */
        }
      };

      ws.onclose = () => {
        clearPing();
        ws = null;
        if (!cancelled) scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearPing();
      ws?.close();
    };
  }, [sprintId, enabled]);
}
