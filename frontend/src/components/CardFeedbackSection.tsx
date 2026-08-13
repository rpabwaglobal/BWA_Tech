import { useEffect, useState } from 'react';
import { Check, ExternalLink, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/dateUtils';
import { RespostaFeedbackItens } from '@/components/RespostaFeedbackItens';
import {
  buscarPedidoDoCard,
  copiarParaAreaDeTransferencia,
  linkAtivo,
  rotuloEstadoPedido,
  type PedidoFeedback,
  type RespostaLegivel,
} from '@/services/pedidoFeedbackService';

/**
 * O bloco de FEEDBACK PÓS-ENTREGA dentro do diálogo de card: a checkbox que
 * pede o formulário e, quando ele já existe, o link com botão de copiar.
 *
 * COMPONENTE COMPARTILHADO DE PROPÓSITO. Cards nascem por DUAS telas
 * (ProjectDetails e SprintDetails) e são abertos pelas duas. Com o bloco
 * copiado em cada uma, bastaria um ajuste em só uma delas para o campo mudar de
 * comportamento dependendo de onde a pessoa clicou — que é exatamente o defeito
 * que se quer evitar aqui.
 */
export function CardFeedbackSection({
  cardId,
  marcado,
  onMarcadoChange,
  disabled = false,
  mostrarCheckbox = true,
  podeTerLink,
  onFalhaAoCopiar,
}: {
  /** Card aberto. `null` num card ainda não salvo — aí não há link a buscar. */
  cardId: string | null;
  marcado: boolean;
  onMarcadoChange: (marcado: boolean) => void;
  disabled?: boolean;
  /** False no board de monitoramento: aqueles cards SÃO o acompanhamento. */
  mostrarCheckbox?: boolean;
  /**
   * Só busca o link quando ele PODE existir — card marcado, ou card do board de
   * monitoramento. Sem esse recorte seria uma requisição a mais a cada card
   * aberto, quase sempre para receber lista vazia: o link só nasce quando o
   * projeto é entregue.
   */
  podeTerLink: boolean;
  /**
   * Chamado quando o navegador recusou a área de transferência. Cada tela avisa
   * do seu jeito (as duas têm o próprio diálogo de alerta) — copiar é A ENTREGA
   * desta feature e um botão mudo mataria o fluxo.
   */
  onFalhaAoCopiar: (mensagem: string) => void;
}) {
  /**
   * A busca é identificada por uma CHAVE, e o resultado carrega a chave que o
   * produziu. Vazia = não há nada a buscar.
   *
   * Guardar a chave junto do resultado é o que permite DERIVAR "carregando" e
   * "qual pedido mostrar" em vez de zerá-los com `setState` no corpo do efeito —
   * que é o padrão que dispara render em cascata (e que o lint do projeto
   * recusa). O efeito abaixo só escreve estado DEPOIS do await, nunca de forma
   * síncrona. Na prática isso também mata a piscada em que o card A ainda
   * mostrava o link enquanto o card B carregava.
   */
  const chave = cardId && podeTerLink ? String(cardId) : '';
  const [resultado, setResultado] = useState<{ chave: string; pedido: PedidoFeedback | null } | null>(null);
  /** URL já copiada — a confirmação visual sai DAQUI, derivada, e some em 2s. */
  const [urlCopiada, setUrlCopiada] = useState<string | null>(null);

  useEffect(() => {
    if (!chave) return;

    let cancelado = false;
    buscarPedidoDoCard(chave)
      .then((encontrado) => {
        if (!cancelado) setResultado({ chave, pedido: encontrado });
      })
      .catch(() => {
        // NÃO ter link é estado normal, não falha de tela: o bloco some e
        // pronto. Um erro aqui nunca pode virar alerta para o usuário.
        if (!cancelado) setResultado({ chave, pedido: null });
      });

    return () => {
      cancelado = true;
    };
  }, [chave]);

  const pedido = chave && resultado?.chave === chave ? resultado.pedido : null;
  const carregando = !!chave && resultado?.chave !== chave;
  const copiado = !!pedido && urlCopiada === pedido.url_publica;

  const copiar = async () => {
    if (!pedido?.url_publica) return;
    const url = pedido.url_publica;
    const ok = await copiarParaAreaDeTransferencia(url);
    if (!ok) {
      onFalhaAoCopiar('Não foi possível copiar automaticamente. Selecione o link e copie com Ctrl+C.');
      return;
    }
    setUrlCopiada(url);
    window.setTimeout(() => setUrlCopiada((atual) => (atual === url ? null : atual)), 2000);
  };

  return (
    <>
      {mostrarCheckbox && (
        /* CAIXA CLICÁVEL INTEIRA, e não um quadradinho solto ao lado de um
           texto: o alvo passa a ser a linha toda, o que também deixa óbvio que
           é um controle e não um rótulo. Marcada, ela se destaca em roxo — a
           mesma cor que o resto do sistema usa para "ligado". */
        <label
          className={cn(
            'flex w-full cursor-pointer items-center gap-[10px] rounded-md border px-[12px] py-[10px]',
            'transition-colors',
            disabled && 'cursor-not-allowed opacity-60',
            marcado
              ? 'border-[var(--color-primary)]/55 bg-[var(--color-primary)]/10'
              : 'border-[var(--color-border)] bg-[var(--color-muted)]/25 hover:bg-[var(--color-muted)]/45',
          )}
        >
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
            checked={marcado}
            onChange={(e) => onMarcadoChange(e.target.checked)}
            disabled={disabled}
          />
          <span
            className={cn(
              'text-sm leading-snug',
              marcado
                ? 'font-medium text-[var(--color-primary)]'
                : 'text-[var(--color-foreground)]',
            )}
          >
            Gerar formulário de feedback
          </span>
        </label>
      )}

      {carregando && (
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          Buscando o link do formulário…
        </p>
      )}

      {pedido && (
        <div className="space-y-[6px] rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[8px]">
          <div className="flex items-center justify-between gap-[8px]">
            <Label className="text-[var(--color-foreground)]">Link do formulário</Label>
            <Badge variant="secondary" className="text-[10px]">
              {rotuloEstadoPedido(pedido.estado)}
            </Badge>
          </div>
          {/* LINK ENCERRADO NÃO SE COPIA. Deixar o campo e o botão ali
              convidaria a enviar a um cliente um endereço que só devolve "este
              feedback foi encerrado" — o erro apareceria do lado de fora, com a
              pessoa errada. Voltar o card para uma etapa aberta reativa o MESMO
              link (o token nunca é trocado), e é isso que o texto diz. */}
          {/* A CAIXA INTEIRA É O BOTÃO, igual ao bloco do card no quadro: o
              mesmo link não pode ter duas formas de uso dependendo de onde a
              pessoa clicou. `truncate` garante as reticências (input não faz
              `text-overflow` de forma confiável entre navegadores).
              O plano B de selecionar com o mouse continua existindo: quando a
              área de transferência é recusada, `onFalhaAoCopiar` avisa a tela. */}
          {linkAtivo(pedido.estado) ? (
            <div
              className={cn(
                'relative flex w-full min-w-0 items-center rounded-md bg-[var(--color-muted)]/60',
                'transition-all duration-200',
                copiado ? 'ring-1 ring-green-500' : '',
              )}
            >
              <button
                type="button"
                onClick={copiar}
                title={copiado ? 'Link copiado' : `Copiar: ${pedido.url_publica}`}
                aria-label="Copiar link do formulário"
                className="min-w-0 flex-1 rounded-l-md px-[10px] py-[8px] text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span
                  className={cn(
                    'block truncate text-xs',
                    copiado ? 'font-medium text-green-600 dark:text-green-400' : 'text-[var(--color-foreground)]',
                  )}
                >
                  {copiado ? 'Link copiado!' : pedido.url_publica}
                </span>
              </button>
              <a
                href={pedido.url_publica}
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
          ) : (
            <div className="flex items-start gap-[6px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/60 p-[8px]">
              <Lock className="mt-[1px] h-[13px] w-[13px] shrink-0 text-[var(--color-muted-foreground)]" />
              <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
                Feedback finalizado: o link não abre mais e não aceita novas respostas. As
                respostas já colhidas continuam guardadas abaixo. Para reabrir, arraste o
                card de volta para "Aguardando Feedback" ou "Feedback colhido" — o mesmo
                link volta a funcionar.
              </p>
            </div>
          )}

          {/* O texto do estado intermediário diz a VERDADE do backend, e ela é
              contraintuitiva: o link JÁ ABRE inclusive antes dos 30 dias, e
              responder cedo pula direto para "Feedback colhido". Os 30 dias são
              o LEMBRETE de cobrar, não uma tranca. Dizer "só abre em 30 dias"
              faria a pessoa segurar um link que já funciona. */}
          {pedido.estado === 'aguardando_prazo' && (
            <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
              O link já está válido e pode ser enviado. O card entra em "Aguardando
              Feedback" 30 dias após a entrega — envie a partir daí, ou antes se fizer
              sentido.
            </p>
          )}
          {pedido.estado === 'aguardando_resposta' && pedido.respostas.length === 0 && (
            <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
              Prazo cumprido. Envie o link para quem vai avaliar — o envio é manual.
            </p>
          )}

          <RespostasDoFeedback pedido={pedido} />
        </div>
      )}
    </>
  );
}

/**
 * O QUE A PESSOA RESPONDEU, pergunta a pergunta.
 *
 * É a metade que faltava do requisito "os formulários preenchidos devem ser
 * armazenados no banco": até aqui o dado era gravado e não era lido em NENHUM
 * ponto de produção — sem serializer, sem rota, sem admin. Guardado e ilegível
 * fora de um psql é guardado e inútil.
 *
 * ESTE É O LUGAR CERTO por três motivos concretos: o componente é COMPARTILHADO
 * e já é renderizado nas três superfícies onde um card abre (ProjectDetails,
 * SprintDetails e o board de monitoramento, que reusa ProjectDetails), então uma
 * mudança acende as três sem tocar em nenhum call site; o dado já chega no mesmo
 * payload de `buscarPedidoDoCard`, custo zero de requisição; e a coluna
 * "Feedback colhido" é literalmente onde a pessoa clica procurando o resultado.
 *
 * SEM COLAPSO E SEM "ver resposta": esconder o conteúdo atrás de um clique
 * reintroduziria "guardado e inútil" numa versão menor. O diálogo do card já
 * rola.
 */
function RespostasDoFeedback({ pedido }: { pedido: PedidoFeedback }) {
  // Lista vazia num pedido que JÁ passou por "respondido" só acontece de um
  // jeito: a retenção apagou as linhas. Dizer a verdade — omitir faria parecer
  // bug, e a pessoa procuraria um texto que não existe mais.
  if (pedido.respostas.length === 0) {
    if (pedido.estado === 'respondido' || pedido.total_respostas > 0) {
      return (
        <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
          Já respondido, mas o conteúdo das respostas foi removido pela política de
          retenção.
        </p>
      );
    }
    return null;
  }

  return (
    <div className="space-y-[10px] border-t border-[var(--color-border)] pt-[8px]">
      <p className="text-[11px] font-medium leading-snug text-[var(--color-foreground)]">
        {pedido.respostas.length === 1
          ? '1 resposta recebida'
          : `${pedido.respostas.length} respostas recebidas`}
      </p>

      {/* UMA seção por pessoa. O mesmo link aceita várias respostas, então
          empilhar os itens de todas num bloco só misturaria opiniões de gente
          diferente na mesma leitura. O cabeçalho de cada uma é quem respondeu +
          quando, exatamente o que a lista do modal consolidado mostra. */}
      {pedido.respostas.map((resposta) => (
        <RespostaDoFeedback key={resposta.id} resposta={resposta} />
      ))}
    </div>
  );
}

/** Uma resposta: cabeçalho de quem enviou e as perguntas na ordem da definição. */
function RespostaDoFeedback({ resposta }: { resposta: RespostaLegivel }) {
  return (
    <div className="space-y-[10px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/40 p-[8px]">
      <div className="space-y-[2px]">
        <p className="text-[11px] font-medium leading-snug text-[var(--color-foreground)]">
          {/* `anonimo` vem do servidor justamente para não comparar string com o
              rótulo — e o itálico é o que separa "ninguém digitou nome" de uma
              pessoa que por acaso se chame assim. */}
          <span className={resposta.anonimo ? 'italic text-[var(--color-muted-foreground)]' : ''}>
            {resposta.respondente}
          </span>
          {resposta.setor_respondente && (
            <span className="font-normal text-[var(--color-muted-foreground)]">
              {' '}· {resposta.setor_respondente}
            </span>
          )}
        </p>
        <p className="text-[11px] leading-snug text-[var(--color-muted-foreground)]">
          Enviado em {formatDateTime(resposta.enviado_em)}
        </p>
      </div>

      {/* Compartilhado com o modal consolidado do fluxo — ver
          `RespostaFeedbackItens`. */}
      <RespostaFeedbackItens itens={resposta.itens} />
    </div>
  );
}
