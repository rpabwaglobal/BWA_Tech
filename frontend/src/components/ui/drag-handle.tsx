import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type DragHandleProps = HTMLAttributes<HTMLButtonElement> & {
  /** Quando true, mantém visível mesmo sem hover. Default false (só aparece
   * com hover do container `.group`). */
  alwaysVisible?: boolean;
  /** Tamanho do grid de pontos. Default 'sm' (12px). */
  size?: 'sm' | 'md';
};

/**
 * Drag handle "6 pontinhos" estilo Google Keep / Notion. 2 colunas × 3 linhas.
 * Por default fica invisível e aparece quando o ancestor `.group` recebe hover
 * — pra não poluir o visual. Usa `cursor: grab` e `touch-action: none` pro
 * comportamento de drag funcionar em mobile.
 */
const DragHandle = forwardRef<HTMLButtonElement, DragHandleProps>(
  ({ className, alwaysVisible = false, size = 'sm', ...props }, ref) => {
    const dim = size === 'md' ? 'h-[16px] w-[10px] gap-[3px]' : 'h-[14px] w-[8px] gap-[2px]';
    const dot = size === 'md' ? 'h-[3px] w-[3px]' : 'h-[2px] w-[2px]';
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Arrastar"
        title="Arrastar para reordenar"
        // touch-action: none = dnd-kit precisa pra capturar o gesto sem o
        // browser interpretar como scroll.
        style={{ touchAction: 'none' }}
        className={cn(
          'inline-flex shrink-0 cursor-grab items-center justify-center rounded-sm',
          'text-[var(--color-muted-foreground)]/40 hover:text-[var(--color-foreground)]',
          'transition-opacity active:cursor-grabbing focus:outline-none focus:opacity-100',
          alwaysVisible ? 'opacity-60' : 'opacity-0 group-hover:opacity-60',
          className,
        )}
        {...props}
      >
        <span className={cn('grid grid-cols-2', dim)}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn('rounded-full bg-current', dot)}
            />
          ))}
        </span>
      </button>
    );
  },
);
DragHandle.displayName = 'DragHandle';

export { DragHandle };
