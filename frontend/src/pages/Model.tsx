import { useState } from "react"
import { Activity, ArrowDown, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionCard, StatCard, StatusPill } from "@/components/kit"
import { request, useWorkspace } from "@/lib/sitesense"

type Health = { services: { name: string; ready: boolean }[] }

export default function ModelPage() {
  const { state, error: workspaceError } = useWorkspace()
  const [health, setHealth] = useState<Health>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()
  const [checkedAt, setCheckedAt] = useState<Date>()
  const models = state?.models
  const steps = [
    { label: "Person detection", model: models?.detector, detail: "YOLO11s detects person boxes across the recording." },
    { label: "Track association", model: models?.tracker, detail: "ByteTrack associates observed boxes into temporary IDs within this recording." },
    { label: "Person-window indexing", model: models?.embedding, detail: "Cosmos Embed1 represents each person-focused window as a 256-dimensional vector." },
    { label: "Historical retrieval", model: "Earlier eligible references", detail: "Filter by task, identity or continuous track and earlier time, then rank by cosine similarity." },
    { label: "Evidence comparison", model: models?.reasoner, detail: "Cosmos3 compares the earlier person crop, current crop and current full-scene context." },
    { label: "Optional pose overlay", model: "OpenCV Zoo · MediaPipe33", detail: "CPU inference estimates 33 two-dimensional joints from observed track crops. Low-confidence joints are hidden." },
  ]

  async function checkHealth() {
    setChecking(true)
    setError(undefined)
    try {
      setHealth(await request<Health>("/api/health"))
      setCheckedAt(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Service health could not be checked.")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Models & pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">The deployed models behind tracked video evidence, reference retrieval and visual overlays.</p>
        </div>
        <Button variant="outline" onClick={() => void checkHealth()} disabled={checking}>{checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{checking ? "Checking…" : "Check service health"}</Button>
      </div>

      {(error || workspaceError) && <p role="alert" className="text-sm text-risk">{error || workspaceError}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Embedding" value="256" unit="dimensions" sub="Cosmos Embed1 per video window" />
        <StatCard label="Pose overlay" value="33" unit="keypoints" sub="2D estimates with confidence gating" />
        <StatCard label="Track identity" value="Local" sub="IDs are scoped to one recording" />
        <StatCard label="Review basis" value="Video" sub="Earlier crop, current crop and context" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <SectionCard title="From recording to review" menu={false} className="lg:col-span-3" footer="Detector, tracker, embedding and reasoner names come from the live workspace.">
          <ol>
            {steps.map((step, index) => (
              <li key={step.label} className="relative flex gap-3 py-3">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full border border-hairline bg-subtle text-xs tabular-nums text-ink">{index + 1}</span>
                  {index < steps.length - 1 && <ArrowDown className="size-3.5 flex-1 text-muted-foreground" strokeWidth={1.5} />}
                </div>
                <div className="min-w-0 pb-1">
                  <h2 className="text-sm font-medium text-ink">{step.label}</h2>
                  <div className="mt-1 break-words text-xs text-ink">{step.model ?? "Waiting for workspace…"}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>

        <div className="space-y-5 lg:col-span-2">
          <SectionCard title="Service readiness" menu={false} action={<Activity className="size-4 text-muted-foreground" strokeWidth={1.5} />}
            footer={checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : "Check on demand before processing a recording."}>
            {health ? <ul className="divide-y divide-hairline">{health.services.map((service) => <li key={service.name} className="flex items-center gap-3 py-3 text-sm"><span className="flex-1 text-ink">{service.name}</span><StatusPill tone={service.ready ? "ok" : "risk"}>{service.ready ? "Ready" : "Unavailable"}</StatusPill></li>)}</ul>
              : <p className="py-3 text-sm leading-relaxed text-muted-foreground">Check the current YOLO and Cosmos service responses using the button above.</p>}
            {health && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Readiness describes service availability. It does not measure prediction accuracy.</p>}
          </SectionCard>

          <SectionCard title="Reading the evidence" menu={false}>
            <div className="space-y-3 pt-1 text-sm leading-relaxed text-muted-foreground">
              <p>Review suggestions describe visible changes and task context. The recording and model observations remain available for a human to assess.</p>
              <p>A baseline has no eligible earlier reference. Unknown identity and capture time prevent cross-recording comparisons.</p>
              <p>Pose is an optional video overlay. Occlusion, small people and overlapping workers can leave gaps in the estimated skeleton.</p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
