/** Dados ficcionais para a animação demo do login.
 * Estrutura espelha os modelos reais (Sprint, Project, Card). */

export type DemoActiveSprint = {
  id: string;
  nome: string;
  data_inicio: string;
  fechamento_em: string;
  projetos: number;
  total_cards: number;
  entregues: number;
  em_andamento_count: number;
  entregues_atrasados: number;
  abertos_atrasados: number;
};

export type DemoPlannedSprint = {
  id: string;
  nome: string;
  supervisor_name: string;
  data_inicio: string;
  fechamento_em: string;
  created_at: string;
};

export type DemoProject = {
  id: string;
  nome: string;
  descricao?: string;
  desenvolvedor_name?: string;
};

export type DemoKanbanCard = {
  id: string;
  nome: string;
  descricao?: string;
  status: 'a_desenvolver' | 'em_desenvolvimento' | 'finalizado';
  data_fim?: string;
  area_display?: string;
  area_color?: string;
  tipo_display?: string;
  responsavel_name?: string;
  responsavel_initials?: string;
  responsavel_role?: string;
  prioridade: 'baixa' | 'media' | 'alta' | 'absoluta';
};

/** Hex codes idênticos aos de `src/lib/priorityColors.ts`. */
export const PRIORITY_HEX: Record<DemoKanbanCard['prioridade'], string> = {
  baixa: '#acd89b',
  media: '#ffeeb0',
  alta: '#fea1a0',
  absoluta: '#888888',
};

export const PRIORITY_LABEL: Record<DemoKanbanCard['prioridade'], string> = {
  baixa: 'Baixa',
  media: 'Media',
  alta: 'Alta',
  absoluta: 'Absoluta',
};

export const ACTIVE_SPRINT: DemoActiveSprint = {
  id: 's526',
  nome: 'Sprint 5.26',
  data_inicio: '04/05/2026, 04:00',
  fechamento_em: '22/05/2026, 23:00',
  projetos: 11,
  total_cards: 170,
  entregues: 110,
  em_andamento_count: 13,
  entregues_atrasados: 2,
  abertos_atrasados: 9,
};

export const PLANNED_SPRINTS: DemoPlannedSprint[] = [
  {
    id: 's626',
    nome: 'Sprint 6.26',
    supervisor_name: 'Gustavo Virgilio',
    data_inicio: '25/05/2026',
    fechamento_em: '15/06/2026',
    created_at: '13/05/2026, 17:45',
  },
  {
    id: 's726',
    nome: 'Sprint 7.26',
    supervisor_name: 'Italo Martins',
    data_inicio: '16/06/2026',
    fechamento_em: '06/07/2026',
    created_at: '14/05/2026, 09:12',
  },
  {
    id: 's826',
    nome: 'Sprint 8.26',
    supervisor_name: 'Marina Vilar',
    data_inicio: '07/07/2026',
    fechamento_em: '28/07/2026',
    created_at: '15/05/2026, 11:30',
  },
];

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'p1',
    nome: 'Portal BWA Tech',
    descricao: 'Refatoração do módulo de autenticação',
    desenvolvedor_name: 'Italo M.',
  },
  {
    id: 'p2',
    nome: 'API de Relatórios',
    descricao: 'Endpoints v2 para dashboards',
    desenvolvedor_name: 'Rafael A.',
  },
  {
    id: 'p3',
    nome: 'Mobile App',
    descricao: 'Telas de onboarding',
    desenvolvedor_name: 'Luana P.',
  },
];

/** Card que será arrastado na cena de drag. */
export const DRAGGABLE_CARD: DemoKanbanCard = {
  id: 'card-drag',
  nome: 'Refatorar autenticação JWT',
  descricao: 'Migrar tokens para HttpOnly cookies e adicionar refresh automático.',
  status: 'a_desenvolver',
  data_fim: '24/05',
  area_display: 'BACKEND',
  area_color: 'bg-green-100 text-green-800',
  tipo_display: 'Feature',
  responsavel_name: 'Italo M.',
  responsavel_initials: 'IM',
  responsavel_role: 'Dev',
  prioridade: 'alta',
};

export const PROJECT_KANBAN_CARDS: Record<
  'a_desenvolver' | 'em_desenvolvimento' | 'finalizado',
  DemoKanbanCard[]
> = {
  a_desenvolver: [
    {
      id: 'a1',
      nome: 'Migrar relatórios para v2',
      descricao: 'Reescrever queries antigas usando o novo ORM.',
      status: 'a_desenvolver',
      data_fim: '26/05',
      area_display: 'BACKEND',
      area_color: 'bg-green-100 text-green-800',
      tipo_display: 'Feature',
      responsavel_name: 'Rafael A.',
      responsavel_initials: 'RA',
      responsavel_role: 'Dev',
      prioridade: 'media',
    },
    {
      id: 'a2',
      nome: 'Layout de cards do Kanban',
      descricao: 'Ajustar espaçamento e badges de prioridade.',
      status: 'a_desenvolver',
      data_fim: '25/05',
      area_display: 'FRONTEND',
      area_color: 'bg-blue-100 text-blue-800',
      tipo_display: 'Polish',
      responsavel_name: 'Luana P.',
      responsavel_initials: 'LP',
      responsavel_role: 'Dev',
      prioridade: 'baixa',
    },
  ],
  em_desenvolvimento: [
    {
      id: 'd1',
      nome: 'Endpoint bulk-archive',
      descricao: 'Arquivar múltiplos projetos em uma chamada.',
      status: 'em_desenvolvimento',
      data_fim: '23/05',
      area_display: 'BACKEND',
      area_color: 'bg-green-100 text-green-800',
      tipo_display: 'Feature',
      responsavel_name: 'Joana S.',
      responsavel_initials: 'JS',
      responsavel_role: 'Dev',
      prioridade: 'absoluta',
    },
  ],
  finalizado: [
    {
      id: 'f1',
      nome: 'Nova paleta de cores',
      descricao: 'Aplicação da identidade visual BWA Tech.',
      status: 'finalizado',
      data_fim: '20/05',
      area_display: 'DESIGN',
      area_color: 'bg-purple-100 text-purple-800',
      tipo_display: 'Polish',
      responsavel_name: 'Marina V.',
      responsavel_initials: 'MV',
      responsavel_role: 'UI/UX',
      prioridade: 'media',
    },
  ],
};
