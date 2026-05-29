import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  AlertTriangle, Download, Eye, FileText, Filter, Info, Loader2,
  RefreshCw, Settings as SettingsIcon, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { FilterSelect } from '@/components/ui/filter-select';
import { FilterMultiSelect } from '@/components/ui/filter-multi-select';
import { cn } from '@/lib/utils';
import { readIncludeHeader, writeIncludeHeader } from '@/lib/reportSettings';
import {
  reportService,
  type ReportFormat, type ReportJob,
} from '@/services/reportService';
import ReportTablePreviewDialog from '@/components/reports/ReportTablePreviewDialog';
import { sprintService, type Sprint } from '@/services/sprintService';
import { projectService, type Project } from '@/services/projectService';
import { userService, type User } from '@/services/userService';
import {
  CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES,
} from '@/services/cardService';
import type { ReportDef } from '@/pages/Reports';

export type ReportFilterKey =
  | 'sprint'
  | 'sprints_multi'
  | 'project'
  | 'projects_multi'
  | 'status'
  | 'area'
  | 'tipo'
  | 'prioridade'
  | 'responsavel'
  | 'user'
  | 'period';

export type ReportConfigPanelProps = {
  report: ReportDef;
  icon: LucideIcon;
  categoryColor: string;
  categoryLabel: string;
  /** Job ativo a ser RETOMADO (caso usuário tenha recarregado a página). */
  initialJobId: number | null;
  /** Avisa o caller que o initialJobId foi adotado. */
  onResumeConsumed: () => void;
  /** Job concluído COM SUCESSO. Failure fica visível inline no painel
   * (o caller não é notificado pra evitar fluxo duplicado de erro). */
  onCompleted: (job: ReportJob) => void;
};

const FORMATS: { value: ReportFormat; label: string; descr: string }[] = [
  { value: 'pdf',  label: 'PDF',  descr: 'Estilizado, igual ao site' },
  { value: 'docx', label: 'DOCX', descr: 'Word, editável' },
  { value: 'xlsx', label: 'XLSX', descr: 'Excel, com filtros' },
  { value: 'csv',  label: 'CSV',  descr: 'Texto (Excel pt-BR)' },
];

const POLL_INTERVAL_MS = 1500;

/**
 * Painel inline (split-view) que substitui o `ReportConfigDialog`.
 * Mesmo lifecycle de job (create + polling + cancel + retomar via 409),
 * só que sem modal — fica permanentemente visível ao lado da lista.
 */
