import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Calendar, Check, ExternalLink, Loader2, Lock, MessageCircle, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate, formatDateTime } from '@/lib/dateUtils';
import { RespostaFeedbackItens } from '@/components/RespostaFeedbackItens';
import {
  buscarPedidoDoCard,
  copiarParaAreaDeTransferencia,
  linkAtivo,
  rotuloEstadoPedido,
  type PedidoFeedback,
  type PedidoFeedbackResumo,
  type RespostaLegivel,
} from '@/services/pedidoFeedbackService';
import type { Card as CardType } from '@/services/cardService';

/**
 * O MODAL CONSOLIDADO do fluxo "Monitoramento de Feedbacks".
 *
 * Clicar num card do fluxo abre ISTO, e não o formulário de edição: aquele card
 * não se edita (o backend recusa qualquer campo que não seja `status`), então
 * abrir um formulário editável nele era oferecer o que não existe. O que a
 * pessoa quer ali é ler — quantos responderam, quem, e o quê.
 *
 * ELE É SÓ LEITURA. O único caminho para a tela editável é o botão "Ir para o
 * card", que abre o diálogo que JÁ existe. Nada do formulário de edição é
 * duplicado aqui.
 *
 * O LAYOUT segue "Gerenciar usuário" (`UserPermissionsDialog`), por pedido
 * explícito: mesma largura (`max-w-5xl`), mesma grade
 * `[minmax(0,340px)_minmax(0,1fr)]`, mesma borda separando as colunas e cada
 * coluna rolando por si (`min-h-0` nas duas — sem isso a coluna mais alta
 * empurra a grade além do `max-h` e o rodapé some). À esquerda os dados
 * consolidados do card; à direita a lista de quem respondeu.
 *
 * SÓ VALE PARA CARD DO FLUXO. O card comum continua abrindo direto o modal
 * editável — quem faz esse desvio é a tela do board, não este componente.
 */
