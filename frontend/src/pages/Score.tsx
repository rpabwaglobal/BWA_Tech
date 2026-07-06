import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Pencil, Trash2, ChevronRight, ChevronDown, Settings2, X, Trophy, GripVertical, Search,
} from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragHandle } from '@/components/ui/drag-handle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { FilterSelect } from '@/components/ui/filter-select';
import { FilterMultiSelect } from '@/components/ui/filter-multi-select';
import { KanbanCardPreview } from '@/components/KanbanCardPreview';
import type { KanbanCardPreviewData } from '@/components/KanbanCardPreview';
import {
  scoreService, SETORES_SOLICITANTES,
} from '@/services/scoreService';
import type {
  ScoreCriterion, ScoreCriterionInput, CardScore, ScoreHistoryEntry, PickableCard,
} from '@/services/scoreService';

// ---------------------------------------------------------------------------
// Fórmula do Score (espelha CardScore.calcular_score no backend)
//   score = Σ ( (-1 se negativo senão +1) * peso * valor )
// ---------------------------------------------------------------------------
function computeScore(
  criterios: ScoreCriterion[],
  valores: Record<number, number>,
): number {
  let total = 0;
  for (const c of criterios) {
    const v = valores[c.id];
    if (v === undefined || v === null) continue;
    const contrib = parseFloat(c.peso) * v;
    total += c.negativo ? -contrib : contrib;
  }
  return total;
}

const fmtScore = (n: number | string | null | undefined): string => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(1);
};

const setorLabel = (value: string | null): string =>
  SETORES_SOLICITANTES.find((s) => s.value === value)?.label ?? '—';

// Cabeçalho curto das colunas de critério na tabela (fallback: nome completo).
const COLUNA_CRITERIO: Record<string, string> = {
  'Redução de esforço': 'Esforço',
  'Risco fiscal mitigado': 'Risco',
  'Escalabilidade': 'Escala',
};
const criterioHeader = (nome: string): string => COLUNA_CRITERIO[nome] ?? nome;

