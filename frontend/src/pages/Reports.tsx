import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Zap, FolderKanban, Layers, User as UserIcon, AlertTriangle,
  TrendingUp, ListChecks, FileText, Search, History,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReportConfigPanel from '@/components/reports/ReportConfigPanel';
import ReportPreviewDialog from '@/components/reports/ReportPreviewDialog';
import { reportService, type ReportJob, type ReportType } from '@/services/reportService';
import type { ReportFilterKey } from '@/components/reports/ReportConfigPanel';

type Category = 'Métricas' | 'Operacional';

export type ReportDef = {
  id: ReportType;
  title: string;
  description: string;
  category: Category;
  filters: ReportFilterKey[];
  requiredFilters?: ReportFilterKey[];
  /** Grupos de filtros mutuamente exclusivos. Cada sub-array é um grupo;
   * o painel renderiza um seletor "tabs" e mostra só o filtro ativo do
   * grupo. Útil pra "Período OU Sprint, não os dois". */
  exclusiveFilters?: ReportFilterKey[][];
};

/** Ordem dentro de "Métricas": globais primeiro, depois KPIs executivos,
 *  gargalos, e por último o relatório individual. */
const REPORT_DEFS: ReportDef[] = [
  {
    id: 'metrics',
    title: 'Métricas Globais',
    description: 'KPIs, Tabelas de entrega, Rendimento, Tempo de desenvolvimento e operação geral consolidados.',
    category: 'Métricas',
    filters: ['sprints_multi', 'period'],
    // Ordem importa: o PRIMEIRO é o default selecionado no dropdown "Filtros".
    exclusiveFilters: [['sprints_multi', 'period']],
  },
  {
    id: 'executive',
    title: 'Executivo (KPIs)',
    description: 'Visão de uma página com os principais indicadores. Ideal para apresentações.',
    category: 'Métricas',
    filters: ['period'],
  },
  {
    id: 'bottlenecks',
    title: 'Atrasos & Gargalos',
    description: 'Cards que estouraram prazo + onde a equipe demora mais.',
    category: 'Métricas',
    filters: ['period'],
  },
  {
    id: 'user',
    title: 'Por Usuário',
    description: 'Performance individual: cards entregues, on-time %, cycle time, distribuição por área.',
    category: 'Métricas',
    filters: ['user', 'period'],
    requiredFilters: ['user'],
  },
  {
    id: 'cards',
    title: 'Cards',
    description: 'Todos os cards filtráveis por sprint, projeto, status, área, tipo, prioridade e responsável.',
    category: 'Operacional',
    filters: ['sprints_multi', 'period', 'project', 'status', 'area', 'tipo', 'prioridade', 'responsavel'],
    // Sprints OU Período (mutex), demais filtros independentes.
    exclusiveFilters: [['sprints_multi', 'period']],
  },
  {
    id: 'sprint',
    title: 'Sprint Detalhada',
    description: 'Projetos e todos os cards de uma sprint, com KPIs e status.',
    category: 'Operacional',
    filters: ['sprint'],
    requiredFilters: ['sprint'],
  },
  {
    id: 'projects',
    title: 'Projetos',
    description: 'Cards agrupados por projeto. Selecione um projeto específico ou exporte todos.',
    category: 'Operacional',
    filters: ['projects_multi'],
  },
  {
    id: 'backlog',
    title: 'Backlog Atual',
    description: 'Tudo que ainda não foi entregue, agrupado por projeto/sprint.',
    category: 'Operacional',
    filters: ['project'],
  },
];

const ICONS: Record<ReportType, LucideIcon> = {
  metrics: BarChart3,
  sprint: Zap,
  cards: Layers,
  projects: FolderKanban,
  user: UserIcon,
  bottlenecks: AlertTriangle,
  executive: TrendingUp,
  backlog: ListChecks,
};

const CATEGORY_ORDER: Category[] = ['Operacional', 'Métricas'];

const CATEGORY_META: Record<Category, { dot: string; label: string }> = {
  'Operacional': { dot: '#a47fc4', label: 'Operacional' },
  'Métricas':    { dot: '#8fd0d7', label: 'Métricas' },
};

