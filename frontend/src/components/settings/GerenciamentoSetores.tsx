import { useEffect, useMemo, useState } from 'react';
import { userService, type CatalogItem } from '@/services/userService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Building2, FolderInput } from 'lucide-react';
import { upsertSetor } from '@/lib/catalog-style';
import { CatalogTable } from './CatalogTable';
import { CargoSetorFormDialog } from './CargoSetorFormDialog';
import { MoverConteudoDialog } from './MoverConteudoDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function GerenciamentoSetores() {
  const [setores, setSetores] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formItem, setFormItem] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  /** Setor de destino do diálogo de mover conteúdo — aberto pela linha dele. */
  const [moverPara, setMoverPara] = useState<CatalogItem | null>(null);

  const [delItem, setDelItem] = useState<CatalogItem | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [delError, setDelError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    userService
      .getSetores()
      .then((lista) => {
        if (!mounted) return;
        setSetores(lista);
        lista.forEach(upsertSetor);
        setError('');
      })
      .catch(() => mounted && setError('Não foi possível carregar os setores.'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const ordenados = useMemo(
    () => [...setores].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [setores],
  );

  const handleSaved = (saved: CatalogItem) => {
    upsertSetor(saved);
    setSetores((prev) => {
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
      await userService.deleteSetor(delItem.id);
      setSetores((prev) => prev.filter((x) => String(x.id) !== String(delItem.id)));
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
                <Building2 className="h-5 w-5" /> Setores
              </CardTitle>
              <CardDescription>
                Segmentam a plataforma. O compartilhamento entre setores é definido em cada
                sprint/projeto; para trocar o setor DONO de sprints e projetos, use "Mover
                conteúdo" na linha do setor de destino.
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setFormItem(null);
                setFormOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Novo setor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogTable
            kind="setor"
            items={ordenados}
            onEdit={(it) => {
              setFormItem(it);
              setFormOpen(true);
            }}
            onDelete={(it) => {
              setDelItem(it);
              setDelError('');
            }}
            extraActions={(it) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setMoverPara(it)}
                title={`Mover sprints e projetos para ${it.nome}`}
              >
                <FolderInput className="h-4 w-4" />
              </Button>
            )}
          />
        </CardContent>
      </Card>

      {formOpen && (
        <CargoSetorFormDialog
          kind="setor"
          item={formItem}
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={handleSaved}
        />
      )}

      {moverPara && (
        <MoverConteudoDialog
          destino={moverPara}
          setores={setores}
          open={!!moverPara}
          onOpenChange={(o) => !o && setMoverPara(null)}
        />
      )}

      {delItem && (
        <ConfirmDialog
          open={!!delItem}
          title={`Excluir setor "${delItem.nome}"?`}
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
