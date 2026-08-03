import api from './api';

/**
 * Compartilhamento de um item entre setores.
 *
 * Todo item compartilhável tem um setor DONO (quem criou) e zero ou mais
 * setores CONVIDADOS. Cada convite tem um NÍVEL: `leitura` (enxerga, não
 * escreve) ou `edicao` (trabalha no item como o dono).
 *
 * O nível diz só o que o empréstimo concede. O que a pessoa pode fazer
 * continua saindo das permissões do cargo dela — um convite em edição não dá
 * a ninguém uma permissão que ela não tem no próprio setor.
 *
 * O acesso é hierárquico: a sprint arrasta os projetos e cards dela, o projeto
 * arrasta os cards dele. Por isso não existe endpoint de "propagar": basta
 * compartilhar o nível de cima.
 */

/** Recursos que expõem `<recurso>/<id>/compartilhar/`. */
export type RecursoCompartilhavel = 'sprints' | 'projects' | 'cards' | 'chamados-suporte';

/** Os chamados vivem sob o prefixo `formularios/`, os demais na raiz da API. */
const CAMINHO_DO_RECURSO: Record<RecursoCompartilhavel, string> = {
  sprints: 'sprints',
  projects: 'projects',
  cards: 'cards',
  'chamados-suporte': 'formularios/suporte',
};

/** O que o setor convidado pode fazer com o item. */
export type NivelCompartilhamento = 'leitura' | 'edicao';

export const ROTULO_NIVEL: Record<NivelCompartilhamento, string> = {
  leitura: 'Visualizar',
  edicao: 'Editar',
};

/** Identificação de um setor — o que a tela precisa para desenhar a tag. */
export type SetorBasico = {
  codename: string;
  nome: string;
  cor: string;
};

/** Setor convidado: um setor MAIS o nível em que ele foi convidado. O dono não
 * tem nível — ele não é convidado, o item é dele. */
export type SetorCompartilhado = SetorBasico & {
  nivel: NivelCompartilhamento;
  compartilhado_em?: string;
};

/** Como o usuário ATUAL alcança o item. `dono` = o item é do setor dele;
 * `null` = não alcança. Vem pronto do backend para a tela não refazer a regra. */
export type MeuAcesso = 'dono' | NivelCompartilhamento | null;

export type CompartilhamentoSetores = {
  id: number | string;
  /** Setor dono do item — nulo enquanto o item não tiver setor definido. */
  setor: SetorBasico | null;
  setores_compartilhados: SetorCompartilhado[];
  meu_acesso: MeuAcesso;
};

/** Um convite: com quem, e em que nível. */
export type ConviteSetor = { setor: string; nivel: NivelCompartilhamento };

const urlCompartilhar = (recurso: RecursoCompartilhavel, id: string | number) =>
  `/${CAMINHO_DO_RECURSO[recurso]}/${id}/compartilhar/`;

export const setorSharingService = {
  async get(
    recurso: RecursoCompartilhavel,
    id: string | number,
  ): Promise<CompartilhamentoSetores> {
    const response = await api.get<CompartilhamentoSetores>(urlCompartilhar(recurso, id));
    return response.data;
  },

  /** Substitui a lista de convidados. Lista vazia descompartilha o item.
   * Convites já existentes só têm o nível atualizado — a data e o autor do
   * empréstimo original são preservados. */
  async set(
    recurso: RecursoCompartilhavel,
    id: string | number,
    setores: ConviteSetor[],
  ): Promise<CompartilhamentoSetores> {
    const response = await api.post<CompartilhamentoSetores>(
      urlCompartilhar(recurso, id),
      { setores },
    );
    return response.data;
  },
};
