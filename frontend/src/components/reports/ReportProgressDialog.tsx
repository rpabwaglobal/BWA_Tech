import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';
import { reportService, type ReportJob } from '@/services/reportService';

export type ReportProgressDialogProps = {
  open: boolean;
  jobId: number | null;
  /** Chamado quando job é concluído ou falha — caller decide o que mostrar. */
  onCompleted: (job: ReportJob) => void;
  /** Chamado se usuário fechar o modal antes de completar. Caller pode cancelar. */
  onCancel: () => void;
};

/** Modal de polling de progresso. Mostra barra 0-100 + mensagem dinâmica.
 * Atualiza a cada 1.5s. Botão "Cancelar" envia DELETE no job. */
export default function ReportProgressDialog({
  open,
  jobId,
  onCompleted,
  onCancel,
}: ReportProgressDialogProps) {
  const [job, setJob] = useState<ReportJob | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!open || jobId == null) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const fresh = await reportService.getById(jobId);
        if (cancelled) return;
        setJob(fresh);
        if (fresh.status === 'completed' || fresh.status === 'failed') {
          onCompleted(fresh);
          return; // pára o polling — caller fecha esse dialog
        }
      } catch {
        // Erro de rede transitório: segue tentando.
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, 1500);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [open, jobId, onCompleted]);

  const handleCancel = async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await reportService.cancel(jobId);
    } finally {
      setCancelling(false);
      onCancel();
    }
  };

  const progress = job?.progress ?? 0;
  const message = job?.progress_message || 'Iniciando...';
  const isFailed = job?.status === 'failed';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }} containerClassName="max-w-md">
      <DialogContent onClose={onCancel}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFailed ? (
              <>
                <AlertTriangle className="h-5 w-5 text-[var(--color-destructive)]" />
                Falha ao gerar
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
                Gerando relatório
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isFailed
              ? job?.error?.split('\n')[0] || 'Tente novamente em instantes.'
              : message}
          </DialogDescription>
        </DialogHeader>

        {!isFailed && (
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-[var(--color-muted)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)]">
              <span>{message}</span>
              <span className="font-medium">{progress}%</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={cancelling}>
            {isFailed ? 'Fechar' : (cancelling ? 'Cancelando...' : 'Cancelar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