export default function Reports() {
  const [selectedId, setSelectedId] = useState<ReportType>('cards');
  const [search, setSearch] = useState('');
  /** Job a ser RETOMADO (se usuário recarregou com job ativo). */
  const [resumeJobId, setResumeJobId] = useState<number | null>(null);
  /** Tipo do job retomado — usado para casar com o painel certo. */
  const [resumeJobType, setResumeJobType] = useState<ReportType | null>(null);
  /** Job concluído (preview do PDF). */
  const [completedJob, setCompletedJob] = useState<ReportJob | null>(null);
  /** Marca que o usuário JÁ trocou de relatório manualmente — bloqueia
   * o auto-select tardio do retomar, que sobrescreveria a escolha dele. */
  const userPickedRef = useRef(false);

  const pickReport = useCallback((id: ReportType) => {
    userPickedRef.current = true;
    setSelectedId(id);
  }, []);

  // Retoma job ativo ao montar (caso usuário tenha recarregado).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const running = await reportService.list('running');
        if (cancelled) return;
        if (running.length > 0) {
          setResumeJobId(running[0].id);
          setResumeJobType(running[0].type);
          if (!userPickedRef.current) setSelectedId(running[0].type);
          return;
        }
        const pending = await reportService.list('pending');
        if (cancelled) return;
        if (pending.length > 0) {
          setResumeJobId(pending[0].id);
          setResumeJobType(pending[0].type);
          if (!userPickedRef.current) setSelectedId(pending[0].type);
        }
      } catch {
        // sem permissão / sem rede — segue sem retomar.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleJobCompleted = useCallback((job: ReportJob) => {
    setResumeJobId(null);
    setResumeJobType(null);
    if (job.status !== 'completed') return;
    if (job.format === 'pdf') {
      setCompletedJob(job);
    } else {
      // DOCX/XLSX/CSV: baixa via axios (com Authorization) — `window.open`
      // perderia o header de auth e cairia em 401.
      void reportService.downloadFile(job.id).catch((err) => {
        console.error('Falha ao baixar relatório:', err);
      });
    }
  }, []);

  const selected = useMemo(
    () => REPORT_DEFS.find((r) => r.id === selectedId) ?? REPORT_DEFS[0],
    [selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return REPORT_DEFS;
    return REPORT_DEFS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const out: Record<Category, ReportDef[]> = {
      'Operacional': [], 'Métricas': [],
    };
    for (const r of filtered) out[r.category].push(r);
    return out;
  }, [filtered]);

  return (
    /* Altura travada na viewport (descontando header 64px + padding 32+32
       do <main>) pra que as colunas internas façam o scroll, não a página. */
    <div
      className="flex min-h-0 flex-col gap-[20px]"
      style={{ height: 'calc(100vh - 128px)' }}
    >
      {/* Page header */}
      <div className="flex items-start justify-between gap-[16px]">
        <div className="flex items-start gap-[12px]">
          <div
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[10px] border"
            style={{
              background: 'linear-gradient(135deg, rgba(117,76,153,0.35), rgba(143,208,215,0.25))',
              borderColor: 'rgba(143,208,215,0.18)',
              color: '#c4a3e0',
            }}
          >
            <FileText className="h-[20px] w-[20px]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
              Relatórios
            </h1>
            <p className="mt-1 max-w-[920px] text-sm text-[var(--color-muted-foreground)]">
              Selecione um relatório, configure os filtros e gere em PDF, DOCX, XLSX ou CSV.
              Um relatório por vez.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-[8px]">
          <button
            type="button"
            disabled
            title="Em breve"
            className="flex items-center gap-[6px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] px-[14px] py-[8px] text-xs font-semibold text-[var(--color-muted-foreground)] opacity-60"
          >
            <History className="h-[13px] w-[13px]" /> Histórico
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[18px] md:grid-cols-[300px_1fr]">
        {/* Left: list */}
        <aside className="flex min-h-0 flex-col gap-[12px] rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[14px]">
          <div className="flex items-center gap-[8px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-input)] px-[12px] py-[9px]">
            <Search className="h-[14px] w-[14px] text-[var(--color-muted-foreground)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar relatórios…"
              className="flex-1 bg-transparent text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto pr-[2px]">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) return null;
              const meta = CATEGORY_META[cat];
              return (
                <div key={cat}>
                  <div className="mb-[6px] flex items-center gap-[8px] border-b border-[var(--color-border)] px-[6px] pb-[8px]">
                    <span
                      className="h-[6px] w-[6px] rounded-full"
                      style={{ background: meta.dot }}
                    />
                    <span className="text-[10.5px] font-bold uppercase tracking-[1px] text-[var(--color-muted-foreground)]">
                      {meta.label}
                    </span>
                    <span className="ml-auto rounded-full border border-[var(--color-border)] bg-[var(--color-input)] px-[6px] text-[10px] text-[var(--color-muted-foreground)]">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[2px]">
                    {items.map((r) => {
                      const active = r.id === selected.id;
                      const Icon = ICONS[r.id];
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => pickReport(r.id)}
                          className={cn(
                            'relative flex items-center gap-[10px] rounded-[8px] border px-[10px] py-[8px] text-left transition-colors',
                            active
                              ? 'border-[var(--color-primary)]/55 bg-[var(--color-primary)]/15'
                              : 'border-transparent hover:bg-[var(--color-accent)]',
                          )}
                        >
                          {active && (
                            <span
                              aria-hidden
                              className="absolute -left-px top-[6px] bottom-[6px] w-[3px] rounded-[2px]"
                              style={{ background: '#c4a3e0' }}
                            />
                          )}
                          <span
                            className={cn(
                              'flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[6px]',
                              active
                                ? 'bg-[#8fd0d7]/15 text-[#8fd0d7]'
                                : 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]',
                            )}
                          >
                            <Icon className="h-[12px] w-[12px]" />
                          </span>
                          <span
                            className={cn(
                              'flex-1 truncate text-sm',
                              active
                                ? 'font-bold text-[var(--color-foreground)]'
                                : 'font-medium text-[var(--color-muted-foreground)]',
                            )}
                          >
                            {r.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-[8px] py-[24px] text-center text-xs text-[var(--color-muted-foreground)]">
                Nenhum relatório encontrado para "{search}".
              </div>
            )}
          </div>
        </aside>

        {/* Right: config panel — `key` força reset ao trocar relatório */}
        <ReportConfigPanel
          key={selected.id}
          report={selected}
          icon={ICONS[selected.id]}
          categoryColor={CATEGORY_META[selected.category].dot}
          categoryLabel={CATEGORY_META[selected.category].label}
          initialJobId={resumeJobType === selected.id ? resumeJobId : null}
          onCompleted={handleJobCompleted}
          onResumeConsumed={() => { setResumeJobId(null); setResumeJobType(null); }}
        />
      </div>

      <ReportPreviewDialog
        open={completedJob != null}
        job={completedJob}
        onClose={() => setCompletedJob(null)}
      />
    </div>
  );
}
