import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FilterSelect } from '@/components/ui/filter-select';
import { Loader2, AlertTriangle } from 'lucide-react';
import { readIncludeHeader, writeIncludeHeader } from '@/lib/reportSettings';
import { reportService, type ReportFormat, type ReportJob, type ReportType } from '@/services/reportService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { projectService, type Project } from '@/services/projectService';
import { userService, type User } from '@/services/userService';
import { CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES } from '@/services/cardService';

export type ReportFilterKey =
  | 'sprint'
  | 'project'
  | 'projects_multi'
  | 'status'
  | 'area'
  | 'tipo'
  | 'prioridade'
  | 'responsavel'
  | 'user'
  | 'period';

export type ReportDef = {
  id: ReportType;
  title: string;
  description: string;
  filters: ReportFilterKey[];
  /** Filtros que são obrigatórios. Validados antes de submit. */
  requiredFilters?: ReportFilterKey[];
};

export type ReportConfigDialogProps = {
  open: boolean;
  report: ReportDef | null;
  /** Job ativo a ser RETOMADO (caso o usuário tenha recarregado a página). */
  initialJobId?: number | null;
  /** Job concluído (status='completed' ou 'failed') — caller decide o que fazer
   * (abrir preview, baixar, mostrar erro). */
  onCompleted: (job: ReportJob) => void;
  /** Modal fechado pelo usuário sem completar a geração — caller só remove o estado. */
  onClose: () => void;
};

const FORMATS: { value: ReportFormat; label: string; descr: string }[] = [
  { value: 'pdf', label: 'PDF estilizado', descr: 'Layout colorido, igual ao site' },
  { value: 'docx', label: 'DOCX (Word)', descr: 'Estilizado e editável' },
  { value: 'xlsx', label: 'XLSX (Excel)', descr: 'Tabela com colunas filtráveis' },
  { value: 'csv', label: 'CSV', descr: 'Texto separado por ; (Excel pt-BR)' },
];

const POLL_INTERVAL_MS = 1500;

