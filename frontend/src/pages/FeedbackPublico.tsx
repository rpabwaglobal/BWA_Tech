import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Link2Off, Loader2, Lock, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { agruparPorSecao } from '@/lib/feedbackSecoes';
import { useTheme } from '../context/ThemeContext';
import {
  associarErrosAosCampos,
  carregarFormulario,
  classificarFalha,
  ehEscala,
  ehEscolhaUnica,
  ehTextoLongo,
  enviarResposta,
  lerRascunho,
  limparRascunho,
  pontosDaEscala,
  rotuloDoPonto,
  salvarRascunho,
  temDominioFechado,
  valorPertenceAoDominio,
} from '../services/feedbackService';
import type { CampoFeedback, FormularioPublico } from '../services/feedbackService';

/**
 * Página PÚBLICA do formulário de feedback. Sem login, sem menu, sem sidebar e
 * sem nenhum link para dentro da plataforma — quem abre isto pode nunca ter
 * visto o sistema, e não deveria descobrir nada sobre ele.
 *
 * Ela fica FORA de `PublicRoute` (que jogaria um funcionário logado para o
 * painel) e FORA do bloco `path="/"` com PrivateRoute/Layout (que carregaria
 * sidebar e WebSocket). Ver App.tsx.
 *
 * Todo dado exibido vem do endpoint público, que devolve EXATAMENTE
 * {titulo, subtitulo, referencia, campos}: não há responsável, sprint, setor,
 * id de card nem valores para vazar aqui, porque eles não chegam.
 *
 * ONZE PERGUNTAS EM UMA PÁGINA SÓ, com rolagem — e nada de assistente em
 * etapas. O subtítulo promete "menos de 2 minutos"; quebrar isso em seis telas
 * multiplicaria por seis as chances de abandono no meio, e o servidor não tem
 * NENHUMA noção de resposta parcial (a gravação é um POST único, e o índice
 * único do OneToOne é o que garante resposta única). Quem sai no meio é
 * atendido pelo rascunho local, não por meia resposta no banco.
 */

/**
 * Todas as fases têm tela. A exigência é "sem tela branca em nenhum estado",
 * então o estado é uma união fechada e o render é um switch sobre ela — um caso
 * novo passa a ser erro de compilação, não uma página em branco.
 *
 * `indisponivel` é UMA fase para DOIS casos (token inválido e já respondido)
 * porque o backend os torna indistinguíveis de propósito, para a rota não virar
 * oráculo de enumeração. O texto da tela cobre os dois sem mentir para nenhum.
 */
type Fase =
  | { nome: 'carregando' }
  /** Tela de contexto ANTES das perguntas: de que entrega se trata e por que
   *  responder. O formulário já veio carregado — é só um passo de leitura, sem
   *  requisição nenhuma, então voltar para cá não custa nada. */
  | { nome: 'apresentacao'; form: FormularioPublico }
  | { nome: 'formulario'; form: FormularioPublico }
  | { nome: 'enviado' }
  | { nome: 'indisponivel' }
  /**
   * O feedback foi ENCERRADO pela equipe — tela PRÓPRIA, e não a de
   * `indisponivel`. As duas dizem coisas diferentes e a diferença importa para
   * quem está do outro lado: "não está mais disponível" convida a tentar de
   * novo ou a cobrar o link; "foi encerrado" diz que o ciclo acabou e que não há
   * nada a fazer. O backend distingue com 410 justamente para isto.
   */
  | { nome: 'encerrado' }
  | { nome: 'falha'; mensagem: string };

