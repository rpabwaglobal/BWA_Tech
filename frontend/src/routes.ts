/**
 * Caminhos da SPA em português (sem barra final).
 * API REST continua em inglês; apenas o roteamento do frontend muda.
 */
export const ROUTES = {
  entrar: '/entrar',
  cadastro: '/cadastro',
  recuperarConta: '/recuperar-conta',
  painel: '/painel',
  /** Entrada do menu Sprints → redireciona para a sprint em andamento */
  sprint: '/sprint',
  /** Lista completa de sprints (antiga rota `/sprint`) */
  sprintGerenciar: '/sprint/gerenciar',
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
  score: '/score',
  configuracoes: '/configuracoes',
  administracao: '/administracao',
} as const;

/** Item ativo no menu lateral (rota exata ou detalhe sob o mesmo prefixo). */
export function isNavRouteActive(navPath: string, pathname: string): boolean {
  if (navPath === ROUTES.projetos) {
    return pathname === ROUTES.projetos || pathname.startsWith('/projeto/');
  }
  if (navPath === ROUTES.sprint) {
    return (
      pathname === ROUTES.sprint
      || pathname === ROUTES.sprintGerenciar
      || pathname.startsWith('/sprint/')
    );
  }
  if (navPath === ROUTES.metricas) {
    return pathname === ROUTES.metricas || pathname.startsWith(`${ROUTES.metricas}/`);
  }
  if (navPath === ROUTES.relatorios) {
    return pathname === ROUTES.relatorios || pathname.startsWith(`${ROUTES.relatorios}/`);
  }
  return pathname === navPath;
}
