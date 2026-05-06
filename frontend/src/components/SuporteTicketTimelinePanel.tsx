import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, MessageSquare, SendHorizontal, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/dateUtils';
import {
  suporteTimelineService,
  type SuporteTimelineEntry,
} from '@/services/suporteTimelineService';

type SuporteTicketTimelinePanelProps = {
  chamadoId: number;
  /** Incrementado no pai após eventos automáticos para recarregar a lista. */
  refreshNonce?: number;
  onClose: () => void;
  onError?: (message: string) => void;
};

export function SuporteTicketTimelinePanel({
  chamadoId,
  refreshNonce = 0,
  onClose,
  onError,
}: SuporteTicketTimelinePanelProps) {
  const [entries, setEntries] = useState<SuporteTimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const data = await suporteTimelineService.listByChamado(chamadoId);
      setEntries(Array.isArray(data) ? data : []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, [chamadoId, refreshNonce]);

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text || submittingComment) return;
    setSubmittingComment(true);
    try {
      await suporteTimelineService.create({ chamado_id: chamadoId, descricao: text });
      setCommentText('');
      await loadEntries();
      textareaRef.current?.focus();
    } catch {
      onError?.('Não foi possível gravar a observação.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const getEventColor = (tipo: string) => {
    switch (tipo) {
      case 'criado':
        return 'bg-green-500';
      case 'etapa_alterada':
        return 'bg-blue-500';
      case 'responsavel_alterado':
        return 'bg-indigo-500';
      case 'notificacao':
        return 'bg-amber-500';
      case 'pendencia':
        return 'bg-orange-500';
      case 'comentario':
        return 'bg-cyan-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getTagColor = (tipo: string) => {
    switch (tipo) {
      case 'criado':
        return 'text-green-600 bg-green-500/10';
      case 'etapa_alterada':
        return 'text-blue-600 bg-blue-500/10';
      case 'responsavel_alterado':
        return 'text-indigo-600 bg-indigo-500/10';
      case 'notificacao':
        return 'text-amber-700 bg-amber-500/15';
      case 'pendencia':
        return 'text-orange-600 bg-orange-500/10';
      case 'comentario':
        return 'text-cyan-600 bg-cyan-500/10';
      default:
        return 'text-gray-600 bg-gray-500/10';
    }
  };

  return (
    <div
      className="fixed right-[8px] top-[8px] z-[60] flex h-[calc(100vh-16px)] w-[480px] transform flex-col rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl transition-transform duration-300 ease-in-out pointer-events-auto translate-x-0"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] p-[16px]">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Timeline do ticket</h2>
        <Button variant="ghost" size="icon" className="h-[32px] w-[32px]" type="button" onClick={onClose}>
          <X className="h-[20px] w-[20px]" />
          <span className="sr-only">Fechar timeline</span>
        </Button>
      </div>

      <div className="flex-shrink-0 border-b border-[var(--color-border)] p-[16px]">
        <div className="mb-[8px] flex items-center gap-[6px]">
          <MessageSquare className="h-[14px] w-[14px] text-[var(--color-muted-foreground)]" />
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Observação / Comentário
          </span>
        </div>
        <Textarea
          ref={textareaRef}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleAddComment();
            }
          }}
          placeholder="Adicione uma observação…"
          className="min-h-[72px] resize-none text-sm"
          disabled={submittingComment}
        />
        <div className="mt-[8px] flex items-center justify-between">
          <span className="text-xs text-[var(--color-muted-foreground)]">Ctrl+Enter para enviar</span>
          <Button
            size="sm"
            type="button"
            className="gap-[6px]"
            disabled={!commentText.trim() || submittingComment}
            onClick={() => void handleAddComment()}
          >
            {submittingComment ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              <SendHorizontal className="h-[14px] w-[14px]" />
            )}
            Adicionar comentário
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-[16px]">
        {loading ? (
          <div className="flex h-[200px] items-center justify-center">
            <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center text-center">
            <Clock className="mb-[16px] h-[48px] w-[48px] text-[var(--color-muted-foreground)]" />
            <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum evento na timeline ainda</p>
          </div>
        ) : (
          <div className="relative pl-[48px]">
            <div className="absolute bottom-0 left-[15px] top-0 w-[2px] bg-[var(--color-border)]" />
            <div className="space-y-[40px]">
              {entries.map((log) => (
                <div key={log.id} className="relative">
                  <div className="absolute left-[-48px] top-[2px] z-10 flex-shrink-0">
                    <div
                      className={`h-[32px] w-[32px] rounded-full border-4 border-[var(--color-background)] shadow-sm ${getEventColor(log.tipo_evento)}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-[8px] flex items-start justify-between gap-[8px]">
                      <span
                        className={`rounded-full px-[8px] py-[4px] text-xs font-semibold ${getTagColor(log.tipo_evento)}`}
                      >
                        {log.tipo_evento_display ?? 'Comentário'}
                      </span>
                    </div>
                    {log.tipo_evento === 'pendencia' ? (
                      <div className="mb-[8px]">
                        <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[12px]">
                          <h4 className="mb-[8px] text-xs font-semibold text-[var(--color-foreground)]">Motivo</h4>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-foreground)]">
                            {log.descricao}
                          </p>
                        </div>
                      </div>
                    ) : log.tipo_evento === 'comentario' ? (
                      <div className="mb-[8px]">
                        <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[12px]">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-foreground)]">
                            {log.descricao}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mb-[8px] text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-foreground)]">
                        {log.descricao}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-[8px] text-xs text-[var(--color-muted-foreground)]">
                      {log.usuario_name ? (
                        <div className="flex items-center gap-[4px]">
                          <User className="h-[12px] w-[12px]" />
                          {log.usuario_role_display ? (
                            <span className="font-medium">{log.usuario_role_display}</span>
                          ) : null}
                          <span>{log.usuario_name}</span>
                        </div>
                      ) : null}
                      {log.data ? (
                        <div className="flex items-center gap-[4px]">
                          <Clock className="h-[12px] w-[12px]" />
                          <span>{formatDateTime(log.data)}</span>
                        </div>
                      ) : null}
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
