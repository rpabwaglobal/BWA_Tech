/** Checagem de permissão granular (Fase 3 do sistema de gerenciamento de
 * usuários) — verifica se o usuário tem o codename atribuído.
 *
 * `isAdminUser`/`isSupervisorOrAdmin` (lib/roles.ts) continuam existindo
 * separadamente para checagens ESTRUTURAIS (rotas /administracao e /score,
 * organograma em People.tsx, badges de cargo) — não são substituídas por
 * permissão. Esta função é só para GATES DE AÇÃO (criar sprint, gerenciar
 * Geek Day, etc.), que agora são editáveis por usuário na tela de
 * Gerenciamento de Usuários. */
export function hasPermission(
  user: { permissions?: string[] } | null | undefined,
  codename: string,
): boolean {
  return !!user?.permissions?.includes(codename);
}
