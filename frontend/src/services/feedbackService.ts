import axios from 'axios';

/**
 * Cliente HTTP da rota PÚBLICA de feedback (`GET|POST /api/feedback/<token>/`).
 *
 * Instância PRÓPRIA do axios, deliberadamente SEM interceptors. Não é preferência
 * de estilo — são dois defeitos concretos que o cliente padrão (`services/api.ts`)
 * traria para a única rota anônima do sistema:
 *
 *   1. o interceptor de REQUISIÇÃO (api.ts:23-40) injeta `Authorization: Token …`
 *      em tudo que não esteja numa lista fixa de 3 caminhos. Um funcionário logado
 *      no mesmo navegador emprestaria a sessão dele para a chamada anônima;
 *   2. o interceptor de RESPOSTA (api.ts:49-67) apaga o localStorage e redireciona
 *      para /entrar em qualquer 401. Quem só abriu o link para responder um
 *      formulário seria deslogado da plataforma sem entender por quê.
 *
 * Precedente no repositório: `services/formulariosApi.ts:105` também cria a
 * própria instância. Sem `withCredentials`, nenhum cookie de sessão sai daqui.
 */

// Mesma resolução de api.ts:5-7 — em dev aponta para o Django local, em produção
// para o mesmo domínio da SPA.
const baseURL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : '/api');

