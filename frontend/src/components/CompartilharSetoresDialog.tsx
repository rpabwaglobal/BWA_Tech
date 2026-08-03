import { useEffect, useMemo, useState } from 'react';
import { Check, Eye, Loader2, Pencil, Search, Share2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { chipStyle } from '@/lib/catalog-style';
import { userService, type CatalogItem } from '@/services/userService';
import {
  ROTULO_NIVEL,
  setorSharingService,
  type CompartilhamentoSetores,
  type NivelCompartilhamento,
  type RecursoCompartilhavel,
  type SetorBasico,
  type SetorCompartilhado,
} from '@/services/setorSharingService';

/** O que cada recurso arrasta junto ao ser compartilhado — a cascata é o que
 * decide se o usuário precisa compartilhar item por item ou só o nível de cima. */
const CASCATA: Record<RecursoCompartilhavel, string> = {
  sprints: 'Os projetos e os cards desta sprint vão junto — não é preciso compartilhar um a um.',
  projects: 'Os cards deste projeto vão junto — não é preciso compartilhar um a um.',
  cards: 'O acesso vale só para este card.',
  'chamados-suporte': 'O acesso vale só para este chamado.',
};

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

const mapaDeConvites = (convites: SetorCompartilhado[]) =>
  new Map<string, NivelCompartilhamento>(convites.map((s) => [s.codename, s.nivel]));

const NIVEIS: { valor: NivelCompartilhamento; Icone: typeof Eye }[] = [
  { valor: 'leitura', Icone: Eye },
  { valor: 'edicao', Icone: Pencil },
];

/** Alterna o nível de um convite já feito. Só aparece na linha selecionada:
 * escolher "ver ou editar" só faz sentido depois de decidir compartilhar. */
function SeletorDeNivel({
  valor, onChange,
}: { valor: NivelCompartilhamento; onChange: (n: NivelCompartilhamento) => void }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
      {NIVEIS.map(({ valor: v, Icone }) => {
        const ativo = valor === v;
        return (
          <span
            key={v}
            role="button"
            tabIndex={0}
            title={ROTULO_NIVEL[v]}
            onClick={(e) => { e.stopPropagation(); onChange(v); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(v); }
            }}
            className={`flex items-center gap-1 rounded px-1.5 py-[3px] text-[11px] font-medium transition-colors ${
              ativo
                ? 'bg-[var(--color-primary)] text-white'
                : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'
            }`}
          >
            <Icone className="h-3 w-3" />
            {ROTULO_NIVEL[v]}
          </span>
        );
      })}
    </span>
  );
}

function SetorChip({ setor }: { setor: SetorBasico | CatalogItem }) {
  const cor = setor.cor || '#94a3b8';
  return (
    <span
      className="inline-flex items-center rounded-full border px-[10px] py-[3px] text-xs font-medium"
      style={chipStyle(cor)}
    >
      {setor.nome}
    </span>
  );
}

type Props = {
  recurso: RecursoCompartilhavel;
  itemId: string | number;
  /** Nome do item, só para o cabeçalho — o backend resolve tudo pelo id. */
  itemNome: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (data: CompartilhamentoSetores) => void;
};

/** Escolhe com quais setores um item é compartilhado. Quem abre já precisa ter
 * a permissão `manage_setor_sharing` — o endpoint também a exige. */
