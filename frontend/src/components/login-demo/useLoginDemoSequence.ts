import { useEffect, useState } from 'react';

export type Scene =
  | 'dashboard'
  | 'sprints'
  | 'sprint-detail'
  | 'project-detail'
  | 'drag'
  | 'fade'
  | 'reset';

const TIMELINE: Array<{ scene: Scene; duration: number }> = [
  { scene: 'dashboard', duration: 2800 },
  { scene: 'sprints', duration: 3200 },
  { scene: 'sprint-detail', duration: 2800 },
  { scene: 'project-detail', duration: 2500 },
  { scene: 'drag', duration: 2800 },
  { scene: 'fade', duration: 3000 },
  // `reset` mantém o overlay branco da marca visível enquanto a cena por
  // baixo troca de project-detail para dashboard (exit 0.4s + enter 0.4s).
  // Precisa ser >= 800ms para esconder a transição completamente.
  { scene: 'reset', duration: 1000 },
];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useLoginDemoSequence(): { scene: Scene; index: number } {
  const [index, setIndex] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % TIMELINE.length);
    }, TIMELINE[index].duration);
    return () => window.clearTimeout(timer);
  }, [index, reduced]);

  if (reduced) {
    return { scene: 'project-detail', index: 3 };
  }
  return { scene: TIMELINE[index].scene, index };
}
