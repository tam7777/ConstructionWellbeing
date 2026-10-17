import * as React from "react"
import { MoreHorizontal, Asterisk, Settings2, X, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type Tone = "ok" | "warn" | "risk" | "neutral"
export const toneColor: Record<Tone, string> = { ok: "#1F9D55", warn: "#E8A10A", risk: "#E5484D", neutral: "#8A8A85" }
export const dataColors = { amber: "#E8B10A", orange: "#F26B1D", sky: "#19B6E8", teal: "#18B5A5", pink: "#EC4899" }

export function StatusPill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 text-xs font-medium text-ink", className)}>
      <span className="size-1.5 rounded-full" style={{ background: toneColor[tone] }} />
      {children}
    </span>
  )
}

export type Segment = { label: string; value: number; color: string }

export function StackedBar({ segments, height = 10, className }: { segments: Segment[]; height?: number; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className={cn("flex w-full gap-[2px]", className)} style={{ height }}>
      {segments.filter(s => s.value > 0).map(s => (
        <div key={s.label} title={`${s.label}: ${s.value}`} className="h-full rounded-[3px] first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  )
}

export function Legend({ segments, format = (v: number) => String(v), className }: { segments: Segment[]; format?: (v: number) => string; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className={cn("divide-y divide-hairline", className)}>
      {segments.map(s => (
        <div key={s.label} className="flex items-center gap-2.5 py-2 text-sm">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          <span className="flex-1 text-ink">{s.label}</span>
          <span className="tabular-nums text-ink">{format(s.value)}</span>
          <span className="w-12 text-right tabular-nums text-muted-foreground">({Math.round((s.value / total) * 100)}%)</span>
        </div>
      ))}
    </div>
  )
}

export function SectionCard({ title, action, menu = false, footer, footerAction, className, bodyClassName, children }: {
  title?: React.ReactNode; action?: React.ReactNode; menu?: boolean; footer?: React.ReactNode; footerAction?: React.ReactNode
  className?: string; bodyClassName?: string; children?: React.ReactNode
}) {
  return (
    <section className={cn("overflow-hidden rounded-[18px] border border-hairline bg-white shadow-soft", className)}>
      {(title || action) && (
        <header className="flex items-center gap-2 px-5 pt-4 pb-2">
          <h3 className="flex-1 text-sm font-medium text-muted-foreground">{title}</h3>
          {action}
          {menu && <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-subtle" aria-label="More"><MoreHorizontal className="size-4" strokeWidth={1.5} /></button>}
        </header>
      )}
      <div className={cn("px-5 pb-5", !title && !action && "pt-5", bodyClassName)}>{children}</div>
      {(footer || footerAction) && (
        <footer className="flex items-center gap-3 border-t border-hairline px-5 py-3 text-xs text-muted-foreground">
          <div className="flex-1">{footer}</div>{footerAction}
        </footer>
      )}
    </section>
  )
}

export function Chip({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("btn-dark inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-xs font-medium", className)} {...rest}>{children}</button>
}

export function StatCard({ label, value, unit, sub, tone, className }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cn("rounded-[18px] border border-hairline bg-white p-5 shadow-soft", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {tone && <span className="size-1.5 rounded-full" style={{ background: toneColor[tone] }} />}{label}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-ink">
        {value}{unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function RingProgress({ value, total, size = 36, stroke = 3, label, className }: { value: number; total: number; size?: number; stroke?: number; label?: string; className?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = total ? value / total : 0
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7E7E5" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F1F1F" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      </svg>
      <span className="text-sm text-ink tabular-nums">{label ?? `${value} of ${total}`}</span>
    </div>
  )
}

export function CloudHero({ icon, className, children }: { icon?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("cloud-hero grain relative grid min-h-48 place-items-center overflow-hidden rounded-[16px]", className)}>
      {icon && <div className="relative z-10 grid size-16 place-items-center rounded-full bg-white text-ink shadow-[0_6px_24px_-8px_rgba(0,0,0,.25)] [&_svg]:size-6 [&_svg]:stroke-[1.5]">{icon}</div>}
      {children}
    </div>
  )
}

const corners = {
  tr: ["top-0 right-0", "at 100% 0%"], br: ["bottom-0 right-0", "at 100% 100%"],
  tl: ["top-0 left-0", "at 0% 0%"], bl: ["bottom-0 left-0", "at 0% 100%"],
} as const

export function HalftoneAccent({ className, corner = "tr" }: { className?: string; corner?: keyof typeof corners }) {
  const [pos, at] = corners[corner]
  const mask = `radial-gradient(circle ${at}, #000 0%, transparent 70%)`
  const dots = "radial-gradient(circle, #000 1.2px, transparent 1.7px)"
  return (
    <div aria-hidden className={cn("pointer-events-none absolute size-56", pos, className)} style={{ WebkitMaskImage: mask, maskImage: mask }}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#F7A9C8,#F58A3C 55%,#E8452C)", WebkitMaskImage: dots, maskImage: dots, WebkitMaskSize: "8px 8px", maskSize: "8px 8px" }} />
    </div>
  )
}

export function OperatorPanel({ title = "Operator", onClose, className, children, composer }: { title?: string; onClose?: () => void; className?: string; children?: React.ReactNode; composer?: React.ReactNode }) {
  return (
    <aside className={cn("flex h-full flex-col rounded-[18px] border border-hairline bg-white shadow-soft", className)}>
      <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <Asterisk className="size-4 text-orange" strokeWidth={2} />
        <span className="flex-1 text-sm font-medium text-ink">{title}</span>
        <button className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-subtle" aria-label="Settings"><Settings2 className="size-4" strokeWidth={1.5} /></button>
        {onClose && <button onClick={onClose} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-subtle" aria-label="Close"><X className="size-4" strokeWidth={1.5} /></button>}
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm leading-relaxed text-ink">{children}</div>
      {composer && <div className="border-t border-hairline p-3">{composer}</div>}
    </aside>
  )
}

export function UserBubble({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-ink px-3.5 py-2 text-sm text-white">{children}</div>
}

export function ThoughtLink({ onClick }: { onClick?: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-ink">Thought process <ChevronRight className="size-3" /></button>
}
