import api from './api';

/**
 * O que o Daily Mode precisa e a página de Prioridades não carrega.
 *
 * `/cards/priorities_view/` já traz o card em desenvolvimento e os concluídos
 * hoje — as duas primeiras colunas do daily saem dele sem requisição nenhuma.
 * Só duas coisas faltavam na API, e são exatamente estas:
 *
 *   - o TEXTO do impedimento (o card traz `status` e `events_count`, mas o
 *     serializer não expõe os eventos, então "parado" chegava sem o porquê);
 *   - as ENTREGAS DOS ÚLTIMOS DIAS (o endpoint do dia olha só para hoje e o da
 *     semana olha para a frente; nenhum responde "o que você entregou desde a
 *     última daily").
 *
 * É um COMPLEMENTO, e não um substituto: vem indexado por usuário para casar
 * com o `usersWithCards` que a página já tem na mão. Assim ligar o Daily Mode
 * não rebusca nem repinta os cards que já estão na tela.
 */

export interface DailyEntregaItem {
  id: string;
  nome: string;
  projeto: string;
  finalizado_em: string;
}

export interface DailyEntregaDia {
  /** ISO (YYYY-MM-DD) — a chave estável; o `label` é só para a tela. */
  dia: string;
  /** "Quarta, 26/08" */
  label: string;
  items: DailyEntregaItem[];
}

export interface DailyPendencia {
  card_id: string;
  card_nome: string;
  /** Vazio quando o card está parado mas ninguém registrou o motivo — o
   * backend não inventa texto, e a tela diz isso com todas as letras. */
  motivo: string;
  data: string | null;
}

export interface DailyExtrasUsuario {
  usuario_id: number;
  /** UMA POR CARD PARADO, e não uma por pessoa: quem tem dois cards travados
   * tem dois motivos diferentes, e mostrar só o primeiro colava o motivo de um
   * card no nome do outro. */
  pendencias: DailyPendencia[];
  entregas: DailyEntregaDia[];
  total_entregas: number;
}

export interface DailyExtras {
  hoje: string;
  dias: number;
  usuarios: DailyExtrasUsuario[];
}

export const dailyService = {
  async getExtras(dias?: number): Promise<DailyExtras> {
    const response = await api.get('/cards/daily_extras/', {
      params: dias ? { dias } : undefined,
    });
    return response.data;
  },
};

/** Indexa por usuário para a tela não varrer a lista a cada troca de pessoa. */
export function indexarExtrasPorUsuario(
  extras: DailyExtras | null,
): Map<string, DailyExtrasUsuario> {
  const mapa = new Map<string, DailyExtrasUsuario>();
  for (const linha of extras?.usuarios ?? []) {
    // Chave em string: o id do usuário chega como número aqui e como string no
    // `usersWithCards`, e um `Map` com chaves de tipos diferentes erra o
    // casamento em silêncio — a coluna simplesmente vem vazia.
    mapa.set(String(linha.usuario_id), linha);
  }
  return mapa;
}
