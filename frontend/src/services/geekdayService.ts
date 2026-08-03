import api, { fetchAllPaginated } from './api';

/** Setor como o Geek Day o devolve dentro de um grupo. Já vem com nome e cor
 * para a tela desenhar o chip sem uma segunda ida ao catálogo de setores. */
export type GeekDaySetor = {
  id: number;
  codename: string;
  nome: string;
  cor: string | null;
};

/** Grupo de Geek Day: o conjunto de setores que sorteia junto e compartilha a
 * mesma fila (`current_cycle`). Por padrão cada setor é o seu próprio grupo —
 * o sorteio deixou de ser da empresa inteira. */
export type GeekDayGrupo = {
  id: number;
  nome: string;
  setores: number[];
  setores_detalhe: GeekDaySetor[];
  /** Só muda por `resetarSorteios` — é o ciclo da fila DESTE grupo. */
  current_cycle: number;
  updated_at: string;
};

export type GeekDayUserStatus = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  /** CODENAME do cargo — a roleta decide cor e ordenação por ele. */
  role: string;
  /** Rótulo pronto para exibir (vem do catálogo de cargos do backend). */
  role_display: string;
  profile_picture_url: string | null;
  ja_sorteado: boolean;
  total_sorteios: number;
  ultimo_sorteio: string | null;
};

export type GeekDayDraw = {
  id: number;
  usuario: string | number; // Pode ser string (UUID) ou number (ID)
  usuario_name: string;
  usuario_profile_picture: string | null;
  sorteado_por: string | null;
  sorteado_por_name: string | null;
  data_sorteio: string;
  data_apresentacao?: string | null; // YYYY-MM-DD
  marcado_manual: boolean;
  observacoes: string | null;
  cycle?: number;
  /** Grupo dono do sorteio — sorteio não existe "solto" na empresa. */
  grupo: number;
  grupo_nome: string;
};

/**
 * `?grupo=<id>` é o escopo de TODAS as rotas de sorteio.
 *
 * Sem o parâmetro o backend resolve o grupo do próprio usuário (pelo setor
 * primário), que é o caso comum da tela. Só mandamos o id quando o gestor está
 * olhando OUTRO grupo: passar o parâmetro sempre exigiria `manage_geekday` ou
 * `view_cross_setor` de quem apenas abre o próprio Geek Day.
 */
function escopo(grupoId?: number | null): string {
  return grupoId == null ? '' : `?grupo=${grupoId}`;
}

export const geekdayService = {
  async getUsersStatus(grupoId?: number | null): Promise<GeekDayUserStatus[]> {
    const response = await api.get<GeekDayUserStatus[]>(`/geekday-draws/users_status/${escopo(grupoId)}`);
    return response.data;
  },

  async realizarSorteio(dataApresentacao?: string | null, grupoId?: number | null): Promise<GeekDayDraw> {
    const response = await api.post<GeekDayDraw>(`/geekday-draws/realizar_sorteio/${escopo(grupoId)}`, {
      data_apresentacao: dataApresentacao || null,
    });
    return response.data;
  },

  async marcarComoSorteado(
    usuarioId: string,
    observacoes?: string,
    dataApresentacao?: string | null,
    grupoId?: number | null,
  ): Promise<GeekDayDraw> {
    const response = await api.post<GeekDayDraw>(`/geekday-draws/marcar_como_sorteado/${escopo(grupoId)}`, {
      usuario_id: usuarioId,
      observacoes: observacoes || '',
      data_apresentacao: dataApresentacao || null,
    });
    return response.data;
  },

  async desmarcarComoSorteado(
    usuarioId: string,
    grupoId?: number | null,
  ): Promise<{ message: string; usuario_id: string }> {
    const response = await api.post<{ message: string; usuario_id: string }>(
      `/geekday-draws/desmarcar_como_sorteado/${escopo(grupoId)}`,
      { usuario_id: usuarioId },
    );
    return response.data;
  },

  /** Abre um novo ciclo NO GRUPO — resetar um setor não zera a fila do vizinho. */
  async resetarSorteios(
    grupoId?: number | null,
  ): Promise<{ message: string; cycle: number; grupo: number; grupo_nome: string }> {
    const response = await api.post<{ message: string; cycle: number; grupo: number; grupo_nome: string }>(
      `/geekday-draws/resetar_sorteios/${escopo(grupoId)}`,
    );
    return response.data;
  },

  async getHistorico(grupoId?: number | null): Promise<GeekDayDraw[]> {
    const response = await api.get<GeekDayDraw[]>(`/geekday-draws/historico/${escopo(grupoId)}`);
    return response.data;
  },
};

/**
 * Administração dos grupos de Geek Day.
 *
 * Ler exige `view_metrics` (mesma porta da tela); criar, renomear e mexer nos
 * setores exige também `manage_geekday`.
 */
export const geekdayGrupoService = {
  /** Grupo do usuário logado — cria o grupo do setor dele se ainda não existir.
   * É a chamada principal da tela: o nome exibido e o ciclo saem daqui. */
  async meu(): Promise<GeekDayGrupo> {
    const response = await api.get<GeekDayGrupo>('/geekday-grupos/meu/');
    return response.data;
  },

  /** Lista paginada no backend; a tela precisa de todos para montar o seletor. */
  async listar(): Promise<GeekDayGrupo[]> {
    return fetchAllPaginated<GeekDayGrupo>('/geekday-grupos/');
  },

  async criar(nome: string, setores?: number[]): Promise<GeekDayGrupo> {
    const response = await api.post<GeekDayGrupo>('/geekday-grupos/', { nome, setores: setores ?? [] });
    return response.data;
  },

  async renomear(id: number, nome: string): Promise<GeekDayGrupo> {
    const response = await api.patch<GeekDayGrupo>(`/geekday-grupos/${id}/`, { nome });
    return response.data;
  },

  /** Usa a action de um setor só — o PATCH de `setores` SUBSTITUI a lista
   * inteira e apagaria os demais vínculos sem querer. */
  async adicionarSetor(id: number, setorId: number): Promise<GeekDayGrupo> {
    const response = await api.post<GeekDayGrupo>(`/geekday-grupos/${id}/adicionar-setor/`, { setor: setorId });
    return response.data;
  },

  /** O setor removido não fica órfão: no próximo acesso ganha um grupo próprio. */
  async removerSetor(id: number, setorId: number): Promise<GeekDayGrupo> {
    const response = await api.post<GeekDayGrupo>(`/geekday-grupos/${id}/remover-setor/`, { setor: setorId });
    return response.data;
  },

  /** 409 quando o grupo já tem sorteio registrado — a mensagem do backend
   * explica o porquê e é exibida como está. */
  async excluir(id: number): Promise<void> {
    await api.delete(`/geekday-grupos/${id}/`);
  },
};
