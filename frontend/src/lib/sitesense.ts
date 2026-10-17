import { useCallback, useEffect, useState } from 'react'

export interface Recording {
  id: string; filename: string; source?: string; demo: boolean; library_id?: string; status: string
  media_path: string; duration: number; fps: number; width: number; height: number; task: string
  captured_at?: number | null; imported_at: number; location?: string
}
export interface BoxSample { time: number; frame: number; bbox: number[]; confidence: number }
export interface Track {
  id: string; recording_id: string; track_id: number; label: string; worker_id?: string | null
  identity_confirmed: boolean; coverage: number; mean_confidence: number; start: number; end: number; task: string
  samples?: BoxSample[]
}
export interface Clip {
  id: string; recording_id: string; track_key: string; track_id: number; offset: number; duration: number
  media_path: string; context_path: string; thumbnail_path: string; task: string; demo: boolean
}
export interface Analysis {
  id: string; clip_id: string; recording_id: string; track_key: string; status: string; reviewed: boolean
  review_note?: string; summary?: string; created_at: number; reference_id?: string | null
  reference_candidates?: {clip_id: string; similarity?: number}[]
  report?: {review_priority: string; human_review_summary: string; observable_changes: string[]; task_context: string; limitations: string[]}
}
export interface Job {
  id: string; label: string; status: string; stage: string; progress: number; error?: string | null
  created_at: number; recording_id?: string; result?: {recording_id?: string; cached?: boolean}
  events?: {stage: string; detail?: string; at: number}[]
}
export interface Workspace {
  recordings: Recording[]; tracks: Track[]; clips: Clip[]; analyses: Analysis[]; jobs: Job[]; busy: boolean
  models: {detector: string; tracker: string; embedding: string; reasoner: string}
}
export interface LibraryItem {id: string; filename: string; collection: string; group: string; duration: number; relative_path: string; size: number}
export interface Footage {
  id: string; title: string; collection: string; group: string; duration: number; poster: string; video: string
  libraryId?: string; recording?: Recording; tracks: Track[]; analyses: Analysis[]; reviewCount: number
  status: 'review' | 'ready' | 'unanalysed' | 'processing' | 'failed'
}
export interface Tracking {recording_id: string; width: number; height: number; fps: number; duration: number; tracks: Track[]}
export interface PoseSample {time: number; keypoints: number[][]; confidence: number}
export interface Visuals {recording_id: string; status: string; fps?: number; joint_threshold?: number; tracks?: {id: string; samples: PoseSample[]}[]}

export async function request<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`)
  }
  return response.json()
}
export function media(path?: string) { return path ? '/media/' + path.split('/').map(encodeURIComponent).join('/') : '' }
export function pending(a: Analysis) { return a.status === 'complete' && !a.reviewed && a.report?.review_priority === 'review' }
export function trackReviews(state: Workspace, trackKey: string) { return state.analyses.filter(a => a.track_key === trackKey) }
export function windowLabel(c: Clip) { return `${c.offset.toFixed(1)}–${(c.offset + c.duration).toFixed(1)}s` }
export function buildItems(state: Workspace, library: LibraryItem[]): Footage[] {
  function item(r: Recording | undefined, source?: LibraryItem): Footage {
    const tracks = r ? state.tracks.filter(t => t.recording_id === r.id) : []
    const analyses = r ? state.analyses.filter(a => a.recording_id === r.id) : []
    const reviewCount = analyses.filter(pending).length
    const clip = r ? state.clips.find(c => c.recording_id === r.id) : undefined
    return {
      id: source?.id ?? r!.id, title: source?.filename ?? (r?.demo ? 'Warehouse simulation' : r!.filename),
      collection: source?.collection ?? (r?.demo ? 'Demo' : 'Uploads'), group: source?.group ?? r?.task ?? '',
      duration: r?.duration ?? source!.duration, libraryId: source?.id, recording: r, tracks, analyses, reviewCount,
      poster: source ? `/api/library/${source.id}/thumbnail` : media(clip?.thumbnail_path),
      video: r?.media_path ? media(r.media_path) : source ? `/api/library/${source.id}/video` : '',
      status: !r ? 'unanalysed' : r.status === 'failed' ? 'failed' : !['ready','no_usable_tracks'].includes(r.status) ? 'processing' : reviewCount ? 'review' : 'ready',
    }
  }
  return [
    ...library.map(l => item(state.recordings.filter(r => r.library_id === l.id).sort((a,b) => b.imported_at - a.imported_at)[0], l)),
    ...state.recordings.filter(r => !r.library_id).map(r => item(r)),
  ]
}

export function useWorkspace() {
  const [state, setState] = useState<Workspace | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const [s,l] = await Promise.all([request<Workspace>('/api/state'), request<{videos: LibraryItem[]}>('/api/library')])
      setState(s); setLibrary(l.videos); setError('')
    } catch(e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void refresh(); const id = window.setInterval(refresh, 2500); return () => clearInterval(id) }, [refresh])
  return { state, library, error, refresh }
}

// A missing detection or a gap in pose sampling must not create a phantom skeleton.
export function sampleAt<T extends {time: number}>(samples: T[] | undefined, t: number, tolerance: number): T | undefined {
  if (!samples?.length) return undefined
  let lo = 0, hi = samples.length - 1
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (samples[m].time <= t) lo = m; else hi = m - 1 }
  const candidate = samples[lo]
  return candidate.time <= t + 0.001 && t - candidate.time <= tolerance ? candidate : undefined
}
export const POSE_EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]]
export function joint(point: number[] | undefined, threshold = .55): point is number[] {
  return !!point && point.length >= 3 && point.every(Number.isFinite) && point[2] >= threshold
}
