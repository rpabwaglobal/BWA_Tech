import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Conteúdo extra (ex.: lista do que será alterado). */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modal de confirmação personalizado, reutilizado em todas as ações
 * sensíveis (bulk, exclusões, edições de sistema, absorver-tudo, etc.). */
export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onCancel()} containerClassName="max-w-md">
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant === 'destructive' && <AlertTriangle className="h-5 w-5 text-[var(--color-destructive)]" />}
            {title}
          </DialogTitle>
        </DialogHeader>

        {description && (
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
        {details && <div className="mt-3">{details}</div>}

        <DialogFooter className="mt-6 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
