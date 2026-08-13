import { agruparPorSecao } from '@/lib/feedbackSecoes';
import { formatarValorResposta, type ItemResposta } from '@/services/pedidoFeedbackService';

/**
 * AS PERGUNTAS E O QUE FOI RESPONDIDO, na ordem da definição.
 *
 * ARQUIVO PRÓPRIO porque duas telas leem a MESMA resposta: o bloco de feedback
 * dentro do diálogo do card (`CardFeedbackSection`) e o painel direito do modal
 * consolidado do fluxo (`FeedbackConsolidadoDialog`). Com o trecho copiado nos
 * dois, bastaria ajustar um para a mesma resposta aparecer diferente dependendo
 * de por onde a pessoa clicou — e ninguém notaria, porque as duas telas quase
 * nunca são abertas lado a lado.
 *
 * O AGRUPAMENTO vem de `agruparPorSecao`, a mesma função da página pública: a
 * ordem de leitura tem de ser a ordem em que as perguntas foram feitas. E os
 * rótulos já chegam casados com a VERSÃO do formulário daquele pedido (o
 * servidor faz isso em `resposta_legivel`), então nada aqui consulta a definição
 * ativa — uma resposta antiga continua legível sob os rótulos que a pessoa viu.
 */
export function RespostaFeedbackItens({
  itens,
  /** Escala do texto. O diálogo do card é apertado; o modal consolidado respira. */
  tamanho = 'compacto',
}: {
  itens: ItemResposta[];
  tamanho?: 'compacto' | 'normal';
}) {
  const classeRotulo = tamanho === 'normal'
    ? 'text-sm font-medium leading-snug text-[var(--color-foreground)]'
    : 'text-[11px] font-medium leading-snug text-[var(--color-foreground)]';
  const classeValor = tamanho === 'normal'
    ? 'mt-[4px] rounded-md bg-[var(--color-muted)]/40 px-[10px] py-[6px] text-sm leading-snug text-[var(--color-foreground)]'
    : 'mt-[2px] text-[12px] leading-snug text-[var(--color-foreground)]';
  const classeVazio = tamanho === 'normal'
    ? 'mt-[4px] text-xs italic leading-snug text-[var(--color-muted-foreground)]/70'
    : 'mt-[2px] text-[11px] italic leading-snug text-[var(--color-muted-foreground)]/70';

  return (
    <>
      {agruparPorSecao(itens).map((grupo, indiceGrupo) => (
        <div
          key={`${indiceGrupo}-${grupo.secao}`}
          className={tamanho === 'normal' ? 'space-y-[14px]' : 'space-y-[6px]'}
        >
          {/* Campo sem seção (toda a versão 1 do formulário) renderiza solto,
              sem cabeçalho — como antes de as seções existirem. */}
          {grupo.secao && (
            <p
              className={
                tamanho === 'normal'
                  // Mesmo cabeçalho da página pública: caixa alta, fininho e com
                  // a linha embaixo. As duas telas mostram o MESMO formulário —
                  // ler diferente em cada uma é o que faria parecerem coisas
                  // distintas.
                  ? 'mb-[8px] border-b border-[var(--color-border)] pb-[6px] text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]'
                  : 'text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]'
              }
            >
              {grupo.secao}
            </p>
          )}
          {grupo.itens.map((item) => (
            <div key={item.key}>
              <p className={classeRotulo}>{item.label}</p>
              {item.valor === null || item.valor === '' ? (
                // NÃO omitir a pergunta sem resposta: com cinco opcionais,
                // esconder as vazias apagaria o fato de que foram perguntadas e
                // distorceria a leitura de quem só vê o que sobrou.
                <p className={classeVazio}>não respondido</p>
              ) : (
                <p
                  className={[
                    classeValor,
                    // As quebras de linha que a pessoa digitou não podem
                    // colapsar num parágrafo só.
                    item.tipo === 'texto_longo' ? 'whitespace-pre-wrap break-words' : 'break-words',
                  ].join(' ')}
                >
                  {formatarValorResposta(item)}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
