import { useEffect, useState, type ReactNode } from 'react';
import { type CatalogItem } from '@/services/userService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { chipStyle } from '@/lib/catalog-style';

export type Kind = 'cargo' | 'setor';

/** Máximo de linhas por página — mesmo limite da listagem de usuários. */
const PAGE_SIZE = 50;

export function CatalogTable({
  kind,
  items,
  onEdit,
  onDelete,
  extraActions,
}: {
  kind: Kind;
  items: CatalogItem[];
  onEdit: (item: CatalogItem) => void;
  onDelete: (item: CatalogItem) => void;
  /** Ações que só um dos catálogos tem (ex.: mover conteúdo, em setores).
   * Renderizadas antes de editar/excluir. */
  extraActions?: (item: CatalogItem) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageAtual = Math.min(page, totalPages);
  const visiveis = items.slice((pageAtual - 1) * PAGE_SIZE, pageAtual * PAGE_SIZE);

  // Criar/excluir muda o total: se a página atual deixou de existir, recua.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--color-muted)]/50">
              <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Tag</th>
              <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Código</th>
              <th className="border-b border-[var(--color-border)] p-3 text-right font-medium">Usuários</th>
              {kind === 'cargo' && (
                <th className="border-b border-[var(--color-border)] p-3 text-right font-medium">Template</th>
              )}
              <th className="border-b border-[var(--color-border)] p-3 text-center font-medium">Sistema</th>
              <th className="border-b border-[var(--color-border)] p-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={kind === 'cargo' ? 6 : 5} className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">
                  Nenhum {kind === 'cargo' ? 'cargo' : 'setor'} cadastrado.
                </td>
              </tr>
            ) : (
              visiveis.map((it) => {
                const podeExcluir = !it.is_system && (it.user_count ?? 0) === 0;
                return (
                  <tr key={it.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="p-3">
                      <Badge className="border" style={chipStyle(it.cor || '#94a3b8')}>
                        {it.label_curto || it.nome}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-[var(--color-muted-foreground)]">{it.codename}</td>
                    <td className="p-3 text-right">{it.user_count ?? 0}</td>
                    {kind === 'cargo' && (
                      <td className="p-3 text-right text-[var(--color-muted-foreground)]">
                        {(it.permissoes_padrao ?? []).length}
                      </td>
                    )}
                    <td className="p-3 text-center">
                      {it.is_system ? <Badge variant="secondary">Sistema</Badge> : <span className="text-[var(--color-muted-foreground)]">—</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        {extraActions?.(it)}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(it)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--color-destructive)] disabled:opacity-40"
                          disabled={!podeExcluir}
                          onClick={() => onDelete(it)}
                          title={
                            it.is_system
                              ? 'Cargo/setor de sistema não pode ser excluído'
                              : (it.user_count ?? 0) > 0
                                ? 'Reatribua os usuários antes de excluir'
                                : 'Excluir'
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-muted-foreground)]">
          <span>
            {(pageAtual - 1) * PAGE_SIZE + 1}–{Math.min(pageAtual * PAGE_SIZE, items.length)} de {items.length}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageAtual <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <span className="tabular-nums">
                Página {pageAtual} de {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageAtual >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="gap-1"
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
