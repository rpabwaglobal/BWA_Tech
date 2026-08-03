import * as React from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Estado parcial: alguns itens do grupo marcados (cabeçalho de tabela). */
  indeterminate?: boolean
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
}

/**
 * Checkbox sem Radix, no mesmo padrão do Switch: `button` com role adequado e
 * as CSS vars do tema, para acompanhar claro/escuro sem cor fixa.
 *
 * O input nativo foi trocado porque não é estilizável de forma consistente
 * entre navegadores — o quadrado herdava a cor do sistema operacional.
 */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, indeterminate, disabled, id, className, ...props }, ref) => {
    const marcado = checked || !!indeterminate
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        id={id}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        className={cn(
          "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          marcado
            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
            : "border-[var(--color-border)] bg-[var(--color-background)] hover:border-[var(--color-primary)]",
          className,
        )}
        {...props}
      >
        {indeterminate ? (
          <Minus className="h-3 w-3" strokeWidth={3} />
        ) : checked ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : null}
      </button>
    )
  },
)
Checkbox.displayName = "Checkbox"
