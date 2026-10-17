import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { ArrowUp, Asterisk } from "lucide-react"
import { api, type IndexItem, type Worker } from "@/lib/api"
import { OperatorPanel, UserBubble, ThoughtLink, StackedBar, Legend, StatusPill, dataColors, type Tone } from "@/components/kit"
import { cn } from "@/lib/utils"

type Msg = { role: "user" | "bot"; text: string; node?: React.ReactNode; thought?: string }
type Data = { items: IndexItem[]; workers: Record<string, Worker[]> }

const tone = (s: string): Tone => (s === "red" ? "risk" : s === "amber" ? "warn" : "ok")
const pct = (v: number) => `${Math.round(v * 100)}%`
const SUGGEST = ["Who needs a check-in?", "Highest drop?", "Summarise the riskiest clip", "Site overview"]

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[14px] border border-hairline bg-white p-3.5 shadow-soft">{children}</div>
}

async function answer(q: string, d: Data): Promise<Omit<Msg, "role">> {
  const s = q.toLowerCase()
  const items = d.items
  if (!items.length) return { text: "No clips are loaded yet. Analyse a video first." }

  if (/check.?in|who|worker|tired|fatigue/.test(s)) {
    const all = Object.entries(d.workers).flatMap(([id, ws]) => ws.map((w) => ({ id, w })))
    const flagged = all.filter((x) => x.w.status !== "green").sort((a, b) => b.w.overall - a.w.overall).slice(0, 5)
    if (!flagged.length) return { text: `All ${all.length} tracked workers are in the green. No check-ins suggested right now.`, thought: `Scanned ${all.length} workers across ${items.length} clips.` }
    return {
      text: `${flagged.length} worker${flagged.length > 1 ? "s" : ""} would benefit from a quick check-in. Start with the top of this list.`,
      thought: `Scanned ${all.length} workers in the ${Object.keys(d.workers).length} highest-scoring clips; kept amber/red, ranked by overall score.`,
      node: (
        <Card>
          <div className="divide-y divide-hairline">
            {flagged.map(({ id, w }) => (
              <Link key={id + w.track_id} to={`/video/${encodeURIComponent(id)}`} className="flex items-center gap-2 py-2 text-sm hover:opacity-80">
                <span className="flex-1 truncate text-ink">Worker {w.track_id} <span className="text-muted-foreground">· {id}</span></span>
                <span className="tabular-nums text-muted-foreground">{pct(w.overall)}</span>
                <StatusPill tone={tone(w.status)}>{w.flags[0] ?? w.status}</StatusPill>
              </Link>
            ))}
          </div>
        </Card>
      ),
    }
  }

  if (/drop|height|edge|fall/.test(s)) {
    const top = [...items].sort((a, b) => b.summary.height_risk - a.summary.height_risk)[0]
    let drop: number | undefined
    try { const sc = await api.scene(top.id); drop = Math.max(0, ...sc.edges.map((e) => e.drop_m), ...(sc.hazard_zones ?? []).map((z) => z.drop_m)) } catch { /* scene optional */ }
    return {
      text: `${top.id} has the highest height exposure${drop ? `, with an unprotected drop of about ${drop.toFixed(1)} m` : ""}. Height risk is ${pct(top.summary.height_risk)}.`,
      thought: `Ranked ${items.length} clips by height risk, then read edge drops from the 3D twin.`,
      node: (
        <Card>
          <div className="text-xs text-muted-foreground">Height risk by clip</div>
          <div className="mt-2 space-y-1.5">
            {[...items].sort((a, b) => b.summary.height_risk - a.summary.height_risk).slice(0, 4).map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-ink">{it.id}</span>
                <div className="h-1.5 flex-1 rounded-full bg-subtle"><div className="h-full rounded-full" style={{ width: pct(it.summary.height_risk), background: dataColors.orange }} /></div>
                <span className="w-9 text-right tabular-nums text-muted-foreground">{pct(it.summary.height_risk)}</span>
              </div>
            ))}
          </div>
        </Card>
      ),
    }
  }

  const named = items.find((it) => s.includes(it.id.toLowerCase()))
  if (named || /summar|clip|riskiest/.test(s)) {
    const it = named ?? [...items].sort((a, b) => b.summary.overall - a.summary.overall)[0]
    const sm = it.summary
    const segs = [
      { label: "Fatigue", value: Math.round(sm.fatigue * 100), color: dataColors.amber },
      { label: "Withdrawal", value: Math.round(sm.withdrawal * 100), color: dataColors.sky },
      { label: "Height", value: Math.round(sm.height_risk * 100), color: dataColors.orange },
    ]
    return {
      text: `${it.id}: ${sm.headline || `${sm.n_workers} workers, overall ${pct(sm.overall)}.`}`,
      thought: named ? "Matched the clip name in your question." : "No clip named, so I picked the highest overall score.",
      node: (
        <Card>
          <div className="mb-2 flex items-center gap-2"><span className="flex-1 text-sm font-medium text-ink">{it.id}</span><StatusPill tone={tone(sm.status)}>{pct(sm.overall)}</StatusPill></div>
          <StackedBar segments={segs} height={8} />
          <Legend segments={segs} className="mt-1 text-xs" />
          <div className="mt-2 flex items-center text-xs text-muted-foreground"><span className="flex-1">{sm.n_workers} workers · {sm.predicted_class.replace(/_/g, " ")}</span><Link to={`/video/${encodeURIComponent(it.id)}`} className="btn-dark rounded-[8px] px-2.5 py-1 font-medium">Open</Link></div>
        </Card>
      ),
    }
  }

  const counts = { red: 0, amber: 0, green: 0 }
  items.forEach((it) => { counts[it.summary.status]++ })
  const segs = [
    { label: "Needs attention", value: counts.red, color: "#E5484D" },
    { label: "Watch", value: counts.amber, color: "#E8A10A" },
    { label: "Clear", value: counts.green, color: "#1F9D55" },
  ]
  return {
    text: `Across ${items.length} clips, ${counts.red} need attention and ${counts.amber} are worth watching. Ask about check-ins, drops or a specific clip.`,
    node: <Card><StackedBar segments={segs} /><Legend segments={segs} className="mt-1" /></Card>,
  }
}

