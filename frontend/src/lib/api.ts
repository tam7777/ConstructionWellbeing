export type Status = "green" | "amber" | "red"
export interface Person {
  track_id: number; bbox: number[]; kpts: number[][]; kpts3d?: number[][]
  fatigue: number; withdrawal: number; posture: string; height_m: number; near_edge: boolean; risk: number
}
export interface Frame { t: number; persons: Person[] }
export interface Worker { track_id: number; fatigue: number; withdrawal: number; height_risk: number; overall: number; status: Status; flags: string[] }
export interface Summary {
  n_workers: number; fatigue: number; withdrawal: number; height_risk: number; overall: number; status: Status
  predicted_class: string; predicted_unsafe_prob: number; headline: string
}
export interface Analysis {
  id: string; fps: number; frames: Frame[]; workers: Worker[]; summary: Summary
  timeline: { t: number[]; fatigue: number[]; withdrawal: number[]; risk: number[]; n_persons: number[] }
}
export interface Meta { id: string; source: string; label: number | null; class_name: string | null; split: string | null; fps: number; width: number; height: number; n_frames: number; duration: number }
export interface IndexItem { id: string; source: string; label: number | null; class_name: string | null; thumb: string; summary: Summary }
export interface Scene {
  points: string; n_points: number; bounds: { min: number[]; max: number[] }; ground_y: number
  edges: { polyline: number[][]; drop_m: number }[]; camera: { fov: number; position: number[] }
  hazard_zones?: { center: number[]; radius: number; drop_m: number }[]
  heightmap?: { origin: number[]; cell: number; w: number; h: number; file: string }
  intro_camera?: { position: number[]; target: number[] }
}
export interface ModelMetrics {
  model?: string; accuracy?: number; f1_macro?: number; n_train?: number; n_test?: number
  classes?: string[]; confusion_matrix?: number[][]; feature_importances?: Record<string, number> | { name: string; importance: number }[]
  [k: string]: unknown
}

let mockMode = false
const listeners = new Set<(m: boolean) => void>()
export const isMock = () => mockMode
export const onMockChange = (f: (m: boolean) => void) => { listeners.add(f); return () => { listeners.delete(f) } }
const setMock = (m: boolean) => { if (m !== mockMode) { mockMode = m; listeners.forEach((f) => f(m)) } }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(`${r.status} ${url}`)
  return r.json()
}
async function withMock<T>(real: string, mock: string): Promise<T> {
  try { const d = await getJson<T>(real); setMock(false); return d }
  catch { const d = await getJson<T>(mock); setMock(true); return d }
}

export const api = {
  videos: () => withMock<IndexItem[]>("/api/videos", "/mock/index.json"),
  video: (id: string) => withMock<{ meta: Meta; analysis: Analysis }>(`/api/videos/${id}`, `/mock/${id}/video.json`),
  scene: (id: string) => withMock<Scene>(`/api/videos/${id}/scene`, `/mock/${id}/scene.json`),
  model: () => withMock<ModelMetrics>("/api/model", "/mock/model.json"),
}

export const media = (id: string, file: string) => (mockMode ? `/mock/${id}/${file}` : `/media/${id}/${file}`)
export const thumbUrl = (it: IndexItem) => {
  if (mockMode || it.thumb?.startsWith("/")) return it.thumb || media(it.id, "thumb.jpg")
  return media(it.id, it.thumb || "thumb.jpg")
}

export async function loadPoints(url: string): Promise<Float32Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error("points " + r.status)
  return new Float32Array(await r.arrayBuffer())
}

export const STATUS_COLOR: Record<Status, string> = { green: "#22e5a5", amber: "#fbbf24", red: "#ff3b5c" }
export const riskColor = (v: number) => (v > 0.65 ? STATUS_COLOR.red : v > 0.4 ? STATUS_COLOR.amber : STATUS_COLOR.green)
export const statusOf = (v: number): Status => (v > 0.65 ? "red" : v > 0.4 ? "amber" : "green")

export const COCO_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
]

export function frameAt(frames: Frame[], t: number): Frame | undefined {
  if (!frames.length) return undefined
  let lo = 0, hi = frames.length - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= t) lo = m; else hi = m - 1 }
  return frames[lo]
}