const feedbackApi = axios.create({
  baseURL,
  /** Sem timeout o axios espera indefinidamente se o servidor não responder. */
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Um campo da definição, como o backend o expõe (`campos_publicos`).
 *
 * CINCO chaves são SEMPRE emitidas; as demais são CONDICIONAIS ao tipo — e a
 * assimetria é do backend, não uma escolha daqui. Um campo de texto da versão 1
 * do formulário chega com exatamente as mesmas cinco chaves de antes de as
 * seções e os tipos novos existirem, byte a byte. É por isso que todas as
 * chaves novas são OPCIONAIS neste type: declará-las obrigatórias faria o
 * TypeScript exigir do payload da versão 1 algo que ele nunca vai mandar.
 */
export interface CampoFeedback {
  key: string;
  label: string;
  /**
   * 'texto', 'texto_longo', 'escala' ou 'escolha_unica'. Tipo desconhecido cai
   * em texto simples — a mesma degradação segura que o backend faz no dispatch
   * de validação, para que trocar a definição do formulário (que é DADO) nunca
   * quebre esta página.
   */
  tipo: string;
  obrigatorio: boolean;
  max_length: number;
  /**
   * Cabeçalho de agrupamento. AUSENTE em toda a versão 1 — campo sem seção
   * renderiza solto, sem cabeçalho, como antes de as seções existirem.
   */
  secao?: string;
  /** Só em 'escolha_unica'. A ordem da lista é a ordem da tela. */
  opcoes?: string[];
  /** Só em 'escala'. */
  minimo?: number;
  maximo?: number;
  /** Só em 'escala', e opcional lá também: {'1': 'Péssimo', …}. */
  rotulos?: Record<string, string>;
}

/** O payload público inteiro. O backend não devolve mais nada além disto. */
export interface FormularioPublico {
  titulo: string;
  /** Intro da página. Vem do BANCO para ficar congelada junto com as perguntas. */
  subtitulo: string;
  referencia: string;
  /** Data de entrega em ISO (`AAAA-MM-DD`). `''` em pedidos antigos.
   *  Fica CRUA de propósito: quem formata é o navegador de quem responde,
   *  no fuso e no idioma dele. */
  dataEntrega: string;
  campos: CampoFeedback[];
}

/**
 * As falhas que a página precisa distinguir para NUNCA cair em tela branca.
 *
 * `indisponivel` cobre de propósito dois casos que o backend torna
 * indistinguíveis (token inexistente e já respondido): ele responde 404 com o
 * mesmo corpo nos dois, para a rota não virar oráculo de enumeração. A página
 * usa um texto que serve aos dois.
 */
export type FalhaFeedback =
  | { tipo: 'indisponivel' }
  /**
   * O feedback foi ENCERRADO pela equipe (410 GONE).
   *
   * É o único caso que o backend torna distinguível, e a exceção é deliberada:
   * quem tem o token já sabia que o link existia (ele foi enviado à mão), então
   * dizer "isto acabou" não entrega nada a ninguém — enquanto esconder o
   * encerramento atrás do 404 genérico faria o cliente achar que o link quebrou
   * e cobrar a equipe. A propriedade que continua de pé é a outra: token
   * inexistente, malformado ou apagado seguem INDISTINGUÍVEIS entre si no mesmo
   * 404.
   */
  | { tipo: 'encerrado' }
  | { tipo: 'limite' }
  | { tipo: 'validacao'; mensagens: string[] }
  | { tipo: 'rede' };

const MSG_VALIDACAO_GENERICA = 'Não foi possível enviar. Revise o que você escreveu.';

/**
 * Traduz o erro do axios para o que a interface precisa decidir.
 *
 * Qualquer coisa que não seja uma resposta HTTP reconhecida vira `rede` — o
 * caso "não sei o que houve" tem de ter uma tela com botão de tentar de novo,
 * nunca um `undefined` que quebra a renderização.
 */
export function classificarFalha(erro: unknown): FalhaFeedback {
  if (!axios.isAxiosError(erro)) return { tipo: 'rede' };

  const status = erro.response?.status;
  if (status === 404) return { tipo: 'indisponivel' };
  // 410 GONE é o gancho ESTÁVEL do encerramento — casar a string da mensagem
  // seria uma dependência que quebra na primeira revisão do texto. O corpo traz
  // `encerrado: true` pelo mesmo motivo, mas o status já basta e não depende de
  // o corpo ter sido parseado.
  if (status === 410) return { tipo: 'encerrado' };
  if (status === 429) return { tipo: 'limite' };
  if (status === 400) {
    return { tipo: 'validacao', mensagens: extrairMensagens(erro.response?.data) };
  }
  return { tipo: 'rede' };
}

/** O 400 da rota chega como `{ valores: ['mensagem', …] }` (views.py:166). */
function extrairMensagens(data: unknown): string[] {
  if (data && typeof data === 'object') {
    const valores = (data as { valores?: unknown }).valores;
    if (Array.isArray(valores)) {
      const mensagens = valores.filter((m): m is string => typeof m === 'string' && !!m.trim());
      if (mensagens.length > 0) return mensagens;
    }
  }
  return [MSG_VALIDACAO_GENERICA];
}

/**
 * Monta o caminho com o token JÁ CODIFICADO.
 *
 * `secrets.token_urlsafe` só produz [A-Za-z0-9_-], mas um token digitado ou
 * colado errado pode trazer `/` ou `?` e reescrever a rota chamada. Codificado,
 * um token inválido bate no MESMO 404 de qualquer outro — que é justamente a
 * propriedade que o backend se esforça para manter.
 */
function caminho(token: string): string {
  return `/feedback/${encodeURIComponent(token)}/`;
}

const MAX_LENGTH_PADRAO = 2000;

/**
 * Quantos pontos uma escala pode ter na TELA.
 *
 * O backend limita o intervalo a `maximo > minimo` e nada mais — ele valida
 * número, não desenho. Aqui cada ponto vira um controle no DOM: um `maximo`
 * digitado errado numa migration futura (100000 em vez de 10) travaria o
 * navegador de quem abriu o link, e essa pessoa é justamente a que não tem como
 * pedir ajuda. 21 cobre com folga as duas escalas do formulário (0–10 e 1–5).
 */
const MAX_PONTOS_ESCALA = 21;

/** Igual ao `_INTEIRO_EXATO` do backend: '+7', '7.0' e 'sete' NÃO passam. */
const INTEIRO_EXATO = /^-?\d+$/;

function inteiroOuNulo(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isInteger(bruto) ? bruto : null;
  if (typeof bruto === 'string' && INTEIRO_EXATO.test(bruto.trim())) return Number(bruto.trim());
  return null;
}

function normalizarOpcoes(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const saida: string[] = [];
  for (const item of bruto) {
    if (typeof item !== 'string') continue;
    const texto = item.trim();
    // Duplicata é descartada porque o `checked` compara VALOR: duas opções
    // iguais ficariam as duas marcadas com um clique só.
    if (!texto || saida.includes(texto)) continue;
    saida.push(texto);
  }
  return saida;
}

function normalizarRotulos(bruto: unknown): Record<string, string> {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === 'string' && valor.trim()) saida[chave] = valor.trim();
  }
  return saida;
}

