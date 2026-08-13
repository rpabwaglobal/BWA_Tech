/**
 * Preferência do usuário: exibir os FLUXOS AUTOMÁTICOS DO SISTEMA.
 *
 * Fluxo automático é um projeto mantido pelo sistema, cujos cards nascem e
 * mudam de etapa sozinhos — hoje só o "Monitoramento de Feedbacks", mas o
 * conceito é deliberadamente genérico: qualquer fluxo futuro que siga o mesmo
 * desenho (projeto `is_system` ancorado numa sprint `is_system`) entra aqui sem
 * tocar neste arquivo nem na tela.
 *
 * Mesma chave nas duas páginas que os mostram (sprint e projetos), como a
 * preferência de cores do kanban: a escolha é do usuário, não da tela.
 *
 * PADRÃO LIGADO. O fluxo é trabalho de verdade — alguém precisa copiar o link e
 * enviar. Nascer escondido faria a feature parecer quebrada para quem não sabe
 * que a opção existe; quem se incomodar desliga.
 */
export const MOSTRAR_FLUXOS_AUTOMATICOS_KEY = 'bwa_mostrar_fluxos_automaticos_v1';

export function lerMostrarFluxosAutomaticos(): boolean {
  try {
    const raw = window.localStorage.getItem(MOSTRAR_FLUXOS_AUTOMATICOS_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // localStorage indisponível (modo privado, storage cheio): cai no padrão.
  }
  return true;
}

export function gravarMostrarFluxosAutomaticos(valor: boolean): void {
  try {
    window.localStorage.setItem(MOSTRAR_FLUXOS_AUTOMATICOS_KEY, valor ? 'true' : 'false');
  } catch {
    // ignore — a escolha vale para esta sessão mesmo sem persistir.
  }
}