/** "30 de junho de 2026". Vazio se a data não vier (pedido antigo). */
function dataPorExtenso(iso: string): string {
  if (!iso) return '';
  // Partes explícitas, e NÃO `new Date(iso)`: uma string 'AAAA-MM-DD' é lida
  // como UTC pelo construtor, e num fuso a oeste isso mostra o DIA ANTERIOR.
  const [ano, mes, dia] = iso.split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const d = new Date(ano, mes - 1, dia);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const MSG_REDE = 'Não conseguimos carregar o formulário. Verifique sua conexão e tente de novo.';
const MSG_LIMITE = 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.';
const MSG_FORM_VAZIO = 'O formulário está indisponível no momento. Tente novamente mais tarde.';

export default function FeedbackPublico() {
  const { token = '' } = useParams<{ token: string }>();
  const { theme } = useTheme();

  const [fase, setFase] = useState<Fase>({ nome: 'carregando' });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  /**
   * DUAS listas de erro, e a separação é a exigência de "erro por campo, não só
   * um aviso geral no topo": `errosPorCampo` é o que aparece DEBAIXO de cada
   * pergunta (é o que a pessoa precisa para saber o que corrigir), e
   * `errosGerais` guarda o que não pertence a campo nenhum — falha de rede,
   * limite de tentativas, "Resposta muito longa." Nada é descartado.
   */
  const [errosPorCampo, setErrosPorCampo] = useState<Record<string, string>>({});
  const [errosGerais, setErrosGerais] = useState<string[]>([]);

  // Carrega a definição. Reabrir o link antes de responder cai exatamente aqui e
  // mostra o formulário de novo — é o comportamento pedido, e o backend aceita
  // o GET quantas vezes for preciso enquanto o pedido não estiver respondido.
  useEffect(() => {
    let ativo = true;

    if (!token) {
      setFase({ nome: 'indisponivel' });
      return;
    }

    setFase({ nome: 'carregando' });
    carregarFormulario(token)
      .then((form) => {
        if (!ativo) return;
        // Definição vazia (ou toda malformada) não pode virar um formulário sem
        // campos: o botão enviaria `{}`, o backend aceitaria — não há campo
        // obrigatório a cobrar — e o link seria QUEIMADO sem ninguém ter
        // respondido nada. Melhor não deixar responder do que gastar o pedido.
        if (form.campos.length === 0) {
          setFase({ nome: 'falha', mensagem: MSG_FORM_VAZIO });
          return;
        }
        // O rascunho é restaurado FILTRADO pela definição atual, em dois níveis:
        // pela CHAVE (um campo que não existe mais some em vez de ser enviado e
        // recusado) e pelo DOMÍNIO (uma opção que saiu da lista, ou um número
        // fora do intervalo, vira "não respondido" em vez de um valor invisível
        // na tela que o servidor recusaria depois).
        const rascunho = lerRascunho(token);
        const iniciais: Record<string, string> = {};
        for (const campo of form.campos) {
          const guardado = rascunho[campo.key] ?? '';
          iniciais[campo.key] = valorPertenceAoDominio(campo, guardado) ? guardado : '';
        }
        setValores(iniciais);
        // Entra pela APRESENTAÇÃO, não direto nas perguntas: quem abre o link
        // vindo de fora precisa saber de que entrega se trata antes de opinar.
        setFase({ nome: 'apresentacao', form });
      })
      .catch((erro: unknown) => {
        if (!ativo) return;
        const falha = classificarFalha(erro);
        if (falha.tipo === 'indisponivel') setFase({ nome: 'indisponivel' });
        else if (falha.tipo === 'encerrado') setFase({ nome: 'encerrado' });
        else if (falha.tipo === 'limite') setFase({ nome: 'falha', mensagem: MSG_LIMITE });
        else setFase({ nome: 'falha', mensagem: MSG_REDE });
      });

    // Evita `setState` depois que a página saiu — inclusive na montagem dupla
    // que o StrictMode faz em desenvolvimento.
    return () => {
      ativo = false;
    };
  }, [token]);

  // Salva o rascunho com um respiro, para não escrever no localStorage a cada
  // tecla. Só roda com o formulário na tela, senão o `{}` inicial sobrescreveria
  // o rascunho que ainda nem foi lido.
  useEffect(() => {
    if (fase.nome !== 'formulario' || !token) return;
    const id = window.setTimeout(() => salvarRascunho(token, valores), 400);
    return () => window.clearTimeout(id);
  }, [fase.nome, token, valores]);

  const alterarCampo = (key: string, valor: string) => {
    setValores((atual) => ({ ...atual, [key]: valor }));
    // Limpa o erro assim que a pessoa mexe no campo: manter a mensagem vermelha
    // enquanto ela corrige é ruído, não informação.
    setErrosPorCampo((atual) => {
      if (!atual[key]) return atual;
      const proximo = { ...atual };
      delete proximo[key];
      return proximo;
    });
  };

  /**
   * Valida no cliente antes de enviar. Não substitui a validação do servidor
   * (que é a que vale, e é estrita) — serve para responder na hora, sem gastar
   * uma requisição do limite de taxa por um campo vazio.
   *
   * Devolve mensagem POR CAMPO. O teto de caracteres é pulado nos campos de
   * domínio fechado: o valor deles vem de um botão, não do teclado, e "máximo
   * de 2 caracteres" num NPS seria uma cobrança sobre algo que a pessoa não tem
   * como violar.
   */
  const validar = (campos: CampoFeedback[]): Record<string, string> => {
    const porCampo: Record<string, string> = {};

    for (const campo of campos) {
      const texto = (valores[campo.key] ?? '').trim();

      if (!texto) {
        if (campo.obrigatorio) {
          porCampo[campo.key] = temDominioFechado(campo.tipo)
            ? 'Escolha uma opção para continuar.'
            : 'Preencha este campo para continuar.';
        }
        continue;
      }

      if (!temDominioFechado(campo.tipo) && texto.length > campo.max_length) {
        porCampo[campo.key] = `Máximo de ${campo.max_length} caracteres.`;
      }
    }

    return porCampo;
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (fase.nome !== 'formulario' || enviando) return;

    const encontrados = validar(fase.form.campos);
    setErrosPorCampo(encontrados);
    setErrosGerais([]);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(fase.form.campos, encontrados);
      return;
    }

    setEnviando(true);
    try {
      await enviarResposta(token, valores);
      // O texto sai do navegador só depois de aceito — não deixamos rascunho
      // sobrando na máquina de quem respondeu.
      limparRascunho(token);
      setFase({ nome: 'enviado' });
    } catch (erro: unknown) {
      const falha = classificarFalha(erro);
      if (falha.tipo === 'indisponivel') {
        // Alguém já respondeu por este link (ou ele deixou de valer) entre o
        // carregamento e o envio. Mesma tela de sempre.
        setFase({ nome: 'indisponivel' });
      } else if (falha.tipo === 'encerrado') {
        // O feedback foi encerrado ENQUANTO a pessoa preenchia. O rascunho fica
        // no navegador de propósito: se o card voltar para uma etapa aberta, o
        // mesmo link reabre e o texto ainda está lá — apagá-lo aqui destruiria
        // um trabalho que pode voltar a valer.
        setFase({ nome: 'encerrado' });
      } else if (falha.tipo === 'validacao') {
        // O 400 do servidor também aterrissa NO CAMPO: ele formata cada erro
        // como `"<label>": <motivo>.`, e casar o rótulo é o que evita uma lista
        // de mensagens no topo sem indicação de onde corrigir.
        const { porCampo, gerais } = associarErrosAosCampos(falha.mensagens, fase.form.campos);
        setErrosPorCampo(porCampo);
        setErrosGerais(gerais);
        focarPrimeiroInvalido(fase.form.campos, porCampo);
      } else if (falha.tipo === 'limite') {
        setErrosGerais([MSG_LIMITE]);
      } else {
        setErrosGerais(['Não conseguimos enviar sua resposta. Verifique sua conexão e tente de novo.']);
      }
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Leva o cursor ao primeiro campo com problema — em vez de só listar o erro.
   *
   * PERCORRE `campos`, e não as chaves do objeto de erros: a ordem que importa é
   * a da DEFINIÇÃO, que é a ordem em que a pessoa vê as perguntas. E o id do
   * alvo passa por `idDoControle`, porque um grupo de rádios não tem um controle
   * único: o id do grupo não existe no DOM, e mirar nele faria esta função virar
   * um no-op SILENCIOSO justamente nas seis obrigatórias, que são as únicas que
   * ficam inválidas na prática.
   */
  const focarPrimeiroInvalido = (campos: CampoFeedback[], porCampo: Record<string, string>) => {
    const primeiro = campos.find((campo) => porCampo[campo.key]);
    if (!primeiro) return;
    const alvo = document.getElementById(idDoControle(primeiro));
    alvo?.focus();
    // Rádio dentro de um grupo pode estar visualmente fora da janela mesmo com
    // foco (o navegador rola pouco quando o alvo está em `sr-only`).
    alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    // `bg-feedback-mesh`: as manchas roxo/ciano da marca, mais presentes que as
    // do app logado. Lá a identidade vem da sidebar em degradê; aqui não há
    // sidebar nenhuma, então o fundo carrega isso sozinho. Tem variante para o
    // tema escuro no index.css.
    <div className="bg-feedback-mesh min-h-screen px-[var(--space-2)] py-[var(--space-3)] sm:py-12">
      <div className="mx-auto w-full max-w-[560px]">
        {/* Marca sem link: identifica quem está perguntando, e não é porta de
            entrada para a plataforma. */}
        <img
          src={theme === 'dark' ? '/assets/bwa-tech-white.png' : '/assets/bwa-tech-black.png'}
          alt="BWA Tech"
          className="mx-auto mb-[var(--space-2)] h-10 w-auto"
        />
        {/* Fio do degradê da marca (roxo → ciano), o mesmo do separador de
            cabeçalho das páginas internas. É o que dá a identidade da
            plataforma numa tela que, de propósito, não tem menu nem sidebar. */}
        <div
          aria-hidden
          className="mx-auto mb-[var(--space-3)] h-[3px] w-[72px] rounded-full"
          style={{ background: 'linear-gradient(90deg, #754c99, #8fd0d7)' }}
        />

        <Card className="painel-vidro">
          <CardContent className="p-[var(--space-3)]">
            {fase.nome === 'carregando' && <TelaCarregando />}

            {fase.nome === 'indisponivel' && <TelaIndisponivel />}

            {fase.nome === 'encerrado' && <TelaEncerrado />}

            {fase.nome === 'enviado' && <TelaEnviado />}

            {fase.nome === 'falha' && (
              <TelaFalha mensagem={fase.mensagem} aoTentarNovamente={() => window.location.reload()} />
            )}

            {fase.nome === 'apresentacao' && (
              <TelaApresentacao
                form={fase.form}
                aoComecar={() => setFase({ nome: 'formulario', form: fase.form })}
              />
            )}

            {fase.nome === 'formulario' && (
              <form onSubmit={enviar} noValidate className="feedback-tela space-y-[var(--space-3)]">
                <header className="space-y-[var(--space-1)]">
                  <h1 className="text-lg font-semibold leading-snug text-[var(--color-foreground)]">
                    {fase.form.titulo || 'Sua opinião'}
                  </h1>
                  {/* A intro vem do BANCO, junto com as perguntas: ela fica acima
                      delas e as descreve, então precisa mudar junto e ficar
                      congelada com a versão do formulário. Versão antiga manda
                      '' e este parágrafo simplesmente não aparece. */}
                  {fase.form.subtitulo && (
                    <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                      {fase.form.subtitulo}
                    </p>
                  )}
                </header>

                <div className="space-y-[var(--space-4)]">
                  {agruparPorSecao(fase.form.campos).map((grupo, indiceGrupo) => (
                    <section key={`${indiceGrupo}-${grupo.secao}`}>
                      {/* Campo sem seção (toda a versão 1) não ganha cabeçalho e
                          renderiza solto, como antes de as seções existirem. */}
                      {grupo.secao && (
                        <h2 className="mb-[var(--space-2)] border-b border-[var(--color-border)] pb-[6px] text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          {grupo.secao}
                        </h2>
                      )}

                      <div className="space-y-[var(--space-3)]">
                        {/* O 1.1 do formulário ("Nome do projeto:") é EXIBIÇÃO,
                            não pergunta — ele não está na definição de propósito,
                            e por isso é injetado aqui, no topo da PRIMEIRA seção,
                            que é onde o formulário original o coloca. Sem seções
                            (versão 1) ele cai antes de tudo, no mesmo lugar em
                            que a referência já aparecia. */}
                        {indiceGrupo === 0 && fase.form.referencia && (
                          <NomeDoProjeto valor={fase.form.referencia} />
                        )}

                        {grupo.itens.map((campo) => (
                          <CampoDoFormulario
                            key={campo.key}
                            campo={campo}
                            valor={valores[campo.key] ?? ''}
                            erro={errosPorCampo[campo.key] ?? ''}
                            desabilitado={enviando}
                            aoAlterar={(valor) => alterarCampo(campo.key, valor)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                {/* O resumo no topo do botão CONTINUA existindo, mas agora ele é
                    o que sobrou: só o que não pertence a nenhum campo. O erro de
                    campo mora debaixo do campo. */}
                {errosGerais.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-[var(--radius-md)] border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 p-[var(--space-2)] text-sm text-[var(--color-destructive)]"
                  >
                    <ul className="space-y-1">
                      {errosGerais.map((mensagem) => (
                        <li key={mensagem}>{mensagem}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Contagem, e não a lista inteira: com 11 perguntas, repetir
                    aqui as mensagens que já estão debaixo de cada campo encheria
                    a tela de vermelho. `role="alert"` é o que faz o leitor de
                    tela anunciar que algo falhou depois do clique em enviar. */}
                {Object.keys(errosPorCampo).length > 0 && (
                  <p role="alert" className="text-sm text-[var(--color-destructive)]">
                    {Object.keys(errosPorCampo).length === 1
                      ? 'Há 1 pergunta para revisar acima.'
                      : `Há ${Object.keys(errosPorCampo).length} perguntas para revisar acima.`}
                  </p>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Loader2 className="mr-[var(--space-1)] h-4 w-4 animate-spin" aria-hidden="true" />
                      Enviando…
                    </>
                  ) : (
                    'Enviar resposta'
                  )}
                </Button>

                <p className="text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                  Sua resposta só é enviada quando você clica no botão. Até lá, o que você
                  preencher fica salvo neste navegador — dá para fechar e voltar depois pelo
                  mesmo link.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Id estável do campo. É o prefixo de tudo que pertence a ele no DOM. */
function idDoCampo(key: string): string {
  return `campo-${key}`;
}

/**
 * O id do CONTROLE que recebe foco.
 *
 * Campo de texto tem um controle só, e ele carrega o id do campo. Grupo de
 * rádios tem N controles e NENHUM com o id do grupo — daí o índice. É esta
 * função que impede o foco de erro de virar um no-op silencioso nas perguntas
 * de um clique.
 */
function idDoControle(campo: CampoFeedback, indice = 0): string {
  return temDominioFechado(campo.tipo) ? `${idDoCampo(campo.key)}-${indice}` : idDoCampo(campo.key);
}

/**
 * O 1.1 do formulário: PREENCHIDO pelo sistema e não editável.
 *
 * NÃO é um `<input disabled>` nem um `<input readOnly>`, e a diferença importa:
 * um controle desabilitado sai da ordem de tabulação e alguns leitores de tela
 * o pulam, e um readOnly parece editável e convida a tentar digitar num campo
 * que não aceita. Aqui é texto de verdade — o leitor de tela lê rótulo e valor
 * em ordem, e o valor pode ser selecionado e copiado.
 *
 * O RÓTULO é o do formulário ("Nome do projeto:"); o VALOR é o nome do CARD, por
 * decisão explícita do usuário — o card é a entrega que está sendo avaliada, e é
 * o que a pessoa reconhece. Ele chega já congelado em `referencia_publica`, uma
 * cópia feita na criação do pedido: renomear o card depois NÃO muda o que um
 * link já enviado mostra.
 */
function NomeDoProjeto({ valor }: { valor: string }) {
  return (
    <div className="space-y-[var(--space-1)]">
      <p className="text-sm font-medium leading-none text-[var(--color-foreground)]">
        Nome do projeto:
      </p>
      <p className="break-words rounded-[var(--radius-md)] border border-[var(--color-input)] bg-[var(--color-muted)]/40 px-3 py-2 text-base leading-snug text-[var(--color-foreground)] sm:text-sm">
        {valor}
      </p>
    </div>
  );
}

/**
 * Um campo da definição. Renderiza a partir do `tipo`, que é DADO vindo do
 * banco — trocar o formulário não deveria exigir mexer nesta página. Tipo
 * desconhecido cai em campo de texto simples, a mesma degradação segura que o
 * backend faz na validação.
 */
function CampoDoFormulario({
  campo,
  valor,
  erro,
  desabilitado,
  aoAlterar,
}: {
  campo: CampoFeedback;
  valor: string;
  erro: string;
  desabilitado: boolean;
  aoAlterar: (valor: string) => void;
}) {
  if (ehEscolhaUnica(campo.tipo)) {
    return (
      <GrupoDeRadios
        campo={campo}
        valor={valor}
        erro={erro}
        desabilitado={desabilitado}
        formato="lista"
        opcoes={(campo.opcoes ?? []).map((opcao) => ({ valor: opcao, titulo: opcao, rodape: '' }))}
        aoAlterar={aoAlterar}
      />
    );
  }

  if (ehEscala(campo.tipo)) {
    return (
      <GrupoDeRadios
        campo={campo}
        valor={valor}
        erro={erro}
        desabilitado={desabilitado}
        formato="pontos"
        opcoes={pontosDaEscala(campo).map((ponto) => ({
          valor: String(ponto),
          titulo: String(ponto),
          // Só a 3.1 tem rótulos, e são os do formulário. Escala sem rótulo
          // mostra o número puro; nada é inventado aqui.
          rodape: rotuloDoPonto(campo, ponto),
        }))}
        aoAlterar={aoAlterar}
      />
    );
  }

  return (
    <CampoDeTexto
      campo={campo}
      valor={valor}
      erro={erro}
      desabilitado={desabilitado}
      aoAlterar={aoAlterar}
    />
  );
}

/** A mensagem de erro DO CAMPO. O id existe para o `aria-describedby` apontar. */
function MensagemDeErro({ id, texto }: { id: string; texto: string }) {
  return (
    <p id={id} className="text-xs leading-snug text-[var(--color-destructive)]">
      {texto}
    </p>
  );
}

/** O asterisco de obrigatório. `aria-hidden` porque `required` já é anunciado. */
function MarcaObrigatorio() {
  return (
    <span className="ml-1 text-[var(--color-destructive)]" aria-hidden="true">
      *
    </span>
  );
}

/**
 * SEM `autoFocus`, e a remoção é deliberada.
 *
 * Ele fazia sentido quando o formulário tinha UMA pergunta: focar era a
 * interação inteira. Com onze, e com uma intro e o nome do projeto acima delas,
 * focar no carregamento abre o teclado do celular e rola a página para além de
 * tudo isso — a pessoa chega direto num campo de texto sem ter lido o que está
 * respondendo, e o "leva menos de 2 minutos" some da tela antes de ser lido.
 * Leitores de tela sofrem o mesmo: o foco pula o título e a introdução.
 */
function CampoDeTexto({
  campo,
  valor,
  erro,
  desabilitado,
  aoAlterar,
}: {
  campo: CampoFeedback;
  valor: string;
  erro: string;
  desabilitado: boolean;
  aoAlterar: (valor: string) => void;
}) {
  const id = idDoCampo(campo.key);
  const idContador = `${id}-contador`;
  const idErro = `${id}-erro`;
  const longo = ehTextoLongo(campo.tipo);

  // `text-base` no celular: abaixo de 16px o iOS dá zoom automático ao focar o
  // campo e a página "pula". Em telas maiores volta ao text-sm do sistema.
  const classeControle = [
    'text-base sm:text-sm',
    erro ? 'border-[var(--color-destructive)]' : '',
  ].join(' ');

  const comum = {
    id,
    value: valor,
    disabled: desabilitado,
    required: campo.obrigatorio,
    maxLength: campo.max_length,
    'aria-invalid': !!erro,
    // A mensagem de erro vem ANTES do contador de propósito: é a informação que
    // resolve o problema, e o leitor de tela lê os dois na ordem declarada.
    'aria-describedby': erro ? `${idErro} ${idContador}` : idContador,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => aoAlterar(e.target.value),
  };

  return (
    <div className="space-y-[var(--space-1)]">
      {/* `<label htmlFor>` de verdade, e não um `<p>` solto: é o que faz tocar
          no rótulo levar o foco para o campo — o alvo mais fácil de acertar com
          o dedo num celular. */}
      <label
        htmlFor={id}
        className="block text-sm font-medium leading-snug text-[var(--color-foreground)]"
      >
        {campo.label}
        {campo.obrigatorio && <MarcaObrigatorio />}
      </label>

      {longo ? (
        <Textarea {...comum} rows={6} className={`min-h-[140px] ${classeControle}`} />
      ) : (
        <Input {...comum} type="text" className={`h-11 ${classeControle}`} />
      )}

      {erro && <MensagemDeErro id={idErro} texto={erro} />}

      <p id={idContador} className="text-right text-xs text-[var(--color-muted-foreground)]">
        {valor.length}/{campo.max_length}
      </p>
    </div>
  );
}

/**
 * Um grupo de rádios — serve à ESCOLHA ÚNICA e à ESCALA.
 *
 * `<input type="radio">` NATIVO, e nenhuma dependência nova. O rádio nativo já
 * dá de graça o que mais importa aqui: navegação por setas dentro do grupo,
 * agrupamento por `name` (o que impede duas marcadas), associação com o rótulo e
 * alvo de toque de verdade. Um botão feito à mão teria de reimplementar
 * `roving tabindex` e as setas — e é exatamente o que costuma sair quebrado.
 *
 * NADA DE SLIDER para a escala, por dois motivos concretos: ele nasce com um
 * valor já selecionado, o que FALSIFICA "não respondido" num campo obrigatório;
 * e ele não tem onde mostrar "1 - Péssimo … 5 - Excelente".
 *
 * `<fieldset>` + `<legend>` em vez de `<Label htmlFor>` porque um grupo de
 * rádios NÃO TEM um controle único para o rótulo apontar. `disabled` no
 * fieldset desabilita todos os rádios de uma vez, sem repetir em cada um.
 *
 * DOIS FORMATOS, uma implementação:
 *   'lista'  → uma linha por opção, rádio VISÍVEL. É o certo para 3 alternativas
 *              de texto, onde o que se lê é a frase.
 *   'pontos' → o rádio some (`sr-only`, que mantém foco e leitura) e a caixa
 *              numerada vira o alvo. É o certo para 11 números, que numa lista
 *              vertical viraria uma parede de rolagem.
 */
function GrupoDeRadios({
  campo,
  valor,
  erro,
  desabilitado,
  formato,
  opcoes,
  aoAlterar,
}: {
  campo: CampoFeedback;
  valor: string;
  erro: string;
  desabilitado: boolean;
  formato: 'lista' | 'pontos';
  opcoes: { valor: string; titulo: string; rodape: string }[];
  aoAlterar: (valor: string) => void;
}) {
  const id = idDoCampo(campo.key);
  const idErro = `${id}-erro`;

  return (
    <fieldset
      disabled={desabilitado}
      aria-invalid={!!erro}
      aria-describedby={erro ? idErro : undefined}
      className="space-y-[var(--space-1)] disabled:opacity-60"
    >
      <legend className="mb-[var(--space-1)] text-sm font-medium leading-snug text-[var(--color-foreground)]">
        {campo.label}
        {campo.obrigatorio && <MarcaObrigatorio />}
      </legend>

      {/* PONTOS em GRADE, uma coluna por opção, e não `flex flex-wrap`.
          Com flex-wrap o 0–10 quebrava em duas linhas e as escalas de 1–5
          ficavam encolhidas à esquerda, sobrando espaço à direita. Com
          `repeat(N, 1fr)` a escala ocupa a linha INTEIRA, seja ela de 5 ou de
          11 pontos, e o espaçamento entre os pontos passa a ser regular. */}
      <div
        className={formato === 'pontos' ? 'grid gap-[6px]' : 'space-y-[6px]'}
        style={
          formato === 'pontos'
            ? { gridTemplateColumns: `repeat(${opcoes.length}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {opcoes.map((opcao, indice) => {
          const marcada = valor === opcao.valor;
          const controle = {
            type: 'radio' as const,
            id: idDoControle(campo, indice),
            // O `name` é o que agrupa: sem ele as setas não navegam e duas
            // opções podem ficar marcadas ao mesmo tempo.
            name: id,
            value: opcao.valor,
            checked: marcada,
            required: campo.obrigatorio,
            onChange: () => aoAlterar(opcao.valor),
          };

          if (formato === 'pontos') {
            return (
              <label key={opcao.valor} className="cursor-pointer">
                {/* `sr-only` esconde SEM tirar do fluxo de foco nem da leitura:
                    o rádio continua alcançável por teclado e anunciado. */}
                <input {...controle} className="peer sr-only" />
                <span
                  className={[
                    // `w-full` + SEM largura mínima: quem manda no tamanho agora
                    // é a coluna da grade. Manter `min-w-[44px]` faria 11 pontos
                    // somarem ~500px e vazarem a tela no celular — o alvo de
                    // toque fica garantido pela ALTURA (44px), que não compete
                    // com a largura da tela.
                    'flex min-h-[44px] w-full flex-col items-center justify-center gap-[1px]',
                    // Transição em COR, BORDA e ESCALA: só a cor deixava o
                    // clique parecer instantâneo demais num alvo pequeno. O
                    // `active:scale-95` dá o retorno tátil no momento do toque,
                    // e o `peer-checked:scale-[1.04]` assenta a opção escolhida.
                    'rounded-[var(--radius-md)] border px-[4px] py-[4px] text-center',
                    'transition-[color,background-color,border-color,transform,box-shadow]',
                    'duration-200 ease-out active:scale-95 peer-checked:scale-[1.04]',
                    'motion-reduce:transition-none motion-reduce:active:scale-100',
                    'motion-reduce:peer-checked:scale-100',
                    // Anel de foco no ELEMENTO VISÍVEL: o rádio está em
                    // `sr-only`, então sem isto o foco de teclado ficaria
                    // invisível justamente nas perguntas obrigatórias.
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-ring)]',
                    'peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--color-background)]',
                    marcada
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : erro
                        ? 'border-[var(--color-destructive)] text-[var(--color-foreground)]'
                        : 'border-[var(--color-input)] text-[var(--color-foreground)]',
                  ].join(' ')}
                >
                  <span className="text-base font-semibold leading-none">{opcao.titulo}</span>
                  {opcao.rodape && (
                    <span className="text-[10px] leading-tight">{opcao.rodape}</span>
                  )}
                </span>
              </label>
            );
          }

          return (
            <label
              key={opcao.valor}
              className={[
                'flex min-h-[44px] cursor-pointer items-center gap-[10px] rounded-[var(--radius-md)]',
                'border px-[12px] py-[8px] text-base leading-snug sm:text-sm',
                'transition-[color,background-color,border-color,transform] duration-200 ease-out',
                'active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
                // Aqui o rádio é VISÍVEL e já mostra o próprio foco; o anel na
                // linha inteira existe para o alvo de toque também ficar óbvio.
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-ring)]',
                'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[var(--color-background)]',
                marcada
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                  : erro
                    ? 'border-[var(--color-destructive)]'
                    : 'border-[var(--color-input)]',
              ].join(' ')}
            >
              <input
                {...controle}
                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span className="text-[var(--color-foreground)]">{opcao.titulo}</span>
            </label>
          );
        })}
      </div>

      {erro && <MensagemDeErro id={idErro} texto={erro} />}
    </fieldset>
  );
}

function TelaCarregando() {
  return (
    <div className="flex flex-col items-center gap-[var(--space-2)] py-[var(--space-3)]" role="status">
      <Loader2 className="h-7 w-7 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
      <p className="text-sm text-[var(--color-muted-foreground)]">Carregando o formulário…</p>
    </div>
  );
}

/**
 * A tela ÚNICA de "não dá para usar este link".
 *
 * O texto é o acordo entre dois requisitos que pareciam brigar: mostrar a quem
 * já respondeu que a resposta chegou, e não confirmar a um curioso que aquele
 * token existe. A segunda frase resolve para quem respondeu sem afirmar nada
 * para quem não respondeu.
 */
function TelaIndisponivel() {
  return (
    <div className="flex flex-col items-center gap-[var(--space-2)] py-[var(--space-2)] text-center">
      <div className="rounded-full bg-[var(--color-muted)] p-[var(--space-2)]">
        <Link2Off className="h-6 w-6 text-[var(--color-muted-foreground)]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
        Este link não está mais disponível.
      </h1>
      <p className="max-w-[380px] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Se você já enviou sua resposta, ela foi recebida — obrigado. Não é preciso
        fazer mais nada.
      </p>
    </div>
  );
}

/**
 * "Este feedback foi encerrado" — a tela do 410.
 *
 * SEPARADA de `TelaIndisponivel` por decisão de produto, não por acaso: aquela
 * fala com quem talvez já tenha respondido e evita afirmar que o token existe;
 * esta fala com quem tem um link que EXISTIU e foi fechado pela equipe. Dizer
 * "não está mais disponível" aqui faria a pessoa tentar de novo mais tarde e
 * cobrar um link novo que não virá.
 *
 * SEM botão de tentar novamente, e é o ponto: o estado não muda sozinho. Ele só
 * volta se alguém arrastar o card de volta para uma etapa aberta — e aí o MESMO
 * link funciona outra vez, porque o token nunca foi trocado. Por isso o texto
 * não pede para descartar o link.
 *
 * NÃO diz quem encerrou, quando, nem quantas respostas existem: esta página é
 * pública e não pode virar janela para dentro da plataforma.
 */
function TelaEncerrado() {
  return (
    <div className="flex flex-col items-center gap-[var(--space-2)] py-[var(--space-2)] text-center">
      <div className="rounded-full bg-[var(--color-muted)] p-[var(--space-2)]">
        <Lock className="h-6 w-6 text-[var(--color-muted-foreground)]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
        Este feedback foi encerrado.
      </h1>
      <p className="max-w-[380px] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        A coleta de respostas para esta entrega foi finalizada e o formulário não aceita
        mais envios. Se você já respondeu, sua avaliação foi registrada — obrigado. Se
        ainda precisa enviar alguma coisa, fale com quem te enviou o link.
      </p>
    </div>
  );
}

/**
 * A tela de encerramento. O parágrafo é o texto EXATO do formulário.
 *
 * ELE FICA AQUI, e não no banco junto com o subtítulo — a diferença é
 * deliberada. O subtítulo é renderizado AO LADO das perguntas e as descreve: se
 * elas mudarem e ele não, o leitor vê uma intro falando de perguntas que não
 * estão na tela. Esta mensagem aparece DEPOIS do envio, numa tela SEM nenhuma
 * pergunta, e não descreve nenhuma — ela continua verdadeira para qualquer
 * versão do formulário. Versionar uma frase que não varia com a versão custaria
 * coluna, migration, procedimento de 2 passos, serializer e type, e não
 * compraria nada.
 *
 * QUANDO REVER: no dia em que uma versão do formulário precisar da PRÓPRIA
 * mensagem de encerramento (uma que prometa retorno, por exemplo). Aí a coluna
 * se paga — e é nesse dia, não antes.
 *
 * O `{'detail': …}` que o POST devolve TAMBÉM não é usado: ele só moveria o
 * texto fixo de um .tsx para um .py sem ganhar versionamento nenhum, e
 * acrescentaria um modo de falha (corpo ausente = tela de sucesso sem texto).
 */
function TelaEnviado() {
  return (
    <div
      className="flex flex-col items-center gap-[var(--space-2)] py-[var(--space-2)] text-center"
      role="status"
    >
      <div className="rounded-full bg-[var(--color-muted)] p-[var(--space-2)]">
        <CheckCircle2 className="h-6 w-6 text-[var(--color-primary)]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">Resposta enviada</h1>
      <p className="max-w-[380px] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Obrigado pelo seu feedback! Ele será utilizado para evoluir nossos processos e
        entregas.
      </p>
    </div>
  );
}

/**
 * Tela de CONTEXTO, antes das perguntas.
 *
 * Quem abre este link chega de fora, muitas vezes semanas depois da entrega e
 * sem saber por que está sendo perguntado. Cair direto em onze perguntas é o
 * que faz a pessoa fechar a aba. Aqui ela lê de qual entrega se trata, quando
 * foi, para que serve responder e quanto tempo custa — e só então decide.
 *
 * NÃO faz requisição: o formulário já veio inteiro na carga inicial. Isto é um
 * passo de leitura, não de rede.
 */
function TelaApresentacao({
  form,
  aoComecar,
}: {
  form: FormularioPublico;
  aoComecar: () => void;
}) {
  const entregaEm = dataPorExtenso(form.dataEntrega);

  return (
    <div className="feedback-tela flex flex-col gap-[var(--space-2)]">
      <div className="flex flex-col items-center gap-[var(--space-1)] text-center">
        <div className="rounded-full bg-[var(--color-muted)] p-[var(--space-2)]">
          <MessageCircle
            className="h-6 w-6 text-[var(--color-primary)]"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </div>
        <h1 className="text-lg font-semibold text-[var(--color-foreground)]">{form.titulo}</h1>
      </div>

      <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Sua opinião é o que nos diz o que manter e o que mudar nas próximas entregas.
        É a partir dela que ajustamos prazo, comunicação e qualidade do que
        produzimos — inclusive para este mesmo projeto, caso algo ainda precise de
        atenção. Respostas honestas valem mais do que gentis.
      </p>

      <p className="text-sm font-medium leading-relaxed text-[var(--color-foreground)]">
        Leva menos de 2 minutos e são 12 perguntas curtas, quase todas de marcar.
      </p>

      {/* O QUE está sendo avaliado, num cartão próprio DEPOIS do texto: a
          pessoa lê o porquê e, logo antes de clicar em Começar, confirma sobre
          qual entrega vai opinar. */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-[var(--space-2)]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Projeto avaliado
        </p>
        <p className="mt-[4px] text-sm font-semibold leading-snug text-[var(--color-foreground)]">
          {form.referencia}
        </p>
        {entregaEm && (
          <p className="mt-[2px] text-sm text-[var(--color-muted-foreground)]">
            Entregue em {entregaEm}
          </p>
        )}
      </div>

      <Button type="button" onClick={aoComecar} className="mt-[var(--space-1)] w-full">
        Começar
      </Button>
    </div>
  );
}

/** Falha de rede ou excesso de tentativas: é o único caso que se pode repetir. */
function TelaFalha({ mensagem, aoTentarNovamente }: { mensagem: string; aoTentarNovamente: () => void }) {
  return (
    <div className="flex flex-col items-center gap-[var(--space-2)] py-[var(--space-2)] text-center">
      <div className="rounded-full bg-[var(--color-muted)] p-[var(--space-2)]">
        <AlertCircle
          className="h-6 w-6 text-[var(--color-muted-foreground)]"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
        Não foi possível abrir o formulário
      </h1>
      <p className="max-w-[380px] text-sm leading-relaxed text-[var(--color-muted-foreground)]" role="alert">
        {mensagem}
      </p>
      <Button type="button" variant="outline" onClick={aoTentarNovamente}>
        Tentar novamente
      </Button>
    </div>
  );
}