/**
 * Normaliza UM campo. `null` quando ele não dá nem para renderizar.
 *
 * DEGRADAÇÃO PARA TEXTO, e não omissão, quando o DOMÍNIO chega quebrado
 * (escolha única sem nenhuma opção, escala sem intervalo utilizável). O backend
 * já omite esses campos antes de emitir — este ramo só existe para o dia em que
 * ele não omitir. Entre "sumir com a pergunta" e "mostrar a pergunta com uma
 * caixa de texto", a segunda é melhor: a pessoa ao menos vê o que foi
 * perguntado, e a validação do servidor (que é a que vale) continua sendo a
 * autoridade sobre o que é aceito. Sumir apagaria a existência da pergunta.
 */
function normalizarCampo(bruto: unknown): CampoFeedback | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const cru = bruto as Record<string, unknown>;

  const key = typeof cru.key === 'string' ? cru.key.trim() : '';
  if (!key) return null;

  const campo: CampoFeedback = {
    key,
    label: typeof cru.label === 'string' && cru.label ? cru.label : key,
    tipo: typeof cru.tipo === 'string' ? cru.tipo : 'texto',
    obrigatorio: !!cru.obrigatorio,
    max_length:
      typeof cru.max_length === 'number' && Number.isFinite(cru.max_length) && cru.max_length > 0
        ? cru.max_length
        : MAX_LENGTH_PADRAO,
  };

  const secao = typeof cru.secao === 'string' ? cru.secao.trim() : '';
  if (secao) campo.secao = secao;

  if (campo.tipo === 'escolha_unica') {
    const opcoes = normalizarOpcoes(cru.opcoes);
    if (opcoes.length === 0) return { ...campo, tipo: 'texto' };
    campo.opcoes = opcoes;
  } else if (campo.tipo === 'escala') {
    const minimo = inteiroOuNulo(cru.minimo);
    const maximo = inteiroOuNulo(cru.maximo);
    const invalida =
      minimo === null || maximo === null || maximo <= minimo || maximo - minimo + 1 > MAX_PONTOS_ESCALA;
    if (invalida) return { ...campo, tipo: 'texto' };
    campo.minimo = minimo;
    campo.maximo = maximo;
    const rotulos = normalizarRotulos(cru.rotulos);
    if (Object.keys(rotulos).length > 0) campo.rotulos = rotulos;
  }

  return campo;
}

/**
 * Normaliza o payload antes de entregá-lo à página.
 *
 * A página é renderizada a partir de `campos`, que é definição vinda do banco.
 * Um item malformado ali não pode virar exceção de renderização numa tela que
 * um estranho está vendo — por isso o filtro, e não uma asserção de tipo.
 */
function normalizar(bruto: unknown): FormularioPublico {
  const dados = (bruto ?? {}) as Record<string, unknown>;
  const campos = Array.isArray(dados.campos) ? dados.campos : [];

  return {
    titulo: typeof dados.titulo === 'string' ? dados.titulo : '',
    // Versão antiga do formulário devolve '' e a página não renderiza a intro.
    subtitulo: typeof dados.subtitulo === 'string' ? dados.subtitulo : '',
    referencia: typeof dados.referencia === 'string' ? dados.referencia : '',
    dataEntrega: typeof dados.data_entrega === 'string' ? dados.data_entrega : '',
    campos: campos
      .map((campo) => normalizarCampo(campo))
      .filter((campo): campo is CampoFeedback => campo !== null),
  };
}

