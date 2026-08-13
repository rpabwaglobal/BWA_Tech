import type { Project } from '@/services/projectService';

/**
 * COMO O FRONTEND RECONHECE O FLUXO "Monitoramento de Feedbacks".
 *
 * Nunca por NOME. O projeto abandonou o casamento por nome de propósito (ver o
 * comentário de `Project.is_system` no backend, que existe justamente para
 * "substituir o hardcoding por nome no frontend") — renomear o projeto pela
 * interface não pode quebrar a tela.
 *
 * A identidade é a mesma que o backend usa no seed: é o projeto SISTÊMICO
 * pendurado na sprint SISTÊMICA. Nenhum dos outros projetos sistêmicos
 * (Suporte, Sugestões, Projetos Descartados) mora numa sprint sistêmica, então
 * o par de flags é único.
 *
 * POR QUE O PAR, E NÃO SÓ `sprint_detail.is_system`: um projeto criado à mão
 * dentro da sprint sistêmica (não deveria acontecer, mas a API permite) não é o
 * de monitoramento. E por que não perguntar à lista de sprints: `GET /sprints/`
 * NÃO devolve a sprint sistêmica — procurar por lá não acharia nada. O projeto
 * é o único caminho, e ele já traz `sprint_detail` pronto no mesmo payload.
 */
export function isProjetoMonitoramento(
  projeto: Pick<Project, 'is_system' | 'sprint_detail'> | null | undefined,
): boolean {
  return !!projeto?.is_system && !!projeto?.sprint_detail?.is_system;
}

/** Acha o projeto de monitoramento numa lista já carregada. `null` se não existir. */
export function acharProjetoMonitoramento(projetos: Project[]): Project | null {
  return projetos.find((p) => isProjetoMonitoramento(p)) ?? null;
}

/**
 * O projeto é um FLUXO AUTOMÁTICO DO SISTEMA?
 *
 * Mesma regra de `isProjetoMonitoramento` — projeto sistêmico ancorado numa
 * sprint sistêmica —, mas com o nome do CONCEITO em vez do nome do primeiro
 * caso. Hoje as duas respondem igual; quando existir um segundo fluxo, é esta
 * que continua certa, e as telas que só querem saber "é fluxo automático?" já
 * estarão perguntando isso.
 *
 * Existe como função separada, e não como `export { isProjetoMonitoramento as
 * ehFluxoAutomatico }`, para que o dia em que as duas divergirem seja uma
 * edição óbvia aqui e não uma renomeação silenciosa espalhada pelas telas.
 */
export function ehFluxoAutomatico(
  projeto: Pick<Project, 'is_system' | 'sprint_detail'> | null | undefined,
): boolean {
  return !!projeto?.is_system && !!projeto?.sprint_detail?.is_system;
}

/** Lista os fluxos automáticos presentes numa lista de projetos já carregada. */
export function acharFluxosAutomaticos(projetos: Project[]): Project[] {
  return projetos.filter((p) => ehFluxoAutomatico(p));
}

/**
 * As KEYS das 4 colunas do board de monitoramento.
 *
 * São LITERALMENTE os valores de `EstadoPedido` no backend — é isso que faz a
 * sincronização card↔pedido ser um `update(status=estado)` lá. Aqui elas servem
 * só para PINTAR a coluna: sem isso, o board cairia na paleta por hash e as
 * etapas ganhariam cores aleatórias sem relação com o significado delas.
 *
 * Isto NÃO é o recorte de quais colunas cada board desenha — quem decide isso é
 * `ProjectKanbanStageConfig` no backend, por projeto. Uma key desconhecida aqui
 * só perde a cor bonita; nada quebra.
 *
 * `feedback_encerrado` (rótulo "Feedback Finalizado") é a etapa terminal do
 * fluxo: dela o link público não abre mais. A cor é a MESMA família de
 * "encerrado sem problema" do resto do sistema (cinza), e não vermelho —
 * encerrar é o fim normal do ciclo, não um erro.
 */
export const CORES_ETAPAS_FEEDBACK: Record<string, string> = {
  aguardando_prazo: 'bg-gray-100',
  aguardando_resposta: 'bg-amber-100',
  respondido: 'bg-green-100',
  feedback_encerrado: 'bg-slate-200',
};

/**
 * Os ÚNICOS destinos válidos ao arrastar um card do fluxo de feedback.
 *
 * O backend recusa qualquer outro com 400 (`FEEDBACK_ETAPA_FORA_DO_FLUXO`), e a
 * lista existe aqui para o card não "pular" de coluna e voltar: a tela para
 * ANTES da requisição. Deriva das chaves das cores para as duas nunca
 * divergirem — acrescentar uma etapa passa a ser uma linha só, acima.
 *
 * NÃO é "quais colunas o board desenha" (isso é a `kanban-config` do projeto).
 * É "para onde este card pode ir".
 */
export const KEYS_ETAPAS_FEEDBACK: readonly string[] = Object.keys(CORES_ETAPAS_FEEDBACK);

/** O destino do arraste pertence ao fluxo de feedback? */
export function ehEtapaDoFluxoFeedback(key: string): boolean {
  return KEYS_ETAPAS_FEEDBACK.includes(key);
}
