import { Calendar, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  getPriorityStyle,
  getPriorityLabel,
  kanbanCardInkTextClass,
  getKanbanAreaBadgeClasses,
  kanbanMutedChipOnPastelClass,
} from '@/lib/priorityColors';
import { formatDate, isCardAtrasado } from '@/lib/dateUtils';
import { ATRASADO_STATUS_BADGE } from '@/lib/dueDateBadgeClasses';
import { getRoleLabel, getRoleColor } from '@/components/ui/user-select';
import { cn } from '@/lib/utils';

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

      <div className={cn('font-medium text-sm break-words pr-7', ink)}>{card.nome}</div>

      {card.data_fim && (
        <div className="flex items-center justify-between gap-[8px] mt-[6px]">
          <div className={cn('flex items-center gap-[4px] text-xs', ink)}>
            <Calendar className="h-[12px] w-[12px]" />
            {formatDate(card.data_fim)}
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

      {(card.area_display || card.tipo_display) && (
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
        </div>
      )}

      {card.descricao && (
        <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>{card.descricao}</p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px] min-w-0">
          {card.responsavel_name ? (
            <div className={cn('flex items-center gap-[6px] text-xs min-w-0', ink)}>
              {responsavelRoleLabel && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-[6px] py-[2px] rounded-full ${responsavelRoleColor}`}
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
        {card.prioridade && (
          <span
            className={cn(
              'text-[10px] px-[6px] py-[2px] rounded-full font-medium shrink-0',
              kanbanMutedChipOnPastelClass,
            )}
          >
            {getPriorityLabel(card.prioridade)}
          </span>
        )}
      </div>
    </div>
  );
}
