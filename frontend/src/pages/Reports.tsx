import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, Zap, FolderKanban, Layers, User, AlertTriangle, TrendingUp, ListChecks,
  FileText,
} from 'lucide-react';
import ReportCard from '@/components/reports/ReportCard';
import ReportConfigDialog, {
  type ReportDef,
} from '@/components/reports/ReportConfigDialog';
import ReportPreviewDialog from '@/components/reports/ReportPreviewDialog';
import { reportService, type ReportJob } from '@/services/reportService';

/** Definição estática dos relatórios oferecidos. Para adicionar novo:
 *  - Inclua aqui (id, título, ícone, filtros)
 *  - Crie o generator backend em apps/reports/generators/<id>.py
 *  - Crie o template HTML em apps/reports/templates/reports/<id>.html
 */
const REPORT_DEFS: ReportDef[] = [
  {
    id: 'metrics',
    title: 'Métricas Globais',
    description: 'KPIs, leaderboard, throughput, volume por área e cycle time consolidados.',
    filters: ['period'],
  },
  {
    id: 'sprint',
    title: 'Sprint Detalhada',
    description: 'Projetos e todos os cards de uma sprint, com KPIs e status.',
    filters: ['sprint'],
    requiredFilters: ['sprint'],
  },
  {
    id: 'cards',
    title: 'Cards',
    description: 'Todos os cards filtráveis por sprint, projeto, status, área, tipo, prioridade e responsável.',
    filters: ['sprint', 'project', 'status', 'area', 'tipo', 'prioridade', 'responsavel', 'period'],
  },
  {
    id: 'projects',
    title: 'Projetos',
    description: 'Cards agrupados por projeto. Selecione um projeto específico ou exporte todos.',
    filters: ['projects_multi'],
  },
  {
    id: 'user',
    title: 'Por Usuário',
    description: 'Performance individual: cards entregues, on-time %, cycle time, distribuição por área.',
    filters: ['user', 'period'],
    requiredFilters: ['user'],
  },
  {
    id: 'bottlenecks',
    title: 'Atrasos & Gargalos',
    description: 'Cards que estouraram prazo + onde a equipe demora mais.',
    filters: ['period'],
  },
  {
    id: 'executive',
    title: 'Executivo (KPIs)',
    description: 'Visão de uma página com os principais indicadores. Ideal para apresentações.',
    filters: ['period'],
  },
  {
    id: 'backlog',
    title: 'Backlog Atual',
    description: 'Tudo que ainda não foi entregue, agrupado por projeto/sprint.',
    filters: ['project'],
  },
];

const ICONS = {
  metrics: BarChart3,
  sprint: Zap,
  cards: Layers,
  projects: FolderKanban,
  user: User,
  bottlenecks: AlertTriangle,
  executive: TrendingUp,
  backlog: ListChecks,
} as const;

export default function Reports() {
  const [configReport, setConfigReport] = useState<ReportDef | null>(null);
  // Job ativo (em andamento) — se o usuário recarregar a página, retomamos.
  const [resumeJobId, setResumeJobId] = useState<number | null>(null);
  // Job concluído com sucesso — abre preview (PDF) ou baixa direto.
  const [completedJob, setCompletedJob] = useState<ReportJob | null>(null);

  // Retoma job ativo ao montar (caso usuário tenha recarregado).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const running = await reportService.list('running');
        if (cancelled) return;
        if (running.length > 0) {
          setResumeJobId(running[0].id);
          // Encontra o report def equivalente para reabrir o dialog.
          const def = REPORT_DEFS.find((r) => r.id === running[0].type);
          if (def) setConfigReport(def);
          return;
        }
        const pending = await reportService.list('pending');
        if (cancelled) return;
        if (pending.length > 0) {
          setResumeJobId(pending[0].id);
          const def = REPORT_DEFS.find((r) => r.id === pending[0].type);
          if (def) setConfigReport(def);
        }
      } catch {
        // sem permissão / sem rede — segue sem retomar.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleJobCompleted = useCallback((job: ReportJob) => {
    setResumeJobId(null);
    if (job.status !== 'completed') {
      // Falha: o erro fica visível no próprio ConfigDialog. Não fechamos
      // o dialog — usuário pode tentar de novo ajustando filtros.
      return;
    }
    // Sucesso: fecha config e mostra preview ou baixa.
    setConfigReport(null);
    if (job.format === 'pdf') {
      setCompletedJob(job);
    } else {
      window.open(reportService.downloadUrl(job.id), '_blank');
    }
  }, []);

  const handleConfigClose = useCallback(() => {
    setConfigReport(null);
    setResumeJobId(null);
  }, []);

  const isLocked = configReport != null && resumeJobId != null;

  return (
    <div className="space-y-[24px]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <FileText className="h-7 w-7" />
          Relatórios
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Exporte relatórios estilizados (PDF, DOCX) ou em formato de tabela
          (XLSX, CSV). Um relatório por vez. Sua preferência de cabeçalho das
          colunas é lembrada pelo navegador.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {REPORT_DEFS.map((r) => (
          <ReportCard
            key={r.id}
            icon={ICONS[r.id]}
            title={r.title}
            description={r.description}
            disabled={isLocked}
            onClick={() => setConfigReport(r)}
          />
        ))}
      </div>

      <ReportConfigDialog
        open={configReport != null}
        report={configReport}
        initialJobId={resumeJobId}
        onCompleted={handleJobCompleted}
        onClose={handleConfigClose}
      />
      <ReportPreviewDialog
        open={completedJob != null}
        job={completedJob}
        onClose={() => setCompletedJob(null)}
      />
    </div>
  );
}
