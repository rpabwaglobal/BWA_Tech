/**
 * Entregue no prazo, ou fora dele — a regra do lado do cliente.
 *
 * ESPELHA `backend/apps/projects/prazo.py`. As duas precisam concordar: a mesma
 * pergunta respondida de dois jeitos faz a tela de Métricas discordar do
 * relatório, e números diferentes para a mesma coisa destroem a confiança nos
 * dois.
 *
 * O PRAZO É MARCADO EM MINUTOS; A ENTREGA É REGISTRADA EM SEGUNDOS. O seletor
 * de data grava `YYYY-MM-DDTHH:mm` e completa os segundos com zero; a conclusão
 * é o instante exato do clique. Medido no banco: 1074 de 1074 prazos terminam
 * em segundo zero, e 0 de 902 conclusões terminam.
 *
 * Comparar os dois com `<=` cru marcava como atrasado quem entregou DENTRO do
 * minuto combinado — quatro cards, errados por 12 a 35 segundos, todos
 * exibindo na tela exatamente o mesmo horário do prazo.
 */

/** O prazo "18:30" vale até 18:30:59 — um minuto inteiro, porque é essa a
 *  unidade que a pessoa consegue escolher na tela. */
export const TOLERANCIA_DO_PRAZO_MS = 60_000;

/**
 * O card foi concluído dentro do minuto do prazo?
 *
 * Sem prazo ou sem conclusão devolve `null`: o card está **fora da pergunta**,
 * e quem chama decide o que fazer com isso. Devolver `true` aqui esconderia a
 * diferença entre "entregou no prazo" e "não dá para saber".
 */
export function entregueNoPrazo(card: {
  data_fim?: string | null;
  finalizado_em?: string | null;
}): boolean | null {
  if (!card.data_fim || !card.finalizado_em) return null;

  const prazo = new Date(card.data_fim).getTime();
  const conclusao = new Date(card.finalizado_em).getTime();
  if (Number.isNaN(prazo) || Number.isNaN(conclusao)) return null;

  return conclusao < prazo + TOLERANCIA_DO_PRAZO_MS;
}
