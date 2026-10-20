/**
 * Quem enxerga cada aba de Configurações.
 *
 * POR QUE ISTO MERECE TESTE. A mesma função decide DUAS coisas em lugares
 * diferentes: o que a página desenha e se o menu lateral mostra o item de
 * Configurações. Antes de ela existir, a lista vivia dentro da página e o menu
 * mostrava "Configurações" para todo mundo — levando quem não tem permissão a
 * uma tela que só dizia que ele não tinha permissão.
 *
 * A aba de Feriados entrou depois, e com ela o risco de sempre numa lista
 * gateada: aparecer para quem não pode, ou sumir para quem pode.
 */
import { describe, expect, it } from 'vitest';

import { abasVisiveisPara, podeVerConfiguracoes } from './configuracoesAbas';

/** O mínimo que `hasPermission` lê. O resto do User não interessa aqui. */
const comPermissoes = (...permissions: string[]) =>
  ({ permissions }) as Parameters<typeof abasVisiveisPara>[0];

const chaves = (user: Parameters<typeof abasVisiveisPara>[0]) =>
  abasVisiveisPara(user).map((a) => a.key);

describe('abasVisiveisPara', () => {
  it('mostra Feriados a quem tem manage_feriados', () => {
    expect(chaves(comPermissoes('manage_feriados'))).toEqual(['feriados']);
  });

  it('NÃO mostra Feriados a quem só administra setores', () => {
    // As duas permissões são independentes de propósito: a migration que
    // concede `manage_feriados` a quem tem `manage_setores` é um ponto de
    // partida, e quem administra pode desmarcar uma sem perder a outra.
    expect(chaves(comPermissoes('manage_setores'))).toEqual(['setores']);
  });

  it('não mostra nada a quem não tem permissão nenhuma', () => {
    expect(chaves(comPermissoes())).toEqual([]);
    expect(chaves(null)).toEqual([]);
    expect(chaves(undefined)).toEqual([]);
  });

  it('acumula as abas de quem tem mais de uma permissão', () => {
    const visiveis = chaves(comPermissoes('manage_cargos', 'manage_feriados'));

    expect(visiveis).toContain('cargos');
    expect(visiveis).toContain('feriados');
    expect(visiveis).not.toContain('setores');
  });
});

describe('podeVerConfiguracoes', () => {
  it('é verdadeiro quando a pessoa alcança ao menos uma aba', () => {
    // A trava que liga o menu à página: quem só tem Feriados precisa conseguir
    // CHEGAR em Configurações, senão a aba existe e ninguém a encontra.
    expect(podeVerConfiguracoes(comPermissoes('manage_feriados'))).toBe(true);
  });

  it('é falso para quem não alcança nenhuma', () => {
    expect(podeVerConfiguracoes(comPermissoes())).toBe(false);
    expect(podeVerConfiguracoes(null)).toBe(false);
  });
});
