import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { STATUS_COLOR, riskColor, type Status } from "@/lib/api"

const LABEL: Record<Status, string> = { green: "FIT", amber: "CHECK-IN", red: "HOLD" }

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const c = STATUS_COLOR[status]
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-widest", className)}
      style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55`, boxShadow: `0 0 14px -4px ${c}` }}
    >
      <span className={cn("size-1.5 rounded-full", status === "red" && "pulse-dot")} style={{ background: c }} />
      {LABEL[status]}
    </span>
  )
}

export function MiniBar({ label, value, className }: { label: string; value: number; className?: string }) {
  const c = riskColor(value)
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono-num" style={{ color: c }}>{Math.round(value * 100)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${c}88, ${c})`, boxShadow: `0 0 10px ${c}` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, value * 100)}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </div>
    </div>
  )
}

export function Glass({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-2xl", className)} {...rest}>{children}</div>
}

export function Kpi({ label, value, sub, color = "#67e8f9", delay = 0 }: { label: string; value: string | number; sub?: string; color?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Glass className="relative overflow-hidden p-4">
        <div className="absolute -right-6 -top-6 size-20 rounded-full blur-2xl" style={{ background: `${color}33` }} />
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
        <div className="font-mono-num mt-1 text-3xl font-semibold" style={{ color, textShadow: `0 0 18px ${color}88` }}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </Glass>
    </motion.div>
  )
}

export function Gauge({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const c = riskColor(value), r = size / 2 - 10, circ = Math.PI * 1.5 * r
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[225deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={8} strokeDasharray={`${circ} 999`} strokeLinecap="round" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={8} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${c})` }}
          initial={{ strokeDasharray: `0 999` }} animate={{ strokeDasharray: `${circ * value} 999` }} transition={{ duration: 1.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono-num text-2xl font-bold" style={{ color: c }}>{Math.round(value * 100)}</span>
        {label && <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
