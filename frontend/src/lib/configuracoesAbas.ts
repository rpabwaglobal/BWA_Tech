import { hasPermission } from '@/lib/permissions';
import type { User } from '@/services/userService';

/**
 * AS ABAS DE CONFIGURAÇÕES E AS PERMISSÕES QUE CADA UMA EXIGE.
 *
 * Mora aqui, e não dentro da página, porque DOIS lugares precisam da mesma
 * resposta: a página (para decidir o que desenhar) e o menu lateral (para
 * decidir se mostra o item). Enquanto a lista viveu só na página, o menu não
 * tinha como consultá-la — e simplesmente mostrava "Configurações" para todo
 * mundo, levando quem não tem permissão a uma tela que só diz que ele não tem
 * permissão.
 *
 * Com a lista aqui, acrescentar uma aba nova atualiza os dois de uma vez.
 */
export const ABAS_CONFIGURACOES = [
  { key: 'usuarios' as const, label: 'Usuários', perms: ['manage_users', 'manage_user_permissions'] },
  { key: 'cargos' as const, label: 'Cargos', perms: ['manage_cargos'] },
  { key: 'setores' as const, label: 'Setores', perms: ['manage_setores'] },
];

export type AbaConfiguracoesKey = (typeof ABAS_CONFIGURACOES)[number]['key'];

/** As abas que este usuário alcança. Vazio = a página inteira é inútil para ele. */
export function abasVisiveisPara(user: User | null | undefined) {
  return ABAS_CONFIGURACOES.filter((aba) => aba.perms.some((p) => hasPermission(user, p)));
}

/** Se vale a pena oferecer Configurações no menu.
 *
 * A mesma pergunta que a página faz para decidir entre o conteúdo e o aviso de
 * "sem permissão" — por isso as duas saem da mesma função.
 */
export function podeVerConfiguracoes(user: User | null | undefined): boolean {
  return abasVisiveisPara(user).length > 0;
}
