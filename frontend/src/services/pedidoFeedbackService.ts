import api from './api';
import type { ReportTablePreview } from './reportService';
import type { PaginatedResponse } from './api';

/**
 * O lado AUTENTICADO do feedback: pergunta "qual é o link deste card?".
 *
 * ARQUIVO SEPARADO DE `feedbackService.ts` DE PROPÓSITO. Aquele existe para a
 * rota ANÔNIMA e tem uma instância própria do axios, sem interceptors, para que
 * nenhuma sessão de funcionário vaze para dentro dela. Este aqui é o oposto:
 * precisa do `Authorization` do cliente padrão. Misturar os dois no mesmo
 * arquivo faria alguém importar o axios errado um dia — e o erro seria mudo.
 *
 * NÃO EXISTE E-MAIL: o link nasce junto com o pedido e é enviado À MÃO. Esta
 * função é o que torna esse envio manual possível — é daqui que sai o texto que
 * o botão de copiar joga na área de transferência.
 */

/**
 * Espelha `EstadoPedido` do backend, que também é a KEY da coluna do kanban.
 *
 * `feedback_encerrado` é a etapa terminal ("Feedback Finalizado"): o link
 * público passa a responder 410 e a página de fora mostra a tela de encerrado.
 * Voltar o card para qualquer outra etapa reabre o link — o token nunca é
 * trocado, então a reabertura é a própria mudança de estado.
 */
export type EstadoPedido =
  | 'aguardando_prazo'
  | 'aguardando_resposta'
  | 'respondido'
  | 'feedback_encerrado';

/**
 * Uma pergunta com a resposta dela, JÁ CASADA no servidor.
 *
 * O backend não devolve o dict cru `{key: valor}`, e isso é o ponto: casar chave
 * com rótulo AQUI obrigaria a tela a escolher contra qual definição casar, e a
 * única que ela teria à mão é a ATIVA. Uma resposta gravada na versão 1
 * apareceria sob os rótulos da versão 2 — exatamente o defeito que o
 * versionamento em duas etapas existe para impedir. `resposta_legivel` casa
 * contra a definição DAQUELE pedido, então rótulo, tipo, seção, domínio e ORDEM
 * chegam prontos e não podem divergir da página que a pessoa realmente viu.
 */
export type ItemResposta = {
  key: string;
  label: string;
  tipo: string;
  /** '' quando a definição não declara seção (toda a versão 1). */
  secao: string;
  /** `null` = pergunta opcional que ficou sem resposta. Escala grava INTEIRO. */
  valor: string | number | null;
  /** Só em 'escala' — acompanham o item para a tela formatar sem consultar nada. */
  minimo?: number;
  maximo?: number;
  rotulos?: Record<string, string>;
};

/**
 * UMA resposta enviada por UMA pessoa, com o cabeçalho de quem a enviou.
 *
 * QUEM RESPONDEU VEM PRONTO DO SERVIDOR. A rota é anônima: não há usuário nem
 * sessão do outro lado, só o que a própria pessoa digitou em "Seu nome:" e "Seu
 * setor:" — os dois OPCIONAIS, e ausentes na versão 1 do formulário. O backend
 * já resolve isso e manda `respondente` com o nome OU o rótulo honesto
 * "Anônimo", mais `anonimo` dizendo qual dos dois é. A tela NÃO compara string
 * com o rótulo nem vasculha `itens` atrás da chave: essa regra é do servidor e
 * muda quando o formulário muda.
 */
export type RespostaLegivel = {
  /** Id da LINHA — chave estável da lista, imune a resposta apagada no meio. */
  id: number;
  /** ISO JÁ no fuso local (o backend aplica `localtime` antes de serializar). */
  enviado_em: string;
  /** Nome digitado, ou "Anônimo". NUNCA inventar identificação a partir daqui. */
  respondente: string;
  /** `true` quando `respondente` é o rótulo, não um nome de verdade. */
  anonimo: boolean;
  /** '' quando não preenchido — a tela omite a linha em vez de escrever "—". */
  setor_respondente: string;
  itens: ItemResposta[];
};

/**
 * Payload de `PedidoFeedbackInternoSerializer`. Sem token cru.
 *
 * `respostas` é o que fecha o requisito "os formulários preenchidos devem ser
 * armazenados no banco": guardado sem lugar para LER é guardado e inútil. Elas
 * vêm no MESMO payload que a busca do link já traz, então a tela de leitura não
 * custa nenhuma requisição a mais.
 *
 * É uma LISTA porque o mesmo link aceita várias pessoas — mostrar só a mais
 * recente com um contador dizendo 3 seria confusão garantida. Ordem: da mais
 * recente para a mais antiga, decidida pelo servidor.
 *
 * LISTA VAZIA cobre DOIS casos que a tela precisa distinguir pelo `estado`:
 * nunca respondido, e respondido mas já apagado pela política de retenção (que
 * deleta a linha e deixa o pedido em `estado='respondido'`).
 */
