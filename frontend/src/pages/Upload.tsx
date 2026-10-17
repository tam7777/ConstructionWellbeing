import { useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { UploadCloud, Loader2, Check, XCircle, Film, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CloudHero, SectionCard, RingProgress, StatusPill } from "@/components/kit"
import { request, useWorkspace } from "@/lib/sitesense"
import { cn } from "@/lib/utils"

type UploadJob = {
  id: string
  label?: string
  status: string
  stage?: string
  progress?: number
  error?: string | null
  recording_id?: string
  result?: { recording_id?: string }
  events?: { stage: string; detail?: string; at: number }[]
}

const INFO = [
  ["Person-focused evidence", "Tracked video windows, earlier references and visible changes in movement or posture."],
  ["Video overlays", "Person boxes and confidence-gated 2D pose estimates for visible people."],
  ["Recording context", "Use the actual capture time and task. Confirm worker identity only when you know it."],
]

function durationOf(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)
    const timeout = window.setTimeout(() => finish(undefined, "The video duration could not be read. Choose a playable MP4."), 15000)
    const finish = (duration?: number, message?: string) => {
      window.clearTimeout(timeout)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
      if (message) reject(new Error(message))
      else resolve(duration ?? 0)
    }
    video.preload = "metadata"
    video.onloadedmetadata = () => finish(video.duration)
    video.onerror = () => finish(undefined, "This video could not be read. Choose a playable MP4.")
    video.src = url
  })
}

