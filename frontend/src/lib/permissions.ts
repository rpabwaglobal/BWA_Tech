/** Checagem de permissão granular — verifica se o usuário tem o codename
 * atribuído.
 *
 * É a forma padrão de decidir autorização no frontend. Gates por nome de cargo
 * (`user.role === 'supervisor'`) foram eliminados: impediam que um cargo criado
 * pelo admin — CEO, Gerente, o que for — recebesse a mesma capacidade.
 *
 * É a ÚNICA forma de autorização no frontend: não há checagem por cargo em
 * lugar nenhum. */
export function hasPermission(
  user: { permissions?: string[] } | null | undefined,
  codename: string,
): boolean {
  return !!user?.permissions?.includes(codename);
}