export default function OperatorDrawer() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [showT, setShowT] = useState<number>()
  const data = useRef<Data | undefined>(undefined)
  const end = useRef<HTMLDivElement>(null)
  const loc = useLocation()

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  async function load(): Promise<Data> {
    if (data.current) return data.current
    const items = await api.videos().catch(() => [] as IndexItem[])
    const workers: Record<string, Worker[]> = {}
    const ranked = [...items].sort((a, b) => b.summary.overall - a.summary.overall).slice(0, 8)
    await Promise.all(ranked.map((it) => api.video(it.id).then((v) => { workers[it.id] = v.analysis.workers }).catch(() => {})))
    return (data.current = { items, workers })
  }

  async function ask(text: string) {
    if (!text.trim() || busy) return
    setQ(""); setBusy(true)
    setMsgs((m) => [...m, { role: "user", text }])
    const ctx = decodeURIComponent(loc.pathname.match(/\/video\/([^/]+)/)?.[1] ?? "")
    const r = await answer(ctx && /this|here/.test(text.toLowerCase()) ? `${text} ${ctx}` : text, await load())
    setMsgs((m) => [...m, { role: "bot", ...r }]); setBusy(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="btn-dark fixed right-6 bottom-6 z-40 inline-flex h-10 items-center gap-2 rounded-[12px] px-4 text-sm font-medium">
      <Asterisk className="size-4 text-orange" strokeWidth={2} />Ask Operator
    </button>
  )

  return (
    <div className="fixed inset-y-3 right-3 z-40 w-[400px] max-w-[calc(100vw-24px)]">
      <OperatorPanel onClose={() => setOpen(false)} className="shadow-[0_24px_60px_-20px_rgba(0,0,0,.25)]"
        composer={
          <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex items-center gap-2 rounded-[12px] bg-subtle py-1.5 pr-1.5 pl-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about workers, drops or a clip" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            <button disabled={!q.trim() || busy} className="btn-dark grid size-7 place-items-center rounded-[8px] disabled:opacity-40" aria-label="Send"><ArrowUp className="size-4" /></button>
          </form>
        }>
        {!msgs.length && (
          <div className="space-y-3">
            <p className="text-muted-foreground">I answer from the clips loaded on this site: worker readiness, edge drops and clip summaries.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-hairline bg-white px-3 py-1 text-xs text-ink hover:bg-subtle">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? <UserBubble key={i}>{m.text}</UserBubble> : (
          <div key={i} className="space-y-2">
            {m.thought && <ThoughtLink onClick={() => setShowT(showT === i ? undefined : i)} />}
            {showT === i && <div className="border-l-2 border-hairline pl-3 text-xs text-muted-foreground">{m.thought}</div>}
            <p>{m.text}</p>
            {m.node}
          </div>
        ))}
        {busy && <div className={cn("text-xs text-muted-foreground")}>Reading site data…</div>}
        <div ref={end} />
      </OperatorPanel>
    </div>
  )
}
