import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, User } from 'lucide-react';
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

/** Subset do Card suficiente para preview no modal — espelha todos os campos
 * exibidos no card do Kanban. */
export interface ConclusaoModalCard {
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
  /** Role do responsável (ex.: 'desenvolvedor', 'gerente') — usado para o badge "Dev.". */
  responsavel_role?: string;
}

export interface ConclusaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Card completo — habilita o preview com cor de prioridade (igual ao Kanban). */
  card?: ConclusaoModalCard | null;
  /** Fallback quando `card` não é passado (ex.: Suporte). */
  cardName?: string;
  /** Padrão: confirmação de conclusão (quadro de projetos). Use `inviabilizado` para cancelar/inviabilizar. */
  variant?: 'conclusao' | 'inviabilizado';
  /** Texto antes do nome quando `card` não é passado. Padrão: Card */
  nameLabel?: string;
}

export function ConclusaoModal({
  isOpen,
  onClose,
  onConfirm,
  card,
  cardName,
  variant = 'conclusao',
  nameLabel = 'Card',
}: ConclusaoModalProps) {
  const isInviabilizado = variant === 'inviabilizado';
  const title = isInviabilizado ? 'Confirmar inviabilização' : 'Confirmar conclusão do card';
  const question = isInviabilizado
    ? 'Ao inviabilizar, o chamado será marcado como cancelado e deixará de poder ser movido para outras etapas. Tem certeza?'
    : 'Ao concluir o card, não será mais possível arrastá-lo para outra etapa. Tem certeza?';

  const displayName = card?.nome ?? cardName;
  const showCardPreview = !!card;
  const ink = kanbanCardInkTextClass(true);

  // Card-like atrasado check (espelha a lógica do Kanban).
  const atrasado = card ? isCardAtrasado({ status: card.status ?? '', data_fim: card.data_fim }) : false;
  const showPendenciasBadge = card?.status === 'parado_pendencias' && !atrasado;

  const responsavelRoleLabel = card?.responsavel_role ? getRoleLabel(card.responsavel_role) : '';
  const responsavelRoleColor = card?.responsavel_role ? getRoleColor(card.responsavel_role) : '';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onClose={onClose} className="sm:max-w-[460px] gap-6">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">{question}</DialogDescription>
        </DialogHeader>

        {showCardPreview && card && (
          // Preview espelhando o card do Kanban — mesmos elementos, estilos e cores.
          // mt-3 (12px) afasta mais do texto da pergunta.
          <div
            className="mt-3 p-[12px] rounded-[8px] border-l-[3px] shadow-sm bg-[var(--color-kanban-card)]"
            style={card.prioridade ? getPriorityStyle(card.prioridade, card.id) : undefined}
          >
            {/* Linha 1: nome */}
            <div className={cn('font-medium text-sm break-words', ink)}>{card.nome}</div>

            {/* Linha 2: entrega + Atrasado / Pendências */}
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

            {/* Linha 3: badges de área/tipo */}
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

            {/* Linha 4: descrição */}
            {card.descricao && (
              <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>{card.descricao}</p>
            )}

            {/* Linha 5: responsável + prioridade */}
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
        )}

        {!showCardPreview && displayName && (
          // Fallback simples quando não temos o card completo (ex.: Suporte).
          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-4 py-3">
            <span className="text-sm font-medium text-[var(--color-muted-foreground)]">{nameLabel}: </span>
            <span className="text-sm font-semibold text-[var(--color-foreground)]">{displayName}</span>
          </div>
        )}

        {/* Botões ocupam toda a largura útil (mesmas bordas do card preview),
            divididos igualmente em 2 colunas. `space-x-0` neutraliza o
            `sm:space-x-2` default do DialogFooter (evita duplo espaçamento
            quando combinado com gap-2). */}
        <DialogFooter className="gap-2 sm:gap-2 sm:space-x-0 sm:flex-row sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            className="flex-1 text-base"
          >
            Deixar para depois
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={onConfirm}
            className="flex-1 text-base"
          >
            {isInviabilizado ? 'Inviabilizar' : 'Concluir Card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