export function FeedbackConsolidadoDialog({
  card,
  resumo,
  open,
  onOpenChange,
  onIrParaCard,
  onFalhaAoCopiar,
}: {
  card: CardType;
  /**
   * O que o board já tinha em mãos (`?cards=`). Serve para a esquerda desenhar
   * NA HORA — estado, contagem, link — enquanto a busca do payload completo
   * (que é a única que traz o texto das respostas) ainda está no ar. Sem ele o
   * modal abriria vazio por um instante a cada clique.
   */
  resumo: PedidoFeedbackResumo | null;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /**
   * Fecha este modal e abre o diálogo editável do card, que já existe.
   *
   * OPCIONAL: a aba "Feedbacks" da página de Relatórios não tem esse diálogo —
   * ela é só leitura. Sem o callback o botão SOME, em vez de ficar ali sem
   * fazer nada; botão morto é pior do que botão ausente.
   */
  onIrParaCard?: () => void;
  /** O navegador recusou a área de transferência — a tela avisa do seu jeito. */
  onFalhaAoCopiar: (mensagem: string) => void;
}) {
  /**
   * Mesma disciplina de `CardFeedbackSection`: a busca é identificada por uma
   * CHAVE e o resultado carrega a chave que o produziu. É o que permite derivar
   * "carregando" sem zerar estado no corpo do efeito — e o que impede o card A
   * de mostrar as respostas enquanto o card B carrega.
   */
  const chave = open ? String(card.id) : '';
  const [resultado, setResultado] = useState<{ chave: string; pedido: PedidoFeedback | null } | null>(null);
  /**
   * Resposta aberta no painel direito. `null` = mostrando a lista.
   *
   * Guarda a CHAVE junto, e a leitura abaixo confere as duas: trocar de card tem
   * de voltar para a lista, senão o modal do card seguinte abriria já dentro de
   * uma resposta que não é dele. Zerar isso num `useEffect` sobre `chave` seria o
   * `setState` síncrono em efeito que o lint do projeto recusa — derivar não
   * dispara render em cascata e não tem janela de um quadro com o estado errado.
   */
  const [aberta, setAberta] = useState<{ chave: string; resposta: RespostaLegivel } | null>(null);
  const respostaAberta = aberta?.chave === chave ? aberta.resposta : null;
  const [urlCopiada, setUrlCopiada] = useState<string | null>(null);

  useEffect(() => {
    if (!chave) return;

    let cancelado = false;
    buscarPedidoDoCard(chave)
      .then((encontrado) => {
        if (!cancelado) setResultado({ chave, pedido: encontrado });
      })
      // Não ter pedido é estado normal (card do fluxo criado à mão nunca tem);
      // falhar aqui não pode virar alerta nem tela quebrada.
      .catch(() => {
        if (!cancelado) setResultado({ chave, pedido: null });
      });

    return () => {
      cancelado = true;
    };
  }, [chave]);

  const pedido = chave && resultado?.chave === chave ? resultado.pedido : null;
  const carregando = !!chave && resultado?.chave !== chave;

  // O estado sai do payload completo quando ele chega, e do resumo do board
  // enquanto não chega. Os dois vêm do MESMO campo no servidor.
  const estado = pedido?.estado ?? resumo?.estado ?? card.status;
  const url = pedido?.url_publica ?? resumo?.url_publica ?? '';
  /**
   * DA MAIS RECENTE PARA A MAIS ANTIGA.
   *
   * Ordenado aqui, e não confiando na ordem do servidor: o endpoint devolve as
   * respostas na ordem do prefetch, que segue o id (ordem de criação). Copia
   * antes de ordenar — `sort` altera o array no lugar, e ele vem do estado.
   */
  const respostas = [...(pedido?.respostas ?? [])].sort(
    (a, b) => new Date(b.enviado_em).getTime() - new Date(a.enviado_em).getTime(),
  );
  const total = pedido?.total_respostas ?? resumo?.total_respostas ?? 0;
  const copiado = !!url && urlCopiada === url;

  const copiar = async () => {
    if (!url) return;
    const ok = await copiarParaAreaDeTransferencia(url);
    if (!ok) {
      onFalhaAoCopiar('Não foi possível copiar automaticamente. Selecione o link e copie com Ctrl+C.');
      return;
    }
    setUrlCopiada(url);
    window.setTimeout(() => setUrlCopiada((atual) => (atual === url ? null : atual)), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} containerClassName="max-w-5xl">
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="flex max-h-[88vh] flex-col md:overflow-y-hidden"
      >
        <DialogHeader>
          <DialogTitle className="pr-8">Feedback pós-entrega</DialogTitle>
        </DialogHeader>

        {/* Dados do card à esquerda; quem respondeu à direita. Mesma estrutura e
            proporção de "Gerenciar usuário" — ver o comentário do componente. */}
        <div className="mt-4 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:overflow-hidden">
          <div className="min-h-0 space-y-4 md:overflow-y-auto md:pr-2">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Projeto avaliado
              </p>
              {/* O NOME DO CARD é o que a pessoa de fora lê ao abrir o link —
                  por isso ele é o título aqui também, e não um detalhe. */}
              <p className="break-words text-base font-semibold leading-snug text-[var(--color-foreground)]">
                {card.nome}
              </p>
              <Badge variant="secondary" className="text-[11px]">
                {rotuloEstadoPedido(estado)}
              </Badge>
            </div>

            {card.descricao && (
              <p className="whitespace-pre-wrap break-words text-sm leading-snug text-[var(--color-muted-foreground)]">
                {card.descricao}
              </p>
            )}

            <div className="space-y-2 rounded-md border border-[var(--color-border)] px-3 py-2.5">
              {/* `data_referencia` é o dia a partir do qual os 30 dias correm —
                  ou seja, a entrega. Ela vem do PEDIDO, não do card: renomear ou
                  remexer no card depois não muda a régua que o servidor usa. */}
              {pedido?.data_referencia && (
                <LinhaInfo
                  icone={<Calendar className="h-3.5 w-3.5" />}
                  rotulo="Entrega de referência"
                  valor={formatDate(pedido.data_referencia)}
                />
              )}
              <LinhaInfo
                icone={<MessageCircle className="h-3.5 w-3.5" />}
                rotulo="Respostas recebidas"
                valor={String(total)}
              />
              {pedido?.respondido_em && (
                <LinhaInfo
                  icone={<Check className="h-3.5 w-3.5" />}
                  rotulo="Primeira resposta"
                  valor={formatDateTime(pedido.respondido_em)}
                />
              )}
              {resumo?.dias_restantes != null && (
                <LinhaInfo
                  icone={<Calendar className="h-3.5 w-3.5" />}
                  rotulo="Liberação do formulário"
                  valor={
                    resumo.dias_restantes === 0
                      ? 'Hoje'
                      : resumo.dias_restantes === 1
                        ? 'Em 1 dia'
                        : `Em ${resumo.dias_restantes} dias`
                  }
                />
              )}
            </div>

            {/* O LINK. Encerrado não se copia: enviar a um cliente um endereço
                que só devolve "este feedback foi encerrado" faria o erro
                aparecer do lado de fora, com a pessoa errada. */}
            {url && (
              <div className="space-y-2 rounded-md border border-[var(--color-border)] px-3 py-2.5">
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  Link do formulário
                </p>
                {linkAtivo(estado) ? (
                  <>
                    {/* MESMA REGRA DO PREVIEW DO CARD: a caixa copia, a âncora
                        à direita abre em nova guia. O mesmo link não pode ter
                        formas de uso diferentes dependendo da tela.
                        Irmãos, e não aninhados: botão dentro de botão é HTML
                        inválido e o navegador desmonta a árvore. */}
                    <div
                      className={[
                        'flex w-full min-w-0 items-center rounded-md bg-[var(--color-muted)]/60',
                        'transition-all duration-200',
                        copiado ? 'ring-1 ring-green-500' : '',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={copiar}
                        title={copiado ? 'Link copiado' : `Copiar: ${url}`}
                        aria-label="Copiar link do formulário"
                        className="min-w-0 flex-1 rounded-l-md px-[10px] py-[8px] text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <span
                          className={[
                            'block truncate text-xs',
                            copiado
                              ? 'font-medium text-green-600 dark:text-green-400'
                              : 'text-[var(--color-foreground)]',
                          ].join(' ')}
                        >
                          {copiado ? 'Link copiado!' : url}
                        </span>
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir o formulário em nova guia"
                        aria-label="Abrir o formulário em nova guia"
                        className="mr-[6px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/10 dark:hover:bg-white/15"
                      >
                        {copiado ? (
                          <Check className="h-[15px] w-[15px] text-green-600 dark:text-green-400" />
                        ) : (
                          <ExternalLink className="h-[15px] w-[15px] text-[var(--color-foreground)]" />
                        )}
                      </a>
                    </div>
                    <p className="text-xs leading-snug text-[var(--color-muted-foreground)]">
                      O envio é manual: copie e mande para quem vai avaliar.
                    </p>
                  </>
                ) : (
                  <div className="flex items-start gap-2">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                    <p className="text-xs leading-snug text-[var(--color-muted-foreground)]">
                      Feedback finalizado: o link não abre mais e não aceita novas respostas.
                      As respostas já colhidas continuam guardadas. Arrastar o card de volta
                      para "Aguardando Feedback" ou "Feedback colhido" reativa o mesmo link.
                    </p>
                  </div>
                )}
              </div>
            )}

            {onIrParaCard && (
              <Button type="button" variant="outline" className="w-full" onClick={onIrParaCard}>
                Ir para o card
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3 md:border-l md:border-[var(--color-border)] md:pl-6">
            {respostaAberta ? (
              <DetalheDaResposta resposta={respostaAberta} aoVoltar={() => setAberta(null)} />
            ) : (
              <ListaDeRespostas
                respostas={respostas}
                carregando={carregando}
                estado={estado}
                aoAbrir={(resposta) => setAberta({ chave, resposta })}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Uma linha "rótulo → valor" do bloco consolidado da esquerda. */
function LinhaInfo({
  icone,
  rotulo,
  valor,
}: {
  icone: ReactNode;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-[var(--color-muted-foreground)]">
        {icone}
        {rotulo}
      </span>
      <span className="text-right font-medium text-[var(--color-foreground)]">{valor}</span>
    </div>
  );
}

/**
 * QUEM RESPONDEU — nome e data, cada linha abrindo a resposta daquela pessoa.
 *
 * O nome vem PRONTO do servidor (`respondente`): a rota é anônima e o campo
 * "Seu nome:" é opcional, então quem não se identificou aparece como "Anônimo",
 * em itálico. Nada é inventado aqui — nem o nome do card, nem "Cliente".
 *
 * ROLA POR SI (`min-h-0 flex-1 overflow-y-auto`): um link perene pode acumular
 * dezenas de respostas, e sem isso a lista esticaria a grade e comeria o rodapé
 * do modal.
 */
function ListaDeRespostas({
  respostas,
  carregando,
  estado,
  aoAbrir,
}: {
  respostas: RespostaLegivel[];
  carregando: boolean;
  estado: string;
  aoAbrir: (resposta: RespostaLegivel) => void;
}) {
  return (
    <>
      <div>
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          Quem respondeu {respostas.length > 0 && `(${respostas.length})`}
        </p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Clique numa linha para ler o formulário preenchido por essa pessoa.
        </p>
      </div>

      <div className="min-h-0 flex-1 md:overflow-y-auto md:pr-2">
        {carregando ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando as respostas...
          </div>
        ) : respostas.length === 0 ? (
          /* ESTADO VAZIO HONESTO: "ainda ninguém respondeu" é diferente de
             "as respostas sumiram". O primeiro texto é o caso normal; o segundo
             só aparece em pedido que já passou por respondido e teve as linhas
             apagadas pela retenção. */
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {estado === 'aguardando_prazo'
                ? 'Ninguém respondeu ainda. O card entra em "Aguardando Feedback" 30 dias após a entrega — o link, porém, já é válido.'
                : estado === 'respondido'
                  ? 'Sem conteúdo para exibir: as respostas deste feedback foram removidas pela política de retenção.'
                  : 'Ninguém respondeu ainda. Envie o link para quem vai avaliar — o envio é manual.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {respostas.map((resposta) => (
              <li key={resposta.id}>
                {/* `<button>` de verdade, e não uma `<div onClick>`: a lista
                    inteira precisa ser alcançável por teclado. */}
                <button
                  type="button"
                  onClick={() => aoAbrir(resposta)}
                  className="flex w-full items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-accent)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={[
                        'block truncate text-sm font-medium',
                        resposta.anonimo
                          ? 'italic text-[var(--color-muted-foreground)]'
                          : 'text-[var(--color-foreground)]',
                      ].join(' ')}
                    >
                      {resposta.respondente}
                      {resposta.setor_respondente && (
                        <span className="font-normal text-[var(--color-muted-foreground)]">
                          {' '}– {resposta.setor_respondente}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                      {formatDateTime(resposta.enviado_em)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** O formulário preenchido por UMA pessoa, com a volta para a lista. */
function DetalheDaResposta({
  resposta,
  aoVoltar,
}: {
  resposta: RespostaLegivel;
  aoVoltar: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={aoVoltar}
          className="-ml-2 shrink-0 gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="min-w-0">
          <p
            className={[
              'truncate text-sm font-medium',
              resposta.anonimo
                ? 'italic text-[var(--color-muted-foreground)]'
                : 'text-[var(--color-foreground)]',
            ].join(' ')}
          >
            {resposta.respondente}
          </p>
          <p className="truncate text-xs text-[var(--color-muted-foreground)]">
            Enviado em {formatDateTime(resposta.enviado_em)}
            {resposta.setor_respondente && ` · ${resposta.setor_respondente}`}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 md:overflow-y-auto md:pr-2">
        <RespostaFeedbackItens itens={resposta.itens} tamanho="normal" />
      </div>
    </>
  );
}
