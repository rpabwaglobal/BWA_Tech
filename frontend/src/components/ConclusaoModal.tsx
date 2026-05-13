import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KanbanCardPreview, type KanbanCardPreviewData } from '@/components/KanbanCardPreview';

/** Subset do Card suficiente para preview no modal — espelha todos os campos
 * exibidos no card do Kanban. Alias do tipo reutilizável. */
export type ConclusaoModalCard = KanbanCardPreviewData;

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
          <KanbanCardPreview card={card} className="mt-3" />
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
