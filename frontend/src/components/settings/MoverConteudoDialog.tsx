import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, FolderInput, Layers, Loader2, Search,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { chipStyle } from '@/lib/catalog-style';
import { formatDate } from '@/lib/dateUtils';
import {
  userService,
  type AtribuirDadosResult,
  type CatalogItem,
} from '@/services/userService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { projectService, type Project } from '@/services/projectService';
import { isProjetoMonitoramento } from '@/lib/monitoramentoFeedback';

/** Espelha `SETOR_PADRAO_CODENAME` do backend: o destino de tudo que ainda não
 * foi classificado. É o único setor que o atalho `todos` esvazia. */
const SETOR_PADRAO_CODENAME = 'sem_setor';

/** Fluxo em três passos porque mover é irreversível na prática: o usuário
 * escolhe, LÊ o alcance da mudança, e só então aplica. */
type Etapa = 'selecao' | 'confirmacao' | 'resultado';

type Aba = 'sprints' | 'projetos';

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

const statusHttp = (err: unknown) =>
  (err as { response?: { status?: number } })?.response?.status;

function SetorChip({ setor }: { setor: CatalogItem }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-[10px] py-[3px] text-xs font-medium"
      style={chipStyle(setor.cor || '#94a3b8')}
    >
      {setor.nome}
    </span>
  );
}

/** Tag do setor ATUAL do item. Recebe o catálogo já carregado para não fazer
 * uma requisição por linha. */
function SetorAtual({ codename, catalogo }: { codename?: string | null; catalogo: Map<string, CatalogItem> }) {
  if (!codename) {
    return <span className="text-xs text-[var(--color-muted-foreground)]">sem setor</span>;
  }
  const setor = catalogo.get(codename);
  const cor = setor?.cor || '#94a3b8';
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-[2px] text-[11px] font-medium"
      style={chipStyle(cor)}
    >
      {setor?.label_curto || setor?.nome || codename}
    </span>
  );
}

function Caixa({ checked }: { checked: boolean }) {
  return (
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
  );
}

const plural = (n: number, singular: string, pluralForma: string) =>
  `${n} ${n === 1 ? singular : pluralForma}`;

type Props = {
  /** Setor de DESTINO — o diálogo é aberto a partir da linha dele. */
  destino: CatalogItem;
  /** Catálogo completo de setores, para resolver a tag do setor atual de cada item. */
  setores: CatalogItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: (resultado: AtribuirDadosResult) => void;
};

/** Move sprints/projetos para um setor. Quem abre precisa de `manage_setores` —
 * o endpoint também a exige. */
