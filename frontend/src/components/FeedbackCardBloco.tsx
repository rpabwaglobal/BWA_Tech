import { useState } from 'react';
import { Check, Clock, ExternalLink, Lock, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  copiarParaAreaDeTransferencia,
  linkAtivo,
  type PedidoFeedbackResumo,
} from '@/services/pedidoFeedbackService';

/**
 * O bloco que aparece DENTRO do card do fluxo de feedback: contagem de dias na
 * espera, link (copiar / abrir) depois dela, e a situação das respostas.
 *
 * ARQUIVO PRÓPRIO porque agora DUAS telas desenham o mesmo card: o quadro do
 * projeto de monitoramento (`ProjectDetails`) e a aba "Feedbacks" da página de
 * Relatórios. Com o trecho copiado nas duas, bastaria ajustar uma para o mesmo
 * card mostrar coisas diferentes dependendo de onde a pessoa entrou — e ninguém
 * notaria, porque as duas telas quase nunca são abertas lado a lado.
 */

/** "12/08/2026" a partir de "2026-08-12".
 *
 * Monta a partir das PARTES, e não com `new Date(iso)`: o construtor lê uma
 * string 'AAAA-MM-DD' como UTC, e num fuso a oeste isso exibe o DIA ANTERIOR. */
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * AS TAGS DO CARD DE FEEDBACK OCUPAM A LINHA INTEIRA — pedido explícito.
 *
 * Elas eram `inline-flex` e encolhiam até o texto, então "Faltam 3 dias…" e
 * "12 feedbacks colhidos | Último em 12/08/2026" tinham larguras diferentes e o
 * board ficava com uma borda serrilhada, tag a tag. `flex w-full` faz a pílula
 * virar uma FAIXA: mesma largura em todos os cards, mesma altura, e o texto
 * longo passa a ter para onde crescer em vez de espremer o card.
 *
 * `min-w-0` + `truncate` no filho: sem eles, um item flex se recusa a encolher
 * abaixo do próprio conteúdo e a linha longa vazaria a coluna em vez de cortar.
 */
const TAG_FEEDBACK_BASE =
  'flex w-full min-w-0 items-center gap-[4px] rounded-full px-[8px] py-[3px] text-[10px] font-medium';

/** A variante cinza — usada pela contagem de dias e pelo "nenhum respondido". */
const TAG_FEEDBACK_NEUTRA = cn(
  TAG_FEEDBACK_BASE,
  'bg-[var(--color-muted)]/60 text-[var(--color-muted-foreground)]',
);