export type PedidoFeedback = {
  id: number;
  estado: EstadoPedido;
  /** Dia (YYYY-MM-DD) a partir do qual os 30 dias são contados. */
  data_referencia: string;
  respondido_em: string | null;
  /** A URL pública inteira — o token vai embutido nela. É isto que se copia. */
  url_publica: string;
  respostas: RespostaLegivel[];
  /** Mesmo número do resumo do board — sai do mesmo campo, nunca diverge. */
  total_respostas: number;
};

/**
 * Busca o pedido de feedback ligado a um card. `null` quando não há.
 *
 * O endpoint casa `<id>` contra o card MARCADO **ou** contra o card do kanban de
 * monitoramento, então a MESMA chamada serve às duas telas: o card original que
 * alguém marcou e o card de acompanhamento que nasceu dele.
 *
 * ELE É DELIBERADAMENTE ESTREITO no backend: sem `?card=` a lista sai vazia e
 * não existe rota de detalhe, porque a `url_publica` contém o token, que é a
 * credencial INTEIRA da rota anônima. Por isso o link também NÃO vem embutido no
 * CardSerializer: seria despejar o token em toda listagem de card.
 *
 * Não trata erro: quem chama decide o que fazer (as telas engolem e não mostram
 * o bloco do link — não ter link é um estado normal, não uma falha de tela).
 */
export async function buscarPedidoDoCard(cardId: string | number): Promise<PedidoFeedback | null> {
  const { data } = await api.get<PaginatedResponse<PedidoFeedback> | PedidoFeedback[]>(
    `/feedbacks/pedidos/?card=${encodeURIComponent(String(cardId))}`,
  );
  const lista = Array.isArray(data) ? data : (data.results ?? []);
  return lista[0] ?? null;
}

/**
 * Como um valor gravado vira texto na tela, usando SÓ o que veio no item.
 *
 * Escala grava INTEIRO no banco (7, não '7') — é o que torna média de NPS e
 * distribuição de 1 a 5 possíveis sem parsing depois. O preço é que o número
 * sozinho não se explica: "4" não diz se a nota vai até 5 ou até 10. Por isso o
 * item carrega o domínio e a formatação acontece aqui:
 *
 *   escala COM rótulos → "4 - Ótimo"    (os rótulos do próprio formulário)
 *   escala SEM rótulos → "8 de 10"      (o `maximo` dá a régua)
 *   escolha única e texto → a string exata que foi gravada
 *
 * Nada é inventado: se o formulário não deu rótulo, nenhum é criado aqui.
 */
export function formatarValorResposta(item: ItemResposta): string {
  if (item.valor === null) return '';

  if (item.tipo === 'escala') {
    const rotulo = item.rotulos?.[String(item.valor)];
    if (rotulo) return `${item.valor} - ${rotulo}`;
    if (typeof item.maximo === 'number') return `${item.valor} de ${item.maximo}`;
  }

  return String(item.valor);
}

/**
 * O link público ainda abre neste estado? Espelha `link_ativo` do backend.
 *
 * Existe como função (e não como `estado !== 'feedback_encerrado'` espalhado)
 * pelo mesmo motivo que existe lá: a pergunta "este link ainda funciona?" é
 * feita em mais de uma tela, e uma resposta só evita que elas discordem no dia
 * em que houver um segundo estado fechado.
 */
export function linkAtivo(estado: EstadoPedido | string): boolean {
  return estado !== 'feedback_encerrado';
}

/** Rótulo humano de cada estado — o mesmo texto das colunas do board. */
export function rotuloEstadoPedido(estado: EstadoPedido | string): string {
  switch (estado) {
    case 'aguardando_prazo':
      return 'Aguardando 30 dias';
    case 'aguardando_resposta':
      return 'Aguardando Feedback';
    case 'respondido':
      return 'Feedback colhido';
    case 'feedback_encerrado':
      // O rótulo VISÍVEL diverge da key de propósito: 'finalizado' já é a etapa
      // terminal dos projetos comuns no catálogo global, então a chave teve de
      // ser outra — mas o nome que o usuário pediu é este.
      return 'Feedback Finalizado';
    default:
      return estado;
  }
}