/** Campo de várias linhas? Espelha TIPOS_TEXTO do backend. */
export function ehTextoLongo(tipo: string): boolean {
  return tipo === 'texto_longo';
}

export function ehEscala(tipo: string): boolean {
  return tipo === 'escala';
}

export function ehEscolhaUnica(tipo: string): boolean {
  return tipo === 'escolha_unica';
}

/**
 * O valor vem de um CONJUNTO FECHADO (uma opção, um ponto da escala)?
 *
 * Serve para uma decisão concreta na validação do cliente: nesses campos o
 * `max_length` NÃO é cobrado. Ele existe na definição para o payload público e
 * para o atributo `maxLength` de uma caixa de texto — cobrar "máximo de 2
 * caracteres" de quem clicou num botão de NPS seria uma mensagem absurda, sobre
 * um limite que a pessoa não tem como violar. O que guarda esses campos é o
 * DOMÍNIO, no servidor.
 */
export function temDominioFechado(tipo: string): boolean {
  return ehEscala(tipo) || ehEscolhaUnica(tipo);
}

/** Os pontos de uma escala, do mínimo ao máximo. Vazio se não for escala. */
export function pontosDaEscala(campo: CampoFeedback): number[] {
  if (!ehEscala(campo.tipo)) return [];
  const minimo = campo.minimo ?? 0;
  const maximo = campo.maximo ?? 0;
  if (maximo <= minimo) return [];
  return Array.from({ length: maximo - minimo + 1 }, (_, i) => minimo + i);
}

/**
 * O rótulo de um ponto da escala, quando a definição declara um.
 *
 * Só a pergunta 3.1 do formulário tem rótulos ("1 - Péssimo" … "5 - Excelente").
 * As outras escalas não têm, e NÃO se inventa nenhum: o enunciado já orienta que
 * maior é melhor, e um rótulo criado aqui seria texto que ninguém aprovou
 * aparecendo para o cliente.
 */
export function rotuloDoPonto(campo: CampoFeedback, ponto: number): string {
  return campo.rotulos?.[String(ponto)] ?? '';
}

/**
 * O valor guardado ainda cabe no domínio ATUAL do campo?
 *
 * Usado ao RESTAURAR O RASCUNHO. Sem isto há uma armadilha real: o rascunho
 * traz "Sim" (ou "9"), o formulário mudou de versão e essa opção não existe
 * mais, nenhum botão aparece marcado na tela — mas o estado do React acha que o
 * campo está preenchido. A validação do cliente passaria, e a pessoa levaria um
 * 400 do servidor sobre um campo que ela vê vazio. Descartar o valor órfão faz
 * o campo voltar a ser, honestamente, "não respondido".
 *
 * Campo de texto aceita qualquer coisa: o domínio dele é o comprimento, que é
 * checado na validação.
 */
export function valorPertenceAoDominio(campo: CampoFeedback, valor: string): boolean {
  if (!valor) return true;
  if (ehEscolhaUnica(campo.tipo)) return (campo.opcoes ?? []).includes(valor);
  if (ehEscala(campo.tipo)) {
    const numero = inteiroOuNulo(valor);
    return numero !== null && numero >= (campo.minimo ?? 0) && numero <= (campo.maximo ?? 0);
  }
  return true;
}

/**
 * Distribui as mensagens de erro do SERVIDOR pelos campos que as originaram.
 *
 * O backend formata cada erro de campo como `"<label>": <motivo>.` (e nunca ecoa
 * o valor recebido, porque a rota é anônima). Casando o rótulo entre aspas com
 * `campos`, a mensagem do servidor aterrissa DEBAIXO da pergunta certa, do mesmo
 * jeito que a validação do cliente — em vez de virar mais uma linha numa lista
 * no topo, longe do controle que a pessoa precisa corrigir.
 *
 * O que NÃO casar continua geral, e isso é proposital: `Formato inválido.`,
 * `Resposta muito longa.` e `Campos não reconhecidos: …` são sobre o envio
 * inteiro, não sobre um campo. Uma mensagem sem dono NUNCA é descartada — some
 * da tela seria pior do que aparecer no lugar errado.
 */
