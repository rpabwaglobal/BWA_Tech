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

const AvatarImage = React.forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ className, src, onLoad, onError, ...props }, ref) => {
  const { status, setStatus } = React.useContext(AvatarContext)

  React.useEffect(() => {
    if (!src) {
      setStatus("error")
    } else {
      setStatus("loading")
    }
  }, [src, setStatus])

  if (!src || status === "error") return null

  return (
    <img
      ref={ref}
      src={src}
      className={cn(
        "aspect-square h-full w-full",
        status !== "loaded" && "invisible",
        className
      )}
      onLoad={(e) => {
        setStatus("loaded")
        onLoad?.(e)
      }}
      onError={(e) => {
        setStatus("error")
        onError?.(e)
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
