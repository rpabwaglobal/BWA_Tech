import { useEffect, useRef, useCallback } from 'react';
import type { Notification } from '@/services/notificationService';

type WebSocketMessage = {
  type: 'notification' | 'pong' | 'permissions_changed' | 'account_deactivated'
    | 'solicitacoes_changed';
  data?: Notification;
};

type UseWebSocketOptions = {
  onNotification?: (notification: Notification) => void;
  /** Cargo/permissões/setor do usuário logado mudaram — deve refazer /users/me/ agora. */
  onPermissionsChanged?: () => void;
  /** Conta do usuário logado foi desativada — deve encerrar a sessão agora. */
  onAccountDeactivated?: () => void;
  /** Uma fila de solicitações mudou — o painel de Demandas/Solicitações deve refazer os GETs. */
  onSolicitacoesChanged?: () => void;
  enabled?: boolean;
};

export function useWebSocket({
  onNotification,
  onPermissionsChanged,
  onAccountDeactivated,
  onSolicitacoesChanged,
  enabled = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelay = 3000; // 3 segundos
  /** Teto do backoff. Não existe número máximo de tentativas: por este socket
   * chegam as mudanças de permissão, e desistir dele em definitivo devolveria
   * a plataforma ao "recarregue a página para valer" — exatamente o que o
   * tempo real existe para evitar. Um servidor fora do ar custa uma tentativa
   * a cada 30s, e a aba volta sozinha quando ele levanta. */
  const maxReconnectDelay = 30000;
  /** Já houve uma conexão bem-sucedida nesta sessão? Distingue o primeiro
   * `onopen` (o AuthContext acabou de carregar /users/me/, nada a ressincronizar)
   * de uma RE-conexão, que sempre deixa um buraco atrás de si. */
  const jaConectouRef = useRef(false);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Não abrir um segundo socket: o timer de reconexão e os gatilhos de
    // rede/visibilidade podem cair juntos, e dois sockets no mesmo grupo
    // entregariam cada notificação duas vezes.
    const atual = wsRef.current;
    if (atual && (atual.readyState === WebSocket.OPEN || atual.readyState === WebSocket.CONNECTING)) {
      return;
    }

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

        // Toda RE-conexão ressincroniza o acesso. O servidor não reenvia o que
        // empurrou enquanto o socket esteve fora, e o `permissions_changed` é
        // justamente o evento que não pode se perder: quem estava com a aba
        // ABERTA durante a queda ficaria com a permissão velha até um F5,
        // porque o `visibilitychange` do AuthContext (a outra rede de
        // segurança) só dispara para quem saiu e voltou da aba. Custa um
        // GET /users/me/ por reconexão.
        if (jaConectouRef.current) {
          onPermissionsChanged?.();
          // Mesma razão para o painel de solicitações: um pedido criado ou
          // avaliado durante a queda não é reenviado, e a fila voltaria
          // defasada até um F5. Custa um refetch silencioso por reconexão, e
          // só de quem está com a página aberta.
          onSolicitacoesChanged?.();
        }
        jaConectouRef.current = true;


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
          } else if (message.type === 'permissions_changed') {
            onPermissionsChanged?.();
          } else if (message.type === 'account_deactivated') {
            onAccountDeactivated?.();
          } else if (message.type === 'solicitacoes_changed') {
            onSolicitacoesChanged?.();
          }
          // 'pong' é mantido apenas como sinal de vida — nenhum side-effect.
        } catch (error) {
          console.error('[WebSocket] Erro ao processar mensagem:', error);
        }
      };

      ws.onerror = (error) => {
        // Socket já substituído/descartado erra o tempo todo por construção
        // (a sessão caiu, o efeito remontou). Só é erro de verdade se este
        // ainda for o socket vivo.
        if (wsRef.current !== ws) return;
        console.error('[WebSocket] Erro:', error);
      };

      ws.onclose = (event) => {
        if (wsRef.current === ws) {
          console.log('[WebSocket] Desconectado. Código:', event.code, 'Razão:', event.reason);
        }
        if ((ws as any).pingInterval) {
          clearInterval((ws as any).pingInterval);
        }

        // Só o socket que ESTÁ no ref agenda reconexão. Quem já foi substituído
        // (ou fechado de propósito por `disconnect`, que zera o ref antes) sai
        // por aqui: sem isso, o fechamento antigo agendaria uma reconexão que
        // duplicaria o socket recém-aberto.
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        if (!enabled) return;
        reconnectAttemptsRef.current++;
        const espera = Math.min(reconnectDelay * reconnectAttemptsRef.current, maxReconnectDelay);
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Tentando reconectar (tentativa ${reconnectAttemptsRef.current})...`);
          connect();
        }, espera);
      };
    } catch (error) {
      console.error('Erro ao criar conexão WebSocket:', error);
    }
  }, [enabled, onNotification, onPermissionsChanged, onAccountDeactivated,
      onSolicitacoesChanged]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    const ws = wsRef.current;
    if (ws) {
      // Zera o ref ANTES de mexer no socket: `onclose` usa `wsRef.current !== ws`
      // para saber que este socket foi descartado e não deve reconectar.
      wsRef.current = null;
      // Chamar `close()` num socket ainda em CONNECTING faz o navegador
      // registrar "WebSocket is closed before the connection is established"
      // e disparar `onerror` + `onclose` com código 1006 (fechamento anormal).
      // Não é falha de nada: acontece toda vez que a sessão cai, ou que o
      // StrictMode do React monta e desmonta o efeito em desenvolvimento.
      // Ruído de erro que não corresponde a erro treina quem olha o console a
      // ignorá-lo — então descartamos os handlers e só fechamos quando o
      // handshake terminar.
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onerror = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    }

    reconnectAttemptsRef.current = 0;
    // Encerrou a sessão (logout, `enabled=false`): o próximo `onopen` é um
    // primeiro contato, não uma reconexão — quem entrar de novo já terá feito
    // /users/me/ no login e não precisa do refresh extra.
    jaConectouRef.current = false;
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

  // Volta da rede / volta para a aba: se o socket morreu no meio do caminho,
  // reconecta AGORA em vez de esperar o backoff. É nessa janela que os eventos
  // de permissão se perdem — o servidor não reenvia o que empurrou enquanto o
  // cliente estava fora (quem fecha a janela de vez é o `refreshUser` que o
  // AuthContext dispara ao voltar o foco).
  useEffect(() => {
    if (!enabled) return;

    const reviver = () => {
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      connect();
    };
    const aoVoltarParaAba = () => {
      if (document.visibilityState === 'visible') reviver();
    };

    window.addEventListener('online', reviver);
    document.addEventListener('visibilitychange', aoVoltarParaAba);
    return () => {
      window.removeEventListener('online', reviver);
      document.removeEventListener('visibilitychange', aoVoltarParaAba);
    };
  }, [enabled, connect]);

  return {
    connected: wsRef.current?.readyState === WebSocket.OPEN,
    disconnect,
    reconnect: connect,
  };
}
