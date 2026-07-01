/** Usuário com cargo Admin na plataforma (não confundir com Django superuser). */
export function isAdminUser(
  user: { role?: string; role_display?: string } | null | undefined,
): boolean {
  const role = (user?.role ?? user?.role_display ?? '').toLowerCase();
  return role === 'admin';
}
