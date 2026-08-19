import api from './api';
import type { Card as CardType } from './cardService';
import type { Project } from './projectService';
import type { User } from './userService';

/**
 * O resumo do dashboard, pronto, numa requisição.
 *
 * Substitui o que a tela fazia antes: paginar TODOS os projetos em sequência
 * (`?page=2`, `3`, `4`, `5`, `6`) e depois disparar uma requisição de cards por
 * projeto. Eram cerca de quarenta idas ao servidor e centenas de objetos de
 * card baixados — para no fim calcular contagens e um conjunto de ids.
 *
 * Medido: LCP de 6,53 s antes; a chamada única responde em ~360 ms com 18 KB.
 */
export type ResumoDashboard = {
  sprints: {
    total: number;
    em_andamento: number;
    /** A mais recente entre as em andamento — o atalho "Meus Cards" usa este id. */
    principal_id: number | null;
  };
  projetos: {
    total: number;
    em_sprints_ativas: number;
    ativos: number;
    concluidos: number;
    recentes: Project[];
  };
  cards: {
    a_desenvolver: number;
    em_desenvolvimento: number;
    entregues_sprints_ativas: number;
    entregues_total: number;
    /** Só os cards em desenvolvimento — os únicos que a tela lista de fato. */
    lista_em_desenvolvimento: (CardType & { projeto_nome: string })[];
  };
  /** Quem participa do trabalho e NÃO tem card em desenvolvimento. */
  usuarios_sem_card: User[];
};

export const dashboardService = {
  async obterResumo(): Promise<ResumoDashboard> {
    const { data } = await api.get<ResumoDashboard>('/dashboard/resumo/');
    return data;
  },
};
