/**
 * Caminhos da SPA em português (sem barra final).
 * API REST continua em inglês; apenas o roteamento do frontend muda.
 */
export const ROUTES = {
  entrar: '/entrar',
  cadastro: '/cadastro',
  painel: '/painel',
  /** Lista de sprints (segmento singular, como pedido) */
  sprint: '/sprint',
  sprintPorId: (sprintId: string) => `/sprint/${sprintId}`,
  sprintCard: (sprintId: string, cardId: string) => `/sprint/${sprintId}/card/${cardId}`,
  projetos: '/projetos',
  projeto: (projectId: string) => `/projeto/${projectId}`,
  projetoCard: (projectId: string, cardId: string) => `/projeto/${projectId}/card/${cardId}`,
  prioridades: '/prioridades',
  meusAfazeres: '/meus-afazeres',
  pessoas: '/pessoas',
  metricas: '/metricas',
  relatorios: '/relatorios',
  suporte: '/suporte',
  diaGeek: '/dia-geek',
  configuracoes: '/configuracoes',
} as const;

/** Item ativo no menu lateral (rota exata ou detalhe sob o mesmo prefixo). */
export function isNavRouteActive(navPath: string, pathname: string): boolean {
  if (navPath === ROUTES.projetos) {
    return pathname === ROUTES.projetos || pathname.startsWith('/projeto/');
  }
  if (navPath === ROUTES.sprint) {
    return pathname === ROUTES.sprint || pathname.startsWith('/sprint/');
  }
  if (navPath === ROUTES.metricas) {
    return pathname === ROUTES.metricas || pathname.startsWith(`${ROUTES.metricas}/`);
  }
  if (navPath === ROUTES.relatorios) {
    return pathname === ROUTES.relatorios || pathname.startsWith(`${ROUTES.relatorios}/`);
  }
  return pathname === navPath;
}
