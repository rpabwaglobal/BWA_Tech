import {
  Zap,
  FolderKanban,
  Clock,
  CheckCircle2,
  Plus,
  ListChecks,
  Code,
  UserX,
} from 'lucide-react';
import DemoSidebar from './DemoSidebar';

const STATS = [
  {
    title: 'Sprints Ativas',
    icon: Zap,
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    value: '1',
    label: 'Sprints Ativas',
    right: '6 total',
  },
  {
    title: 'Total de Projetos',
    icon: FolderKanban,
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    iconColor: 'text-purple-600 dark:text-purple-400',
    value: '11',
    label: 'Projetos na Sprint',
    right: '52 total',
  },
  {
    title: 'Cards em Andamento',
    icon: Clock,
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    value: '11',
    label: 'Em desenvolvimento',
    right: '32 a desenvolver',
  },
  {
    title: 'Concluídos',
    icon: CheckCircle2,
    iconBg: 'bg-green-100 dark:bg-green-900/40',
    iconColor: 'text-green-600 dark:text-green-400',
    value: '112',
    label: 'Concluídos na Sprint Atual',
    right: '400 total',
  },
];

const CARDS_DEV = [
  {
    initials: 'GG',
    nome: 'GRUPO GLORIA',
    sub: 'Parametrização Reforma Tributária',
    periodo: '19/05/2026 → 10/06/2026',
    restante: '21 dias restantes',
    atrasado: false,
  },
  {
    initials: 'BT',
    nome: 'Estudar aplicação de cores',
    sub: 'BWA Tech',
    periodo: '20/05/2026 → 25/05/2026',
    restante: '5 dias restantes',
    atrasado: false,
  },
  {
    initials: 'PC',
    nome: 'Painel Controle Comercial',
    sub: 'Tela de Metas Sócios',
    periodo: '15/05/2026 → 21/05/2026',
    restante: '1 dia restante',
    atrasado: false,
  },
];

const USERS_NO_PROJECT = [
  {
    initials: 'DM',
    nome: 'Douglas Matheus',
    email: 'douglas.matheus@bwa.global',
    role: 'Dados',
  },
  {
    initials: 'GC',
    nome: 'Geymerson Câmara',
    email: 'geymerson.camara@bwa.global',
    role: 'Desenvolvedor',
  },
  {
    initials: 'IM',
    nome: 'Ilton Moreira',
    email: 'ilton.moreira@bwa.global',
    role: 'Desenvolvedor',
  },
];

function StatCard({ stat }: { stat: (typeof STATS)[number] }) {
  const Icon = stat.icon;
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[8px] flex flex-col gap-[3px]">
      <div className="flex items-center justify-between gap-[4px]">
        <span className="text-[8px] font-medium text-[var(--color-foreground)] truncate">
          {stat.title}
        </span>
        <div className={`h-[18px] w-[18px] rounded-full flex items-center justify-center ${stat.iconBg} shrink-0`}>
          <Icon className={`h-[9px] w-[9px] ${stat.iconColor}`} />
        </div>
      </div>
      <p className="text-[18px] font-bold text-[var(--color-foreground)] leading-none">
        {stat.value}
      </p>
      <div className="flex items-end justify-between gap-[4px]">
        <span className="text-[7px] text-[var(--color-muted-foreground)] truncate">
          {stat.label}
        </span>
        <span className="text-[7px] text-[var(--color-muted-foreground)] shrink-0">{stat.right}</span>
      </div>
    </div>
  );
}

