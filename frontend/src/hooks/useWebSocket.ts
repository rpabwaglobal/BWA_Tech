import { useEffect, useRef, useCallback } from 'react';
import type { Notification } from '@/services/notificationService';

type WebSocketMessage = {
  type: 'notification' | 'pong';
  data?: Notification;
};

type UseWebSocketOptions = {
  onNotification?: (notification: Notification) => void;
  enabled?: boolean;
};

export function useWebSocket({ onNotification, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000; // 3 segundos

  const connect = useCallback(() => {
    if (!enabled) return;

    // Obter token de autenticação
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    // Em produção: use VITE_WS_URL (ex: wss://tech.bwa.global) ou mesmo host da página
    const viteWs = import.meta.env.VITE_WS_URL as string | undefined;
    let wsUrl: string;
    if (viteWs) {
      const base = viteWs.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
      wsUrl = `${base.startsWith('ws') ? base : `wss://${viteWs.replace(/^https?:\/\//, '')}`}/ws/notifications/?token=${token}`;
    } else if (import.meta.env.DEV) {
      wsUrl = `ws://127.0.0.1:8000/ws/notifications/?token=${token}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/notifications/?token=${token}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        
        // Enviar ping periódico para manter conexão viva
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000); // Ping a cada 30 segundos
        
        // Armazenar intervalo para limpar depois
        (ws as any).pingInterval = pingInterval;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          if (message.type === 'notification' && message.data) {
            onNotification?.(message.data);
          }
          // 'pong' é mantido apenas como sinal de vida — nenhum side-effect.
        } catch (error) {
          console.error('[WebSocket] Erro ao processar mensagem:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Erro:', error);
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Desconectado. Código:', event.code, 'Razão:', event.reason);
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }
        wsRef.current = null;

        // Tentar reconectar se ainda estiver habilitado e não excedeu tentativas
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Tentando reconectar (tentativa ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
            connect();
          }, reconnectDelay * reconnectAttemptsRef.current); // Backoff exponencial
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.warn('WebSocket: Máximo de tentativas de reconexão atingido');
        }
      };
    } catch (error) {
      console.error('Erro ao criar conexão WebSocket:', error);
    }
  }, [enabled, onNotification]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    reconnectAttemptsRef.current = 0;
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    connected: wsRef.current?.readyState === WebSocket.OPEN,
    disconnect,
    reconnect: connect,
  };
}
