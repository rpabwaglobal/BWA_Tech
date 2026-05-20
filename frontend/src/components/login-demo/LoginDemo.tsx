import { AnimatePresence, motion } from 'framer-motion';
import DemoBrowserFrame from './DemoBrowserFrame';
import DemoDashboardView from './DemoDashboardView';
import DemoSprintsView from './DemoSprintsView';
import DemoSprintDetailView from './DemoSprintDetailView';
import DemoProjectDetailView from './DemoProjectDetailView';
import DemoCard from './DemoCard';
import DemoCursor from './DemoCursor';
import BrandFadeOverlay from './BrandFadeOverlay';
import { useLoginDemoSequence } from './useLoginDemoSequence';
import { DRAGGABLE_CARD } from './demoData';

const DRAG_CARD = {
  initial: { left: '20%', top: '34%' },
  final: { left: '46%', top: '34%' },
};

export default function LoginDemo() {
  const { scene } = useLoginDemoSequence();
  // O overlay da marca permanece durante `reset` para esconder a troca de cena
  // (project-detail → dashboard) que acontece "debaixo do pano". Assim que o
  // `reset` termina e `dashboard` inicia, o overlay faz fade-out e revela o
  // dashboard já totalmente montado.
  const showFade = scene === 'fade' || scene === 'reset';
  const dragInProgress = scene === 'drag';
  const cardDelivered = scene === 'fade' || scene === 'reset';

  const showDashboard = scene === 'dashboard' || scene === 'reset';
  const showSprints = scene === 'sprints';
  const showSprintDetail = scene === 'sprint-detail';
  const showProjectDetail =
    scene === 'project-detail' || scene === 'drag' || scene === 'fade';

  return (
    <div
      aria-hidden="true"
      className="w-full h-full flex items-center justify-center px-[32px] py-[48px]"
    >
      <DemoBrowserFrame>
        <AnimatePresence mode="wait">
          {showDashboard && (
            <motion.div
              key="dashboard"
              className="absolute inset-0 flex"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
            >
              <DemoDashboardView />
            </motion.div>
          )}
          {showSprints && (
            <motion.div
              key="sprints"
              className="absolute inset-0 flex"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
            >
              <DemoSprintsView />
            </motion.div>
          )}
          {showSprintDetail && (
            <motion.div
              key="sprint-detail"
              className="absolute inset-0 flex"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
            >
              <DemoSprintDetailView />
            </motion.div>
          )}
          {showProjectDetail && (
            <motion.div
              key="project-detail"
              className="absolute inset-0 flex"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
            >
              <DemoProjectDetailView
                dragInProgress={dragInProgress}
                cardDelivered={cardDelivered}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {dragInProgress && (
            <motion.div
              key="drag-ghost"
              className="absolute z-20 w-[150px] pointer-events-none"
              style={{ willChange: 'transform' }}
              initial={{ ...DRAG_CARD.initial, opacity: 0, scale: 0.95, rotate: -2 }}
              animate={{ ...DRAG_CARD.final, opacity: 1, scale: 1.04, rotate: 2 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 2.2, ease: 'easeInOut' }}
            >
              <DemoCard
                card={DRAGGABLE_CARD}
                className="shadow-2xl ring-2 ring-[var(--color-primary)]/50"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {!showFade && <DemoCursor scene={scene} />}

        <AnimatePresence>{showFade && <BrandFadeOverlay />}</AnimatePresence>
      </DemoBrowserFrame>
    </div>
  );
}
