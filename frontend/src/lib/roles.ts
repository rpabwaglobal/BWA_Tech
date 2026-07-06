/** Usuário com cargo Admin na plataforma (não confundir com Django superuser). */
export function isAdminUser(
  user: { role?: string; role_display?: string } | null | undefined,
): boolean {
  const role = (user?.role ?? user?.role_display ?? '').toLowerCase();
  return role === 'admin';
}

/** Supervisor ou Admin — quem pode gerenciar o Score dos cards. */
export function isSupervisorOrAdmin(
  user: { role?: string; role_display?: string } | null | undefined,
): boolean {
  const role = (user?.role ?? user?.role_display ?? '').toLowerCase();
  return role === 'admin' || role === 'supervisor';
}
