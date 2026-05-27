import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import api from '@/services/api';
import type { ReportJob } from '@/services/reportService';

export type ReportPreviewDialogProps = {
  open: boolean;
  job: ReportJob | null;
  onClose: () => void;
};

/**
 * Modal de preview do PDF gerado.
 *
 * Por que NÃO setamos `src` direto na URL `/preview/`: o `<iframe>` faz a
 * request sem os headers do JS (Authorization). O backend então responde 401
 * + página de erro com `X-Frame-Options: deny`, o que cria um quadrado vazio.
 *
 * Solução: buscamos o PDF via axios (com Authorization), embrulhamos em Blob,
 * e setamos no iframe via `blob:` URL — que o browser carrega sem fazer
 * request HTTP adicional.
 */
export default function ReportPreviewDialog({ open, job, onClose }: ReportPreviewDialogProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guarda a URL atual pra revogar quando trocar/fechar (evita leak de memória)
  const blobUrlRef = useRef<string | null>(null);

  // Carrega o PDF como blob quando o modal abre.
  useEffect(() => {
    if (!open || !job) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await api.get(`/reports/${job.id}/preview/`, {
          responseType: 'blob',
        });
        if (cancelled) return;
        // Força application/pdf — NÃO honra o Content-Type do servidor.
        // Defesa: se backend regredir e mandar text/html, um `blob:` HTML
        // executa JS na mesma origem do app (escapando do iframe sandbox).
        const blob = new Blob([response.data as BlobPart], {
          type: 'application/pdf',
        });
        const url = URL.createObjectURL(blob);
        // Revoga blob anterior antes de sobrescrever (evita leak ao reabrir
        // o mesmo job — o useEffect de cleanup só roda em troca de job.id).
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = url;
        setBlobUrl(url);
        // Extrai filename do header Content-Disposition (formato definido pelo
        // backend: "BWATech - <Título> - DD-MM-YYYY HH-MM.<fmt>").
        const cd = response.headers['content-disposition'] as string | undefined;
        const parsed = parseContentDispositionFilename(cd);
        setFilename(parsed ? sanitizeFilename(parsed) : null);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Falha ao carregar preview.';
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, job]);

  // Cleanup do blob URL ao desmontar/trocar de job
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [job?.id]);

  if (!job) return null;

  const handleDownload = async () => {
    // Reusa o mesmo blob — não baixa de novo do servidor. Usa <a download>
    // pra forçar o nome do arquivo e o "Save as" do browser.
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    // Prefere o filename vindo do Content-Disposition (padrão "BWATech - ..."
    // gerado pelo backend). Fallback: nome simples baseado no id.
    a.download = filename || `BWATech - relatorio-${job.id}.${job.format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

        <div className="flex-1 min-h-[60vh] border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-muted)] relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-muted-foreground)]">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
              <span className="text-sm">Carregando preview...</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-[var(--color-destructive)] text-center">
              {error}
            </div>
          )}
          {blobUrl && !loading && !error && (
            <iframe
              src={blobUrl}
              title="Preview do relatório"
              className="w-full h-full"
              style={{ minHeight: '60vh' }}
            />
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button type="button" onClick={handleDownload} disabled={!blobUrl || loading}>
            <Download className="h-4 w-4 mr-2" />
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Extrai filename de Content-Disposition. Suporta:
 *   filename="BWATech - Relatorio.pdf"
 *   filename*=UTF-8''BWATech%20-%20Relat%C3%B3rio.pdf  (RFC 5987, prioridade)
 *
 * Retorna null se header ausente ou não conseguir parsear.
 */
/** Remove caracteres de path/controle de um filename vindo da rede.
 * Defesa contra path traversal injetado em Content-Disposition
 * (browsers em geral sanitizam, mas é trivial reforçar). */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/]/g, '_')
    .replace(/^\.+/, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, 200)
    .trim() || 'relatorio';
}

function parseContentDispositionFilename(header: string | undefined): string | null {
  if (!header) return null;
  // RFC 5987 first (suporta UTF-8). Ex.: `filename*=UTF-8''BWATech%20...pdf`
  const star = header.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      /* fallthrough */
    }
  }
  // Legacy `filename="..."` (com ou sem aspas)
  const legacy = header.match(/filename\s*=\s*("([^"]+)"|([^;]+))/i);
  if (legacy) {
    const raw = (legacy[2] || legacy[3] || '').trim();
    return raw || null;
  }
  return null;
}
