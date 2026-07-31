import { Calendar, User, ExternalLink, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  getPriorityStyle,
  getPriorityLabel,
  kanbanCardInkTextClass,
  getKanbanAreaBadgeClasses,
  kanbanMutedChipOnPastelClass,
  kanbanScriptLinkOnPastelClass,
} from '@/lib/priorityColors';
import { formatDateTime, isCardAtrasado } from '@/lib/dateUtils';
import { ATRASADO_STATUS_BADGE } from '@/lib/dueDateBadgeClasses';
import { getRoleLabel, getRoleColor } from '@/components/ui/user-select';
import { cn, normalizeExternalUrl } from '@/lib/utils';

export interface KanbanCardPreviewData {
  id: string;
  nome: string;
  prioridade?: string;
  status?: string;
  area?: string;
  area_display?: string;
  tipo?: string;
  tipo_display?: string;
  descricao?: string;
  data_fim?: string | null;
  responsavel_name?: string;
  responsavel_role?: string;
  script_url?: string | null;
  score_final?: string | number | null;
}

interface KanbanCardPreviewProps {
  card: KanbanCardPreviewData;
  className?: string;
  /** Conteúdo opcional renderizado no canto superior direito (ex: botão de
   * desafixar). Tem `pointer-events-auto` por padrão para não ser bloqueado
   * por elementos ancestrais com hover. */
  topRightSlot?: React.ReactNode;
  onClick?: () => void;
}

/** Preview de card 1:1 com o card do Kanban — usado no ConclusaoModal,
 * página "Cards Fixados" e qualquer outro lugar que precise mostrar um
 * card fora do quadro. Cores, badges e layout idênticos. */
export function KanbanCardPreview({ card, className, topRightSlot, onClick }: KanbanCardPreviewProps) {
  const ink = kanbanCardInkTextClass(true);
  const atrasado = isCardAtrasado({ status: card.status ?? '', data_fim: card.data_fim });
  const showPendenciasBadge = card.status === 'parado_pendencias' && !atrasado;
  const responsavelRoleLabel = card.responsavel_role ? getRoleLabel(card.responsavel_role) : '';
  const responsavelRoleColor = card.responsavel_role ? getRoleColor(card.responsavel_role) : '';

  return (
    <div
      className={cn(
        'relative p-[12px] rounded-[8px] border-l-[3px] shadow-sm bg-[var(--color-kanban-card)]',
        onClick && 'cursor-pointer hover:shadow-md transition-shadow',
        className,
      )}
      style={card.prioridade ? getPriorityStyle(card.prioridade, card.id) : undefined}
      onClick={onClick}
    >
      {topRightSlot && (
        <div className="absolute right-[6px] top-[6px] pointer-events-auto">
          {topRightSlot}
        </div>
      )}

      <div className="flex items-start justify-between gap-[8px]">
        <div className={cn('flex items-center gap-[8px] flex-1 min-w-0', topRightSlot && 'pr-7')}>
          <span className={cn('font-medium text-sm truncate flex-1', ink)}>{card.nome}</span>
        </div>
      </div>

      {card.data_fim && (
        <div className="flex items-center justify-between gap-[8px] mt-[6px]">
          <div className={cn('flex items-center gap-[4px] text-xs', ink)}>
            <Calendar className="h-[12px] w-[12px]" />
            {formatDateTime(card.data_fim)}
          </div>
          <div className="flex items-center gap-[8px]">
            {atrasado ? (
              <Badge variant="outline" className={ATRASADO_STATUS_BADGE}>
                Atrasado
              </Badge>
            ) : showPendenciasBadge ? (
              <Badge variant="secondary" className="text-[10px] px-[6px] py-0 shrink-0">
                Pendências
              </Badge>
            ) : null}
          </div>
        </div>
      )}

      {(card.area_display || card.tipo_display || card.script_url) && (
        <div className="flex flex-wrap gap-[4px] mt-[8px]">
          {card.area_display && (
            <span
              className={`text-[10px] px-[6px] py-[2px] rounded-full ${getKanbanAreaBadgeClasses(card.area ?? '', true)}`}
            >
              {card.area_display}
            </span>
          )}
          {card.tipo_display && (
            <span className={cn('text-[10px] px-[6px] py-[2px] rounded-full', kanbanMutedChipOnPastelClass)}>
              {card.tipo_display}
            </span>
          )}
          {card.script_url && (
            <a
              href={normalizeExternalUrl(card.script_url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full transition-colors',
                kanbanScriptLinkOnPastelClass,
              )}
            >
              <ExternalLink className="h-[10px] w-[10px]" />
              Script
            </a>
          )}
        </div>
      )}

      {card.descricao && (
        <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>{card.descricao}</p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px] flex-wrap">
          {card.responsavel_name ? (
            <div className={cn('flex items-center gap-[6px] text-xs', ink)}>
              {responsavelRoleLabel && (
                <Badge
                  variant="secondary"
                  className={`whitespace-nowrap text-[10px] px-[6px] py-[2px] rounded-full ${responsavelRoleColor}`}
                >
                  {responsavelRoleLabel}
                </Badge>
              )}
              <span className="truncate">{card.responsavel_name}</span>
            </div>
          ) : (
            <div className={cn('flex items-center gap-[6px] text-xs', ink)}>
              <User className="h-[12px] w-[12px]" />
              <span className="truncate">Sem usuário atribuído</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-[6px] shrink-0">
          {card.score_final != null && (
            <span
              title={`Score: ${Number(card.score_final).toFixed(1)}`}
              className="inline-flex items-center gap-[3px] rounded-full bg-[var(--color-primary)] px-[6px] py-[2px] text-[10px] font-semibold text-[var(--color-primary-foreground)]"
            >
              <Trophy className="h-[10px] w-[10px]" />
              {Number(card.score_final).toFixed(1)}
            </span>
          )}
          {card.prioridade && (
            <span
              className={cn(
                'text-[10px] px-[6px] py-[2px] rounded-full font-medium',
                kanbanMutedChipOnPastelClass,
              )}
            >
              {getPriorityLabel(card.prioridade)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
