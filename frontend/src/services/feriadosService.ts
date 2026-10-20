import api, { fetchAllPaginated } from './api';
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

export type FeriadoAbrangencia = 'estadual' | 'municipal' | 'empresa';

/** Uma LINHA cadastrada. Feriado nacional não tem linha — é calculado. */
export type FeriadoCadastrado = {
  id: number;
  data: string;
  nome: string;
  abrangencia: FeriadoAbrangencia;
  abrangencia_display?: string;
  /** true = vale todo ano nesta data. `data` é a PRIMEIRA ocorrência. */
  recorrente: boolean;
  observacao?: string;
  criado_em?: string;
};

export type FeriadoCadastradoInput = {
  data: string;
  nome: string;
  abrangencia: FeriadoAbrangencia;
  recorrente: boolean;
  observacao?: string;
};

/**
 * Administra a metade CADASTRADA dos feriados.
 *
 * Rota separada de `/feriados/` de propósito: aquela responde "quais dias são
 * feriado" (calculado + cadastrado, só leitura); esta mexe nas linhas. Um
 * feriado nacional não aparece aqui porque não existe como registro — oferecer
 * editá-lo seria oferecer o que não dá.
 *
 * Escrever exige `manage_feriados`; ler basta estar autenticado, para a tela
 * mostrar a lista a quem só consulta.
 */
export const feriadosCadastradosService = {
  async listar(): Promise<FeriadoCadastrado[]> {
    return fetchAllPaginated<FeriadoCadastrado>('/feriados-cadastrados/');
  },

  async criar(dados: FeriadoCadastradoInput): Promise<FeriadoCadastrado> {
    const { data } = await api.post('/feriados-cadastrados/', dados);
    return data;
  },

  async atualizar(id: number, dados: Partial<FeriadoCadastradoInput>): Promise<FeriadoCadastrado> {
    const { data } = await api.patch(`/feriados-cadastrados/${id}/`, dados);
    return data;
  },

  async excluir(id: number): Promise<void> {
    await api.delete(`/feriados-cadastrados/${id}/`);
  },
};
