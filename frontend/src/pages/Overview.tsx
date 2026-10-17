import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Search, Users, ArrowUpRight, Play, LoaderCircle } from "lucide-react"
import { useWorkspace, buildItems, media, trackReviews, type Footage } from "@/lib/sitesense"
import { SectionCard, StatCard, StatusPill, StackedBar, Legend, Chip, toneColor, type Tone } from "@/components/kit"
import { cn } from "@/lib/utils"

type Filter = "all" | "review" | "analysed" | "unanalysed"
const FILTERS: { value: Filter; label: string; tone?: Tone }[] = [
  { value: "all", label: "All" },
  { value: "review", label: "Needs review", tone: "warn" },
  { value: "analysed", label: "Analysed", tone: "ok" },
  { value: "unanalysed", label: "Not analysed", tone: "neutral" },
]
const STATUS: Record<Footage["status"], { label: string; tone: Tone }> = {
  review: { label: "Needs review", tone: "warn" }, ready: { label: "Analysed", tone: "ok" },
  unanalysed: { label: "Not analysed", tone: "neutral" }, processing: { label: "Processing", tone: "neutral" }, failed: { label: "Failed", tone: "risk" },
}
const isAnalysed = (item: Footage) => item.status === "ready" || item.status === "review"
const durationLabel = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return ""
  const seconds = Math.round(duration)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
const observationLabel = (text?: string) => text?.split(/(?<=[.!?])\s+/)[0] || "Flagged window awaiting review"
const footageLink = (item: Footage) => isAnalysed(item) && item.recording
  ? `/video/${encodeURIComponent(item.recording.id)}`
  : item.libraryId ? `/library/${encodeURIComponent(item.libraryId)}`
  : item.recording ? `/video/${encodeURIComponent(item.recording.id)}` : "/upload"

function FootagePreview({ item }: { item: Footage }) {
  const [imageFailed, setImageFailed] = useState(false)
  return imageFailed ? (
    <video src={item.video} muted playsInline preload="metadata" aria-hidden="true" className="size-full object-cover"
      onLoadedMetadata={event => { const video = event.currentTarget; if (video.duration > .2) video.currentTime = Math.min(1, video.duration / 2) }} />
  ) : (
    <img src={item.poster} alt={`Frame from ${item.title}`} loading="lazy" decoding="async" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" onError={() => setImageFailed(true)} />
  )
}