/**
 * Copia um texto para a área de transferência. `true` se conseguiu.
 *
 * `navigator.clipboard` só existe em contexto seguro (https ou localhost) — num
 * acesso por IP interno em http, que é como este sistema é usado na rede da
 * empresa, ele é `undefined` e o botão de copiar simplesmente não faria nada.
 * O fallback com `document.execCommand('copy')` é feio e obsoleto, e é
 * exatamente por isso que está aqui: é o único que funciona em http.
 *
 * COPIAR É A ENTREGA DESTA FEATURE — o envio do link é manual. Um botão que
 * falha em silêncio na metade das máquinas mataria o fluxo inteiro.
 */
export async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no fallback abaixo — permissão negada ou contexto inseguro */
  }

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    // Fora da tela e sem foco visível: o textarea não pode piscar na interface.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** O resumo que o QUADRO usa: só o necessário para o preview do card. */
export type PedidoFeedbackResumo = {
  id: number;
  /** Card MARCADO (o do checkbox). */
  card: number | null;
  /** Card do quadro de monitoramento — é por ele que o preview casa. */
  card_kanban: number | null;
  estado: EstadoPedido;
  url_publica: string;
  total_respostas: number;
  /**
   * Dias que faltam para o formulário ser liberado. `null` quando o pedido já
   * saiu da espera — e `null` é diferente de `0`, que significa "libera hoje".
   *
   * Vem do SERVIDOR de propósito: a conta tem de ser a mesma da varredura que
   * promove o pedido. Refazê-la aqui divergiria perto da meia-noite.
   */
  dias_restantes: number | null;
  /** Data (YYYY-MM-DD, fuso local) da resposta mais recente. `null` se não houver. */
  ultima_resposta_em: string | null;
};

/**
 * Busca os pedidos de VÁRIOS cards numa requisição só.
 *
 * O quadro de monitoramento desenha dezenas de cards, e cada um precisa do link
 * e da contagem. Uma chamada por card seria N requisições a cada render — daí o
 * `?cards=` em lote, que o backend atende com um serializer enxuto.
 *
 * Devolve um MAPA indexado por id de card, já casando tanto `card_kanban` quanto
 * `card`: a mesma resposta serve ao quadro de monitoramento e ao card original.
 *
 * Não trata erro por escolha: não ter link é estado normal (pedido ainda não
 * criado), e a tela simplesmente não desenha o bloco.
 */
export async function buscarPedidosDosCards(
  ids: Array<string | number>,
): Promise<Record<string, PedidoFeedbackResumo>> {
  const limpos = Array.from(new Set(ids.map((i) => String(i)).filter(Boolean)));
  if (limpos.length === 0) return {};

  const { data } = await api.get<{ results?: PedidoFeedbackResumo[] } | PedidoFeedbackResumo[]>(
    `/feedbacks/pedidos/?cards=${encodeURIComponent(limpos.join(','))}`,
  );
  const lista = Array.isArray(data) ? data : (data?.results ?? []);

  const mapa: Record<string, PedidoFeedbackResumo> = {};
  for (const pedido of lista) {
    if (pedido.card_kanban != null) mapa[String(pedido.card_kanban)] = pedido;
    if (pedido.card != null) mapa[String(pedido.card)] = pedido;
  }
  return mapa;
}


/**
 * Baixa a planilha com TODOS os feedbacks (uma linha por resposta).
 *
 * `responseType: 'blob'` é obrigatório: sem ele o axios trataria o xlsx como
 * texto e o arquivo salvo chegaria corrompido — abre e dá erro de formato.
 *
 * O nome do arquivo vem do `Content-Disposition` do servidor, com um fallback
 * local: assim a data do nome é a do servidor, não a do relógio de quem baixa.
 */
export async function exportarFeedbacks(formato: 'xlsx' | 'csv'): Promise<void> {
  const resposta = await api.get(`/feedbacks/exportar/?formato=${formato}`, {
    responseType: 'blob',
  });

  const disposicao = String(resposta.headers?.['content-disposition'] ?? '');
  const casado = /filename="?([^"]+)"?/.exec(disposicao);
  const nome = casado?.[1] ?? `feedbacks.${formato}`;

  const url = window.URL.createObjectURL(new Blob([resposta.data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // `revokeObjectURL` sem isto o blob fica na memória da aba até recarregar —
  // com exportações repetidas de planilhas grandes, isso acumula.
  window.URL.revokeObjectURL(url);
}


/** Uma página da pré-visualização da tabela de feedbacks.
 *
 * Reusa o tipo do preview de relatórios de propósito: é o MESMO diálogo que
 * desenha as duas coisas, e um formato próprio aqui obrigaria a converter — que
 * é onde as duas telas começariam a divergir. */
export async function previaFeedbacks(
  offset: number,
  limit: number,
): Promise<ReportTablePreview> {
  const { data } = await api.get<ReportTablePreview>(
    `/feedbacks/exportar/previa/?offset=${offset}&limit=${limit}`,
  );
  return data;
}