function PersonAvatar({ initials }: { initials: string }) {
  return (
    <div className="h-[20px] w-[20px] rounded-full bg-[var(--color-primary)] text-white text-[8px] font-bold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}

export default function DemoDashboardView() {
  return (
    <>
      <DemoSidebar active="Dashboard" />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[40px] flex items-center px-[14px] bg-[var(--color-card)] border-header-gradient shrink-0">
          <h2 className="text-[13px] font-semibold text-[var(--color-foreground)]">Dashboard</h2>
        </header>
        <div className="flex-1 p-[10px] flex flex-col gap-[10px] overflow-hidden">
          {/* Topo: saudação + atalhos rápidos */}
          <div className="flex items-start justify-between gap-[10px]">
            <div className="min-w-0">
              <h1 className="text-[14px] font-bold text-[var(--color-foreground)] leading-tight">
                Boa tarde, Italo Martins!
              </h1>
              <p className="text-[9px] text-[var(--color-muted-foreground)] mt-[2px]">
                Aqui está um resumo do seu ambiente de trabalho.
              </p>
            </div>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[6px] shrink-0">
              <p className="text-[7px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-[4px]">
                Atalhos Rápidos
              </p>
              <div className="flex gap-[4px]">
                <button
                  type="button"
                  className="flex items-center gap-[3px] px-[6px] py-[3px] rounded-[5px] bg-[var(--color-primary)] text-white text-[8px] font-semibold"
                >
                  <Plus className="h-[8px] w-[8px]" />
                  Criar Card
                </button>
                <button
                  type="button"
                  className="flex items-center gap-[3px] px-[6px] py-[3px] rounded-[5px] border border-[var(--color-border)] text-[var(--color-foreground)] text-[8px] font-medium"
                >
                  <ListChecks className="h-[8px] w-[8px]" />
                  Meus Cards
                </button>
              </div>
            </div>
          </div>

          {/* Grid 4 stat cards */}
          <div className="grid grid-cols-4 gap-[6px]">
            {STATS.map((s) => (
              <StatCard key={s.title} stat={s} />
            ))}
          </div>

          {/* Duas colunas inferiores */}
          <div className="grid grid-cols-2 gap-[8px] flex-1 min-h-0">
            {/* Cards em Desenvolvimento */}
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[8px] flex flex-col min-h-0">
              <div className="flex items-center gap-[4px] mb-[2px]">
                <Code className="h-[10px] w-[10px] text-[var(--color-primary)]" />
                <h3 className="text-[10px] font-semibold text-[var(--color-foreground)]">
                  Cards em Desenvolvimento
                </h3>
              </div>
              <p className="text-[7px] text-[var(--color-muted-foreground)] mb-[6px]">
                Cards que estão sendo desenvolvidos atualmente
              </p>
              <div className="space-y-[5px] overflow-hidden">
                {CARDS_DEV.map((c) => (
                  <div
                    key={c.nome}
                    className="flex items-center gap-[6px] p-[5px] rounded-[6px] border border-[var(--color-border)]"
                  >
                    <PersonAvatar initials={c.initials} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[8px] font-semibold text-[var(--color-foreground)] truncate leading-tight">
                        {c.nome}
                      </p>
                      <p className="text-[7px] text-[var(--color-muted-foreground)] truncate">
                        {c.sub}
                      </p>
                      <p className="text-[7px] text-[var(--color-muted-foreground)] truncate">
                        {c.periodo} · {c.restante}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Usuários sem Projeto */}
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] p-[8px] flex flex-col min-h-0">
              <div className="flex items-center gap-[4px] mb-[2px]">
                <UserX className="h-[10px] w-[10px] text-amber-600 dark:text-amber-400" />
                <h3 className="text-[10px] font-semibold text-[var(--color-foreground)]">
                  Usuários sem Projeto
                </h3>
              </div>
              <p className="text-[7px] text-[var(--color-muted-foreground)] mb-[6px]">
                Usuários sem projetos ou cards atribuídos
              </p>
              <div className="space-y-[5px] overflow-hidden">
                {USERS_NO_PROJECT.map((u) => (
                  <div
                    key={u.nome}
                    className="flex items-center gap-[6px] p-[5px] rounded-[6px] border border-[var(--color-border)]"
                  >
                    <PersonAvatar initials={u.initials} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[8px] font-semibold text-[var(--color-foreground)] truncate leading-tight">
                        {u.nome}
                      </p>
                      <p className="text-[7px] text-[var(--color-muted-foreground)] truncate">
                        {u.email}
                      </p>
                      <p className="text-[7px] text-[var(--color-muted-foreground)] truncate">
                        {u.role}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