export function FeedbackCardBloco({ pedido }: { pedido: PedidoFeedbackResumo }) {
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou] = useState(false);

  /**
   * NA ESPERA NÃO EXISTE LINK NA TELA — existe uma contagem.
   *
   * O link já existe no banco desde a criação do pedido, mas mostrá-lo aqui
   * convidaria a enviar antes da hora, e o combinado é que o formulário só vale
   * 30 dias após a entrega. O que a pessoa precisa saber nesta coluna é quando
   * ele fica pronto, não como copiá-lo.
   *
   * `dias_restantes` vem do servidor: é a MESMA conta da varredura que promove
   * o pedido. Ver o serializer.
   */
  if (pedido.estado === 'aguardando_prazo') {
    const dias = pedido.dias_restantes;
    return (
      <div className="mt-[8px]">
        <span className={TAG_FEEDBACK_NEUTRA}>
          <Clock className="h-[10px] w-[10px]" />
          {dias == null
            ? 'Aguardando prazo'
            : dias === 0
              ? 'Formulário liberado hoje'
              : dias === 1
                ? 'Falta 1 dia para o formulário'
                : `Faltam ${dias} dias para o formulário`}
        </span>
      </div>
    );
  }

  const copiar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copiarParaAreaDeTransferencia(pedido.url_publica);
    setFalhou(!ok);
    setCopiado(ok);
    if (ok) window.setTimeout(() => setCopiado(false), 1800);
  };

  return (
    // `key` pelo ESTADO: trocar a chave remonta o bloco, e é isso que faz a
    // animação tocar a cada mudança de etapa em vez de só na primeira vez.
    <div
      key={pedido.estado}
      className="feedback-bloco-entra mt-[8px] space-y-[4px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ENCERRADO NÃO MOSTRA O LINK. Copiar dali mandaria a um cliente um
          endereço que só devolve "este feedback foi encerrado" — o erro
          apareceria do lado de fora, com a pessoa errada. A contagem de
          respostas continua abaixo: encerrar não apaga nada. */}
      {!linkAtivo(pedido.estado) ? (
        <span className={TAG_FEEDBACK_NEUTRA}>
          <Lock className="h-[10px] w-[10px] shrink-0" />
          Link encerrado — não aceita respostas
        </span>
      ) : falhou ? (
        /* PLANO B: a área de transferência foi recusada. Volta um campo REAL e
           selecionável — perder o Ctrl+C junto com o clique deixaria a pessoa
           sem nenhuma saída. */
        <input
          readOnly
          value={pedido.url_publica}
          onClick={(e) => {
            e.stopPropagation();
            (e.target as HTMLInputElement).select();
          }}
          className="block w-full min-w-0 rounded-[6px] border-0 bg-[var(--color-muted)]/60 px-[6px] py-[3px] text-[10px] leading-[16px] text-[var(--color-foreground)] outline-none focus:outline-none"
          aria-label="Link do formulário de feedback"
        />
      ) : (
        /* DUAS AÇÕES, DOIS ALVOS IRMÃOS — e não um dentro do outro: botão
           dentro de botão é HTML inválido e o navegador desmonta a árvore.
           A CAIXA copia; a ÂNCORA à direita abre o formulário em nova guia.

           `<span>` truncado no lugar de `<input>`: input não faz reticências de
           forma confiável entre navegadores (o Firefox ignora `text-overflow`
           nele). Com `truncate` o "…" é garantido. */
        <div
          className={cn(
            'relative flex w-full min-w-0 items-center rounded-[6px] bg-[var(--color-muted)]/60',
            'transition-all duration-200',
            copiado ? 'ring-1 ring-green-500' : '',
          )}
        >
          <button
            type="button"
            onClick={copiar}
            title={copiado ? 'Link copiado' : `Copiar: ${pedido.url_publica}`}
            aria-label="Copiar link do formulário"
            className="min-w-0 flex-1 rounded-l-[6px] py-[3px] pl-[6px] pr-[2px] text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span
              className={cn(
                'block truncate text-[10px] leading-[16px]',
                copiado
                  ? 'font-medium text-green-600 dark:text-green-400'
                  : 'text-[var(--color-foreground)]',
              )}
            >
              {copiado ? 'Link copiado!' : pedido.url_publica}
            </span>
          </button>
          <a
            href={pedido.url_publica}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir o formulário em nova guia"
            aria-label="Abrir o formulário em nova guia"
            className="mr-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-black/10 dark:hover:bg-white/15"
          >
            {copiado ? (
              <Check className="h-[12px] w-[12px] text-green-600 dark:text-green-400" />
            ) : (
              <ExternalLink className="h-[12px] w-[12px] text-[var(--color-foreground)]" />
            )}
          </a>
        </div>
      )}

      {falhou && (
        <p className="text-[10px] text-[var(--color-destructive)]">
          Não foi possível copiar. Selecione o link e use Ctrl+C.
        </p>
      )}

      {pedido.total_respostas > 0 ? (
        <span
          className={cn(
            TAG_FEEDBACK_BASE,
            // MESMA opacidade da tag neutra (/60). Com /15 ela quase sumia
            // sobre o fundo do card — e, no kanban, sobre um pastel de
            // prioridade sumia de vez. As duas tags ocupam o mesmo lugar e
            // precisam ter o mesmo peso visual; o que as diferencia é a COR,
            // não a transparência.
            'bg-[var(--color-primary)]/60 text-[var(--color-primary-foreground)]',
          )}
        >
          <MessageCircle className="h-[10px] w-[10px] shrink-0" />
          <span className="truncate">
            {pedido.total_respostas} feedback{pedido.total_respostas === 1 ? '' : 's'} colhido
            {pedido.total_respostas === 1 ? '' : 's'}
            {pedido.ultima_resposta_em && ` | Último em ${dataCurta(pedido.ultima_resposta_em)}`}
          </span>
        </span>
      ) : (
        /* Ainda sem resposta: dizer isso é mais útil do que não mostrar nada —
           sem a tag, "esperando" e "colhido zero" ficariam visualmente iguais. */
        <span className={TAG_FEEDBACK_NEUTRA}>
          <MessageCircle className="h-[10px] w-[10px] shrink-0" />
          Nenhum formulário respondido ainda
        </span>
      )}
    </div>
  );
}