export default function Overview() {
  const { state, library, error, refresh } = useWorkspace()
  const [filter, setFilter] = useState<Filter>("all")
  const [source, setSource] = useState("all")
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  useEffect(() => {setQ(new URLSearchParams(location.search).get('q') ?? '');setLimit(24)},[location.search])
  const [limit, setLimit] = useState(24)
  const clipsOnly = location.pathname === "/clips"
  const items = useMemo(() => state ? buildItems(state, library) : [], [state, library])
  const sources = useMemo(() => ["all", ...new Set(library.map(item => item.collection))], [library])
  const attention = useMemo(() => {
    if (!state) return []
    return state.tracks.flatMap(track => {
      const flags = trackReviews(state, track.id).filter(analysis => analysis.status === "complete" && !analysis.reviewed && analysis.report?.review_priority === "review")
      if (!flags.length) return []
      const flag = flags[flags.length - 1]
      const clip = state.clips.find(clip => clip.track_key === track.id && clip.id === flag.clip_id) || state.clips.find(clip => clip.track_key === track.id)
      const item = items.find(item => item.recording?.id === track.recording_id)
      return [{ track, flags, flag, clip, item }]
    }).sort((a, b) => b.flags.length - a.flags.length)
  }, [state, items])
  const stats = useMemo(() => {
    const dataset = items.filter(item => item.libraryId)
    const analysed = dataset.filter(isAnalysed)
    const demo = items.filter(item => item.recording?.demo && isAnalysed(item)).length
    const pending = dataset.filter(item => item.status === "review").length
    return {
      available: library.length,
      construction: library.filter(item => item.collection === "Construction").length,
      factory: library.filter(item => item.collection === "Factory").length,
      analysed: analysed.length, demo, pending,
      windows: attention.reduce((total, item) => total + item.flags.length, 0),
      withoutFlags: analysed.length - pending,
      unanalysed: Math.max(0, library.length - analysed.length),
      tracks: state?.tracks.length ?? 0,
      recordings: state?.recordings.length ?? 0,
      reviewTracks: attention.length,
    }
  }, [items, library, state, attention])
  const segments = [
    { label: "Analysed", value: stats.withoutFlags, color: toneColor.ok },
    { label: "Needs review", value: stats.pending, color: toneColor.warn },
    { label: "Not analysed", value: stats.unanalysed, color: "#D4D4CE" },
  ]
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase()
    const order = { review: 0, processing: 1, ready: 2, failed: 3, unanalysed: 4 }
    return items
      .filter(item => filter === "all" || (filter === "analysed" ? isAnalysed(item) : filter === "unanalysed" ? !isAnalysed(item) : item.status === "review"))
      .filter(item => source === "all" || item.collection === source)
      .filter(item => !query || `${item.title} ${item.collection} ${item.group}`.toLowerCase().includes(query))
      .sort((a, b) => order[a.status] - order[b.status])
  }, [items, filter, source, q])
  const visible = shown.slice(0, limit)
  const changeFilter = (value: Filter) => { setFilter(value); setLimit(24) }
  const seg = "h-8 rounded-[8px] px-3 text-[13px] text-muted-foreground transition hover:text-ink"
  const segOn = "bg-white text-ink shadow-soft border border-hairline"

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{clipsOnly ? "Clips" : "Site overview"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{clipsOnly ? "Recorded footage, ready to explore." : "Site footage. Worker observations. A timely check-in."}</p>
        </div>
        <Link to="/upload" className="btn-dark inline-flex h-9 shrink-0 items-center rounded-[10px] px-3.5 text-sm font-medium">Analyse a clip</Link>
      </div>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-muted-foreground"><span>{error}</span><Chip onClick={() => void refresh()}>Retry</Chip></div>}
      {!clipsOnly && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Videos available" value={state ? stats.available : "—"} sub={`${stats.construction} construction · ${stats.factory} factory`} />
            <StatCard label="Videos analysed" tone="ok" value={state ? stats.analysed : "—"} sub={stats.demo ? `Plus ${stats.demo} warehouse demo${stats.demo === 1 ? "" : "s"}` : "From the footage library"} />
            <StatCard label="Worker tracks" value={state ? stats.tracks : "—"} sub={`Across ${stats.recordings} recordings`} />
            <StatCard label="Needs review" tone="warn" value={state ? stats.reviewTracks : "—"} unit="tracks" sub={`${stats.windows} flagged observation ${stats.windows === 1 ? "window" : "windows"}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <SectionCard title="Analysis across footage" menu={false} className="lg:col-span-2" footer={`${stats.analysed} library videos analysed${stats.demo ? ` · ${stats.demo} demo` : ""}`} footerAction={<Chip onClick={() => changeFilter("review")}>View flags</Chip>}>
              <div className="text-[28px] font-semibold tabular-nums text-ink">{stats.available ? Math.round(stats.analysed / stats.available * 100) : 0}%<span className="ml-2 text-sm font-normal text-muted-foreground">analysed</span></div>
              <StackedBar segments={segments} className="mt-4" />
              <Legend segments={segments} className="mt-4" />
            </SectionCard>
            <SectionCard title="Who to check in with" menu={false} className="lg:col-span-3" bodyClassName="px-2 pb-2" action={attention.length > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{attention.length} tracks</span> : undefined}>
              {state && attention.length === 0 && <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center"><p className="text-sm text-ink">No pending review flags</p><p className="mt-1 text-xs text-muted-foreground">Open an analysed clip to inspect its observations.</p></div>}
              {!state && <p className="px-3 py-6 text-sm text-muted-foreground">Loading recorded observations…</p>}
              {attention.slice(0, 5).map(({ track, flags, flag, clip, item }) => (
                <Link key={track.id} to={`/video/${encodeURIComponent(track.recording_id)}?worker=${encodeURIComponent(track.id)}`} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-canvas">
                  {clip?.thumbnail_path ? <img src={media(clip.thumbnail_path)} alt="" loading="lazy" className="h-9 w-14 shrink-0 rounded-md bg-subtle object-cover" /> : <span className="grid h-9 w-14 shrink-0 place-items-center rounded-md bg-subtle text-muted-foreground"><Users className="size-4" strokeWidth={1.5} /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2"><span className="truncate text-sm font-medium text-ink">{track.worker_id || `Track #${track.track_id}`}</span><span className="truncate text-xs text-muted-foreground">{item?.title || "Recorded footage"}</span></div>
                    <div className="truncate text-xs text-muted-foreground">{observationLabel(flag.report?.human_review_summary)}</div>
                  </div>
                  <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{flags.length} {flags.length === 1 ? "window" : "windows"}</span>
                  <StatusPill tone="warn">Review</StatusPill>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" strokeWidth={1.5} />
                </Link>
              ))}
            </SectionCard>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-[10px] bg-subtle p-0.5" role="group" aria-label="Analysis status">
          {FILTERS.map(({ value, label, tone }) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)} className={cn(seg, "inline-flex items-center gap-1.5", filter === value && segOn)}>{tone && <span className="size-1.5 rounded-full" style={{ background: toneColor[tone] }} />}{label}</button>
          ))}
        </div>
        <div className="flex rounded-[10px] bg-subtle p-0.5" role="group" aria-label="Footage collection">
          {sources.map(collection => <button key={collection} type="button" aria-pressed={source === collection} onClick={() => { setSource(collection); setLimit(24) }} className={cn(seg, source === collection && segOn)}>{collection === "all" ? "All sources" : collection}</button>)}
        </div>
        <label className="ml-auto flex h-9 items-center gap-2 rounded-[10px] bg-subtle px-3">
          <Search className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <input value={q} onChange={event => { setQ(event.target.value); setLimit(24) }} aria-label="Search clips" placeholder="Search clips" className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </label>
      </div>
      {!state && !error && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading footage…</div>}
      {state && shown.length === 0 && <div className="rounded-[18px] border border-hairline bg-white px-4 py-14 text-center text-sm text-muted-foreground">{items.length ? "No clips match these filters." : "Add footage to begin."}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map(item => {
          const status = STATUS[item.status]
          return (
            <Link key={item.id} to={footageLink(item)} className="group overflow-hidden rounded-[18px] border border-hairline bg-white shadow-soft transition hover:-translate-y-0.5">
              <div className="relative aspect-video overflow-hidden bg-subtle">
                <FootagePreview item={item} />
                <div className="absolute left-2.5 top-2.5"><StatusPill tone={status.tone} className="bg-white/95">{status.label}</StatusPill></div>
                {isAnalysed(item) && <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] tabular-nums text-ink" title="Tracked people in this recording"><Users className="size-3" strokeWidth={1.5} />{item.tracks.length}</div>}
                {durationLabel(item.duration) && <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{durationLabel(item.duration)}</span>}
                <span className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-black/30 text-white opacity-0 transition group-hover:opacity-100"><Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={1.5} /></span>
              </div>
              <div className="space-y-3 p-4">
                <div><p className="truncate text-sm font-medium text-ink" title={item.title}>{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.collection} · {item.group}</p></div>
                <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3 text-xs text-muted-foreground">
                  <span>{item.status === "review" ? `${item.reviewCount} pending ${item.reviewCount === 1 ? "window" : "windows"}` : isAnalysed(item) ? `${item.tracks.length} worker ${item.tracks.length === 1 ? "track" : "tracks"}` : item.status === "processing" ? "Analysis in progress" : item.status === "failed" ? "Retry analysis" : "Ready to analyse"}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-ink">{isAnalysed(item) ? "Open" : "Preview"}<ArrowUpRight className="size-3.5" strokeWidth={1.5} /></span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      {state && shown.length > 0 && <div className="flex flex-col items-center gap-3 pt-1"><span className="text-xs tabular-nums text-muted-foreground">Showing {visible.length} of {shown.length} clips</span>{visible.length < shown.length && <Chip onClick={() => setLimit(value => value + 24)}>Load more clips</Chip>}</div>}
    </div>
  )
}
