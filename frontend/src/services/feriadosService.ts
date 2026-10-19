import api from './api';
import { definirFeriadosDoServidor, totalDeFeriadosDoServidor } from '@/lib/feriados';

export type FeriadosResposta = {
  inicio: string;
  fim: string;
  /** Datas YYYY-MM-DD, ordenadas. */
  feriados: string[];
};

/**
 * Busca os feriados CADASTRADOS e os entrega a `@/lib/feriados`.
 *
 * A METADE CALCULADA NÃO VEM DAQUI. Os feriados nacionais o frontend produz
 * sozinho, e é por isso que esta chamada pode falhar sem derrubar nada: sem ela
 * o sistema desconta os nacionais, com ela desconta também os estaduais do RN,
 * os municipais de Natal e os recessos da empresa.
 *
 * NÃO LANÇA. Quem chama é a inicialização do app, e um feriado municipal que
 * não chegou não é motivo para quebrar a tela — este projeto já teve um card
 * ficando vazio sem explicação por depender de uma segunda requisição. O
 * resultado diz se carregou, para quem quiser registrar.
 */
export const feriadosService = {
  async carregar(): Promise<{ ok: boolean; total: number }> {
    try {
      const { data } = await api.get<FeriadosResposta>('/feriados/');
      definirFeriadosDoServidor(data?.feriados ?? []);
      return { ok: true, total: totalDeFeriadosDoServidor() };
    } catch {
      // Silêncio deliberado: ver o parágrafo "NÃO LANÇA" acima. O sistema
      // continua com os nacionais, que é o caso da esmagadora maioria.
      return { ok: false, total: totalDeFeriadosDoServidor() };
    }
  },
};
