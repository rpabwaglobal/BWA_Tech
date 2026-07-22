import { useEffect, useMemo, useState } from 'react';
import { userService, type CatalogItem, type PermissionCatalogEntry } from '@/services/userService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Pencil, Trash2, Shield, Building2 } from 'lucide-react';
import { chipStyle } from '@/lib/catalog-style';
import { upsertCargo, upsertSetor } from '@/lib/catalog-style';
import { CargoSetorFormDialog } from './CargoSetorFormDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Kind = 'cargo' | 'setor';

function CatalogTable({
  kind,
  items,
  onEdit,
  onDelete,
}: {
  kind: Kind;
  items: CatalogItem[];
  onEdit: (item: CatalogItem) => void;
  onDelete: (item: CatalogItem) => void;
}) {
  return (
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
          {items.length === 0 ? (
            <tr>
              <td colSpan={kind === 'cargo' ? 6 : 5} className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">
                Nenhum {kind === 'cargo' ? 'cargo' : 'setor'} cadastrado.
              </td>
            </tr>
          ) : (
            items.map((it) => {
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
  );
}

export function GerenciamentoSetoresCargos() {
  const [cargos, setCargos] = useState<CatalogItem[]>([]);
  const [setores, setSetores] = useState<CatalogItem[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formKind, setFormKind] = useState<Kind>('cargo');
  const [formItem, setFormItem] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [delItem, setDelItem] = useState<{ kind: Kind; item: CatalogItem } | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [delError, setDelError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [c, s, cat] = await Promise.all([
        userService.getCargos(),
        userService.getSetores(),
        userService.getPermissionsCatalog(),
      ]);
      setCargos(c);
      setSetores(s);
      setCatalog(cat);
      c.forEach(upsertCargo);
      s.forEach(upsertSetor);
      setError('');
    } catch {
      setError('Não foi possível carregar os catálogos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const sortedCargos = useMemo(() => [...cargos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [cargos]);
  const sortedSetores = useMemo(() => [...setores].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [setores]);

  const openCreate = (kind: Kind) => {
    setFormKind(kind);
    setFormItem(null);
    setFormOpen(true);
  };
  const openEdit = (kind: Kind, item: CatalogItem) => {
    setFormKind(kind);
    setFormItem(item);
    setFormOpen(true);
  };

  const handleSaved = (kind: Kind, saved: CatalogItem) => {
    if (kind === 'cargo') {
      upsertCargo(saved);
      setCargos((prev) => {
        const idx = prev.findIndex((x) => String(x.id) === String(saved.id));
        return idx >= 0 ? prev.map((x) => (String(x.id) === String(saved.id) ? { ...x, ...saved } : x)) : [...prev, saved];
      });
    } else {
      upsertSetor(saved);
      setSetores((prev) => {
        const idx = prev.findIndex((x) => String(x.id) === String(saved.id));
        return idx >= 0 ? prev.map((x) => (String(x.id) === String(saved.id) ? { ...x, ...saved } : x)) : [...prev, saved];
      });
    }
  };

  const confirmDelete = async () => {
    if (!delItem) return;
    setDelLoading(true);
    setDelError('');
    try {
      if (delItem.kind === 'cargo') {
        await userService.deleteCargo(delItem.item.id);
        setCargos((prev) => prev.filter((x) => String(x.id) !== String(delItem.item.id)));
      } else {
        await userService.deleteSetor(delItem.item.id);
        setSetores((prev) => prev.filter((x) => String(x.id) !== String(delItem.item.id)));
      }
      setDelItem(null);
    } catch (err) {
      const data = (err as { response?: { data?: { detail?: string } } })?.response?.data;
      setDelError(data?.detail || 'Não foi possível excluir.');
    } finally {
      setDelLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" /> Cargos
              </CardTitle>
              <CardDescription>Defina cargos, cores e o template de permissões-padrão.</CardDescription>
            </div>
            <Button onClick={() => openCreate('cargo')} className="gap-2">
              <Plus className="h-4 w-4" /> Novo cargo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogTable
            kind="cargo"
            items={sortedCargos}
            onEdit={(it) => openEdit('cargo', it)}
            onDelete={(it) => { setDelItem({ kind: 'cargo', item: it }); setDelError(''); }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" /> Setores
              </CardTitle>
              <CardDescription>
                Segmentam a plataforma. O compartilhamento entre setores é definido em cada sprint/projeto.
              </CardDescription>
            </div>
            <Button onClick={() => openCreate('setor')} className="gap-2">
              <Plus className="h-4 w-4" /> Novo setor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogTable
            kind="setor"
            items={sortedSetores}
            onEdit={(it) => openEdit('setor', it)}
            onDelete={(it) => { setDelItem({ kind: 'setor', item: it }); setDelError(''); }}
          />
        </CardContent>
      </Card>

      {formOpen && (
        <CargoSetorFormDialog
          kind={formKind}
          item={formItem}
          permissionCatalog={catalog}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={(saved) => handleSaved(formKind, saved)}
        />
      )}

      {delItem && (
        <ConfirmDialog
          open={!!delItem}
          title={`Excluir ${delItem.kind === 'cargo' ? 'cargo' : 'setor'} "${delItem.item.nome}"?`}
          description="Esta ação não pode ser desfeita."
          details={delError ? <p className="text-sm text-[var(--color-destructive)]">{delError}</p> : undefined}
          confirmLabel="Excluir"
          variant="destructive"
          loading={delLoading}
          onConfirm={confirmDelete}
          onCancel={() => setDelItem(null)}
        />
      )}
    </div>
  );
}
