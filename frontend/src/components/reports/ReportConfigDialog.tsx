import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FilterSelect } from '@/components/ui/filter-select';
import { Loader2 } from 'lucide-react';
import { readIncludeHeader, writeIncludeHeader } from '@/lib/reportSettings';
import type { ReportFormat, ReportType } from '@/services/reportService';
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

export type SubmitInput = {
  type: ReportType;
  format: ReportFormat;
  filters: Record<string, unknown>;
  include_header: boolean;
};

export type ReportConfigDialogProps = {
  open: boolean;
  report: ReportDef | null;
  /** Submeter a config — caller dispara o reportService.create. */
  onSubmit: (input: SubmitInput) => Promise<void>;
  onClose: () => void;
};

const FORMATS: { value: ReportFormat; label: string; descr: string }[] = [
  { value: 'pdf', label: 'PDF estilizado', descr: 'Layout colorido, igual ao site' },
  { value: 'docx', label: 'DOCX (Word)', descr: 'Estilizado e editável' },
  { value: 'xlsx', label: 'XLSX (Excel)', descr: 'Tabela com colunas filtrávies' },
  { value: 'csv', label: 'CSV', descr: 'Texto separado por ; (Excel pt-BR)' },
];

export default function ReportConfigDialog({ open, report, onSubmit, onClose }: ReportConfigDialogProps) {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          if (!cancelled) {
            setProjects(p.filter((pr) => !pr.is_system && !pr.arquivado));
          }
        }));
      }
      if (report?.filters.some((f) => ['responsavel', 'user'].includes(f))) {
        tasks.push(userService.getAll().then((u) => { if (!cancelled) setUsers(u); }));
      }
      await Promise.allSettled(tasks);
    })();
    return () => { cancelled = true; };
  }, [open, report]);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setFormat('pdf');
    setFilters({});
    setError(null);
  }, [open, report?.id]);

  // Lê preferência de include_header sempre que muda o formato
  useEffect(() => {
    if (format === 'xlsx' || format === 'csv') {
      setIncludeHeader(readIncludeHeader(format));
    } else {
      setIncludeHeader(true);
    }
  }, [format]);

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
      await onSubmit({
        type: report.id,
        format,
        filters: serializeFilters(filters),
        include_header: includeHeader,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao iniciar a geração.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} containerClassName="max-w-xl">
      <DialogContent onClose={onClose} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{report.title}</DialogTitle>
          <DialogDescription>{report.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Filtros dinâmicos por relatório */}
          {report.filters.map((f) => (
            <div key={f} className="space-y-1">
              <Label>{filterLabel(f)}{report.requiredFilters?.includes(f) ? ' *' : ''}</Label>
              {renderFilter(f, filters, setFilter, { sprints, projects, users })}
            </div>
          ))}

          {/* Formato */}
          <div className="space-y-1">
            <Label>Formato</Label>
            <div className="grid grid-cols-2 gap-2">
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
            <label className="flex items-start gap-2 cursor-pointer">
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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando...</>
            ) : 'Gerar'}
          </Button>
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
      // Versão simples por enquanto: vírgula-separada de IDs. Pode virar
      // multi-select dedicado futuramente.
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

/** Reorganiza filters do shape "frontend" pra forma que o backend espera. */
function serializeFilters(raw: Record<string, string | string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    // project_ids: backend espera array
    if (k === 'project_ids') {
      out[k] = Array.isArray(v) ? v : [v];
    } else if (k === 'period_range') {
      // ignorado — period_start/period_end são salvos direto no filters Record
    } else {
      out[k] = v;
    }
  }
  return out;
}
