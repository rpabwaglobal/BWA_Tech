import {
  Zap,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  XCircle,
  User,
  Calendar,
  Clock,
} from 'lucide-react';
import DemoSidebar from './DemoSidebar';
import { ACTIVE_SPRINT, PLANNED_SPRINTS } from './demoData';

function StatBox({
  icon: Icon,
  iconColor,
  label,
  value,
  valueColor,
}: {
  icon: typeof Zap;
  iconColor?: string;
  label: string;
  value: number;
  valueColor?: string;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--color-border)] p-[8px] bg-[var(--color-card)]/40">
      <div className="flex items-center gap-[4px] text-[8px] text-[var(--color-muted-foreground)] font-medium">
        <Icon className={'h-[10px] w-[10px] ' + (iconColor ?? '')} />
        <span className="truncate">{label}</span>
      </div>
      <p
        className={'text-[14px] font-bold leading-tight mt-[2px] ' + (valueColor ?? 'text-[var(--color-foreground)]')}
      >
        {value}
      </p>
    </div>
  );
}

function PlannedSprintCard({ s }: { s: (typeof PLANNED_SPRINTS)[number] }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-card)] p-[10px] flex flex-col gap-[5px] shadow-sm">
      <div className="flex items-center gap-[6px]">
        <div className="h-[24px] w-[24px] rounded-[6px] flex items-center justify-center bg-[var(--color-primary)]/10 shrink-0">
          <Zap className="h-[12px] w-[12px] text-[var(--color-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-[11px] font-bold text-[var(--color-foreground)] truncate leading-tight">
            {s.nome}
          </h4>
          <span className="inline-block mt-[2px] text-[8px] font-semibold px-[6px] py-[1px] rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            Planejada
          </span>
        </div>
      </div>
      <div className="flex items-center gap-[3px] text-[8px] text-[var(--color-muted-foreground)]">
        <User className="h-[8px] w-[8px] shrink-0" />
        <span className="truncate">Criado por: {s.supervisor_name}</span>
      </div>
      <div className="flex items-center gap-[3px] text-[8px] text-[var(--color-muted-foreground)]">
        <Calendar className="h-[8px] w-[8px] shrink-0" />
        <span className="truncate">
          {s.data_inicio} → {s.fechamento_em}
        </span>
      </div>
      <div className="flex items-center gap-[3px] text-[8px] text-[var(--color-muted-foreground)]">
        <Clock className="h-[8px] w-[8px] shrink-0" />
        <span className="truncate">Criada em: {s.created_at}</span>
      </div>
      <div className="flex items-center gap-[3px] text-[8px] text-[var(--color-muted-foreground)]">
        <CheckCircle2 className="h-[8px] w-[8px] shrink-0" />
        <span className="truncate">Fechada em: Sprint aberta</span>
      </div>
    </div>
  );
}

export default function DemoSprintsView() {
  return (
    <>
      <DemoSidebar active="Sprints" />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[44px] flex items-center px-[16px] bg-[var(--color-card)] border-header-gradient shrink-0">
          <h2 className="text-[13px] font-semibold text-[var(--color-foreground)]">Sprints</h2>
        </header>
        <div className="flex-1 p-[12px] space-y-[12px] overflow-hidden">
          {/* === SPRINT EM ANDAMENTO === */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--color-foreground)] mb-[6px]">
              Sprint em Andamento
            </h3>
            <div
              data-sprint="ativa"
              className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-card)] p-[12px] shadow-sm"
            >
              {/* Header */}
              <div className="flex items-center gap-[10px]">
                <div className="h-[36px] w-[36px] rounded-[8px] flex items-center justify-center bg-[var(--color-primary)]/10 shrink-0">
                  <Zap className="h-[18px] w-[18px] text-[var(--color-primary)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[14px] font-bold text-[var(--color-foreground)] truncate leading-tight">
                    {ACTIVE_SPRINT.nome}
                  </h4>
                  <div className="flex items-center gap-[6px] mt-[2px]">
                    <span className="text-[9px] font-semibold px-[7px] py-[1px] rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                      Em Andamento
                    </span>
                    <span className="text-[9px] text-[var(--color-muted-foreground)] truncate">
                      {ACTIVE_SPRINT.data_inicio} → {ACTIVE_SPRINT.fechamento_em}
                    </span>
                  </div>
                </div>
              </div>
              {/* Stats grid */}
              <div className="grid grid-cols-6 gap-[6px] mt-[10px]">
                <StatBox icon={FolderKanban} label="Projetos" value={ACTIVE_SPRINT.projetos} />
                <StatBox icon={Zap} label="Total Cards" value={ACTIVE_SPRINT.total_cards} />
                <StatBox
                  icon={CheckCircle2}
                  iconColor="text-green-600 dark:text-green-400"
                  label="Entregues"
                  value={ACTIVE_SPRINT.entregues}
                  valueColor="text-green-600 dark:text-green-400"
                />
                <StatBox
                  icon={AlertCircle}
                  iconColor="text-blue-600 dark:text-blue-400"
                  label="Em Andam."
                  value={ACTIVE_SPRINT.em_andamento_count}
                  valueColor="text-blue-600 dark:text-blue-400"
                />
                <StatBox
                  icon={XCircle}
                  iconColor="text-red-600 dark:text-red-400"
                  label="Entr. atras."
                  value={ACTIVE_SPRINT.entregues_atrasados}
                  valueColor="text-red-600 dark:text-red-400"
                />
                <StatBox
                  icon={AlertCircle}
                  iconColor="text-amber-600 dark:text-amber-400"
                  label="Ab. atras."
                  value={ACTIVE_SPRINT.abertos_atrasados}
                  valueColor="text-amber-600 dark:text-amber-400"
                />
              </div>
            </div>
          </div>

          {/* === SPRINTS PLANEJADAS === */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--color-foreground)] mb-[6px]">
              Sprints Planejadas
            </h3>
            <div className="grid grid-cols-3 gap-[8px]">
              {PLANNED_SPRINTS.map((s) => (
                <PlannedSprintCard key={s.id} s={s} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
