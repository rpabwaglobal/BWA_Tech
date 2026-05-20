import {
  ArrowLeft,
  Zap,
  User,
  Calendar,
  Clock,
  FolderKanban,
  Plus,
  Search,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import DemoSidebar from './DemoSidebar';
import DemoCard from './DemoCard';
import { ACTIVE_SPRINT, type DemoKanbanCard } from './demoData';

type StageSection = {
  id: string;
  label: string;
  cards: DemoKanbanCard[];
};

type SprintProject = {
  id: string;
  nome: string;
  totalCards: number;
  stages: StageSection[];
};

/** Dados ficcionais com a estrutura real (cards agrupados por etapa dentro de cada projeto). */
const SPRINT_PROJECTS: SprintProject[] = [
  {
    id: 'p-declaracoes',
    nome: 'Declarações Sem Movimento',
    totalCards: 1,
    stages: [
      {
        id: 'a_desenvolver',
        label: 'A DESENVOLVER',
        cards: [
          {
            id: 'c-dec-1',
            nome: 'Envio SPED/EFD ICMS Sem...',
            descricao: 'Robô para enviar SPED/EFD ICMS Sem Movimento e salvar no e-continuo os recibos...',
            status: 'a_desenvolver',
            area_display: 'RPA',
            area_color: 'bg-purple-100 text-purple-800',
            tipo_display: 'Nova Robotização',
            responsavel_name: 'Italo Martins',
            responsavel_initials: 'IM',
            responsavel_role: 'Dev.',
            prioridade: 'media',
          },
        ],
      },
      { id: 'em_desenvolvimento', label: 'EM DESENVOLVIMENTO', cards: [] },
      { id: 'parado_pendencias', label: 'PARADO POR PENDÊNCIAS', cards: [] },
    ],
  },
  {
    id: 'p-parametrizacao',
    nome: 'Parametrização Reforma Tributária',
    totalCards: 5,
    stages: [
      { id: 'a_desenvolver', label: 'A DESENVOLVER', cards: [] },
      {
        id: 'em_desenvolvimento',
        label: 'EM DESENVOLVIMENTO',
        cards: [
          {
            id: 'c-par-1',
            nome: 'GRUPO GLORIA',
            descricao: 'OIA BAR E RESTAURANTE LTDA 28.696.330/0001-82 SALOMÃO E MIOD LTDA...',
            status: 'em_desenvolvimento',
            data_fim: '10/06/2026',
            area_display: 'Sistema',
            area_color: 'bg-gray-100 text-gray-800',
            tipo_display: 'Manutenção',
            responsavel_name: 'Neilton Silva',
            responsavel_initials: 'NS',
            responsavel_role: 'G. Proj.',
            prioridade: 'media',
          },
        ],
      },
      { id: 'parado_pendencias', label: 'PARADO POR PENDÊNCIAS', cards: [] },
    ],
  },
  {
    id: 'p-bwatech',
    nome: 'BWA Tech',
    totalCards: 36,
    stages: [
      {
        id: 'a_desenvolver',
        label: 'A DESENVOLVER',
        cards: [
          {
            id: 'c-bwa-1',
            nome: 'Sistema de alertas personali...',
            descricao: 'Implementar tela de alertas em tempo real que o supervisor tem acesso e pode mandar...',
            status: 'a_desenvolver',
            data_fim: '15/05/2026',
            area_display: 'Sistema',
            area_color: 'bg-gray-100 text-gray-800',
            tipo_display: 'Feature',
            responsavel_name: 'Italo Martins',
            responsavel_initials: 'IM',
            responsavel_role: 'Dev.',
            prioridade: 'baixa',
          },
          {
            id: 'c-bwa-2',
            nome: 'Geração automática de relat...',
            descricao: 'Adicionar o relatório de execuções na aba Relatórios do BWA Tech. O relatório será...',
            status: 'a_desenvolver',
            area_display: 'Sistema',
            area_color: 'bg-gray-100 text-gray-800',
            tipo_display: 'Feature',
            responsavel_name: 'Italo Martins',
            responsavel_initials: 'IM',
            responsavel_role: 'Dev.',
            prioridade: 'baixa',
          },
        ],
      },
      { id: 'em_desenvolvimento', label: 'EM DESENVOLVIMENTO', cards: [] },
    ],
  },
  {
    id: 'p-dashboards',
    nome: "Dashboard's",
    totalCards: 16,
    stages: [
      {
        id: 'a_desenvolver',
        label: 'A DESENVOLVER',
        cards: [
          {
            id: 'c-dash-1',
            nome: 'BI do DP',
            descricao: 'Bi com as informações passadas por Daniel Viana',
            status: 'a_desenvolver',
            area_display: 'Sistema',
            area_color: 'bg-gray-100 text-gray-800',
            tipo_display: 'Novo Painel',
            responsavel_name: 'Sem usuário atribuído',
            responsavel_initials: '—',
            responsavel_role: '',
            prioridade: 'media',
          },
          {
            id: 'c-dash-2',
            nome: 'Base de Clientes',
            descricao: 'Inserir regra RLS para que somente Diretoria, Gestores e Supervisores visualizem o...',
            status: 'a_desenvolver',
            area_display: 'Dados',
            area_color: 'bg-amber-100 text-amber-800',
            tipo_display: 'Feature',
            responsavel_name: 'Pedro Silva',
            responsavel_initials: 'PS',
            responsavel_role: 'Dev.',
            prioridade: 'media',
          },
        ],
      },
    ],
  },
];

function ProjectColumn({ project, isHighlighted }: { project: SprintProject; isHighlighted: boolean }) {
  return (
    <div
      data-project={project.id}
      className={
        'flex-shrink-0 w-[170px] rounded-[10px] border bg-[var(--color-muted)]/30 flex flex-col ' +
        (isHighlighted
          ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30'
          : 'border-[var(--color-border)]')
      }
    >
      {/* Header do projeto */}
      <div className="p-[8px] border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-start justify-between gap-[4px]">
          <div className="flex items-start gap-[4px] flex-1 min-w-0">
            <div className="h-[18px] w-[18px] rounded-[5px] flex items-center justify-center bg-[var(--color-primary)]/10 shrink-0 mt-[1px]">
              <FolderKanban className="h-[10px] w-[10px] text-[var(--color-primary)]" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[9px] font-semibold text-[var(--color-foreground)] leading-tight line-clamp-2">
                {project.nome}
              </h3>
              <span className="text-[8px] text-[var(--color-muted-foreground)]">
                {project.totalCards} cards
              </span>
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-[2px] px-[5px] py-[2px] rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-[7px] font-semibold shrink-0"
          >
            <Plus className="h-[7px] w-[7px]" />
            Card
          </button>
        </div>
      </div>

      {/* Conteúdo: stages com cards */}
      <div className="p-[6px] space-y-[6px] flex-1 overflow-hidden">
        {project.stages.map((stage) => (
          <div key={stage.id}>
            <p className="text-[7px] font-bold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-[4px] px-[2px]">
              {stage.label}
            </p>
            {stage.cards.length === 0 ? (
              <p className="text-[8px] text-[var(--color-muted-foreground)] italic text-center py-[6px]">
                Nenhum card
              </p>
            ) : (
              <div className="space-y-[4px]">
                {stage.cards.map((card) => (
                  <DemoCard key={card.id} card={card} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DemoSprintDetailView() {
  return (
    <>
      <DemoSidebar active="Sprints" />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[40px] flex items-center px-[14px] bg-[var(--color-card)] border-header-gradient shrink-0">
          <h2 className="text-[13px] font-semibold text-[var(--color-foreground)]">Sprints</h2>
        </header>

        <div className="flex-1 p-[10px] flex flex-col gap-[8px] overflow-hidden">
          {/* Cabeçalho da sprint */}
          <div>
            <div className="flex items-center gap-[6px]">
              <div className="h-[20px] w-[20px] rounded-[5px] flex items-center justify-center bg-[var(--color-muted)]">
                <ArrowLeft className="h-[10px] w-[10px] text-[var(--color-muted-foreground)]" />
              </div>
              <div className="h-[28px] w-[28px] rounded-[7px] flex items-center justify-center bg-[var(--color-primary)]/10 shrink-0">
                <Zap className="h-[14px] w-[14px] text-[var(--color-primary)]" />
              </div>
              <h1 className="text-[14px] font-bold text-[var(--color-foreground)] truncate">
                {ACTIVE_SPRINT.nome}
              </h1>
              <span className="text-[9px] font-semibold px-[7px] py-[1px] rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                Em andamento
              </span>
            </div>
            {/* Linha meta */}
            <div className="flex items-center flex-wrap gap-x-[10px] gap-y-[3px] mt-[5px] text-[8px] text-[var(--color-muted-foreground)]">
              <span className="flex items-center gap-[3px]">
                <User className="h-[8px] w-[8px]" />
                Gustavo Virgilio
              </span>
              <span className="flex items-center gap-[3px]">
                <Calendar className="h-[8px] w-[8px]" />
                {ACTIVE_SPRINT.data_inicio} → {ACTIVE_SPRINT.fechamento_em}
              </span>
              <span className="flex items-center gap-[3px]">
                <Clock className="h-[8px] w-[8px]" />
                19 dias (14 úteis)
              </span>
              <span className="px-[6px] py-[1px] rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold">
                Entregues atrasados: 2
              </span>
              <span className="px-[6px] py-[1px] rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
                Abertos atrasados: 9
              </span>
            </div>
          </div>

          {/* Barra de busca + filtros */}
          <div className="flex items-center gap-[5px] shrink-0">
            <div className="flex-1 flex items-center gap-[4px] px-[7px] py-[3px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-card)]">
              <Search className="h-[8px] w-[8px] text-[var(--color-muted-foreground)]" />
              <span className="text-[7px] text-[var(--color-muted-foreground)] truncate">
                Pesquisar cards por nome, descrição, responsável...
              </span>
            </div>
            <div className="flex items-center gap-[3px] px-[6px] py-[3px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-card)] text-[7px] text-[var(--color-foreground)] font-medium">
              <SlidersHorizontal className="h-[7px] w-[7px]" />
              Opções
            </div>
            <div className="flex items-center gap-[3px] px-[6px] py-[3px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-card)] text-[7px] text-[var(--color-foreground)] font-medium">
              Todos os status
              <ChevronDown className="h-[7px] w-[7px]" />
            </div>
            <div className="flex items-center gap-[3px] px-[6px] py-[3px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-card)] text-[7px] text-[var(--color-foreground)] font-medium">
              Todos os resp.
              <ChevronDown className="h-[7px] w-[7px]" />
            </div>
          </div>

          {/* Kanban horizontal de projetos */}
          <div className="flex-1 flex gap-[6px] overflow-hidden min-h-0">
            {SPRINT_PROJECTS.map((p, idx) => (
              <ProjectColumn key={p.id} project={p} isHighlighted={idx === 0} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