// ===========================================================================
// Página
// ===========================================================================
export default function Score() {
  const [criterios, setCriterios] = useState<ScoreCriterion[]>([]);
  const [scores, setScores] = useState<CardScore[]>([]);
  const [cards, setCards] = useState<PickableCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CardScore | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [scoreToDelete, setScoreToDelete] = useState<CardScore | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const criteriosAtivos = useMemo(
    () => criterios.filter((c) => c.ativo).sort((a, b) => a.ordem - b.ordem),
    [criterios],
  );

  // --- Filtros da tabela ---
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [respFilter, setRespFilter] = useState('');
  const [scoreRanges, setScoreRanges] = useState<string[]>([]);
  const [sprintEmAndamento, setSprintEmAndamento] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const statusOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scores) map.set(s.card_status, s.card_status_display);
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scores]);

  const responsavelOptions = useMemo(() => {
    const map = new Map<string, { label: string; role: string }>();
    let temSem = false;
    for (const s of scores) {
      if (s.responsavel && s.responsavel_name) {
        map.set(String(s.responsavel), {
          label: s.responsavel_name,
          role: s.responsavel_role ?? '',
        });
      } else {
        temSem = true;
      }
    }
    const opts = Array.from(map, ([value, v]) => ({ value, label: v.label, role: v.role }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (temSem) opts.unshift({ value: '__sem__', label: 'Sem Responsável', role: '' });
    return opts;
  }, [scores]);

  // Faixas de score (de 0 a 1, de 1 a 2, ...) geradas a partir dos scores presentes.
  const scoreRangeOptions = useMemo(() => {
    const vals = scores.map((s) => parseFloat(s.score_final)).filter((v) => !Number.isNaN(v));
    if (vals.length === 0) return [] as { value: string; label: string }[];
    const lo = Math.floor(Math.min(...vals));
    const hi = Math.floor(Math.max(...vals)) + 1;
    const out: { value: string; label: string }[] = [];
    for (let i = lo; i < hi; i++) {
      out.push({ value: String(i), label: `de ${i} a ${i + 1}` });
    }
    return out;
  }, [scores]);

  const filteredScores = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rangeSet = new Set(scoreRanges);
    return scores
      .filter((s) => {
        if (q && !s.card_nome.toLowerCase().includes(q)) return false;
        if (statusFilter && s.card_status !== statusFilter) return false;
        if (respFilter) {
          if (respFilter === '__sem__') {
            if (s.responsavel) return false;
          } else if (String(s.responsavel ?? '') !== respFilter) {
            return false;
          }
        }
        if (sprintEmAndamento && !s.sprint_em_andamento) return false;
        if (rangeSet.size > 0) {
          const sf = parseFloat(s.score_final);
          if (!rangeSet.has(String(Math.floor(sf)))) return false;
        }
        return true;
      })
      // Maior score primeiro (independe da ordem de inserção local após editar/criar).
      .sort((a, b) => parseFloat(b.score_final) - parseFloat(a.score_final));
  }, [scores, search, statusFilter, respFilter, scoreRanges, sprintEmAndamento]);

  // Reseta a paginação por scroll quando os filtros mudam.
  useEffect(() => {
    setVisibleCount(50);
  }, [search, statusFilter, respFilter, scoreRanges, sprintEmAndamento]);

  const visibleScores = filteredScores.slice(0, visibleCount);

  // Núcleo da página: critérios + scores (leves). NÃO carrega os cards aqui — a
  // tabela não precisa deles e carregar todos (getAll, paginado) travava a página.
  const loadCore = async () => {
    try {
      setLoading(true);
      setError(null);
      const [crit, scr] = await Promise.all([
        scoreService.getCriterios(),
        scoreService.getScores(),
      ]);
      setCriterios(crit);
      setScores(scr);
    } catch (e) {
      console.error('Erro ao carregar Score:', e);
      setError('Não foi possível carregar os dados do Score.');
    } finally {
      setLoading(false);
    }
  };

  // Cards do seletor: endpoint leve (uma request, sem paginação), em background.
  const loadCards = async () => {
    try {
      setCardsLoading(true);
      const crd = await scoreService.getPickableCards();
      setCards(crd);
    } catch (e) {
      console.error('Erro ao carregar cards do seletor:', e);
    } finally {
      setCardsLoading(false);
    }
  };

  useEffect(() => {
    loadCore();
    loadCards();
  }, []);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (score: CardScore) => {
    setEditing(score);
    setFormOpen(true);
  };

  // Atualiza o estado local após salvar — sem recarregar nada (instantâneo).
  const applySavedScore = (saved: CardScore) => {
    setScores((prev) => [saved, ...prev.filter((s) => String(s.card) !== String(saved.card))]);
    setCards((prev) =>
      prev.map((c) =>
        String(c.id) === String(saved.card) ? { ...c, score_final: saved.score_final } : c,
      ),
    );
  };

  const confirmDelete = async () => {
    if (!scoreToDelete) return;
    const alvo = scoreToDelete;
    try {
      setDeleting(true);
      await scoreService.deleteScore(alvo.id);
      setScores((prev) => prev.filter((s) => s.id !== alvo.id));
      setCards((prev) =>
        prev.map((c) =>
          String(c.id) === String(alvo.card) ? { ...c, score_final: null } : c,
        ),
      );
      setScoreToDelete(null);
    } catch (e) {
      console.error('Erro ao excluir score:', e);
      window.alert('Erro ao excluir o score.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] flex-1 min-h-0">
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7 text-[var(--color-primary)]" />
            Score
          </h1>
          <p className="text-[var(--color-muted-foreground)] mt-1">
            Pontuação de valor dos cards. Fórmula configurável — cada critério tem
            seu peso e sinal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setConfigOpen(true)}>
            <Settings2 className="h-4 w-4 mr-2" />
            Configurar formulário
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            Atribuir Score
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 px-4 py-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {/* Barra de filtros */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shrink-0">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <Label className="mb-1.5 block">Projeto</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
              <Input
                className="pl-8"
                placeholder="Buscar projeto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-[280px]">
            <Label className="mb-1.5 block">Responsável</Label>
            <FilterSelect
              options={responsavelOptions}
              value={respFilter}
              onChange={setRespFilter}
              placeholder="Todos"
              searchPlaceholder="Buscar responsável..."
            />
          </div>
          <div className="w-[200px]">
            <Label className="mb-1.5 block">Status</Label>
            <FilterSelect
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Todos"
            />
          </div>
          <div className="w-[200px]">
            <Label className="mb-1.5 block">Score</Label>
            <FilterMultiSelect
              options={scoreRangeOptions}
              value={scoreRanges}
              onChange={setScoreRanges}
              placeholder="Todos"
              searchPlaceholder="Buscar faixa..."
            />
          </div>
          <label className="flex items-center gap-2 h-10 cursor-pointer">
            <Switch checked={sprintEmAndamento} onCheckedChange={setSprintEmAndamento} />
            <span className="text-sm">Sprint em andamento</span>
          </label>
        </div>
      </div>

      {/* Tabela de Score (7.4) — barra de rolagem interna à lista */}
      <div
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-auto flex-1 min-h-0"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
            setVisibleCount((prev) => (prev < filteredScores.length ? prev + 50 : prev));
          }
        }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-card)]">
            <tr className="border-b border-[var(--color-border)] text-left">
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Setor</th>
              {criteriosAtivos.map((c) => (
                <th key={c.id} className="px-3 py-3 font-semibold text-center whitespace-nowrap">
                  {criterioHeader(c.nome)}
                  {c.negativo && (
                    <span className="text-[var(--color-muted-foreground)]"> (−)</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 font-semibold text-center">Score</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {scores.length === 0 ? (
              <tr>
                <td
                  colSpan={criteriosAtivos.length + 5}
                  className="px-4 py-10 text-center text-[var(--color-muted-foreground)]"
                >
                  Nenhum score atribuído ainda. Clique em “Atribuir Score”.
                </td>
              </tr>
            ) : filteredScores.length === 0 ? (
              <tr>
                <td
                  colSpan={criteriosAtivos.length + 5}
                  className="px-4 py-10 text-center text-[var(--color-muted-foreground)]"
                >
                  Nenhum score corresponde aos filtros.
                </td>
              </tr>
            ) : (
              visibleScores.map((score) => {
                const byCriterion: Record<number, number> = {};
                for (const v of score.valores) byCriterion[v.criterion] = v.valor;
                const isExpanded = expanded.has(score.id);
                return (
                  <Fragment key={score.id}>
                    <tr
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/40 cursor-pointer"
                      onClick={() => openEdit(score)}
                    >
                      <td className="px-4 py-3 max-w-[280px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                            title={isExpanded ? 'Recolher histórico' : 'Ver histórico'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(score.id);
                            }}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <span className="font-medium truncate" title={score.card_nome}>
                            {score.card_nome}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {score.setor_solicitante_display ?? setorLabel(score.setor_solicitante)}
                      </td>
                      {criteriosAtivos.map((c) => (
                        <td key={c.id} className="px-3 py-3 text-center">
                          {byCriterion[c.id] ?? '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <Badge className="text-sm font-semibold">{fmtScore(score.score_final)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className="w-[176px] justify-center whitespace-nowrap"
                        >
                          {score.card_status_display}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Excluir score"
                            onClick={(e) => {
                              e.stopPropagation();
                              setScoreToDelete(score);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-[var(--color-destructive)]" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[var(--color-border)] last:border-0">
                        <td colSpan={criteriosAtivos.length + 5} className="p-0">
                          <div className="bg-[var(--color-muted)]/50 pl-12 pr-4 py-3">
                            <ScoreHistoryPanel score={score} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredScores.length > 0 && (
        <div className="text-xs text-[var(--color-muted-foreground)] shrink-0">
          Mostrando {Math.min(visibleCount, filteredScores.length)} de {filteredScores.length} score(s)
          {filteredScores.length !== scores.length && ` (${scores.length} no total)`}
        </div>
      )}

      {formOpen && (
        <ScoreFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          criterios={criteriosAtivos}
          cards={cards}
          cardsLoading={cardsLoading}
          scores={scores}
          existing={editing}
          onSaved={applySavedScore}
        />
      )}

      {configOpen && (
        <CriteriaConfigDialog
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          criterios={criterios}
          onChanged={loadCore}
        />
      )}

      {scoreToDelete && (
        <Dialog
          open
          onOpenChange={(v) => !v && !deleting && setScoreToDelete(null)}
          containerClassName="max-w-md"
        >
          <DialogContent onClose={deleting ? undefined : () => setScoreToDelete(null)}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-[var(--color-destructive)]" />
                Excluir score
              </DialogTitle>
              <DialogDescription>
                Só o <strong className="text-[var(--color-foreground)]">score</strong> será
                apagado. O card{' '}
                <strong className="text-[var(--color-foreground)]">
                  “{scoreToDelete.card_nome}”
                </strong>{' '}
                continua existindo normalmente, apenas <strong>sem a pontuação</strong>.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setScoreToDelete(null)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
                {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Excluir score
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ===========================================================================
// Dialog: Atribuir / Editar Score
// ===========================================================================
function ScoreFormDialog({
  open, onClose, criterios, cards, cardsLoading, scores, existing, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  criterios: ScoreCriterion[];
  cards: PickableCard[];
  cardsLoading: boolean;
  scores: CardScore[];
  existing: CardScore | null;
  onSaved: (saved: CardScore) => void;
}) {
  const [cardId, setCardId] = useState<string>(existing ? String(existing.card) : '');
  const [setor, setSetor] = useState<string>(existing?.setor_solicitante ?? '');
  const [valores, setValores] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    if (existing) for (const v of existing.valores) init[v.criterion] = v.valor;
    return init;
  });
  const [saving, setSaving] = useState(false);

  // Pré-carrega os valores e o setor do score já existente do card selecionado
  // — tanto ao editar (existing) quanto ao selecionar um card já pontuado no
  // modo de criação. Sem isso, reabrir um card pontuado mostrava tudo zerado.
  useEffect(() => {
    const source = existing ?? scores.find((s) => String(s.card) === String(cardId));
    if (source) {
      const init: Record<number, number> = {};
      for (const v of source.valores) init[v.criterion] = v.valor;
      setValores(init);
      setSetor(source.setor_solicitante ?? '');
    } else {
      setValores({});
      setSetor('');
    }
  }, [cardId, existing, scores]);

  // Browser de cards (modo criação)
  const [search, setSearch] = useState('');
  const [sprintFilter, setSprintFilter] = useState('');
  const [respFilter, setRespFilter] = useState('');
  const [projFilter, setProjFilter] = useState('');

  const preview = computeScore(criterios, valores);
  const canSave = cardId !== '' && !saving;

  const selectedCard = useMemo(
    () => cards.find((c) => String(c.id) === String(cardId)) ?? null,
    [cards, cardId],
  );

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cards) {
      if (c.projeto) map.set(String(c.projeto), c.projeto_nome ?? '—');
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  const sprintOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cards) {
      if (c.sprint && c.sprint_nome) map.set(String(c.sprint), c.sprint_nome);
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  const responsavelOptions = useMemo(() => {
    const map = new Map<string, { label: string; role: string }>();
    for (const c of cards) {
      if (c.responsavel && c.responsavel_name) {
        map.set(String(c.responsavel), {
          label: c.responsavel_name,
          role: c.responsavel_role ?? '',
        });
      }
    }
    return Array.from(map, ([value, v]) => ({ value, label: v.label, role: v.role }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (sprintFilter && String(c.sprint ?? '') !== sprintFilter) return false;
      if (respFilter && String(c.responsavel ?? '') !== respFilter) return false;
      if (projFilter && String(c.projeto) !== projFilter) return false;
      if (q && !`${c.nome} ${c.descricao ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, search, sprintFilter, respFilter, projFilter]);

  const toPreview = useCallback((c: PickableCard): KanbanCardPreviewData => ({
    id: String(c.id),
    nome: c.nome,
    prioridade: c.prioridade,
    status: c.status,
    area: c.area,
    area_display: c.area_display,
    tipo: c.tipo,
    tipo_display: c.tipo_display,
    descricao: c.descricao ?? undefined,
    data_fim: c.data_fim,
    responsavel_name: c.responsavel_name ?? undefined,
    responsavel_role: c.responsavel_role ?? undefined,
    script_url: c.script_url,
    score_final: c.score_final,
  }), []);

  // Lista de cards memoizada: só recomputa quando os filtros ou o card
  // selecionado mudam. Assim, clicar numa opção de critério (que altera
  // `valores`) NÃO re-renderiza os ~581 previews — seleção fica instantânea.
  const cardListEl = useMemo(() => {
    if (filtered.length === 0) {
      return (
        <div className="text-center text-sm text-[var(--color-muted-foreground)] py-10">
          Nenhum card encontrado.
        </div>
      );
    }
    return filtered.map((c) => (
      <KanbanCardPreview
        key={c.id}
        card={toPreview(c)}
        onClick={() => setCardId(String(c.id))}
        className={
          'w-[288px]' +
          (String(c.id) === String(cardId)
            ? ' ring-2 ring-inset ring-[var(--color-primary)]'
            : '')
        }
      />
    ));
  }, [filtered, cardId, toPreview]);

  const handleSave = async () => {
    if (!canSave) return;
    try {
      setSaving(true);
      const payload = {
        card: Number(cardId),
        setor_solicitante: setor || null,
        valores: Object.entries(valores).map(([criterion, valor]) => ({
          criterion: Number(criterion),
          valor,
        })),
      };
      const saved = existing
        ? await scoreService.updateScore(existing.id, payload)
        : await scoreService.saveScore(payload);
      onSaved(saved);
      if (existing) {
        onClose();
      } else {
        // Mantém o modal aberto para pontuar o próximo card; limpa a seleção
        // (o efeito zera valores/setor ao mudar o card).
        setCardId('');
      }
    } catch (e) {
      console.error('Erro ao salvar score:', e);
      window.alert('Erro ao salvar o score.');
    } finally {
      setSaving(false);
    }
  };

  const posCrit = criterios.filter((c) => !c.negativo);
  const negCrit = criterios.filter((c) => c.negativo);
  const renderTerm = (c: ScoreCriterion) => (
    <span className="inline-flex flex-col items-center leading-tight">
      <span>
        <span className="text-[var(--color-muted-foreground)]">
          {parseFloat(c.peso).toFixed(2)}·
        </span>
        <span className="font-semibold">{valores[c.id] ?? 0}</span>
      </span>
      <span
        className="text-[10px] text-[var(--color-muted-foreground)] max-w-[90px] truncate"
        title={c.nome}
      >
        {c.nome}
      </span>
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} containerClassName="max-w-7xl">
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{existing ? 'Editar Score' : 'Atribuir Score'}</DialogTitle>
          <DialogDescription>
            {existing
              ? 'Ajuste os valores dos critérios. O Score é recalculado automaticamente.'
              : 'Escolha um card à direita e selecione o valor de cada critério.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 py-2 items-stretch">
          {/* Coluna esquerda: browser de cards (preview idêntico ao do kanban) */}
          <div className="flex flex-col gap-2 min-w-0 min-h-0">
            {existing ? (
              <>
                <Label>Card</Label>
                {selectedCard ? (
                  <KanbanCardPreview card={toPreview(selectedCard)} className="w-[288px]" />
                ) : (
                  <div className="text-sm text-[var(--color-muted-foreground)]">Card #{cardId}</div>
                )}
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  O card não pode ser alterado ao editar um score.
                </p>
              </>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar card..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <FilterSelect
                      options={sprintOptions}
                      value={sprintFilter}
                      onChange={setSprintFilter}
                      placeholder="Sprint"
                      searchPlaceholder="Buscar sprint..."
                    />
                    <FilterSelect
                      options={projectOptions}
                      value={projFilter}
                      onChange={setProjFilter}
                      placeholder="Projeto"
                      searchPlaceholder="Buscar projeto..."
                    />
                  </div>
                  <FilterSelect
                    options={responsavelOptions}
                    value={respFilter}
                    onChange={setRespFilter}
                    placeholder="Responsável"
                    searchPlaceholder="Buscar responsável..."
                  />
                </div>

                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {cardsLoading && cards.length === 0
                    ? 'Carregando cards…'
                    : `${filtered.length} card(s)`}
                </div>
                <div className="flex-1 min-h-0 relative">
                  <div className="absolute inset-0 overflow-y-auto pr-1 space-y-[8px]">
                    {cardsLoading && cards.length === 0 ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
                      </div>
                    ) : (
                      cardListEl
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Coluna direita: formulário */}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="shrink-0 flex items-end gap-4 flex-wrap">
              <div className="w-[260px] max-w-full">
                <Label className="mb-1.5 block">Setor solicitante</Label>
                <FilterSelect
                  options={SETORES_SOLICITANTES}
                  value={setor}
                  onChange={setSetor}
                  placeholder="Selecione o setor"
                />
              </div>
              <div className="flex-1 min-w-[240px]">
                <Label className="mb-1.5 block">Fórmula</Label>
                <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 text-sm">
                  {posCrit.length > 0 && <span>(</span>}
                  {posCrit.map((c, i) => (
                    <Fragment key={c.id}>
                      {i > 0 && <span>+</span>}
                      {renderTerm(c)}
                    </Fragment>
                  ))}
                  {posCrit.length > 0 && <span>)</span>}
                  {negCrit.length > 0 && <span>−</span>}
                  {negCrit.length > 0 && <span>(</span>}
                  {negCrit.map((c, i) => (
                    <Fragment key={c.id}>
                      {i > 0 && <span>+</span>}
                      {renderTerm(c)}
                    </Fragment>
                  ))}
                  {negCrit.length > 0 && <span>)</span>}
                  <span>=</span>
                  <span className="font-bold text-[var(--color-primary)]">
                    {fmtScore(preview)}
                  </span>
                </div>
              </div>
            </div>

            {/* Score final (prévia) — abaixo do setor solicitante */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--color-accent)] px-4 py-3 shrink-0">
              <div className="min-w-0">
                <div className="font-medium">Score final (prévia)</div>
                {selectedCard ? (
                  <div className="text-xs text-[var(--color-muted-foreground)] truncate">
                    {selectedCard.nome}
                  </div>
                ) : !existing ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    ← Selecione um card na lista à esquerda
                  </div>
                ) : null}
              </div>
              <span className="text-3xl font-bold text-[var(--color-primary)] shrink-0 pl-3">
                {fmtScore(preview)}
              </span>
            </div>

            <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: '640px' }}>
              {criterios.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-[var(--color-border)] p-2.5"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-sm">
                      {c.nome}
                      {c.negativo && (
                        <span className="text-[var(--color-muted-foreground)]"> (negativo)</span>
                      )}
                    </span>
                    <span className="text-[11px] text-[var(--color-muted-foreground)]">
                      peso {parseFloat(c.peso).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-stretch gap-1.5">
                    {c.opcoes
                      .slice()
                      .sort((a, b) => a.ordem - b.ordem || a.valor - b.valor)
                      .map((op) => {
                        const active = valores[c.id] === op.valor;
                        return (
                          <button
                            key={`${c.id}-${op.valor}`}
                            type="button"
                            onClick={() =>
                              setValores((prev) => ({ ...prev, [c.id]: op.valor }))
                            }
                            className={
                              'flex-1 min-w-0 truncate text-center whitespace-nowrap text-[11px] px-2 py-1 rounded-full border transition-colors ' +
                              (active
                                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-transparent'
                                : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]')
                            }
                            title={op.descricao}
                          >
                            <span className="font-semibold">{op.valor}</span> · {op.descricao}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Dialog: Configurar formulário (critérios)
// ===========================================================================
/** Linha de critério arrastável (handle = ícone de 6 pontinhos GripVertical). */
function SortableCriterionRow({
  criterion, onEdit, onDelete,
}: {
  criterion: ScoreCriterion;
  onEdit: (c: ScoreCriterion) => void;
  onDelete: (c: ScoreCriterion) => void;
}) {
  const c = criterion;
  const {
    setNodeRef, setActivatorNodeRef, transform, transition, isDragging, attributes, listeners,
  } = useSortable({ id: String(c.id) });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...listeners}
        style={{ touchAction: 'none' }}
        title="Arrastar para reordenar"
        aria-label="Arrastar"
        className="shrink-0 cursor-grab active:cursor-grabbing text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          {c.nome}
          {!c.ativo && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
          {c.negativo && <Badge variant="outline" className="text-[10px]">negativo</Badge>}
        </div>
        <div className="text-xs text-[var(--color-muted-foreground)]">
          peso {parseFloat(c.peso).toFixed(2)} · {c.opcoes.length} opções
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(c)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(c)}>
        <Trash2 className="h-4 w-4 text-[var(--color-destructive)]" />
      </Button>
    </div>
  );
}

function CriteriaConfigDialog({
  open, onClose, criterios, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  criterios: ScoreCriterion[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<ScoreCriterion | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [ordered, setOrdered] = useState<ScoreCriterion[]>(
    () => criterios.slice().sort((a, b) => a.ordem - b.ordem),
  );
  useEffect(() => {
    setOrdered(criterios.slice().sort((a, b) => a.ordem - b.ordem));
  }, [criterios]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ordered.findIndex((c) => String(c.id) === active.id);
    const newIdx = ordered.findIndex((c) => String(c.id) === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const novo = arrayMove(ordered, oldIdx, newIdx);
    setOrdered(novo); // otimista
    try {
      await scoreService.reorderCriterios(novo.map((c) => c.id));
      await onChanged();
    } catch (err) {
      console.error('Erro ao reordenar critérios:', err);
      await onChanged(); // recarrega o estado consistente
    }
  };

  const handleDelete = async (c: ScoreCriterion) => {
    if (!window.confirm(`Remover o critério "${c.nome}"? Os scores já calculados não mudam.`))
      return;
    try {
      await scoreService.deleteCriterio(c.id);
      await onChanged();
    } catch (e) {
      console.error('Erro ao remover critério:', e);
      window.alert('Erro ao remover o critério.');
    }
  };

  if (editing || creatingNew) {
    return (
      <CriterionEditor
        open={open}
        criterion={editing}
        nextOrder={criterios.length + 1}
        onClose={() => {
          setEditing(null);
          setCreatingNew(false);
        }}
        onSaved={async () => {
          setEditing(null);
          setCreatingNew(false);
          await onChanged();
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} containerClassName="max-w-2xl">
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Configurar formulário de Score</DialogTitle>
          <DialogDescription>
            Adicione, edite ou remova critérios. Cada critério tem peso e sinal
            usados na fórmula do Score.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={ordered.map((c) => String(c.id))}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {ordered.map((c) => (
                  <SortableCriterionRow
                    key={c.id}
                    criterion={c}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setCreatingNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar critério
          </Button>
          <Button onClick={onClose}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editor de um critério
// ---------------------------------------------------------------------------
type EditableOption = { id: string; valor: string; descricao: string };

/** Linha de opção arrastável (handle de 6 pontinhos via dnd-kit). */
function SortableOption({
  id, valor, descricao, onValor, onDescricao, onRemove,
}: {
  id: string;
  valor: string;
  descricao: string;
  onValor: (v: string) => void;
  onDescricao: (v: string) => void;
  onRemove: () => void;
}) {
  const {
    setNodeRef, setActivatorNodeRef, transform, transition, isDragging, attributes, listeners,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-2">
      <DragHandle ref={setActivatorNodeRef} alwaysVisible {...listeners} />
      <Input
        type="number"
        className="w-20"
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        placeholder="Valor"
      />
      <Input
        className="flex-1"
        value={descricao}
        onChange={(e) => onDescricao(e.target.value)}
        placeholder="Descrição"
      />
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CriterionEditor({
  open, criterion, nextOrder, onClose, onSaved,
}: {
  open: boolean;
  criterion: ScoreCriterion | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const idRef = useRef(0);
  const novaOpcao = (valor: string, descricao: string): EditableOption => ({
    id: `op-${idRef.current++}`,
    valor,
    descricao,
  });

  const [nome, setNome] = useState(criterion?.nome ?? '');
  const [peso, setPeso] = useState(criterion ? String(criterion.peso) : '0.10');
  const [negativo, setNegativo] = useState(criterion?.negativo ?? false);
  const [ativo, setAtivo] = useState(criterion?.ativo ?? true);
  const [opcoes, setOpcoes] = useState<EditableOption[]>(() =>
    criterion
      ? criterion.opcoes
          .slice()
          .sort((a, b) => a.ordem - b.ordem || a.valor - b.valor)
          .map((o) => novaOpcao(String(o.valor), o.descricao))
      : [novaOpcao('0', '')],
  );
  const [saving, setSaving] = useState(false);

  const addOpcao = () => setOpcoes((prev) => [...prev, novaOpcao('', '')]);
  const removeOpcao = (id: string) =>
    setOpcoes((prev) => prev.filter((o) => o.id !== id));
  const setOpcao = (id: string, patch: Partial<EditableOption>) =>
    setOpcoes((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOpcoes((prev) => {
      const oldIdx = prev.findIndex((o) => o.id === active.id);
      const newIdx = prev.findIndex((o) => o.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const canSave = nome.trim() !== '' && !Number.isNaN(parseFloat(peso)) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    const payload: ScoreCriterionInput = {
      nome: nome.trim(),
      peso: parseFloat(peso),
      negativo,
      ativo,
      ordem: criterion?.ordem ?? nextOrder,
      opcoes: opcoes
        .filter((o) => o.valor !== '' && o.descricao.trim() !== '')
        .map((o, idx) => ({
          valor: Number(o.valor),
          descricao: o.descricao.trim(),
          ordem: idx,
        })),
    };
    try {
      setSaving(true);
      if (criterion) {
        await scoreService.updateCriterio(criterion.id, payload);
      } else {
        await scoreService.createCriterio(payload);
      }
      onSaved();
    } catch (e) {
      console.error('Erro ao salvar critério:', e);
      window.alert('Erro ao salvar o critério.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} containerClassName="max-w-xl">
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{criterion ? 'Editar critério' : 'Novo critério'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-1.5 block">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Redução de esforço" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Peso</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={negativo} onCheckedChange={setNegativo} />
                <span className="text-sm">Negativo</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={ativo} onCheckedChange={setAtivo} />
                <span className="text-sm">Ativo</span>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Opções (valor · descrição)</Label>
              <Button variant="ghost" size="sm" onClick={addOpcao}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={opcoes.map((o) => o.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {opcoes.map((o) => (
                      <SortableOption
                        key={o.id}
                        id={o.id}
                        valor={o.valor}
                        descricao={o.descricao}
                        onValor={(v) => setOpcao(o.id, { valor: v })}
                        onDescricao={(v) => setOpcao(o.id, { descricao: v })}
                        onRemove={() => removeOpcao(o.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Dialog: Histórico do Score
// ===========================================================================
function ScoreHistoryPanel({ score }: { score: CardScore }) {
  const historico: ScoreHistoryEntry[] = score.historico ?? [];

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return iso;
    }
  };

  if (historico.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)] py-1">
        Sem registros de histórico.
      </p>
    );
  }

  // A lista vem do mais novo para o mais antigo; o estado anterior de uma entrada
  // é a próxima da lista (mais antiga). As mudanças são o diff entre elas.
  const buildChanges = (
    entry: ScoreHistoryEntry,
    older: ScoreHistoryEntry | undefined,
  ): string[] => {
    if (entry.acao === 'excluido') return [];
    const changes: string[] = [];

    // Setor
    const oldSetor = older?.setor_solicitante ?? null;
    if (!older) {
      if (entry.setor_solicitante) changes.push(`Setor: ${setorLabel(entry.setor_solicitante)}`);
    } else if (oldSetor !== entry.setor_solicitante) {
      changes.push(
        `Setor: ${oldSetor ? setorLabel(oldSetor) : '—'} → ` +
          `${entry.setor_solicitante ? setorLabel(entry.setor_solicitante) : '—'}`,
      );
    }

    // Critérios (valor anterior → novo valor)
    const oldMap = new Map((older?.snapshot ?? []).map((s) => [s.criterion_id, s]));
    for (const s of entry.snapshot) {
      const prev = oldMap.get(s.criterion_id);
      if (!older) {
        changes.push(`${s.criterion_nome}: ${s.valor}`);
      } else if (!prev) {
        changes.push(`${s.criterion_nome}: — → ${s.valor}`);
      } else if (prev.valor !== s.valor) {
        changes.push(`${s.criterion_nome}: ${prev.valor} → ${s.valor}`);
      }
    }
    if (older) {
      const newIds = new Set(entry.snapshot.map((s) => s.criterion_id));
      for (const s of older.snapshot) {
        if (!newIds.has(s.criterion_id)) changes.push(`${s.criterion_nome}: removido`);
      }
    }

    return changes;
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide">
        Histórico de alterações
      </div>
      {historico.map((h, i) => {
        const older = historico[i + 1];
        const changes = buildChanges(h, older);
        const scoreChanged =
          h.acao === 'editado' && older != null && older.score_final !== h.score_final;
        return (
          <div
            key={h.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3"
          >
            <div className="flex items-center justify-between">
              <Badge variant="outline">{h.acao_display}</Badge>
              <span className="text-xs text-[var(--color-muted-foreground)]">{fmtDate(h.data)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-[var(--color-muted-foreground)]">{h.usuario_nome ?? 'Sistema'}</span>
              <span className="font-semibold">
                Score{' '}
                {scoreChanged
                  ? `${fmtScore(older!.score_final)} → ${fmtScore(h.score_final)}`
                  : fmtScore(h.score_final)}
              </span>
            </div>
            {changes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm">
                {changes.map((c, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-[var(--color-muted-foreground)]">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            {h.acao === 'editado' && changes.length === 0 && (
              <div className="mt-2 text-sm text-[var(--color-muted-foreground)]">
                Sem mudanças nos valores dos critérios.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
