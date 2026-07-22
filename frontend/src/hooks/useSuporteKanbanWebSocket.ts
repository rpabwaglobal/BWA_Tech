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
  onChamadoDeleted?: (id: number) => void;
}) {
  const { enabled, onChamadoUpsert, onChamadoDeleted } = opts;
  const cbRef = useRef(onChamadoUpsert);
  cbRef.current = onChamadoUpsert;
  const delRef = useRef(onChamadoDeleted);
  delRef.current = onChamadoDeleted;

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
        ws = new WebSocket(buildSuporteKanbanWsUrl(token as string));
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
            data?: ChamadoSuporte | { id?: number };
          };
          if (msg.type !== 'suporte') return;
          if (msg.event === 'chamado_deleted') {
            // O backend pode disparar deleted como { id } ou { data: { id } }.
            const data = msg.data as ChamadoSuporte | { id?: number } | undefined;
            const id = typeof data?.id === 'number' ? data.id : undefined;
            if (id != null && delRef.current) delRef.current(id);
            return;
          }
          if (msg.event !== 'chamado_created' && msg.event !== 'chamado_updated') return;
          const row = msg.data as ChamadoSuporte | undefined;
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

    // Quando a aba volta a ficar visível, força recálculo: se já atingimos
    // maxReconnectAttempts dormindo numa aba background, queremos uma nova
    // chance imediata. Sem isso, o WS pode ficar morto pra sempre depois de
    // ~24s de tela apagada.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      // Se o socket está saudável, nada a fazer.
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      reconnectAttempts = 0;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      connect();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearPing();
      ws?.close();
    };
  }, [enabled]);
}
