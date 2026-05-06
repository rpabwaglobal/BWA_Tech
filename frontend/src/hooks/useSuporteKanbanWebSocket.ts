import { useEffect, useRef } from 'react';
import type { ChamadoSuporte } from '@/services/suporteService';
import { getFormulariosAuthStorageKey } from '@/services/formulariosApi';

function buildSuporteKanbanWsUrl(token: string): string {
  const viteWs = import.meta.env.VITE_WS_URL as string | undefined;
  if (viteWs) {
    const base = viteWs.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const root = base.startsWith('ws') ? base : `wss://${viteWs.replace(/^https?:\/\//, '')}`;
    return `${root.replace(/\/$/, '')}/ws/suporte/?token=${encodeURIComponent(token)}`;
  }
  if (import.meta.env.DEV) {
    return `ws://127.0.0.1:8000/ws/suporte/?token=${encodeURIComponent(token)}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/suporte/?token=${encodeURIComponent(token)}`;
}

/** Tempo real quando chamados vêm da API Django (`usesLocalFormulariosBackend`). */
export function useSuporteKanbanWebSocket(opts: {
  enabled: boolean;
  onChamadoUpsert: (row: ChamadoSuporte) => void;
}) {
  const { enabled, onChamadoUpsert } = opts;
  const cbRef = useRef(onChamadoUpsert);
  cbRef.current = onChamadoUpsert;

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem(getFormulariosAuthStorageKey());
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
        ws = new WebSocket(buildSuporteKanbanWsUrl(token));
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
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            event?: string;
            data?: ChamadoSuporte;
          };
          if (msg.type !== 'suporte') return;
          if (msg.event !== 'chamado_created' && msg.event !== 'chamado_updated') return;
          const row = msg.data;
          if (row && typeof row.id === 'number') {
            cbRef.current(row);
          }
        } catch {
          /* ignorar */
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
  }, [enabled]);
}
