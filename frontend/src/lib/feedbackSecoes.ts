/**
 * O AGRUPAMENTO POR SEÇÃO, em UM lugar só.
 *
 * Duas telas precisam da MESMA regra: a página pública (que desenha o
 * formulário) e o bloco de leitura dentro do card (que mostra o que foi
 * respondido). Se cada uma agrupasse do seu jeito, a ordem das perguntas na
 * resposta poderia divergir da ordem em que a pessoa as viu — e ninguém
 * perceberia, porque as duas telas quase nunca são abertas lado a lado.
 *
 * A REGRA É "RUN CONSECUTIVO", E ISSO NÃO É DETALHE DE IMPLEMENTAÇÃO.
 * A lista de campos é a ÚNICA fonte da ordem da tela — é a promessa que o
 * backend faz em `FeedbackFormulario.campos` e que `campos_publicos` preserva.
 * Agrupar percorrendo a lista UMA vez e abrindo um grupo quando a seção muda
 * mantém essa promessa intacta.
 *
 * O QUE NÃO SE PODE FAZER, e é a armadilha óbvia:
 *
 *     [...new Set(itens.map((i) => i.secao))].map((s) => itens.filter(...))
 *
 * Isso REORDENA (o Set entrega a ordem da primeira aparição, não a da lista) e
 * FUNDE runs não-adjacentes: uma versão futura que volte à seção 2 depois da 3
 * teria as perguntas embaralhadas em silêncio, sem erro nenhum. Na versão 2 os
 * 11 campos já vêm em runs perfeitos, então hoje o resultado visual seria
 * idêntico — o que é exatamente o que faria o defeito passar despercebido até a
 * versão seguinte.
 *
 * Item SEM seção (toda a versão 1 do formulário) cai num grupo de seção vazia e
 * é renderizado solto, sem cabeçalho — que é o comportamento de antes de as
 * seções existirem.
 */

/** Um run de itens consecutivos que declaram a mesma seção. */
export type GrupoSecao<T> = { secao: string; itens: T[] };

export function agruparPorSecao<T extends { secao?: string }>(itens: T[]): GrupoSecao<T>[] {
  const grupos: GrupoSecao<T>[] = [];

  for (const item of itens) {
    const secao = (item.secao ?? '').trim();
    const ultimo = grupos[grupos.length - 1];
    // Só continua o grupo anterior se ele for ADJACENTE e da mesma seção.
    if (ultimo && ultimo.secao === secao) {
      ultimo.itens.push(item);
    } else {
      grupos.push({ secao, itens: [item] });
    }
  }

  return grupos;
}