export default function ReportConfigPanel({
  report,
  icon: Icon,
  categoryColor,
  categoryLabel,
  initialJobId,
  onResumeConsumed,
  onCompleted,
}: ReportConfigPanelProps) {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<ReportJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  // Dropdown data
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Adota job inicial (retomada após reload). Só consome o "token" de retomada
  // se o GET resolveu e o tipo bateu — assim, se o usuário trocar de relatório
  // antes do GET terminar, o pai mantém o resumeJobId e o painel correto
  // ainda pode adotar quando montar.
  useEffect(() => {
    if (!initialJobId) return;
    let cancelled = false;
    void reportService
      .getById(initialJobId)
      .then((job) => {
        if (cancelled) return;
        if (job.type === report.id) {
          setActiveJob(job);
          onResumeConsumed();
        }
        // Mismatch (defesa): pai já filtra por resumeJobType, então
        // só chegaria aqui em race. Não consome — pai redireciona.
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  // Carrega listas relevantes pro relatório atual
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tasks: Array<Promise<void>> = [];
      if (report.filters.some((f) => f === 'sprint' || f === 'sprints_multi')) {
        tasks.push(sprintService.getAll().then((s) => { if (!cancelled) setSprints(s); }));
      }
      if (report.filters.some((f) => f === 'project' || f === 'projects_multi')) {
        tasks.push(projectService.getAll().then((p) => {
          if (!cancelled) setProjects(p.filter((pr) => !pr.is_system && !pr.arquivado));
        }));
      }
      if (report.filters.some((f) => f === 'responsavel' || f === 'user')) {
        tasks.push(userService.getAll().then((u) => { if (!cancelled) setUsers(u); }));
      }
      await Promise.allSettled(tasks);
    })();
    return () => { cancelled = true; };
  }, [report.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Lê preferência de include_header sempre que muda o formato
  useEffect(() => {
    if (format === 'xlsx' || format === 'csv') {
      setIncludeHeader(readIncludeHeader(format));
    } else {
      setIncludeHeader(true);
    }
  }, [format]);

  // Polling — deps narrowed para id+status pra não recriar o timer a cada
  // tick (cada setActiveJob mudaria a referência do objeto inteiro).
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  useEffect(() => {
    if (!activeJobId || activeJobStatus === 'completed' || activeJobStatus === 'failed') {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await reportService.getById(activeJobId);
        if (cancelled) return;
        setActiveJob(fresh);
        if (fresh.status === 'completed') {
          onCompleted(fresh);
          return;
        }
        if (fresh.status === 'failed') {
          // Erro fica visível inline (bloco de erro mais abaixo).
          return;
        }
      } catch {
        // erro transitório — reagenda
      }
      if (!cancelled) {
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [activeJobId, activeJobStatus, onCompleted]);

  const isGenerating =
    !!activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed';
  const formControlsDisabled = isGenerating || submitting;

  const setFilter = (key: string, value: string | string[]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    for (const required of report.requiredFilters ?? []) {
      if (required === 'period') {
        // `period` mora em DUAS chaves; basta exigir start (end é opcional).
        const start = filters['period_start'];
        if (!start || (typeof start === 'string' && start.trim() === '')) {
          return `O filtro "${filterLabel(required)}" é obrigatório (data inicial).`;
        }
        continue;
      }
      const key = filterKey(required);
      const val = filters[key];
      if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) {
        return `O filtro "${filterLabel(required)}" é obrigatório.`;
      }
    }
    // Coerência de período: se ambos preenchidos, start <= end.
    const ps = typeof filters['period_start'] === 'string' ? (filters['period_start'] as string) : '';
    const pe = typeof filters['period_end'] === 'string' ? (filters['period_end'] as string) : '';
    if (ps && pe && ps > pe) {
      return 'Período inválido: data inicial é posterior à data final.';
    }
    return null;
  };

  /** `formatOverride` permite o botão "Pré-visualizar" gerar em PDF sem
   * mexer no `format` selecionado pelo usuário (que pode estar em XLSX). */
  const handleSubmit = async (formatOverride?: ReportFormat) => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSubmitting(true);
    const effectiveFormat = formatOverride ?? format;
    try {
      if (effectiveFormat === 'xlsx' || effectiveFormat === 'csv') {
        writeIncludeHeader(effectiveFormat, includeHeader);
      }
      const job = await reportService.create({
        type: report.id,
        format: effectiveFormat,
        filters: serializeFilters(filters),
        include_header: includeHeader,
      });
      setActiveJob(job);
      if (job.status === 'completed') onCompleted(job);
    } catch (e: unknown) {
      if (isAxiosError(e) && e.response?.status === 409) {
        const data = e.response.data as { existing_id?: unknown } | undefined;
        const existingId = data?.existing_id;
        if (typeof existingId === 'number' && Number.isFinite(existingId)) {
          try {
            const adopted = await reportService.getById(existingId);
            setActiveJob(adopted);
            return;
          } catch { /* fallthrough */ }
        }
      }
      const msg = e instanceof Error ? e.message : 'Falha ao iniciar a geração.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Preview tabular (XLSX/CSV) — paginado ──────────────────────────────
  // Dialog gerencia sua própria paginação via callback `fetchPage`. Painel
  // só decide ABRIR (com formato) e fornece o callback bound nos filtros.
  const [tablePreview, setTablePreview] = useState<{
    open: boolean;
    format: 'xlsx' | 'csv';
    // Snapshot dos filtros no momento da abertura — congela o que o
    // backend usa em TODAS as páginas, mesmo se o user mexer enquanto
    // o modal está aberto.
    filtersSnapshot: Record<string, unknown>;
  }>({ open: false, format: 'xlsx', filtersSnapshot: {} });

  const handlePreviewTable = (fmt: 'xlsx' | 'csv') => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setTablePreview({
      open: true,
      format: fmt,
      filtersSnapshot: serializeFilters(filters),
    });
  };

  const fetchPreviewPage = useCallback(
    (offset: number, limit: number) =>
      reportService.previewTable({
        type: report.id,
        filters: tablePreview.filtersSnapshot,
        offset,
        limit,
      }),
    [report.id, tablePreview.filtersSnapshot],
  );

  const handleCancelJob = async () => {
    if (!activeJob) return;
    try { await reportService.cancel(activeJob.id); }
    finally {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
      setActiveJob(null);
    }
  };

  // Pré-visualizar = ao gerar com formato PDF, o onCompleted abre o preview.
  const previewDisabled = formControlsDisabled;

  // ── Mutual exclusion (ex.: "Período OU Sprints") ───────────────────────
  // Para cada grupo de filtros mutuamente exclusivos, mantém qual deles está
  // ativo. Default: primeiro membro do grupo. Trocar de aba LIMPA o estado
  // do outro filtro pra evitar enviar campos incompatíveis ao backend.
  const exclusiveGroups = useMemo(
    () => report.exclusiveFilters ?? [],
    [report],
  );

  const [exclusiveActive, setExclusiveActive] = useState<Record<number, ReportFilterKey>>(
    () => Object.fromEntries(exclusiveGroups.map((g, i) => [i, g[0]])),
  );
  // Se trocar de relatório (key remounta o componente), state já reseta.

  /** Map filterKey → index do grupo exclusivo a que pertence (ou -1). */
  const exclusiveIndexByFilter = useMemo(() => {
    const map = new Map<ReportFilterKey, number>();
    exclusiveGroups.forEach((g, i) => g.forEach((f) => map.set(f, i)));
    return map;
  }, [exclusiveGroups]);

  const setExclusiveTab = (groupIdx: number, picked: ReportFilterKey) => {
    setExclusiveActive((prev) => {
      if (prev[groupIdx] === picked) return prev;
      // Limpa estado dos OUTROS filtros do mesmo grupo.
      const group = exclusiveGroups[groupIdx];
      setFilters((prevF) => {
        const next = { ...prevF };
        for (const f of group) {
          if (f === picked) continue;
          if (f === 'period') {
            delete next['period_start'];
            delete next['period_end'];
            delete next['period_date_type'];
          } else {
            delete next[filterKey(f)];
          }
        }
        return next;
      });
      return { ...prev, [groupIdx]: picked };
    });
  };

  /** Filtros do grid: somente os que NÃO pertencem a grupo exclusivo
   *  (os exclusivos são renderizados em uma row própria com o dropdown
   *  "Filtros" à esquerda). */
  const filtersToRender = useMemo(
    () => report.filters.filter((f) => exclusiveIndexByFilter.get(f) === undefined),
    [report.filters, exclusiveIndexByFilter],
  );

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)]">
      {/* Header */}
      <header className="flex items-start gap-[14px] border-b border-[var(--color-border)] p-[22px]">
        <div
          className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[10px] border"
          style={{
            background: 'rgba(117,76,153,0.22)',
            borderColor: 'rgba(117,76,153,0.32)',
            color: '#c4a3e0',
          }}
        >
          <Icon className="h-[22px] w-[22px]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[8px] flex-wrap">
            <h2 className="text-xl font-bold text-[var(--color-foreground)]">{report.title}</h2>
            <span
              className="rounded-full border px-[8px] py-[2px] text-[10.5px] font-semibold tracking-[0.2px]"
              style={{
                background: `${categoryColor}1f`,
                borderColor: `${categoryColor}44`,
                color: categoryColor,
              }}
            >
              {categoryLabel}
            </span>
          </div>
          <p className="mt-[5px] text-sm leading-[1.5] text-[var(--color-muted-foreground)]">
            {report.description}
          </p>
        </div>
      </header>

      {/* Body — scrollable se passar */}
      <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[22px]">
        {/* Filtros */}
        <section>
          <div className="mb-[12px] flex items-center justify-between">
            <h3 className="flex items-center gap-[6px] text-xs font-bold uppercase tracking-[0.5px] text-[var(--color-foreground)]">
              <Filter className="h-[13px] w-[13px] text-[var(--color-primary)]" />
              Filtros
            </h3>
            {(filtersToRender.length > 0 || exclusiveGroups.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  // Restaura tudo aos defaults: filtros, formato, header, erro,
                  // e a aba de cada grupo exclusivo volta pro primeiro item.
                  setFilters({});
                  setFormat('pdf');
                  setIncludeHeader(true);
                  setError(null);
                  setExclusiveActive(
                    Object.fromEntries(exclusiveGroups.map((g, i) => [i, g[0]])),
                  );
                }}
                disabled={formControlsDisabled}
                className="text-[11.5px] font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-40"
              >
                Restaurar padrões
              </button>
            )}
          </div>

          {/* Para cada grupo mutuamente exclusivo: row com dropdown "Filtros"
              à esquerda e o controle do filtro ativo à direita. Trocar o
              dropdown limpa o estado do filtro anterior. */}
          {exclusiveGroups.length > 0 && (
            <div className="mb-[14px] flex flex-col gap-[12px]">
              {exclusiveGroups.map((group, idx) => {
                const active = exclusiveActive[idx];
                return (
                  <div
                    key={idx}
                    className="grid gap-[10px] sm:grid-cols-[200px_1fr]"
                  >
                    <div className="space-y-[6px]">
                      <Label className="text-[10.5px] font-bold uppercase tracking-[1px] text-[var(--color-muted-foreground)]">
                        Filtros
                      </Label>
                      <div className={formControlsDisabled ? 'pointer-events-none opacity-60' : ''}>
                        <FilterSelect
                          clearable={false}
                          placeholder="Selecione..."
                          options={group.map((f) => ({
                            value: f,
                            label: filterLabel(f),
                          }))}
                          value={active}
                          onChange={(v) => setExclusiveTab(idx, v as ReportFilterKey)}
                        />
                      </div>
                    </div>
                    <div className="space-y-[6px]">
                      <Label className="text-[10.5px] font-bold uppercase tracking-[1px] text-[var(--color-muted-foreground)]">
                        {filterLabel(active)}
                        {report.requiredFilters?.includes(active) ? ' *' : ''}
                      </Label>
                      <div className={formControlsDisabled ? 'pointer-events-none opacity-60' : ''}>
                        {renderFilter(active, filters, setFilter, { sprints, projects, users })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filtersToRender.length === 0 && exclusiveGroups.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[var(--color-border)] p-[12px] text-xs text-[var(--color-muted-foreground)]">
              Este relatório não tem filtros configuráveis.
            </div>
          ) : filtersToRender.length === 0 ? null : (
            <div
              className={cn(
                'grid gap-[14px]',
                filtersToRender.length === 1 ? 'grid-cols-1'
                  : filtersToRender.length === 2 ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
              )}
            >
              {filtersToRender.map((f) => (
                <div key={f} className="space-y-[6px]">
                  <Label className="text-[10.5px] font-bold uppercase tracking-[1px] text-[var(--color-muted-foreground)]">
                    {filterLabel(f)}
                    {report.requiredFilters?.includes(f) ? ' *' : ''}
                  </Label>
                  <div className={formControlsDisabled ? 'pointer-events-none opacity-60' : ''}>
                    {renderFilter(f, filters, setFilter, { sprints, projects, users })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Formato */}
        <section>
          <h3 className="mb-[12px] flex items-center gap-[6px] text-xs font-bold uppercase tracking-[0.5px] text-[var(--color-foreground)]">
            <FileText className="h-[13px] w-[13px] text-[var(--color-primary)]" />
            Formato de saída
          </h3>
          <div
            className={cn(
              'flex flex-wrap gap-[8px]',
              formControlsDisabled && 'pointer-events-none opacity-60',
            )}
          >
            {FORMATS.map((opt) => {
              const active = format === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormat(opt.value)}
                  className={cn(
                    'flex min-w-[140px] flex-col items-start gap-[2px] rounded-[10px] border px-[14px] py-[10px] text-left transition-colors',
                    active
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-foreground)]'
                      : 'border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50',
                  )}
                >
                  <span className="flex items-center gap-[8px] text-sm font-bold">
                    <FileText className="h-[14px] w-[14px]" /> {opt.label}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">{opt.descr}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Opções */}
        {(format === 'xlsx' || format === 'csv') && (
          <section>
            <h3 className="mb-[12px] flex items-center gap-[6px] text-xs font-bold uppercase tracking-[0.5px] text-[var(--color-foreground)]">
              <SettingsIcon className="h-[13px] w-[13px] text-[var(--color-primary)]" />
              Opções
            </h3>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-[10px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-input)] p-[12px]',
                formControlsDisabled && 'pointer-events-none opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={includeHeader}
                onChange={(e) => setIncludeHeader(e.target.checked)}
                className="mt-[2px] h-[14px] w-[14px] accent-[var(--color-primary)]"
              />
              <div>
                <div className="text-sm font-semibold text-[var(--color-foreground)]">
                  Incluir linha de cabeçalho das colunas
                </div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Quando marcado, a primeira linha terá os nomes das colunas (Nome, Status, …).
                  Sua preferência é lembrada no navegador.
                </div>
              </div>
            </label>
          </section>
        )}

        {/* Erros */}
        {error && (
          <div className="flex items-start gap-[8px] rounded-[8px] border border-red-300 bg-red-50 p-[10px] text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {activeJob?.status === 'failed' && (
          <div className="flex items-start gap-[8px] rounded-[8px] border border-red-300 bg-red-50 p-[10px] text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" />
            <div>
              <div className="font-semibold">Falha ao gerar relatório</div>
              <div className="text-xs">
                {activeJob.error?.split('\n')[0] || 'Tente novamente.'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer / action bar */}
      <footer className="flex flex-col gap-[10px] border-t border-[var(--color-border)] p-[18px]">
        {/* Progresso */}
        {isGenerating && activeJob && (
          <div className="space-y-[4px]">
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
              <div
                className="h-full transition-all"
                style={{
                  width: `${activeJob.progress}%`,
                  background: 'linear-gradient(90deg, #754c99, #8fd0d7)',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)]">
              <span className="truncate">
                <Loader2 className="mr-[6px] inline h-[11px] w-[11px] animate-spin" />
                {activeJob.progress_message || 'Gerando…'}
              </span>
              <span className="ml-[8px] shrink-0 font-semibold">{activeJob.progress}%</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-[10px]">
          <div className="flex flex-1 items-center gap-[6px] text-xs text-[var(--color-muted-foreground)]">
            <Info className="h-[12px] w-[12px] shrink-0" />
            <span>
              {format === 'pdf'
                ? 'PDF abre em pré-visualização. DOCX/XLSX/CSV baixam direto.'
                : 'Será baixado direto ao concluir.'}
            </span>
          </div>

          {isGenerating ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelJob}
              disabled={submitting}
              className="shrink-0"
            >
              <RefreshCw className="mr-[6px] h-[14px] w-[14px]" /> Cancelar geração
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (format === 'pdf') {
                  void handleSubmit('pdf');
                } else if (format === 'xlsx' || format === 'csv') {
                  void handlePreviewTable(format);
                }
                // DOCX: botão fica desabilitado (sem preview disponível).
              }}
              disabled={previewDisabled || isGenerating || submitting || format === 'docx'}
              className="shrink-0"
              title={
                format === 'docx'
                  ? 'Pré-visualização indisponível para DOCX — baixe pra ver.'
                  : format === 'pdf'
                    ? 'Gera em PDF e abre o preview'
                    : 'Mostra as primeiras 100 linhas como tabela (não gera o arquivo)'
              }
            >
              <Eye className="mr-[6px] h-[14px] w-[14px]" /> Pré-visualizar
            </Button>
          )}

          <Button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={submitting || isGenerating}
            className="shrink-0"
            style={{
              background: 'linear-gradient(135deg, #754c99, #8fd0d7)',
              color: '#ffffff',
              border: 'none',
              boxShadow: '0 4px 14px rgba(117,76,153,0.35)',
            }}
          >
            {submitting || isGenerating ? (
              <><Loader2 className="mr-[8px] h-[14px] w-[14px] animate-spin" /> Gerando…</>
            ) : (
              <><Download className="mr-[8px] h-[14px] w-[14px]" /> Gerar relatório</>
            )}
          </Button>
        </div>
      </footer>

      <ReportTablePreviewDialog
        open={tablePreview.open}
        title={`${report.title} — preview ${tablePreview.format.toUpperCase()}`}
        format={tablePreview.format}
        fetchPage={fetchPreviewPage}
        onGenerate={() => {
          // Fecha o preview e dispara o fluxo de geração real com o mesmo
          // formato selecionado pelo usuário.
          setTablePreview((prev) => ({ ...prev, open: false }));
          void handleSubmit(tablePreview.format);
        }}
        onClose={() => setTablePreview((prev) => ({ ...prev, open: false }))}
      />
    </section>
  );
}

// ─────────────────── helpers de filtros (idênticos ao Dialog antigo) ───────────────────

function filterKey(f: ReportFilterKey): string {
  switch (f) {
    case 'sprint': return 'sprint_id';
    case 'sprints_multi': return 'sprint_ids';
    case 'project': return 'project_id';
    case 'projects_multi': return 'project_ids';
    case 'responsavel': return 'responsavel_id';
    case 'user': return 'user_id';
    case 'period': return 'period_range';
    default: return f;
  }
}

function filterLabel(f: ReportFilterKey): string {
  switch (f) {
    case 'sprint': return 'Sprint';
    case 'sprints_multi': return 'Sprints';
    case 'project': return 'Projeto';
    case 'projects_multi': return 'Projetos';
    case 'status': return 'Status';
    case 'area': return 'Área';
    case 'tipo': return 'Tipo';
    case 'prioridade': return 'Prioridade';
    case 'responsavel': return 'Responsável';
    case 'user': return 'Usuário';
    case 'period': return 'Período (datas)';
  }
}

function renderFilter(
  f: ReportFilterKey,
  filters: Record<string, string | string[]>,
  setFilter: (key: string, value: string | string[]) => void,
  data: { sprints: Sprint[]; projects: Project[]; users: User[] },
): React.ReactNode {
  const key = filterKey(f);
  switch (f) {
    case 'sprint':
      return (
        <FilterSelect
          placeholder="Selecione uma sprint"
          searchPlaceholder="Buscar sprint..."
          options={data.sprints.map((s) => ({ value: String(s.id), label: s.nome }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'sprints_multi': {
      const selected = Array.isArray(filters[key]) ? (filters[key] as string[]) : [];
      return (
        <FilterMultiSelect
          placeholder="Selecione uma ou mais sprints"
          searchPlaceholder="Buscar sprint..."
          options={data.sprints.map((s) => ({ value: String(s.id), label: s.nome }))}
          value={selected}
          onChange={(arr) => setFilter(key, arr)}
        />
      );
    }
    case 'project':
      return (
        <FilterSelect
          placeholder="Selecione um projeto"
          searchPlaceholder="Buscar projeto..."
          options={data.projects.map((p) => ({ value: String(p.id), label: p.nome }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'projects_multi':
      return (
        <FilterSelect
          placeholder="Selecione um projeto (ou deixe vazio para TODOS)"
          searchPlaceholder="Buscar projeto..."
          options={data.projects.map((p) => ({ value: String(p.id), label: p.nome }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'status':
      return (
        <FilterSelect
          placeholder="Qualquer status"
          options={CARD_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'area':
      return (
        <FilterSelect
          placeholder="Qualquer área"
          options={CARD_AREAS.map((a) => ({ value: a.value, label: a.label }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'tipo':
      return (
        <FilterSelect
          placeholder="Qualquer tipo"
          options={CARD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'prioridade':
      return (
        <FilterSelect
          placeholder="Qualquer prioridade"
          options={CARD_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'responsavel':
    case 'user':
      return (
        <FilterSelect
          placeholder="Selecione um usuário"
          searchPlaceholder="Buscar por nome ou cargo..."
          options={data.users.map((u) => ({
            value: String(u.id),
            label: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username,
            role: u.role,
          }))}
          value={(filters[key] as string) ?? ''}
          onChange={(v) => setFilter(key, v)}
        />
      );
    case 'period':
      return (
        // 3 colunas na mesma linha: tipo de data + de + até. Em telas pequenas,
        // empilha (sm:grid-cols-3).
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
          {/* Tipo de data: explicita por qual campo filtrar (criação OU
              entrega). Backend usa `period_date_type` pra escolher entre
              `created_at` e `finalizado_em`. Default = created. */}
          <FilterSelect
            clearable={false}
            placeholder="Tipo de data"
            options={[
              { value: 'created', label: 'Data de criação' },
              { value: 'delivered', label: 'Data de entrega' },
            ]}
            value={(filters['period_date_type'] as string) || 'created'}
            onChange={(v) => setFilter('period_date_type', v)}
          />
          <DateInput
            value={(filters['period_start'] as string) ?? ''}
            onChange={(e) => setFilter('period_start', e.target.value)}
          />
          <DateInput
            value={(filters['period_end'] as string) ?? ''}
            onChange={(e) => setFilter('period_end', e.target.value)}
          />
        </div>
      );
  }
}

function serializeFilters(raw: Record<string, string | string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (k === 'project_ids' || k === 'sprint_ids') {
      out[k] = Array.isArray(v) ? v : [v];
    } else if (k === 'period_range') {
      // ignored — period_start/period_end vão separados
    } else {
      out[k] = v;
    }
  }
  return out;
}