export default function ReportConfigDialog({
  open,
  report,
  initialJobId,
  onCompleted,
  onClose,
}: ReportConfigDialogProps) {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Estado do job em andamento (criado por este dialog OU adotado via initialJobId).
  const [activeJob, setActiveJob] = useState<ReportJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  // Dados pra dropdowns
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Carrega listas quando abre.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const tasks: Array<Promise<void>> = [];
      if (report?.filters.some((f) => ['sprint'].includes(f))) {
        tasks.push(sprintService.getAll().then((s) => { if (!cancelled) setSprints(s); }));
      }
      if (report?.filters.some((f) => ['project', 'projects_multi'].includes(f))) {
        tasks.push(projectService.getAll().then((p) => {
          if (!cancelled) setProjects(p.filter((pr) => !pr.is_system && !pr.arquivado));
        }));
      }
      if (report?.filters.some((f) => ['responsavel', 'user'].includes(f))) {
        tasks.push(userService.getAll().then((u) => { if (!cancelled) setUsers(u); }));
      }
      await Promise.allSettled(tasks);
    })();
    return () => { cancelled = true; };
  }, [open, report]);

  // Reset state ao abrir o dialog. Se houver initialJobId, adota como activeJob.
  useEffect(() => {
    if (!open) return;
    setFormat('pdf');
    setFilters({});
    setError(null);
    setSubmitting(false);
    if (initialJobId) {
      // Buscar status atual do job adotado.
      void reportService
        .getById(initialJobId)
        .then((job) => setActiveJob(job))
        .catch(() => setActiveJob(null));
    } else {
      setActiveJob(null);
    }
  }, [open, report?.id, initialJobId]);

  // Lê preferência de include_header sempre que muda o formato
  useEffect(() => {
    if (format === 'xlsx' || format === 'csv') {
      setIncludeHeader(readIncludeHeader(format));
    } else {
      setIncludeHeader(true);
    }
  }, [format]);

  // Polling enquanto há activeJob não-terminal.
  useEffect(() => {
    if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await reportService.getById(activeJob.id);
        if (cancelled) return;
        setActiveJob(fresh);
        if (fresh.status === 'completed' || fresh.status === 'failed') {
          onCompleted(fresh);
          return;
        }
      } catch {
        // Erro transitório — continua tentando.
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
  }, [activeJob, onCompleted]);

  // Cleanup do timer ao fechar.
  useEffect(() => {
    if (!open && pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [open]);

  if (!report) return null;

  const setFilter = (key: string, value: string | string[]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    for (const required of report.requiredFilters ?? []) {
      const key = filterKey(required);
      const val = filters[key];
      if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) {
        return `O filtro "${filterLabel(required)}" é obrigatório.`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSubmitting(true);
    try {
      if (format === 'xlsx' || format === 'csv') {
        writeIncludeHeader(format, includeHeader);
      }
      const job = await reportService.create({
        type: report.id,
        format,
        filters: serializeFilters(filters),
        include_header: includeHeader,
      });
      setActiveJob(job);
      // Se já vier completo (raríssimo, mas possível), notifica imediato.
      if (job.status === 'completed' || job.status === 'failed') {
        onCompleted(job);
      }
    } catch (e: unknown) {
      // 409 = já existe job ativo (de outra aba/sessão). Adotamos.
      if (isAxiosError(e) && e.response?.status === 409 && e.response.data?.existing_id) {
        try {
          const adopted = await reportService.getById(e.response.data.existing_id as number);
          setActiveJob(adopted);
          return;
        } catch {
          // Falha ao adotar: cai pra erro genérico.
        }
      }
      const msg = e instanceof Error ? e.message : 'Falha ao iniciar a geração.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Cancela o job em andamento mas mantém o dialog aberto pro usuário ajustar filtros. */
  const handleCancelJob = async () => {
    if (!activeJob) return;
    try {
      await reportService.cancel(activeJob.id);
    } finally {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
      setActiveJob(null);
    }
  };

  /** Fecha o modal. Se houver job em andamento, cancela antes. */
  const handleCloseDialog = () => {
    if (activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed') {
      void reportService.cancel(activeJob.id).catch(() => undefined);
    }
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    setActiveJob(null);
    onClose();
  };

  const isGenerating = !!activeJob && activeJob.status !== 'completed' && activeJob.status !== 'failed';
  const formControlsDisabled = isGenerating || submitting;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCloseDialog(); }} containerClassName="max-w-xl">
      <DialogContent onClose={handleCloseDialog} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{report.title}</DialogTitle>
          <DialogDescription>{report.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Filtros dinâmicos por relatório */}
          {report.filters.map((f) => (
            <div key={f} className="space-y-1">
              <Label>{filterLabel(f)}{report.requiredFilters?.includes(f) ? ' *' : ''}</Label>
              <div className={formControlsDisabled ? 'opacity-60 pointer-events-none' : ''}>
                {renderFilter(f, filters, setFilter, { sprints, projects, users })}
              </div>
            </div>
          ))}

          {/* Formato */}
          <div className="space-y-1">
            <Label>Formato</Label>
            <div className={`grid grid-cols-2 gap-2 ${formControlsDisabled ? 'opacity-60 pointer-events-none' : ''}`}>
              {FORMATS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormat(opt.value)}
                  className={`text-left rounded-md border px-3 py-2 transition-colors ${
                    format === opt.value
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-foreground)]">{opt.label}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">{opt.descr}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Cabeçalho das colunas (só XLSX/CSV) */}
          {(format === 'xlsx' || format === 'csv') && (
            <label className={`flex items-start gap-2 cursor-pointer ${formControlsDisabled ? 'opacity-60 pointer-events-none' : ''}`}>
              <input
                type="checkbox"
                checked={includeHeader}
                onChange={(e) => setIncludeHeader(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <div>
                <div className="text-sm text-[var(--color-foreground)]">
                  Incluir linha de cabeçalho das colunas
                </div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Quando marcado, a primeira linha terá os nomes das colunas
                  (Nome, Status, etc.). Sua preferência é lembrada no navegador.
                </div>
              </div>
            </label>
          )}

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {activeJob?.status === 'failed' && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Falha ao gerar relatório</div>
                <div className="text-xs">{activeJob.error?.split('\n')[0] || 'Tente novamente.'}</div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <div className="flex w-full items-center gap-3">
            {/* Barra de progresso ocupa o espaço da esquerda quando há geração ativa. */}
            <div className="flex-1 min-w-0">
              {isGenerating && activeJob && (
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full bg-[var(--color-muted)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-primary)] transition-all"
                      style={{ width: `${activeJob.progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)] truncate">
                    <span className="truncate">{activeJob.progress_message || 'Gerando...'}</span>
                    <span className="font-medium shrink-0 ml-2">{activeJob.progress}%</span>
                  </div>
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={isGenerating ? handleCancelJob : handleCloseDialog}
              disabled={submitting}
              className="shrink-0"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || isGenerating}
              className="shrink-0"
            >
              {submitting || isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando...</>
              ) : 'Gerar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── helpers de filtros ───────────────────

function filterKey(f: ReportFilterKey): string {
  switch (f) {
    case 'sprint': return 'sprint_id';
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-[var(--color-muted-foreground)]">De</Label>
            <Input
              type="date"
              value={(filters['period_start'] as string) ?? ''}
              onChange={(e) => setFilter('period_start', e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-[var(--color-muted-foreground)]">Até</Label>
            <Input
              type="date"
              value={(filters['period_end'] as string) ?? ''}
              onChange={(e) => setFilter('period_end', e.target.value)}
            />
          </div>
        </div>
      );
  }
}

function serializeFilters(raw: Record<string, string | string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (k === 'project_ids') {
      out[k] = Array.isArray(v) ? v : [v];
    } else if (k === 'period_range') {
      // ignored — period_start/period_end gravados separados
    } else {
      out[k] = v;
    }
  }
  return out;
}