export function associarErrosAosCampos(
  mensagens: string[],
  campos: CampoFeedback[],
): { porCampo: Record<string, string>; gerais: string[] } {
  const porCampo: Record<string, string> = {};
  const gerais: string[] = [];

  for (const mensagem of mensagens) {
    const casado = /^"(.+)":\s*(.+)$/.exec(mensagem);
    const campo = casado ? campos.find((c) => c.label === casado[1]) : undefined;
    if (!casado || !campo || porCampo[campo.key]) {
      gerais.push(mensagem);
      continue;
    }
    // Só o motivo fica embaixo do campo: repetir o rótulo ali seria lê-lo duas
    // vezes seguidas. Maiúscula inicial porque o texto do servidor é a segunda
    // metade de uma frase ("obrigatório.") e vira frase sozinho aqui.
    const motivo = casado[2];
    porCampo[campo.key] = motivo.charAt(0).toUpperCase() + motivo.slice(1);
  }

  return { porCampo, gerais };
}

/** Busca a definição do formulário. Pode ser chamada quantas vezes for preciso. */
export async function carregarFormulario(token: string): Promise<FormularioPublico> {
  const { data } = await feedbackApi.get<unknown>(caminho(token));
  return normalizar(data);
}

/** Envia a resposta. Só funciona UMA vez: depois disso a rota devolve 404. */
export async function enviarResposta(
  token: string,
  valores: Record<string, string>,
): Promise<void> {
  await feedbackApi.post(caminho(token), { valores });
}

/* ------------------------------------------------------------------ *
 * Rascunho — fica NO NAVEGADOR, nunca no servidor.
 *
 * Atende literalmente o cenário que o usuário descreveu ("caso feche sem
 * querer ou preencha e esqueça de enviar") sem criar tabela de rascunho e,
 * principalmente, sem guardar mais dado pessoal do lado de cá: o texto só sai
 * do navegador quando a pessoa aperta enviar. Com ONZE perguntas isso passou a
 * valer mais, não menos: perder o preenchido é perder muito mais trabalho.
 *
 * TUDO É STRING AQUI, INCLUSIVE ESCALA — e é por isso que o estado da página
 * também é `Record<string, string>`. O rascunho só sobrevive ao JSON como
 * string (a leitura abaixo descarta qualquer valor que não seja uma), então
 * guardar `7` como número faria a resposta da escala EVAPORAR quando a pessoa
 * reabrisse o link, exatamente no cenário que este arquivo existe para cobrir.
 * Quem converte para inteiro é o servidor, que é a única autoridade sobre o
 * tipo gravado — e `_validar_escala` aceita string decimal exata justamente por
 * causa disto.
 * ------------------------------------------------------------------ */

const PREFIXO_RASCUNHO = 'feedback_rascunho_';

/**
 * Todo acesso é embrulhado em try/catch: localStorage lança em navegação
 * privativa e quando a cota estoura. Perder o rascunho é aceitável; derrubar a
 * página de quem está respondendo, não.
 */
export function lerRascunho(token: string): Record<string, string> {
  try {
    const cru = window.localStorage.getItem(PREFIXO_RASCUNHO + token);
    if (!cru) return {};
    const dados: unknown = JSON.parse(cru);
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return {};
    const saida: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(dados as Record<string, unknown>)) {
      if (typeof valor === 'string') saida[chave] = valor;
    }
    return saida;
  } catch {
    return {};
  }
}

export function salvarRascunho(token: string, valores: Record<string, string>): void {
  try {
    window.localStorage.setItem(PREFIXO_RASCUNHO + token, JSON.stringify(valores));
  } catch {
    /* rascunho é conveniência: falhar em silêncio é o comportamento correto */
  }
}

/** Chamado no envio bem-sucedido — o texto não fica sobrando no navegador. */
export function limparRascunho(token: string): void {
  try {
    window.localStorage.removeItem(PREFIXO_RASCUNHO + token);
  } catch {
    /* idem */
  }
}
