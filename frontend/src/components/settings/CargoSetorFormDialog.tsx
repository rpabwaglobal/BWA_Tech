import { useEffect, useMemo, useState } from 'react';
import { userService, type CatalogItem, type PermissionCatalogEntry } from '@/services/userService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Check } from 'lucide-react';
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

  useEffect(() => {
    setNome(item?.nome ?? '');
    setCor(item?.cor ?? '#94a3b8');
    setLabelCurto(item?.label_curto ?? '');
    setDescricao(item?.descricao ?? '');
    setTemplate(new Set(item?.permissoes_padrao ?? []));
    setError('');
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange} containerClassName="max-w-lg">
      <DialogContent onClose={() => onOpenChange(false)} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="inline-block h-4 w-4 rounded-full border"
              style={{ backgroundColor: cor, borderColor: `${cor}88` }}
            />
            {titulo}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rótulo curto</Label>
              <Input value={labelCurto} onChange={(e) => setLabelCurto(e.target.value)} maxLength={16} placeholder="Ex.: Dev." />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Breve descrição" />
            </div>
          </div>

          {isCargo && grouped.length > 0 && (
            <div className="space-y-2">
              <Label>Permissões-padrão (template)</Label>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Sugeridas ao atribuir este cargo com "aplicar template". Não altera usuários já existentes.
              </p>
              <div className="max-h-[240px] space-y-3 overflow-y-auto rounded-md border border-[var(--color-border)] p-3">
                {grouped.map(([area, entries]) => (
                  <div key={area}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{area}</p>
                    <div className="space-y-1.5">
                      {entries.map((entry) => (
                        <label key={entry.codename} className="flex items-center justify-between gap-3 text-sm">
                          <span>{entry.name}</span>
                          <Switch checked={template.has(entry.codename)} onCheckedChange={() => toggle(entry.codename)} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>

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