export default function UploadPage() {
  const { state, error: workspaceError, refresh } = useWorkspace()
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState<File>()
  const [duration, setDuration] = useState<number>()
  const [task, setTask] = useState("")
  const [capturedAt, setCapturedAt] = useState("")
  const [checking, setChecking] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [submittedJob, setSubmittedJob] = useState<UploadJob>()
  const input = useRef<HTMLInputElement>(null)
  const liveJob = state?.jobs.find((job) => job.id === submittedJob?.id)
    ?? (!submittedJob ? state?.jobs.find((job) => ["queued", "running"].includes(job.status)) : undefined)
  const job = liveJob ?? submittedJob
  const running = !!job && ["queued", "running"].includes(job.status)
  const busy = sending || running || !!state?.busy
  const progress = Math.max(0, Math.min(100, job?.progress ?? 0))
  const recordingId = job?.result?.recording_id ?? job?.recording_id
  const events = Array.from(new Map((job?.events ?? []).map((event) => [event.stage, event])).values())
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function selectFile(candidate: File) {
    if (busy || checking) return
    setError(undefined)
    setFile(undefined)
    setDuration(undefined)
    if (!candidate.name.toLowerCase().endsWith(".mp4")) {
      setError("Choose an MP4 video.")
      return
    }
    if (candidate.size === 0 || candidate.size > 80_000_000) {
      setError("Choose a non-empty MP4 up to 80 MB.")
      return
    }
    setChecking(true)
    try {
      const seconds = await durationOf(candidate)
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) throw new Error("Choose a video between 1 and 30 seconds long.")
      setFile(candidate)
      setDuration(seconds)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The video could not be checked.")
    } finally {
      setChecking(false)
      if (input.current) input.current.value = ""
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault()
    if (busy || checking) return
    setError(undefined)
    if (!file || duration === undefined) return setError("Choose a 1–30 second MP4 first.")
    if (!task.trim()) return setError("Enter the activity or task shown in this recording.")
    const captured = new Date(capturedAt)
    if (!capturedAt || !Number.isFinite(captured.getTime()) || captured.getTime() < 0 || captured.getTime() > Date.now() + 86_400_000) {
      return setError("Enter the actual recorded date and time.")
    }
    setSending(true)
    try {
      const body = new FormData()
      body.append("file", file)
      body.append("task", task.trim())
      body.append("captured_at", captured.toISOString())
      const accepted = await request<UploadJob>("/api/upload", { method: "POST", body })
      setSubmittedJob(accepted)
      void refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload could not be started.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-[880px] space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Analyse footage</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add a recording to detect people, compare person-focused windows and review the visible evidence.</p>
      </div>

      <form onSubmit={run} className="space-y-5">
        <div
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => { event.preventDefault(); setDrag(false); const candidate = event.dataTransfer.files[0]; if (candidate) void selectFile(candidate) }}
          className={cn("rounded-[20px] border bg-white p-2 shadow-soft transition", drag ? "border-ink" : "border-hairline")}
        >
          <input ref={input} type="file" accept=".mp4,video/mp4" className="sr-only" aria-label="Choose MP4 recording" disabled={busy || checking}
            onChange={(event) => { const candidate = event.target.files?.[0]; if (candidate) void selectFile(candidate) }} />
          <CloudHero className="min-h-56" icon={sending || checking ? <Loader2 className="animate-spin" /> : <UploadCloud />} />
          <div className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium text-ink">{checking ? "Checking video…" : file?.name ?? "Drop an MP4 here, or choose a file"}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{file ? `${(file.size / 1e6).toFixed(1)} MB · ${duration?.toFixed(1)} seconds` : "MP4 · 1–30 seconds · up to 80 MB"}</div>
            </div>
            <Button type="button" variant="primary" disabled={busy || checking} onClick={() => input.current?.click()}><Film className="size-4" strokeWidth={1.5} />Choose file</Button>
          </div>
        </div>

        <SectionCard title="Recording details" menu={false} footer={`Date and time use your local timezone: ${timeZone}.`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-ink" htmlFor="upload-task">
              <span>Task or activity</span>
              <Input id="upload-task" value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. moving stock" required maxLength={80} disabled={busy} />
            </label>
            <label className="space-y-2 text-sm text-ink" htmlFor="upload-captured-at">
              <span>Actual recorded date and time</span>
              <Input id="upload-captured-at" type="datetime-local" step="1" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} required disabled={busy} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!file || !state || busy || checking}>{sending && <Loader2 className="size-4 animate-spin" />}{sending ? "Uploading…" : "Start analysis"}</Button>
            {state?.busy && !running && <span className="text-xs text-muted-foreground">Another recording is processing. Wait for it to finish.</span>}
          </div>
        </SectionCard>
      </form>

      {job && (
        <SectionCard title={job.stage ?? "Queued for analysis"} menu={false}
          action={<StatusPill tone={job.status === "failed" ? "risk" : job.status === "completed" ? "ok" : "warn"}>{job.status}</StatusPill>}
          footer={<span className="break-all">Job {job.id}</span>}
          footerAction={<RingProgress value={Math.round(progress)} total={100} label={`${Math.round(progress)}%`} size={28} />}>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${progress}%` }} />
          </div>
          <ol className="divide-y divide-hairline">
            {events.map((event, index) => (
              <li key={event.stage} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-hairline text-muted-foreground">
                  {job.status === "failed" && index === events.length - 1 ? <XCircle className="size-3 text-risk" /> : running && index === events.length - 1 ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                </span>
                <div><div className="text-ink">{event.stage}</div>{event.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{event.detail}</p>}</div>
              </li>
            ))}
            {!events.length && <li className="py-3 text-sm text-muted-foreground">Waiting for the server to begin processing.</li>}
          </ol>
          {job.error && <p className="mt-3 text-sm text-risk" role="alert">{job.error}</p>}
          {job.status === "completed" && recordingId && <Link to={`/video/${encodeURIComponent(recordingId)}`} className="btn-dark mt-4 inline-flex h-9 items-center gap-2 rounded-[10px] px-3.5 text-sm font-medium">Open recording<ArrowUpRight className="size-4" /></Link>}
        </SectionCard>
      )}

      {(error || workspaceError) && <div role="alert" className="flex items-center gap-3 rounded-[16px] border border-hairline bg-white p-4 text-sm shadow-soft"><XCircle className="size-5 shrink-0 text-risk" strokeWidth={1.5} /><span className="flex-1 text-ink">{error || workspaceError}</span></div>}

      <div className="grid gap-3 md:grid-cols-3">
        {INFO.map(([title, description]) => <div key={title} className="rounded-[16px] border border-hairline bg-white p-4 shadow-soft"><div className="text-sm font-medium text-ink">{title}</div><div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div></div>)}
      </div>
    </div>
  )
}
