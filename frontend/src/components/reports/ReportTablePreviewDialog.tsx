import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import type { ReportTablePreview, ReportTablePreviewColumn } from '@/services/reportService';

export type ReportTablePreviewDialogProps = {
  open: boolean;
  /** Título exibido (ex.: "Cards (preview XLSX)"). */
  title: string;
  /** Formato real que será gerado ao clicar em Baixar — só pra mostrar no
   * botão. O download dispara `onGenerate`. */
  format: 'xlsx' | 'csv';
  /** Callback que carrega uma página. Dialog gerencia `offset` internamente. */
  fetchPage: (offset: number, limit: number) => Promise<ReportTablePreview>;
  /** Click em "Gerar e baixar" — pai dispara o fluxo de criação de job. */
  onGenerate: () => void;
  onClose: () => void;
};

const PAGE_SIZE = 100;
const MIN_COL_WIDTH = 80;
const DEFAULT_COL_WIDTH = 180;

/**
 * Modal de preview de XLSX/CSV.
 *
 * Paginação por scroll: carrega a 1ª página ao abrir e busca a próxima
 * quando o usuário rola perto do fim. Cada página re-roda `fetch_data` no
 * backend (sem cache) — aceitável porque o sample é em memória.
 *
 * Colunas redimensionáveis: cada `<th>` tem um handle no canto direito;
 * arrastar atualiza a largura no `<colgroup>`. Estado local — perde ao
 * fechar (intencional pra v1).
 */
export default function ReportTablePreviewDialog({
  open, title, format, fetchPage, onGenerate, onClose,
}: ReportTablePreviewDialogProps) {
  const [columns, setColumns] = useState<ReportTablePreviewColumn[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Larguras das colunas em px, keyed por column.key. */
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Token de "requisição corrente" pra ignorar respostas obsoletas se o user
  // reabrir o modal antes da request anterior terminar.
  const requestSeqRef = useRef(0);

  // Reset + carrega 1ª página ao abrir
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeqRef.current;
    setColumns([]);
    setRows([]);
    setTotal(0);
    setHasMore(false);
    setColWidths({});
    setError(null);
    setLoading(true);
    fetchPage(0, PAGE_SIZE)
      .then((data) => {
        if (seq !== requestSeqRef.current) return;
        setColumns(data.columns);
        setRows(data.rows);
        setTotal(data.total);
        setHasMore(data.has_more);
      })
      .catch((e: unknown) => {
        if (seq !== requestSeqRef.current) return;
        setError(extractErr(e));
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
  }, [open, fetchPage]);

  // Inicializa larguras default quando colunas chegam (preserva user-set)
  useLayoutEffect(() => {
    if (columns.length === 0) return;
    setColWidths((prev) => {
      const next = { ...prev };
      for (const c of columns) {
        if (next[c.key] == null) next[c.key] = DEFAULT_COL_WIDTH;
      }
      return next;
    });
  }, [columns]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(rows.length, PAGE_SIZE);
      if (seq !== requestSeqRef.current) return;
      setRows((prev) => [...prev, ...data.rows]);
      setHasMore(data.has_more);
      // total pode oscilar se filtros mudarem no meio — confia no último
      setTotal(data.total);
    } catch (e: unknown) {
      if (seq !== requestSeqRef.current) return;
      setError(extractErr(e));
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false);
    }
  }, [fetchPage, loading, loadingMore, hasMore, rows.length]);

  // Infinite scroll: dispara loadMore quando chegar a ~200px do fim
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 200) {
        void loadMore();
      }
    },
    [loadMore],
  );

  // ── Column resize ──────────────────────────────────────────────────────
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const onResizeStart = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      key,
      startX: e.clientX,
      startWidth: colWidths[key] ?? DEFAULT_COL_WIDTH,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeEnd);
  };

  const onResizeMove = (e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const delta = e.clientX - r.startX;
    const next = Math.max(MIN_COL_WIDTH, r.startWidth + delta);
    setColWidths((prev) => ({ ...prev, [r.key]: next }));
  };

  const onResizeEnd = () => {
    resizingRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
  };

  // Cleanup listeners ao desmontar
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('mouseup', onResizeEnd);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} containerClassName="max-w-6xl">
      <DialogContent onClose={onClose} className="max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Carregando preview…'
              : `Mostrando ${rows.length} de ${total} linha${total === 1 ? '' : 's'}${hasMore ? ' (role pra carregar mais)' : ''}.`}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="relative flex-1 min-h-[60vh] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)]"
        >
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-muted-foreground)]">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
              <span className="text-sm">Carregando preview…</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-[var(--color-destructive)]">
              {error}
            </div>
          )}
          {!loading && !error && columns.length > 0 && (
            <table
              className="border-collapse text-sm"
              style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}
            >
              <colgroup>
                {columns.map((c) => (
                  <col key={c.key} style={{ width: colWidths[c.key] ?? DEFAULT_COL_WIDTH }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[var(--color-input)]">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="relative border-b border-[var(--color-border)] px-[12px] py-[8px] text-left text-xs font-bold uppercase tracking-[0.5px] text-[var(--color-foreground)]"
                    >
                      <span className="block truncate pr-[6px]">{c.label}</span>
                      {/* Handle de resize: faixa de 6px no canto direito */}
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={onResizeStart(c.key)}
                        title="Arraste pra redimensionar"
                        className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize select-none hover:bg-[var(--color-primary)]/40"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-[12px] py-[20px] text-center text-sm text-[var(--color-muted-foreground)]"
                    >
                      Nenhum dado encontrado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent)]/40"
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className="overflow-hidden px-[12px] py-[8px] align-top text-sm text-[var(--color-foreground)]"
                          title={formatCell(row[c.key])}
                        >
                          <span className="block truncate">{formatCell(row[c.key])}</span>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
          {loadingMore && (
            <div className="sticky bottom-0 flex items-center justify-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)]/95 py-[8px] text-xs text-[var(--color-muted-foreground)]">
              <Loader2 className="h-[12px] w-[12px] animate-spin" />
              Carregando mais…
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            type="button"
            onClick={onGenerate}
            disabled={loading || !!error || columns.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Gerar e baixar {format.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Converte qualquer célula em string segura pra renderizar. */
function formatCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function extractErr(e: unknown): string {
  if (typeof e === 'object' && e && 'response' in e) {
    const resp = (e as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (e instanceof Error) return e.message;
  return 'Falha ao carregar preview.';
}
