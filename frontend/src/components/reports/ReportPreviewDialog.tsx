import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type { ReportJob } from '@/services/reportService';
import { reportService } from '@/services/reportService';

export type ReportPreviewDialogProps = {
  open: boolean;
  job: ReportJob | null;
  onClose: () => void;
};

/** Modal de preview do PDF gerado (iframe). Para DOCX/XLSX/CSV, baixa direto. */
export default function ReportPreviewDialog({ open, job, onClose }: ReportPreviewDialogProps) {
  if (!job) return null;
  const previewUrl = reportService.previewUrl(job.id);
  const downloadUrl = reportService.downloadUrl(job.id);

  const handleDownload = () => {
    // Força download abrindo a URL — Content-Disposition: attachment cuida do resto.
    window.open(downloadUrl, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} containerClassName="max-w-5xl">
      <DialogContent onClose={onClose} className="max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pré-visualização do relatório</DialogTitle>
          <DialogDescription>
            Confira o conteúdo abaixo e clique em "Baixar PDF" para salvar uma cópia local.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-[60vh] border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-muted)]">
          {/* iframe do PDF — browsers modernos renderizam nativamente */}
          <iframe
            src={previewUrl}
            title="Preview do relatório"
            className="w-full h-full"
            style={{ minHeight: '60vh' }}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button type="button" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
