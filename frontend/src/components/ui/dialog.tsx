import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Classes do wrapper externo (largura). Padrão: max-w-lg */
  containerClassName?: string;
}

/** Quem pediu menos movimento não recebe animação — e, sem animação, não há
 *  `animationend`. Ver `fechar` abaixo. */
function semMovimento() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

/**
 * Rede de segurança para o desmonte, em milissegundos.
 *
 * O fechamento espera o `animationend`. Se a animação não rodar por qualquer
 * motivo que não seja `prefers-reduced-motion` — CSS que não carregou, aba em
 * segundo plano que engaveta animações, o nó recebendo `display: none` de um
 * ancestral —, o evento nunca chega e o modal fica PRESO ABERTO, cobrindo a tela
 * com um backdrop que não sai. Um painel lateral travado é um incômodo; um modal
 * travado impede de usar o sistema.
 *
 * Folga generosa sobre os 140ms da animação: aqui o objetivo é não ser
 * alcançado no caminho normal.
 */
const PRAZO_MAXIMO_DA_SAIDA = 400;

/**
 * O BACKDROP COBRE A TELA INTEIRA, SEMPRE.
 *
 * Havia uma prop `reserveRightPx` que o encurtava pela direita, para "deixar a
 * timeline fora do escurecimento". Ela não era necessária — o painel da timeline
 * é `z-[60]` e o backdrop é `z-50`, então o painel já fica POR CIMA e nunca foi
 * escurecido — e cobrava um preço visível: a faixa reservada tinha 488px e o
 * painel ocupa 480, então sobravam tiras sem desfoque acima, abaixo e à direita
 * dele, mostrando a página crua ao redor de um painel flutuante.
 *
 * ENTRA E SAI ANIMADO, e a saída é o que obrigou a estrutura abaixo.
 *
 * Antes era `if (!open) return null`: o modal aparecia e sumia no mesmo quadro.
 * Animar a entrada seria trivial, mas a SAÍDA não: nó desmontado não anima, e
 * desmontar no mesmo quadro em que a classe de saída entraria faz a animação
 * nunca rodar. É a mesma armadilha documentada em `useTimelineRecolhivel`.
 *
 * Daí o estado interno: `open` é o que quem chama QUER, `renderizando` é o que
 * está na tela. Quando `open` cai, o modal continua montado com a classe de
 * saída, e só então desmonta.
 */
const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children, containerClassName }) => {
  const [renderizando, setRenderizando] = React.useState(open);
  const [saindo, setSaindo] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setRenderizando(true);
      setSaindo(false);
      return;
    }
    // Já estava fechado: nada a animar. Sem esta guarda, montar o componente
    // com `open=false` dispararia uma saída de um modal que nunca apareceu.
    if (!renderizando) return;

    if (semMovimento()) {
      setRenderizando(false);
      return;
    }
    setSaindo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A rede de segurança do desmonte. Vive num efeito próprio porque precisa ser
  // cancelada quando o `animationend` chega primeiro — o caminho normal.
  React.useEffect(() => {
    if (!saindo) return;
    const id = window.setTimeout(() => {
      setSaindo(false);
      setRenderizando(false);
    }, PRAZO_MAXIMO_DA_SAIDA);
    return () => window.clearTimeout(id);
  }, [saindo]);

  if (!renderizando) return null;

  /**
   * Fim da animação de SAÍDA — é aqui que o modal realmente desmonta.
   *
   * Duas armadilhas, as duas tratadas:
   *
   * 1. `animationend` BORBULHA. Qualquer filho animado (e o conteúdo dos modais
   *    deste projeto anima: `card-entra`, `slot-entra`, e outros) dispararia
   *    este handler e desmontaria o modal no meio da abertura. Daí a conferência
   *    do alvo contra `currentTarget`.
   * 2. A animação de ENTRADA também passa por aqui. Por isso só age com `saindo`.
   */
  const aoTerminarSaida = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !saindo) return;
    setSaindo(false);
    setRenderizando(false);
  };

  const contentWrapperClassName = cn(
    'fixed left-1/2 top-1/2 z-[60] w-full -translate-x-1/2 -translate-y-1/2 px-4',
    containerClassName ?? 'max-w-lg',
    saindo ? 'modal-sai' : 'modal-entra',
  );

  return (
    <>
      {createPortal(
        <div
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
            saindo ? 'modal-fundo-sai' : 'modal-fundo-entra',
          )}
          // Clicar no fundo de um modal que já está saindo não deve pedir outro
          // fechamento: o `pointer-events: none` da classe de saída já barra,
          // e a guarda existe para o caso de a animação não rodar.
          onClick={() => { if (!saindo) onOpenChange(false); }}
          aria-hidden
        />,
        document.body
      )}
      {createPortal(
        <div
          className={contentWrapperClassName}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={aoTerminarSaida}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
};

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }
>(({ className, children, onClose, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-lg max-h-[90vh] overflow-y-auto",
      className
    )}
    {...props}
  >
    {onClose && (
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </button>
    )}
    {children}
  </div>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-[var(--color-muted-foreground)]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
