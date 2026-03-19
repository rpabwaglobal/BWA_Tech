import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | undefined>(undefined)

interface DropdownMenuProps {
  children: React.ReactNode
  /** Padrão: inline-block (encolhe ao conteúdo). Use p.ex. `block w-full` para o trigger preencher o pai. */
  className?: string
}

const DropdownMenu = ({ children, className }: DropdownMenuProps) => {
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div
        className={cn(
          'relative text-left',
          className ?? 'inline-block',
        )}
      >
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  children: React.ReactNode
  open?: boolean
  setOpen?: (open: boolean) => void
}

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ className, children, asChild, open, setOpen, ...props }, ref) => {
    const context = React.useContext(DropdownMenuContext)
    const isOpen = open ?? context?.open ?? false
    const setIsOpen = setOpen ?? context?.setOpen

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (setIsOpen) {
        setIsOpen(!isOpen)
      }
      props.onClick?.(e)
    }

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ...props,
        onClick: handleClick,
        ref,
      } as any)
    }

    return (
      <button
        ref={ref}
        className={cn("inline-flex items-center justify-center", className)}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end" | "center"
  open?: boolean
  setOpen?: (open: boolean) => void
}

const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, align = "start", open, setOpen, children, ...props }, ref) => {
    const context = React.useContext(DropdownMenuContext)
    const isOpen = open ?? context?.open ?? false
    const setIsOpen = setOpen ?? context?.setOpen
    const contentRef = React.useRef<HTMLDivElement>(null)
    const combinedRef = React.useMemo(() => {
      if (ref) {
        if (typeof ref === 'function') {
          return (node: HTMLDivElement | null) => {
            contentRef.current = node
            ref(node)
          }
        } else {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = contentRef.current
        }
      }
      return contentRef
    }, [ref])

    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
          if (setIsOpen) {
            setIsOpen(false)
          }
        }
      }

      if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside)
      }

      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
      }
    }, [isOpen, setIsOpen])

    if (!isOpen) return null

    const alignClasses = {
      start: "left-0",
      end: "right-0",
      center: "left-1/2 -translate-x-1/2",
    }

    return (
      <div
        ref={combinedRef}
        className={cn(
          "absolute z-50 mt-[4px] min-w-[160px] rounded-md border border-[var(--color-border)] bg-[var(--color-popover)] shadow-md",
          alignClasses[align],
          className
        )}
        {...props}
      >
        <div className="p-[4px]">
          {children}
        </div>
      </div>
    )
  }
)
DropdownMenuContent.displayName = "DropdownMenuContent"

interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
  onSelect?: () => void
}

const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ className, children, onSelect, onClick, ...props }, ref) => {
    const context = React.useContext(DropdownMenuContext)
    const setIsOpen = context?.setOpen

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onSelect?.()
      onClick?.(e)
      if (setIsOpen) {
        setIsOpen(false)
      }
    }

    return (
      <button
        ref={ref}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-sm px-[12px] py-[8px] text-sm outline-none transition-colors hover:bg-[var(--color-accent)] focus:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuItem.displayName = "DropdownMenuItem"

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("my-[4px] h-[1px] bg-[var(--color-border)]", className)}
      {...props}
    />
  )
})
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