export function MoverConteudoDialog({ destino, setores, open, onOpenChange, onMoved }: Props) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projetos, setProjetos] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  /** Mensagem do 409: não é falha, é uma regra de negócio que o usuário resolve. */
  const [conflito, setConflito] = useState('');
  const [etapa, setEtapa] = useState<Etapa>('selecao');
  const [resultado, setResultado] = useState<AtribuirDadosResult | null>(null);

  const [aba, setAba] = useState<Aba>('sprints');
  const [busca, setBusca] = useState('');
  const [sprintsSel, setSprintsSel] = useState<Set<string>>(new Set());
  const [projetosSel, setProjetosSel] = useState<Set<string>>(new Set());
  const [todos, setTodos] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setLoading(true);
    setErro('');
    setConflito('');
    setEtapa('selecao');
    setResultado(null);
    setBusca('');
    setAba('sprints');
    setSprintsSel(new Set());
    setProjetosSel(new Set());
    setTodos(false);
    void (async () => {
      try {
        const [listaSprints, listaProjetos] = await Promise.all([
          sprintService.getAll(),
          projectService.getAll(),
        ]);
        if (cancelado) return;
        setSprints(listaSprints);
        setProjetos(listaProjetos);
      } catch (err) {
        if (!cancelado) setErro(extractApiError(err, 'Não foi possível carregar sprints e projetos.'));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [open, destino.id]);

  const catalogo = useMemo(
    () => new Map(setores.map((s) => [s.codename, s])),
    [setores],
  );

  const setorPadrao = catalogo.get(SETOR_PADRAO_CODENAME) ?? null;
  const destinoEhPadrao = destino.codename === SETOR_PADRAO_CODENAME;

  // Item que já é do destino não tem para onde ir — listá-lo só geraria
  // seleção sem efeito.
  const sprintsMoviveis = useMemo(
    () => sprints
      .filter((s) => s.setor !== destino.codename)
      .sort((a, b) => (b.data_inicio || '').localeCompare(a.data_inicio || '')),
    [sprints, destino.codename],
  );
  const projetosMoviveis = useMemo(
    () => projetos
      // O projeto de Monitoramento de Feedbacks fica FORA da lista, e não por
      // ser sistêmico (Suporte e Sugestões continuam movíveis): ele mora em
      // `sem_setor` DE PROPÓSITO. Os cards dele são de setores diferentes e
      // ficam visíveis só para quem entregou, via compartilhamento por card;
      // dar a ele um setor real entregaria o feedback de TODA a empresa ao time
      // daquele setor. Como é irreversível na prática, é melhor não oferecer.
      .filter((p) => !isProjetoMonitoramento(p))
      .filter((p) => p.setor !== destino.codename)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [projetos, destino.codename],
  );

  const filtroBusca = busca.trim().toLowerCase();
  const sprintsVisiveis = useMemo(
    () => sprintsMoviveis.filter((s) => !filtroBusca || s.nome.toLowerCase().includes(filtroBusca)),
    [sprintsMoviveis, filtroBusca],
  );
  const projetosVisiveis = useMemo(
    () => projetosMoviveis.filter((p) =>
      !filtroBusca
      || p.nome.toLowerCase().includes(filtroBusca)
      || (p.sprint_name ?? '').toLowerCase().includes(filtroBusca)),
    [projetosMoviveis, filtroBusca],
  );

  /** Alcance do atalho `todos`. Os cards de um projeto só entram na conta
   * quando a sprint dele já não está sendo contada — senão contariam duas vezes. */
  const naoClassificados = useMemo(() => {
    const sprintsPadrao = sprints.filter((s) => s.setor === SETOR_PADRAO_CODENAME);
    const idsSprintsPadrao = new Set(sprintsPadrao.map((s) => String(s.id)));
    const projetosPadrao = projetos.filter((p) => p.setor === SETOR_PADRAO_CODENAME);
    return {
      sprints: sprintsPadrao.length,
      projetos: projetosPadrao.length,
      cards: sprintsPadrao.reduce((t, s) => t + (s.cards_total ?? 0), 0)
        + projetosPadrao
          .filter((p) => !idsSprintsPadrao.has(String(p.sprint)))
          .reduce((t, p) => t + (p.cards_count ?? 0), 0),
    };
  }, [sprints, projetos]);

  /** Projeto cuja sprint já foi marcada vai junto de qualquer jeito: mandá-lo
   * também no payload inflaria a contagem sem mudar o resultado. */
  const projetoCoberto = (p: Project) => sprintsSel.has(String(p.sprint));

  const selecionados = useMemo(() => {
    const sprintsEscolhidas = sprintsMoviveis.filter((s) => sprintsSel.has(String(s.id)));
    const projetosAvulsos = projetosMoviveis.filter(
      (p) => projetosSel.has(String(p.id)) && !sprintsSel.has(String(p.sprint)),
    );
    // Projetos que a sprint arrasta contam no alcance, mesmo sem estarem marcados.
    const projetosArrastados = projetos.filter((p) => sprintsSel.has(String(p.sprint)));
    const cards = sprintsEscolhidas.reduce((t, s) => t + (s.cards_total ?? 0), 0)
      + projetosAvulsos.reduce((t, p) => t + (p.cards_count ?? 0), 0);
    return {
      sprints: sprintsEscolhidas,
      projetosAvulsos,
      totalProjetos: projetosAvulsos.length + projetosArrastados.length,
      cards,
    };
  }, [sprintsMoviveis, projetosMoviveis, projetos, sprintsSel, projetosSel]);

  const nadaSelecionado = !todos
    && selecionados.sprints.length === 0
    && selecionados.projetosAvulsos.length === 0;

  const toggleSprint = (id: string) =>
    setSprintsSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleProjeto = (id: string) =>
    setProjetosSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** O atalho e a escolha item a item são caminhos excludentes: misturar os
   * dois esconderia do usuário o que ele está realmente movendo. */
  const alternarTodos = () => {
    setTodos((prev) => {
      if (!prev) {
        setSprintsSel(new Set());
        setProjetosSel(new Set());
      }
      return !prev;
    });
  };

  const aplicar = async () => {
    setSalvando(true);
    setErro('');
    setConflito('');
    try {
      const payload = todos
        ? { todos: true }
        : {
            sprint_ids: selecionados.sprints.map((s) => s.id),
            project_ids: selecionados.projetosAvulsos.map((p) => p.id),
          };
      const res = await userService.atribuirDados(destino.id, payload);
      setResultado(res);
      setEtapa('resultado');
      onMoved?.(res);
    } catch (err) {
      if (statusHttp(err) === 409) {
        setConflito(extractApiError(
          err,
          'A mudança deixaria duas sprints em andamento ao mesmo tempo neste setor.',
        ));
      } else {
        setErro(extractApiError(err, 'Não foi possível mover o conteúdo.'));
      }
    } finally {
      setSalvando(false);
    }
  };

  const fechar = () => {
    if (!salvando) onOpenChange(false);
  };

  const resumoSelecao = todos
    ? `${plural(naoClassificados.sprints, 'sprint', 'sprints')}, `
      + `${plural(naoClassificados.projetos, 'projeto', 'projetos')} e `
      + `${plural(naoClassificados.cards, 'card', 'cards')} `
      + `que ainda estão em ${setorPadrao?.nome ?? 'Sem Setor'}`
    : `${plural(selecionados.sprints.length, 'sprint', 'sprints')}, `
      + `${plural(selecionados.totalProjetos, 'projeto', 'projetos')} e `
      + `${plural(selecionados.cards, 'card', 'cards')}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && fechar()} containerClassName="max-w-2xl">
      <DialogContent onClose={salvando ? undefined : fechar}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5 text-[var(--color-primary)]" />
            Mover conteúdo para um setor
          </DialogTitle>
          <DialogDescription>
            O que for movido passa a pertencer a{' '}
            <strong className="text-[var(--color-foreground)]">{destino.nome}</strong> — e é o
            setor dono que define quem enxerga cada item.
          </DialogDescription>
        </DialogHeader>

        {etapa === 'selecao' && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2.5">
              <Label>Destino</Label>
              <ArrowRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              <SetorChip setor={destino} />
            </div>

            <div className="mt-3 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                Em cascata
              </p>
              <p className="mt-1 text-sm leading-snug text-[var(--color-foreground)]">
                Mover uma sprint leva os projetos e os cards dela. Mover um projeto leva os
                cards dele. Não há como mover um card sozinho — o setor do card é sempre o do
                projeto.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {!destinoEhPadrao && (
                  <button
                    type="button"
                    onClick={alternarTodos}
                    disabled={naoClassificados.sprints + naoClassificados.projetos === 0}
                    className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      todos
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]'
                    }`}
                  >
                    <span className="mt-[2px]"><Caixa checked={todos} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-foreground)]">
                        <Layers className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                        Mover tudo que está em {setorPadrao?.nome ?? 'Sem Setor'}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                        {naoClassificados.sprints + naoClassificados.projetos === 0
                          ? 'Não há conteúdo sem classificação no momento.'
                          : `${plural(naoClassificados.sprints, 'sprint', 'sprints')} e `
                            + `${plural(naoClassificados.projetos, 'projeto', 'projetos')} `
                            + 'ainda sem classificação, com os cards deles.'}
                      </span>
                    </span>
                  </button>
                )}

                <div className={todos ? 'pointer-events-none opacity-50' : undefined}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
                      {([
                        ['sprints', `Sprints (${selecionados.sprints.length})`],
                        ['projetos', `Projetos (${selecionados.projetosAvulsos.length})`],
                      ] as [Aba, string][]).map(([chave, rotulo]) => (
                        <button
                          key={chave}
                          type="button"
                          onClick={() => { setAba(chave); setBusca(''); }}
                          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                            aba === chave
                              ? 'bg-[var(--color-primary)] text-white'
                              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'
                          }`}
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    {(sprintsSel.size > 0 || projetosSel.size > 0) && (
                      <button
                        type="button"
                        onClick={() => { setSprintsSel(new Set()); setProjetosSel(new Set()); }}
                        className="text-xs font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>

                  <div className="relative mt-2">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                    <Input
                      className="h-9 pl-8"
                      placeholder={aba === 'sprints' ? 'Buscar sprint...' : 'Buscar projeto...'}
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>

                  <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-[var(--color-border)]">
                    {aba === 'sprints' ? (
                      sprintsVisiveis.length === 0 ? (
                        <p className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                          Nenhuma sprint fora de {destino.nome}.
                        </p>
                      ) : (
                        sprintsVisiveis.map((s) => {
                          const marcada = sprintsSel.has(String(s.id));
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleSprint(String(s.id))}
                              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)] ${
                                marcada ? 'bg-[var(--color-accent)]/60' : ''
                              }`}
                            >
                              <Caixa checked={marcada} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{s.nome}</span>
                                <span className="block text-xs text-[var(--color-muted-foreground)]">
                                  {formatDate(s.data_inicio)} a {formatDate(s.data_fim || s.fechamento_em)}
                                  {' · '}
                                  {plural(s.projects_count ?? 0, 'projeto', 'projetos')}
                                  {' · '}
                                  {plural(s.cards_total ?? 0, 'card', 'cards')}
                                </span>
                              </span>
                              <SetorAtual codename={s.setor} catalogo={catalogo} />
                            </button>
                          );
                        })
                      )
                    ) : projetosVisiveis.length === 0 ? (
                      <p className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                        Nenhum projeto fora de {destino.nome}.
                      </p>
                    ) : (
                      projetosVisiveis.map((p) => {
                        const coberto = projetoCoberto(p);
                        const marcada = coberto || projetosSel.has(String(p.id));
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={coberto}
                            onClick={() => toggleProjeto(String(p.id))}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                              coberto ? 'bg-[var(--color-muted)]/40' : 'hover:bg-[var(--color-accent)]'
                            } ${marcada && !coberto ? 'bg-[var(--color-accent)]/60' : ''}`}
                          >
                            <Caixa checked={marcada} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{p.nome}</span>
                              <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                                {coberto
                                  ? 'Vai junto com a sprint selecionada'
                                  : `${p.sprint_name || 'Sem sprint'} · ${plural(p.cards_count ?? 0, 'card', 'cards')}`}
                              </span>
                            </span>
                            <SetorAtual codename={p.setor} catalogo={catalogo} />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {nadaSelecionado
                    ? 'Nada selecionado — escolha as sprints ou os projetos que mudam de setor.'
                    : `Vão para ${destino.nome}: ${resumoSelecao}.`}
                </p>
              </div>
            )}
          </>
        )}

        {etapa === 'confirmacao' && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-destructive)]">
                <AlertTriangle className="h-4 w-4" />
                Confirme antes de aplicar
              </p>
              <p className="mt-1.5 text-sm leading-snug text-[var(--color-foreground)]">
                Vão para <strong>{destino.nome}</strong>: {resumoSelecao}. A mudança arrasta a
                árvore inteira — projetos e cards seguem a sprint, e cards seguem o projeto.
                Quem passa a enxergar (e a editar) esse conteúdo muda junto, e compartilhamentos
                que apontavam para {destino.nome} deixam de existir por virarem redundantes.
              </p>
            </div>

            {!todos && (
              <div className="max-h-[220px] space-y-3 overflow-y-auto rounded-md border border-[var(--color-border)] p-3">
                {selecionados.sprints.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      Sprints ({selecionados.sprints.length})
                    </p>
                    <ul className="mt-1 space-y-1">
                      {selecionados.sprints.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                          <SetorAtual codename={s.setor} catalogo={catalogo} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selecionados.projetosAvulsos.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      Projetos ({selecionados.projetosAvulsos.length})
                    </p>
                    <ul className="mt-1 space-y-1">
                      {selecionados.projetosAvulsos.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                          <SetorAtual codename={p.setor} catalogo={catalogo} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {conflito && (
              <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-destructive)]">
                  <AlertTriangle className="h-4 w-4" />
                  Nada foi movido
                </p>
                <p className="mt-1.5 text-sm leading-snug text-[var(--color-foreground)]">
                  {conflito}
                </p>
              </div>
            )}
          </div>
        )}

        {etapa === 'resultado' && resultado && (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
              <CheckCircle2 className="h-5 w-5 text-[var(--color-primary)]" />
              Conteúdo movido para {destino.nome}.
            </p>
            <ul className="space-y-1 rounded-md border border-[var(--color-border)] p-3 text-sm">
              <li>{plural(resultado.atribuidos.sprints ?? 0, 'sprint movida', 'sprints movidas')}</li>
              <li>{plural(resultado.atribuidos.projetos ?? 0, 'projeto movido', 'projetos movidos')}</li>
              <li>{plural(resultado.atribuidos.cards ?? 0, 'card movido', 'cards movidos')}</li>
              {(resultado.atribuidos.compartilhamentos_redundantes_removidos ?? 0) > 0 && (
                <li className="text-[var(--color-muted-foreground)]">
                  {plural(
                    resultado.atribuidos.compartilhamentos_redundantes_removidos ?? 0,
                    'compartilhamento redundante removido',
                    'compartilhamentos redundantes removidos',
                  )}
                  {' '}(o setor dono não precisa de convite).
                </li>
              )}
            </ul>
          </div>
        )}

        {erro && <p className="mt-3 text-sm text-[var(--color-destructive)]">{erro}</p>}

        <DialogFooter className="mt-6 gap-2 sm:gap-2">
          {etapa === 'selecao' && (
            <>
              <Button type="button" variant="outline" onClick={fechar}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={loading || nadaSelecionado}
                onClick={() => { setConflito(''); setErro(''); setEtapa('confirmacao'); }}
              >
                Revisar mudança
              </Button>
            </>
          )}
          {etapa === 'confirmacao' && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                onClick={() => setEtapa('selecao')}
              >
                Voltar
              </Button>
              <Button type="button" variant="destructive" disabled={salvando} onClick={aplicar}>
                {salvando
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Movendo...</>
                  : `Mover para ${destino.nome}`}
              </Button>
            </>
          )}
          {etapa === 'resultado' && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
