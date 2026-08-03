import { useEffect, useMemo, useState } from 'react';
import { userService, type CatalogItem, type PermissionCatalogEntry } from '@/services/userService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const SWATCHES = [
  '#c4b5fd', '#93c5fd', '#86efac', '#fdba74', '#fca5a5', '#f9a8d4',
  '#67e8f9', '#a3e635', '#fcd34d', '#94a3b8', '#f472b6', '#38bdf8',
];

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data) {
    const k = Object.keys(data)[0];
    const v = k ? data[k] : undefined;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    if (typeof v === 'string') return v;
  }
  return fallback;
}

type Props = {
  kind: 'cargo' | 'setor';
  item?: CatalogItem | null; // undefined/null = criar
  permissionCatalog?: PermissionCatalogEntry[]; // só para cargo (template)
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: CatalogItem) => void;
};

export function CargoSetorFormDialog({ kind, item, permissionCatalog = [], open, onOpenChange, onSaved }: Props) {
  const editing = !!item;
  const isCargo = kind === 'cargo';
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState('#94a3b8');
  const [labelCurto, setLabelCurto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [template, setTemplate] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [permSearch, setPermSearch] = useState('');

  useEffect(() => {
    setNome(item?.nome ?? '');
    setCor(item?.cor ?? '#94a3b8');
    setLabelCurto(item?.label_curto ?? '');
    setDescricao(item?.descricao ?? '');
    setTemplate(new Set(item?.permissoes_padrao ?? []));
    setError('');
    setPermSearch('');
  }, [item, open]);

  const grouped = useMemo(() => {
    const g = new Map<string, PermissionCatalogEntry[]>();
    for (const e of permissionCatalog) {
      const list = g.get(e.area) ?? [];
      list.push(e);
      g.set(e.area, list);
    }
    return [...g.entries()];
  }, [permissionCatalog]);

  // A busca só filtra o que é EXIBIDO: `template` segue com o conjunto
  // inteiro, então buscar e salvar nunca remove uma permissão escondida.
  const visiveis = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map(([area, entries]) => {
        const achou = entries.filter((e) =>
          `${e.name} ${e.area} ${e.codename}`.toLowerCase().includes(q),
        );
        return [area, achou] as [string, PermissionCatalogEntry[]];
      })
      .filter(([, entries]) => entries.length > 0);
  }, [grouped, permSearch]);

  const toggle = (cn2: string) =>
    setTemplate((prev) => {
      const next = new Set(prev);
      if (next.has(cn2)) next.delete(cn2);
      else next.add(cn2);
      return next;
    });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        nome: nome.trim(),
        cor,
        label_curto: labelCurto.trim(),
        descricao: descricao.trim(),
        ...(isCargo ? { permissoes_padrao: [...template] } : {}),
      };
      let saved: CatalogItem;
      if (editing) {
        saved = isCargo
          ? await userService.updateCargo(item!.id, payload)
          : await userService.updateSetor(item!.id, payload);
      } else {
        saved = isCargo
          ? await userService.createCargo(payload)
          : await userService.createSetor(payload);
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(extractApiError(err, 'Não foi possível salvar.'));
    } finally {
      setSaving(false);
    }
  };

  const titulo = `${editing ? 'Editar' : 'Novo'} ${isCargo ? 'cargo' : 'setor'}`;
  // Setor não tem template de permissões: sem a coluna da direita, um modal
  // largo ficaria vazio pela metade.
  const comPermissoes = isCargo && grouped.length > 0;

  const dadosDoItem = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={isCargo ? 'Ex.: Analista Financeiro' : 'Ex.: Tecnologia'} />
      </div>

      <div className="space-y-1.5">
        <Label>Cor (tag)</Label>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setCor(s)}
              className={cn('h-7 w-7 rounded-full border-2 flex items-center justify-center', cor === s ? 'border-[var(--color-foreground)]' : 'border-transparent')}
              style={{ backgroundColor: s }}
              aria-label={s}
            >
              {cor === s && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
            </button>
          ))}
          <Input value={cor} onChange={(e) => setCor(e.target.value)} className="h-8 w-[100px]" placeholder="#3b82f6" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Rótulo curto</Label>
        <Input value={labelCurto} onChange={(e) => setLabelCurto(e.target.value)} maxLength={16} placeholder="Ex.: Dev." />
      </div>

      <div className="space-y-1.5">
        <Label>Descrição (opcional)</Label>
        <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Breve descrição" />
      </div>

      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      containerClassName={comPermissoes ? 'max-w-5xl' : 'max-w-lg'}
    >
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="flex max-h-[88vh] flex-col md:overflow-y-hidden"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="inline-block h-4 w-4 rounded-full border"
              style={{ backgroundColor: cor, borderColor: `${cor}88` }}
            />
            {titulo}
          </DialogTitle>
        </DialogHeader>

        {comPermissoes ? (
          <div className="mt-4 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {dadosDoItem}

            <div className="flex min-h-0 flex-col gap-3 md:border-l md:border-[var(--color-border)] md:pl-6">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">Permissões do cargo</p>
                {/* O texto anterior ("não alteram quem já tem o cargo") deixou
                    de ser verdade: o cargo virou fonte de autorização e a
                    edição alcança todo mundo que o tem, na hora. Quem edita
                    precisa saber disso ANTES de salvar. */}
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Valem para todos que têm este cargo — inclusive quem já o tinha — e passam a
                  valer assim que você salvar, sem ninguém precisar recarregar a página. Somam-se
                  às permissões personalizadas de cada pessoa.
                </p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="Buscar permissão..."
                  className="h-9 pl-9"
                />
              </div>

              <div className="min-h-0 flex-1 md:overflow-y-auto md:pr-2">
                {visiveis.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Nenhuma permissão encontrada para “{permSearch.trim()}”.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {visiveis.map(([area, entries]) => (
                      <div key={area}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          {area}
                        </p>
                        <div className="space-y-2">
                          {entries.map((entry) => (
                            <label
                              key={entry.codename}
                              htmlFor={`tpl-${entry.codename}`}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
                            >
                              <span className="text-sm text-[var(--color-foreground)]">{entry.name}</span>
                              <Switch
                                id={`tpl-${entry.codename}`}
                                checked={template.has(entry.codename)}
                                onCheckedChange={() => toggle(entry.codename)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4">{dadosDoItem}</div>
        )}

        <DialogFooter className="mt-6 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving || !nome.trim()}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
