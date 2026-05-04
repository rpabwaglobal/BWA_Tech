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
  /**
   * Largura reservada à direita (px), ex. painel da timeline — o backdrop não cobre essa faixa.
   * O conteúdo do modal permanece centralizado na tela inteira (50% / 50%), como sem reserva.
   */
  reserveRightPx?: number;
}

 // Com reserveRightPx, o backdrop deixa a timeline à direita fora do escurecimento; o painel do modal usa o mesmo centro da viewport.
const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children, containerClassName, reserveRightPx }) => {
  if (!open) return null;

  const backdropStyle: React.CSSProperties =
    reserveRightPx != null
      ? { top: 0, left: 0, bottom: 0, right: reserveRightPx }
      : { top: 0, left: 0, right: 0, bottom: 0 };

  const contentWrapperClassName =
    reserveRightPx != null
      ? cn('w-full px-4', containerClassName ?? 'max-w-lg')
      : cn(
          'fixed left-1/2 top-1/2 z-[60] w-full -translate-x-1/2 -translate-y-1/2 px-4',
          containerClassName ?? 'max-w-lg',
        );

  const contentWrapperStyle: React.CSSProperties | undefined =
    reserveRightPx != null
      ? {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 60,
        }
      : undefined;

  return (
    <>
      {createPortal(
        <div
          className="fixed z-50 bg-black/50 backdrop-blur-sm"
          style={backdropStyle}
          onClick={() => onOpenChange(false)}
          aria-hidden
        />,
        document.body
      )}
      {createPortal(
        <div
          className={contentWrapperClassName}
          style={contentWrapperStyle}
          onClick={(e) => e.stopPropagation()}
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
