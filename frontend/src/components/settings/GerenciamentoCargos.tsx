import { useEffect, useMemo, useState } from 'react';
import { userService, type CatalogItem, type PermissionCatalogEntry } from '@/services/userService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Shield } from 'lucide-react';
import { upsertCargo } from '@/lib/catalog-style';
import { CatalogTable } from './CatalogTable';
import { CargoSetorFormDialog } from './CargoSetorFormDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function GerenciamentoCargos() {
  const [cargos, setCargos] = useState<CatalogItem[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formItem, setFormItem] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [delItem, setDelItem] = useState<CatalogItem | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [delError, setDelError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([userService.getCargos(), userService.getPermissionsCatalog()])
      .then(([lista, cat]) => {
        if (!mounted) return;
        setCargos(lista);
        setCatalog(cat);
        lista.forEach(upsertCargo);
        setError('');
      })
      .catch(() => mounted && setError('Não foi possível carregar os cargos.'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const ordenados = useMemo(
    () => [...cargos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [cargos],
  );

  const handleSaved = (saved: CatalogItem) => {
    upsertCargo(saved);
    setCargos((prev) => {
      const existe = prev.some((x) => String(x.id) === String(saved.id));
      return existe
        ? prev.map((x) => (String(x.id) === String(saved.id) ? { ...x, ...saved } : x))
        : [...prev, saved];
    });
  };

  const confirmDelete = async () => {
    if (!delItem) return;
    setDelLoading(true);
    setDelError('');
    try {
      await userService.deleteCargo(delItem.id);
      setCargos((prev) => prev.filter((x) => String(x.id) !== String(delItem.id)));
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
    <div className="space-y-4">
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
            <Button
              onClick={() => {
                setFormItem(null);
                setFormOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Novo cargo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogTable
            kind="cargo"
            items={ordenados}
            onEdit={(it) => {
              setFormItem(it);
              setFormOpen(true);
            }}
            onDelete={(it) => {
              setDelItem(it);
              setDelError('');
            }}
          />
        </CardContent>
      </Card>

      {formOpen && (
        <CargoSetorFormDialog
          kind="cargo"
          item={formItem}
          permissionCatalog={catalog}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={handleSaved}
        />
      )}

      {delItem && (
        <ConfirmDialog
          open={!!delItem}
          title={`Excluir cargo "${delItem.nome}"?`}
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
