import { motion } from 'framer-motion';
import type { Scene } from './useLoginDemoSequence';

/** Coordenadas relativas (%) ao container interno do DemoBrowserFrame
 * (área de conteúdo abaixo do topbar). Ajustadas para cair sobre os
 * elementos clicáveis de cada cena. */
const POSITIONS: Record<Scene, { x: string; y: string }> = {
  // Item "Sprints" na sidebar (sidebar tem 140px / ~17%, items começam em ~9% Y)
  dashboard: { x: '5%', y: '17%' },
  // Card da sprint em andamento (cabeçalho com "Sprint 5.26")
  sprints: { x: '28%', y: '20%' },
  // Header do primeiro projeto (Declarações Sem Movimento) — não na etapa
  'sprint-detail': { x: '23%', y: '30%' },
  // Card "Refatorar autenticação JWT" na coluna A Desenvolver
  'project-detail': { x: '22%', y: '36%' },
  // Coluna "Em Desenvolvimento" durante o drag
  drag: { x: '50%', y: '40%' },
  fade: { x: '50%', y: '40%' },
  reset: { x: '5%', y: '17%' },
};

const isClickScene = (scene: Scene) =>
  scene === 'dashboard' ||
  scene === 'sprints' ||
  scene === 'sprint-detail' ||
  scene === 'project-detail' ||
  scene === 'drag';

export default function DemoCursor({ scene }: { scene: Scene }) {
  const pos = POSITIONS[scene];
  return (
    <motion.div
      className="absolute pointer-events-none z-30"
      style={{ willChange: 'transform' }}
      animate={{ left: pos.x, top: pos.y }}
      transition={{ duration: scene === 'drag' ? 2.2 : 1.2, ease: 'easeInOut' }}
    >
      <motion.div
        className="absolute -inset-[8px] rounded-full bg-white/40"
        animate={{
          scale: isClickScene(scene) ? [0.4, 1.4, 0.4] : 0.4,
          opacity: isClickScene(scene) ? [0, 0.55, 0] : 0,
        }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
      />
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="white"
        stroke="black"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="drop-shadow-lg"
      >
        <path d="M3 2l5 18 3-7 7-3z" />
      </svg>
    </motion.div>
  );
}
