import * as React from "react"
import { cn } from "@/lib/utils"

type ImageLoadStatus = "idle" | "loading" | "loaded" | "error"

const AvatarContext = React.createContext<{
  status: ImageLoadStatus
  setStatus: (s: ImageLoadStatus) => void
}>({ status: "idle", setStatus: () => {} })

const Avatar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const [status, setStatus] = React.useState<ImageLoadStatus>("idle")
  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
          className
        )}
        {...props}
      />
    </AvatarContext.Provider>
  )
})
Avatar.displayName = "Avatar"

/** Tentativas extras antes de desistir e mostrar o fallback (falha transitória
 * de rede / servidor saturado se auto-recupera sem exigir F5). */
const MAX_RETRIES = 3
/** Backoff base entre tentativas (multiplicado pelo nº da tentativa). */
const RETRY_DELAY_MS = 400

const AvatarImage = React.forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ className, src, onLoad, onError, ...props }, ref) => {
  const { setStatus } = React.useContext(AvatarContext)
  const [resolvedSrc, setResolvedSrc] = React.useState(src)
  const [loaded, setLoaded] = React.useState(false)
  const retriesRef = React.useRef(0)
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const localRef = React.useRef<HTMLImageElement | null>(null)

  const setRefs = React.useCallback(
    (node: HTMLImageElement | null) => {
      localRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLImageElement | null>).current = node
    },
    [ref]
  )

  // Reinicia o ciclo sempre que a URL de origem muda.
  React.useEffect(() => {
    retriesRef.current = 0
    setLoaded(false)
    setResolvedSrc(src)
    setStatus(src ? "loading" : "error")
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [src, setStatus])

  // Imagem já em cache: o evento `load` pode ter disparado antes do handler ser
  // anexado. Checa `complete`/`naturalWidth` para não ficar preso invisível.
  React.useEffect(() => {
    const img = localRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true)
      setStatus("loaded")
    }
  }, [resolvedSrc, setStatus])

  if (!src) return null

  return (
    <img
      ref={setRefs}
      src={resolvedSrc}
      className={cn(
        "aspect-square h-full w-full",
        !loaded && "invisible",
        className
      )}
      onLoad={(e) => {
        setLoaded(true)
        setStatus("loaded")
        onLoad?.(e)
      }}
      onError={(e) => {
        if (retriesRef.current < MAX_RETRIES && src) {
          retriesRef.current += 1
          const attempt = retriesRef.current
          // Cache-bust força um novo GET real (ignora a resposta com erro cacheada).
          const bust = `${src.includes("?") ? "&" : "?"}_retry=${attempt}`
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => {
            setResolvedSrc(src + bust)
          }, RETRY_DELAY_MS * attempt)
        } else {
          setStatus("error")
          onError?.(e)
        }
      }}
      {...props}
    />
  )
})
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { status } = React.useContext(AvatarContext)

  if (status === "loaded") return null

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
        className
      )}
      {...props}
    />
  )
})
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }
