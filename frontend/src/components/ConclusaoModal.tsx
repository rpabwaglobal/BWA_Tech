import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConclusaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  cardName?: string;
  /** Padrão: confirmação de conclusão (quadro de projetos). Use `inviabilizado` para cancelar/inviabilizar. */
  variant?: 'conclusao' | 'inviabilizado';
  /** Texto antes do nome exibido (ex.: «Ticket» na página Suporte). Padrão: Card */
  nameLabel?: string;
}

function descriptionConclusao(cardName: string | undefined, nameLabel: string): string {
  const prefix = cardName ? `${nameLabel}: ${cardName}\n\n` : '';
  return `${prefix}Ao concluir o card, não será mais possível arrastá-lo para outra etapa.\n\nTem certeza que deseja concluir este card?`;
}

function descriptionInviabilizado(cardName: string | undefined, nameLabel: string): string {
  const prefix = cardName ? `${nameLabel}: ${cardName}\n\n` : '';
  return `${prefix}Ao inviabilizar, o chamado será marcado como cancelado na API e deixará de poder ser movido para outras etapas pelo quadro.\n\nTem certeza que deseja inviabilizar?`;
}

export function ConclusaoModal({
  isOpen,
  onClose,
  onConfirm,
  cardName,
  variant = 'conclusao',
  nameLabel = 'Card',
}: ConclusaoModalProps) {
  const title =
    variant === 'inviabilizado' ? 'Confirmar inviabilização' : 'Confirmar Conclusão do Card';

  const description =
    variant === 'inviabilizado'
      ? descriptionInviabilizado(cardName, nameLabel)
      : descriptionConclusao(cardName, nameLabel);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-[8px]">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
          >
            Não
          </Button>
          <Button type="button" onClick={onConfirm} className="bg-green-600 text-white hover:bg-green-700">
            Sim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