export function CompartilharSetoresDialog({
  recurso, itemId, itemNome, open, onOpenChange, onSaved,
}: Props) {
  const [catalogo, setCatalogo] = useState<CatalogItem[]>([]);
  const [dono, setDono] = useState<SetorBasico | null>(null);
  const [selecionados, setSelecionados] = useState<Map<string, NivelCompartilhamento>>(new Map());
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setLoading(true);
    setError('');
    setBusca('');
    void (async () => {
      try {
        const [setores, atual] = await Promise.all([
          userService.getSetores(),
          setorSharingService.get(recurso, itemId),
        ]);
        if (cancelado) return;
        setCatalogo(setores);
        setDono(atual.setor);
            setSelecionados(mapaDeConvites(atual.setores_compartilhados));
      } catch (err) {
        if (!cancelado) setError(extractApiError(err, 'Não foi possível carregar o compartilhamento.'));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [open, recurso, itemId]);

  // O dono já enxerga o item; oferecê-lo como convidado só confundiria.
  const convidaveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return catalogo
      .filter((s) => s.codename !== dono?.codename)
      .filter((s) => !q || s.nome.toLowerCase().includes(q));
  }, [catalogo, dono, busca]);

  /** Clicar na linha entra/sai do compartilhamento. Entrar sempre começa em
   * "Visualizar": o nível mais restrito é o padrão seguro — quem quiser dar
   * edição escolhe explicitamente. */
  const toggle = (codename: string) =>
    setSelecionados((prev) => {
      const next = new Map(prev);
      if (next.has(codename)) next.delete(codename);
      else next.set(codename, 'leitura');
      return next;
    });

  const definirNivel = (codename: string, nivel: NivelCompartilhamento) =>
    setSelecionados((prev) => new Map(prev).set(codename, nivel));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const convites = [...selecionados].map(([setor, nivel]) => ({ setor, nivel }));
      const saved = await setorSharingService.set(recurso, itemId, convites);
      setDono(saved.setor);
      setSelecionados(mapaDeConvites(saved.setores_compartilhados));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(extractApiError(err, 'Não foi possível salvar o compartilhamento.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onOpenChange(false)} containerClassName="max-w-lg">
      <DialogContent onClose={saving ? undefined : () => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-[var(--color-primary)]" />
            Compartilhar entre setores
          </DialogTitle>
          <DialogDescription>
            <strong className="text-[var(--color-foreground)]">{itemNome}</strong> continua sendo do
            setor dono. Cada setor convidado entra para <em>visualizar</em> ou para{' '}
            <em>editar</em> — e nenhum convite concede permissão que a pessoa já não tenha
            no cargo dela.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            Em cascata
          </p>
          <p className="mt-1 text-sm leading-snug text-[var(--color-foreground)]">
            {CASCATA[recurso]}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Setor dono</Label>
              {dono ? (
                <div className="flex items-center gap-2">
                  <SetorChip setor={dono} />
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    acesso permanente
                  </span>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Sem setor definido.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label>Setores convidados</Label>
                {selecionados.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelecionados(new Map())}
                    className="text-xs font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    Descompartilhar todos
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input
                  className="h-9 pl-8"
                  placeholder="Buscar setor..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>

              <div className="max-h-[260px] overflow-y-auto rounded-md border border-[var(--color-border)]">
                {convidaveis.length === 0 ? (
                  <p className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                    Nenhum setor disponível.
                  </p>
                ) : (
                  convidaveis.map((s) => {
                    const checked = selecionados.has(s.codename);
                    return (
                      <button
                        key={s.codename}
                        type="button"
                        onClick={() => toggle(s.codename)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)] ${
                          checked ? 'bg-[var(--color-accent)]/60' : ''
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                            checked
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                              : 'border-[var(--color-border)] bg-[var(--color-background)]'
                          }`}
                        >
                          {checked && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                        </span>
                        <span
                          aria-hidden
                          className="h-[10px] w-[10px] shrink-0 rounded-full"
                          style={{ backgroundColor: s.cor || '#94a3b8' }}
                        />
                        <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                        {checked && (
                          <SeletorDeNivel
                            valor={selecionados.get(s.codename) ?? 'leitura'}
                            onChange={(n) => definirNivel(s.codename, n)}
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <p className="text-xs text-[var(--color-muted-foreground)]">
                {selecionados.size === 0
                  ? 'Nenhum setor convidado — só o dono enxerga.'
                  : `${[...selecionados.values()].filter((n) => n === 'leitura').length} para visualizar, ` +
                    `${[...selecionados.values()].filter((n) => n === 'edicao').length} para editar.`}
              </p>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-[var(--color-destructive)]">{error}</p>}

        <DialogFooter className="mt-6 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={loading || saving}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
