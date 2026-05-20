import { ArrowLeft, FolderKanban, Plus, Settings } from 'lucide-react';
import DemoSidebar from './DemoSidebar';
import DemoCard from './DemoCard';
import {
  DEMO_PROJECTS,
  ACTIVE_SPRINT,
  PROJECT_KANBAN_CARDS,
  DRAGGABLE_CARD,
  type DemoKanbanCard,
} from './demoData';

type StageId = 'a_desenvolver' | 'em_desenvolvimento' | 'finalizado';
type Stage = { id: StageId; label: string; color: string };

const STAGES: Stage[] = [
  { id: 'a_desenvolver', label: 'A Desenvolver', color: 'bg-[var(--color-muted)]/40' },
  { id: 'em_desenvolvimento', label: 'Em Desenvolvimento', color: 'bg-[var(--color-muted)]/40' },
  { id: 'finalizado', label: 'Concluído', color: 'bg-[var(--color-muted)]/40' },
];

const PROJECT = DEMO_PROJECTS[0];
const SPRINT = ACTIVE_SPRINT;

export default function DemoProjectDetailView({
  dragInProgress = false,
  cardDelivered = false,
}: {
  dragInProgress?: boolean;
  cardDelivered?: boolean;
}) {
  const aDesenvolver: DemoKanbanCard[] = cardDelivered
    ? PROJECT_KANBAN_CARDS.a_desenvolver
    : [DRAGGABLE_CARD, ...PROJECT_KANBAN_CARDS.a_desenvolver];
  const emDev: DemoKanbanCard[] = cardDelivered
    ? [{ ...DRAGGABLE_CARD, status: 'em_desenvolvimento' as const }, ...PROJECT_KANBAN_CARDS.em_desenvolvimento]
    : PROJECT_KANBAN_CARDS.em_desenvolvimento;
  const finalizado = PROJECT_KANBAN_CARDS.finalizado;

  const stageCards: Record<StageId, DemoKanbanCard[]> = {
    a_desenvolver: aDesenvolver,
    em_desenvolvimento: emDev,
    finalizado,
  };

  return (
    <>
      <DemoSidebar active="Sprints" />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header do projeto */}
        <header className="px-[14px] py-[10px] bg-[var(--color-card)] border-header-gradient shrink-0">
          <div className="flex items-center gap-[10px]">
            <div className="h-[26px] w-[26px] rounded-[6px] flex items-center justify-center bg-[var(--color-muted)]">
              <ArrowLeft className="h-[12px] w-[12px] text-[var(--color-muted-foreground)]" />
            </div>
            <div className="h-[32px] w-[32px] rounded-[8px] flex items-center justify-center bg-[var(--color-primary)]/10 shrink-0">
              <FolderKanban className="h-[16px] w-[16px] text-[var(--color-primary)]" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[14px] font-bold text-[var(--color-foreground)] truncate">
                {PROJECT.nome}
              </h1>
              <p className="text-[9px] text-[var(--color-muted-foreground)] truncate">
                {SPRINT.nome} ({SPRINT.data_inicio} → {SPRINT.fechamento_em})
              </p>
            </div>
            <div className="flex items-center gap-[4px]">
              <button
                type="button"
                className="h-[24px] flex items-center gap-[3px] px-[8px] rounded-[6px] bg-[var(--color-primary)] text-white text-[9px] font-semibold"
              >
                <Plus className="h-[10px] w-[10px]" />
                Card
              </button>
              <button
                type="button"
                className="h-[24px] w-[24px] rounded-[6px] flex items-center justify-center bg-[var(--color-muted)]"
              >
                <Settings className="h-[10px] w-[10px] text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          </div>
          {PROJECT.descricao && (
            <p className="mt-[4px] text-[9px] text-[var(--color-muted-foreground)] truncate">
              {PROJECT.descricao}
            </p>
          )}
        </header>

        {/* Kanban */}
        <div className="flex-1 p-[10px] flex gap-[8px] overflow-hidden">
          {STAGES.map((stage) => {
            const cards = stageCards[stage.id];
            return (
              <div key={stage.id} className="flex-1 flex flex-col min-w-0">
                <div className={`rounded-[8px] border border-[var(--color-border)] ${stage.color} flex flex-col h-full`}>
                  <div className="p-[8px] border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
                    <h3 className="text-[10px] font-semibold text-[var(--color-foreground)] truncate">
                      {stage.label}
                    </h3>
                    <span className="text-[8px] font-bold px-[5px] py-[1px] rounded-full bg-[var(--color-card)] text-[var(--color-foreground)] shrink-0">
                      {cards.length}
                    </span>
                  </div>
                  <div
                    className="p-[6px] space-y-[5px] flex-1 overflow-hidden"
                    data-column={stage.id}
                  >
                    {cards.map((card) => {
                      const isHiddenDraggable =
                        card.id === DRAGGABLE_CARD.id &&
                        stage.id === 'a_desenvolver' &&
                        dragInProgress;
                      if (isHiddenDraggable) {
                        return (
                          <div
                            key={card.id}
                            className="rounded-[6px] border-2 border-dashed border-[var(--color-border)] h-[64px] opacity-50"
                            data-card-slot={card.id}
                          />
                        );
                      }
                      return <DemoCard key={card.id} card={card} />;
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
