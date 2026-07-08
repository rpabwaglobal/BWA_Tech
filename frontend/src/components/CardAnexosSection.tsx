import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Paperclip, Download, XCircle, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  cardAnexoService,
  validateCardAnexo,
  CARD_ANEXO_ACCEPT,
  type CardAnexo,
} from '@/services/cardAnexoService';

function formatBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Seção de arquivos anexados a um card (imagem, PDF, CSV, Excel, documento…).
 * Autônoma: carrega, envia e remove por conta própria. Upload é imediato, então
 * só funciona para card já existente — em card novo mostra um aviso para salvar.
 */
export function CardAnexosSection({
  cardId,
  disabled = false,
}: {
  cardId: number | string | null | undefined;
  disabled?: boolean;
}) {
  const [anexos, setAnexos] = useState<CardAnexo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const semCard = cardId == null || cardId === '';

  useEffect(() => {
    if (semCard) {
      setAnexos([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void cardAnexoService
      .listByCard(cardId!)
      .then((list) => { if (!cancelled) setAnexos(list); })
      .catch(() => { if (!cancelled) setAnexos([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cardId, semCard]);

  const onSelectFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || semCard) return;
      const err = validateCardAnexo(file);
      if (err) { setErro(err); return; }
      setErro(null);
      setUploading(true);
      try {
        const novo = await cardAnexoService.upload(cardId!, file);
        setAnexos((prev) => [novo, ...prev]);
      } catch (ex: unknown) {
        const data = (ex as { response?: { data?: { arquivo?: string[]; detail?: string } } })
          ?.response?.data;
        const detail = data?.arquivo?.[0] ?? data?.detail;
        setErro(typeof detail === 'string' ? detail : 'Não foi possível enviar o arquivo.');
      } finally {
        setUploading(false);
      }
    },
    [cardId, semCard],
  );

  const onRemove = useCallback(
    async (id: number) => {
      const anterior = anexos;
      setAnexos((prev) => prev.filter((a) => a.id !== id)); // otimista
      try {
        await cardAnexoService.remove(id);
      } catch {
        setAnexos(anterior); // reverte
        setErro('Não foi possível remover o arquivo.');
      }
    },
    [anexos],
  );

  return (
    <div className="space-y-[6px]">
      <div className="flex items-center justify-between gap-[8px]">
        <Label>Arquivos</Label>
        {!disabled && !semCard && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-[4px]"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-[13px] w-[13px] animate-spin" />
            ) : (
              <Plus className="h-[13px] w-[13px]" />
            )}
            Adicionar arquivo
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={CARD_ANEXO_ACCEPT}
        className="hidden"
        onChange={onSelectFile}
      />

      {semCard ? (
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          Salve o card para poder anexar arquivos.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-[6px] text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-[14px] w-[14px] animate-spin" /> Carregando…
        </div>
      ) : anexos.length > 0 ? (
        <div className="space-y-[4px]">
          {anexos.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px]"
            >
              <Paperclip className="h-[13px] w-[13px] shrink-0 text-[var(--color-primary)]" />
              <a
                href={a.arquivo_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                title={a.nome}
                className="flex-1 truncate text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75"
              >
                {a.nome}
              </a>
              {a.tamanho > 0 && (
                <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
                  {formatBytes(a.tamanho)}
                </span>
              )}
              <a
                href={a.arquivo_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                title="Baixar"
              >
                <Download className="h-[13px] w-[13px]" />
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                  title="Remover"
                >
                  <XCircle className="h-[14px] w-[14px]" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          Nenhum arquivo anexado.
        </p>
      )}

      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
    </div>
  );
}
