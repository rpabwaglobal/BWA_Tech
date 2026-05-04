import { useEffect, useState, useMemo, useRef } from 'react';
import { X, Loader2, Clock, User, Filter, ArrowUp, ArrowDown, SendHorizontal, MessageSquare } from 'lucide-react';
import { cardLogService, type CardLog } from '@/services/cardLogService';
import { formatDateTime } from '@/lib/dateUtils';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface CardLogsModalProps {
  cardId: string | null;
  isOpen: boolean;
  onClose: () => void;
  refreshTrigger?: number;
}

type FilterType = 'tudo' | 'alteracoes' | 'movimentacoes' | 'comentarios' | 'pendencias';
type SortOrder = 'desc' | 'asc';

export function CardLogsModal({ cardId, isOpen, onClose, refreshTrigger }: CardLogsModalProps) {
  const [logs, setLogs] = useState<CardLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('tudo');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (isOpen && cardId) {
      loadLogs();
    } else {
      setLogs([]);
    }
  }, [isOpen, cardId, refreshTrigger]);

  const handleAddComment = async () => {
    if (!commentText.trim() || !cardId || submittingComment) return;
    setSubmittingComment(true);
    try {
      await cardLogService.create({
        card: cardId,
        tipo_evento: 'comentario',
        descricao: commentText.trim(),
        usuario: user?.id ?? null,
      });
      setCommentText('');
      await loadLogs();
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Erro ao adicionar comentário:', error);
    } finally {
      setSubmittingComment(false);
    }
  };

  const loadLogs = async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const data = await cardLogService.getByCard(cardId);
      // Garantir que sempre seja um array
      setLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Erro ao carregar logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  // Filtrar e ordenar logs
  const filteredAndSortedLogs = useMemo(() => {
    let filtered = [...logs];

    // Aplicar filtro
    if (filter !== 'tudo') {
      filtered = filtered.filter((log) => {
        switch (filter) {
          case 'alteracoes':
            return log.tipo_evento === 'atualizado' || log.tipo_evento === 'responsavel_alterado';
          case 'movimentacoes':
            return log.tipo_evento === 'movimentado';
          case 'comentarios':
            return log.tipo_evento === 'comentario';
          case 'pendencias':
            return log.tipo_evento === 'pendencia';
          default:
            return true;
        }
      });
    }

    // Ordenar por data
    filtered.sort((a, b) => {
      const dateA = new Date(a.data).getTime();
      const dateB = new Date(b.data).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [logs, filter, sortOrder]);

  const getEventColor = (tipoEvento: string) => {
    switch (tipoEvento) {
      case 'criado':
        return 'bg-green-500';
      case 'movimentado':
        return 'bg-blue-500';
      case 'pendencia':
        return 'bg-orange-500';
      case 'atualizado':
      case 'alteracao':
        return 'bg-purple-500';
      case 'responsavel_alterado':
        return 'bg-indigo-500';
      case 'comentario':
        return 'bg-cyan-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getTagColor = (tipoEvento: string) => {
    switch (tipoEvento) {
      case 'criado':
        return 'text-green-600 bg-green-500/10';
      case 'movimentado':
        return 'text-blue-600 bg-blue-500/10';
      case 'pendencia':
        return 'text-orange-600 bg-orange-500/10';
      case 'atualizado':
      case 'alteracao':
        return 'text-purple-600 bg-purple-500/10';
      case 'responsavel_alterado':
        return 'text-indigo-600 bg-indigo-500/10';
      case 'comentario':
        return 'text-cyan-600 bg-cyan-500/10';
      default:
        return 'text-gray-600 bg-gray-500/10';
    }
  };

  const filterLabels: Record<FilterType, string> = {
    tudo: 'Tudo',
    alteracoes: 'Alterações',
    movimentacoes: 'Movimentações',
    comentarios: 'Comentários',
    pendencias: 'Pendências',
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed right-[8px] top-[8px] h-[calc(100vh-16px)] w-[480px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px] shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out pointer-events-auto ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-[16px] border-b border-[var(--color-border)] flex-shrink-0">
          <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
            Timeline do Card
          </h2>
          <div className="flex items-center gap-[8px]">
            {/* Botão de Ordenação */}
            <Button
              variant="outline"
              size="sm"
              className="h-[32px] gap-[4px]"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            >
              {sortOrder === 'desc' ? (
                <>
                  <ArrowDown className="h-[14px] w-[14px]" />
                  Recente
                </>
              ) : (
                <>
                  <ArrowUp className="h-[14px] w-[14px]" />
                  Antigo
                </>
              )}
            </Button>

            {/* Botão de Filtros */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-[32px] gap-[4px]"
                >
                  <Filter className="h-[14px] w-[14px]" />
                  {filterLabels[filter]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setFilter('tudo')}>
                  Tudo
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setFilter('alteracoes')}>
                  Alterações
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter('movimentacoes')}>
                  Movimentações
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter('comentarios')}>
                  Comentários
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter('pendencias')}>
                  Pendências
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-[32px] w-[32px]"
            >
              <X className="h-[20px] w-[20px]" />
            </Button>
          </div>
        </div>

        {/* Campo de comentário */}
        <div className="border-b border-[var(--color-border)] p-[16px] flex-shrink-0">
          <div className="flex items-center gap-[6px] mb-[8px]">
            <MessageSquare className="h-[14px] w-[14px] text-[var(--color-muted-foreground)]" />
            <span className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide">
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
            placeholder="Adicione um comentário..."
            className="min-h-[72px] resize-none text-sm"
            disabled={submittingComment}
          />
          <div className="flex items-center justify-between mt-[8px]">
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Ctrl+Enter para enviar
            </span>
            <Button
              size="sm"
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

        {/* Content - Timeline */}
        <div className="flex-1 overflow-y-auto p-[16px]">
          {loading ? (
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
            </div>
          ) : filteredAndSortedLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <Clock className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Nenhum log encontrado
              </p>
            </div>
          ) : (
            <div className="relative pl-[48px]">
              {/* Linha vertical da timeline */}
              <div className="absolute left-[15px] top-0 bottom-0 w-[2px] bg-[var(--color-border)]" />
              
              {/* Eventos da timeline */}
              <div className="space-y-[40px]">
                {filteredAndSortedLogs.map((log, index) => (
                  <div key={log.id} className="relative">
                    {/* Ponto da timeline */}
                    <div className="absolute left-[-48px] top-[2px] z-10 flex-shrink-0">
                      <div
                        className={`w-[32px] h-[32px] rounded-full ${getEventColor(log.tipo_evento)} border-4 border-[var(--color-background)] shadow-sm`}
                      />
                    </div>

                    {/* Conteúdo do evento - sem card branco */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-[8px] mb-[8px]">
                        <div className="flex items-center gap-[8px]">
                          <span className={`text-xs font-semibold px-[8px] py-[4px] rounded-full ${getTagColor(log.tipo_evento)}`}>
                            {log.tipo_evento === 'criado' ? 'Card Criado' :
                             log.tipo_evento === 'movimentado' ? 'Card Movimentado' :
                             log.tipo_evento === 'comentario' ? 'Comentário' :
                             log.tipo_evento === 'alteracao' || log.tipo_evento === 'atualizado' ? 'Alteração no Card' :
                             (log.tipo_evento_display || log.tipo_evento)}
                          </span>
                        </div>
                      </div>
                      
                      {log.tipo_evento === 'pendencia' && log.descricao.includes('Motivo:') ? (
                        <div className="mb-[8px]">
                          <p className="text-sm text-[var(--color-foreground)] mb-[8px] whitespace-pre-wrap leading-relaxed">
                            {log.descricao.split('\n\nMotivo:')[0]}
                          </p>
                          <div className="border border-[var(--color-border)] rounded-[8px] p-[12px] bg-[var(--color-card)]">
                            <h4 className="text-xs font-semibold text-[var(--color-foreground)] mb-[8px]">Motivo</h4>
                            <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap leading-relaxed">
                              {log.descricao.split('Motivo:')[1]?.trim() || ''}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-[var(--color-foreground)] mb-[8px] whitespace-pre-wrap leading-relaxed">
                          {log.descricao}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-[8px] flex-wrap text-xs text-[var(--color-muted-foreground)]">
                        {log.usuario_name && (
                          <div className="flex items-center gap-[4px]">
                            <User className="h-[12px] w-[12px]" />
                            {log.usuario_role_display && (
                              <span className="font-medium">{log.usuario_role_display}</span>
                            )}
                            <span>{log.usuario_name}</span>
                          </div>
                        )}
                        {log.data && (
                          <div className="flex items-center gap-[4px]">
                            <Clock className="h-[12px] w-[12px]" />
                            <span>{formatDateTime(log.data)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
