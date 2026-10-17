import * as React from "react"
import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & { kbd?: string; icon?: React.ReactNode }

function Input({ className, kbd, icon, ...props }: InputProps) {
  return (
    <div className={cn("flex h-9 items-center gap-2 rounded-[10px] bg-subtle px-3 text-sm text-ink focus-within:ring-2 focus-within:ring-ring/40", className)}>
      {icon && <span className="text-muted-foreground [&_svg]:size-4 [&_svg]:stroke-[1.5]">{icon}</span>}
      <input data-slot="input" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" {...props} />
      {kbd && <kbd className="rounded-md border border-hairline bg-white px-1.5 text-[11px] leading-5 text-muted-foreground">{kbd}</kbd>}
    </div>
  )
}

export { Input }
