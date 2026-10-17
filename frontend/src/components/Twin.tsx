import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Html, Line, OrbitControls } from "@react-three/drei"
import { Pause, Play, RotateCw, AlertTriangle, Eye, Mountain, Users, Scan, Sparkles, Crosshair, Map as MapIcon, X } from "lucide-react"
import { COCO_EDGES, frameAt, loadPoints, media, riskColor, STATUS_COLOR, type Frame, type Person, type Scene, type Worker } from "@/lib/api"
import { Glass, MiniBar, StatusBadge } from "@/components/common"
import { HalftoneAccent } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

interface Props {
  id: string; scene: Scene | null | undefined; frames: Frame[]; t: number; duration: number
  playing: boolean; setPlaying: (p: boolean) => void; seek: (t: number) => void; workers?: Worker[]
}
type V3 = [number, number, number]
type Layers = { points: boolean; terrain: boolean; hazards: boolean; workers: boolean; scan: boolean }
type Goal = { pos: THREE.Vector3; target: THREE.Vector3; dur: number }
interface Ctl { target: THREE.Vector3; autoRotate: boolean; update(): void; addEventListener(e: string, f: () => void): void; removeEventListener(e: string, f: () => void): void }

const MAX_POINTS = 300_000
const KCONF = 0.35

/* ---------------- colour helpers ---------------- */
const TURBO_GLSL = /* glsl */ `
vec3 turbo(float t){ t=clamp(t,0.,1.);
  return vec3(
    0.13572138+t*(4.61539260+t*(-42.66032258+t*(132.13108234+t*(-152.94239396+t*59.28637943)))),
    0.09140261+t*(2.19418839+t*(4.84296658+t*(-14.18503333+t*(4.27729857+t*2.82956604)))),
    0.10667330+t*(12.64194608+t*(-60.58204836+t*(110.36276771+t*(-89.90310912+t*27.34824973))))); }`
function turbo(t: number): string {
  t = Math.min(1, Math.max(0, t))
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  return `rgb(${c(r)},${c(g)},${c(b)})`
}
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

/* ---------------- sky ---------------- */
function Sky({ radius }: { radius: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vW; void main(){ float h = vW.y;
      vec3 top = vec3(0.93,0.94,0.95), mid = vec3(0.955,0.955,0.95), hor = vec3(0.975,0.972,0.965);
      vec3 c = mix(hor, mid, smoothstep(-0.05,0.25,h)); c = mix(c, top, smoothstep(0.25,0.9,h));
      c = mix(c, vec3(0.94,0.94,0.935), smoothstep(0.0,-0.4,h));
      gl_FragColor = vec4(c,1.); }`,
  }), [])
  return <mesh material={mat} renderOrder={-10}><sphereGeometry args={[radius * 8, 32, 16]} /></mesh>
}

/* ---------------- point cloud ---------------- */
function PointCloud({ data, size, scan, bounds, fogNear, fogFar, visible }: {
  data: Float32Array; size: number; scan: boolean; bounds: { min: number[]; max: number[] }; fogNear: number; fogFar: number; visible: boolean
}) {
  const geom = useMemo(() => {
    const total = Math.floor(data.length / 6)
    const stride = Math.max(1, Math.ceil(total / MAX_POINTS))
    const n = Math.floor(total / stride)
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), rnd = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const i = k * stride * 6
      pos[k * 3] = data[i]; pos[k * 3 + 1] = data[i + 1]; pos[k * 3 + 2] = data[i + 2]
      col[k * 3] = data[i + 3]; col[k * 3 + 1] = data[i + 4]; col[k * 3 + 2] = data[i + 5]
      rnd[k] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    g.setAttribute("color", new THREE.BufferAttribute(col, 3))
    g.setAttribute("rnd", new THREE.BufferAttribute(rnd, 1))
    g.computeBoundingSphere()
    return g
  }, [data])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    uniforms: {
      uSize: { value: size }, uTime: { value: 0 }, uScan: { value: 0 }, uBorn: { value: 0 },
      uMinY: { value: bounds.min[1] }, uMaxY: { value: bounds.max[1] },
      uFogNear: { value: fogNear }, uFogFar: { value: fogFar }, uFog: { value: new THREE.Color("#f3f3f2") },
      uScale: { value: 400 },
    },
    vertexShader: /* glsl */ `
      uniform float uSize, uTime, uScan, uBorn, uMinY, uMaxY, uScale;
      attribute float rnd;
      varying vec3 vCol; varying float vDepth, vBand, vAlpha;
      void main(){
        vec4 wp = modelMatrix*vec4(position,1.);
        float span = max(uMaxY-uMinY, 0.1);
        float scanY = uMinY - 1.0 + mod(uTime*span*0.18, span+2.0);
        float d = (wp.y - scanY) / (span*0.025+0.08);
        vBand = uScan * exp(-d*d);
        // build-in reveal: points appear bottom to top
        float reveal = smoothstep(rnd*0.3, rnd*0.3+0.2, uBorn*1.5 - (wp.y-uMinY)/span*0.5);
        vAlpha = reveal;
        vec4 mv = viewMatrix*wp;
        vDepth = -mv.z;
        vCol = color;
        gl_PointSize = uSize * uScale / max(vDepth, 0.1) * (1.0 + vBand*1.2) * (0.7 + 0.3*reveal);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFogNear, uFogFar; uniform vec3 uFog;
      varying vec3 vCol; varying float vDepth, vBand, vAlpha;
      void main(){
        vec2 c = gl_PointCoord*2.-1.; float r2 = dot(c,c);
        if(r2>1.) discard;
        float soft = 1.0 - smoothstep(0.75, 1.0, r2);
        vec3 col = vCol;
        col = mix(col, vec3(0.10,0.71,0.91), vBand*0.6);
        float f = smoothstep(uFogNear, uFogFar, vDepth);
        col = mix(col, uFog, f*0.7);
        gl_FragColor = vec4(col, soft*vAlpha*(1.-f*0.6));
      }`,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  useEffect(() => { mat.uniforms.uMinY.value = bounds.min[1]; mat.uniforms.uMaxY.value = bounds.max[1] }, [bounds, mat])
  useEffect(() => { mat.uniforms.uFogNear.value = fogNear; mat.uniforms.uFogFar.value = fogFar }, [fogNear, fogFar, mat])
  useFrame(({ clock, size: sz }, dt) => {
    const u = mat.uniforms
    u.uTime.value = clock.elapsedTime
    u.uBorn.value = Math.min(2, u.uBorn.value + dt * 0.5)
    u.uSize.value = size
    u.uScale.value = sz.height * 0.9
    u.uScan.value += ((scan ? 1 : 0) - u.uScan.value) * Math.min(1, dt * 4)
  })
  return <points geometry={geom} material={mat} visible={visible} frustumCulled={false} />
}

/* ---------------- terrain from heightmap ---------------- */
function Terrain({ hm, data, visible }: { hm: NonNullable<Scene["heightmap"]>; data: Float32Array; visible: boolean }) {
  const { geom, lo, hi } = useMemo(() => {
    const step = Math.max(1, Math.ceil(Math.max(hm.w, hm.h) / 320))
    const W = Math.floor((hm.w - 1) / step) + 1, H = Math.floor((hm.h - 1) / step) + 1
    const pos = new Float32Array(W * H * 3)
    const valid = new Uint8Array(W * H)
    let lo = Infinity, hi = -Infinity
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const v = data[r * step * hm.w + c * step]
      const k = r * W + c
      const ok = Number.isFinite(v)
      valid[k] = ok ? 1 : 0
      pos[k * 3] = hm.origin[0] + c * step * hm.cell
      pos[k * 3 + 1] = ok ? v : 0
      pos[k * 3 + 2] = hm.origin[1] + r * step * hm.cell
      if (ok) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    }
    const idx: number[] = []
    for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1
      if (valid[a] && valid[b] && valid[d]) idx.push(a, d, b)
      if (valid[b] && valid[d] && valid[e]) idx.push(b, d, e)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    return { geom: g, lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 1 }
  }, [hm, data])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uLo: { value: lo }, uHi: { value: hi }, uTime: { value: 0 }, uOp: { value: 0 } },
    vertexShader: `varying float vH; varying vec3 vP; void main(){ vH = position.y; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${TURBO_GLSL}
      uniform float uLo, uHi, uTime, uOp; varying float vH; varying vec3 vP;
      void main(){
        float t = (vH-uLo)/max(uHi-uLo,0.01);
        vec3 col = turbo(t);
        float s = vH/0.5; float w = fwidth(s);
        float line = 1. - smoothstep(0., w*1.5, abs(fract(s-0.5)-0.5));
        float s2 = vH/2.5; float w2 = fwidth(s2);
        float major = 1. - smoothstep(0., w2*2., abs(fract(s2-0.5)-0.5));
        vec2 g = abs(fract(vP.xz)-0.5); float grid = 1. - smoothstep(0.0, 0.03, min(g.x,g.y));
        vec3 c = mix(vec3(0.97), col*0.85, 0.35 + line*0.4 + major*0.5) - vec3(0.2)*grid*0.1;
        gl_FragColor = vec4(c, uOp*(0.18 + line*0.25 + major*0.35));
      }`,
  }), [lo, hi])
  useFrame((_, dt) => { mat.uniforms.uOp.value += ((visible ? 1 : 0) - mat.uniforms.uOp.value) * Math.min(1, dt * 3) })
  return <mesh geometry={geom} material={mat} visible={mat.uniforms.uOp.value > 0.01 || visible} renderOrder={1} />
}

/* ---------------- hazards ---------------- */
function orderPolyline(pl: number[][]): THREE.Vector3[] {
  const pts = pl.filter((p) => p.every(Number.isFinite)).map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  if (pts.length < 2) return pts
  // order along principal horizontal axis (polylines come unsorted)
  let mx = new THREE.Vector3(), best = -1
  for (const a of pts) for (const b of pts) { const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2; if (d > best) { best = d; mx = b.clone().sub(a) } }
  mx.y = 0; mx.normalize()
  return pts.sort((a, b) => a.dot(mx) - b.dot(mx))
}

const wallShader = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uLen, uOp; uniform vec3 uCol; varying vec2 vUv;
    void main(){
      float top = smoothstep(0.94, 1.0, vUv.y);
      float fade = pow(vUv.y, 1.2);
      float a = 0.06 + 0.16*fade + top*0.5;
      gl_FragColor = vec4(uCol, a*uOp);
    }`,
}

const DangerEdge = memo(function DangerEdge({ polyline, drop, show, label }: { polyline: number[][]; drop: number; show: boolean; label: boolean }) {
  const pts = useMemo(() => orderPolyline(polyline), [polyline])
  const { geom, len } = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    let acc = 0
    const L = pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0) || 1
    pts.forEach((p, i) => {
      if (i) acc += p.distanceTo(pts[i - 1])
      pos.push(p.x, p.y - drop, p.z, p.x, p.y + 0.25, p.z)
      uv.push(acc / L, 0, acc / L, 1)
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    return { geom: g, len: L }
  }, [pts, drop])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    ...wallShader, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uLen: { value: len }, uOp: { value: 1 }, uCol: { value: new THREE.Color("#E5484D") } },
  }), [len])
  useFrame(({ clock }) => { mat.uniforms.uTime.value = clock.elapsedTime; mat.uniforms.uOp.value = 0.9 + 0.1 * Math.sin(clock.elapsedTime * 2) })
  const mid = pts[Math.floor(pts.length / 2)]
  if (!mid) return null
  return (
    <group visible={show}>
      {pts.length > 1 && <Line points={pts} color="#E5484D" lineWidth={2.5} toneMapped={false} />}
      {pts.length > 1 && <mesh geometry={geom} material={mat} />}
      {pts.length > 1 && <Line points={[[mid.x, mid.y, mid.z], [mid.x, mid.y - drop, mid.z]]} color="#E5484D" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} toneMapped={false} />}
      {label && (
        <Html position={[mid.x, mid.y + 0.9, mid.z]} center zIndexRange={[20, 0]} style={{ display: show ? "block" : "none" }}>
          <div className="pointer-events-none flex select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink shadow-soft">
            <span className="size-1.5 rounded-full bg-risk" />Drop <span className="tnum">{drop.toFixed(1)} m</span>
          </div>
        </Html>
      )}
    </group>
  )
})

function HazardZone({ center, radius, drop, show, groundY }: { center: number[]; radius: number; drop: number; show: boolean; groundY: number }) {
  const r1 = useRef<THREE.Mesh>(null), r2 = useRef<THREE.Mesh>(null), disc = useRef<THREE.MeshBasicMaterial>(null)
  const y = Number.isFinite(center[1]) ? center[1] : groundY
  useFrame(({ clock }) => {
    const e = clock.elapsedTime
    for (const [m, off] of [[r1.current, 0], [r2.current, 0.5]] as const) {
      if (!m) continue
      const s = (e * 0.6 + off) % 1
      m.scale.setScalar(0.4 + s * 0.8)
      ;(m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - s)
    }
    if (disc.current) disc.current.opacity = 0.1 + 0.07 * Math.sin(e * 4)
  })
  return (
    <group position={[center[0], y + 0.05, center[2]]} visible={show}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[radius, 48]} /><meshBasicMaterial ref={disc} color="#E5484D" transparent opacity={0.12} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[radius * 0.96, radius, 64]} /><meshBasicMaterial color="#E5484D" transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      <mesh ref={r1} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[radius * 0.9, radius, 64]} /><meshBasicMaterial color="#E5484D" transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      <mesh ref={r2} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[radius * 0.9, radius, 64]} /><meshBasicMaterial color="#E5484D" transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
    </group>
  )
}

/* ---------------- workers ---------------- */
const BONE_GEOM = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)
const JOINT_GEOM = new THREE.SphereGeometry(1, 14, 10)
const UP = new THREE.Vector3(0, 1, 0)

/** valid 3D joints: 2D conf ok and not the (0,0) garbage projection */
function joints(p: Person): (THREE.Vector3 | null)[] {
  const k3 = p.kpts3d ?? []
  return k3.map((q, i) => {
    const k = p.kpts[i]
    if (!q || !k || k[2] < KCONF || (k[0] < 1 && k[1] < 1) || !q.every(Number.isFinite)) return null
    return new THREE.Vector3(q[0], q[1], q[2])
  })
}

/** person at time t, interpolated between analysis frames */
function lerpPersons(frames: Frame[], t: number): Person[] {
  const f0 = frameAt(frames, t)
  if (!f0) return []
  const i0 = frames.indexOf(f0)
  const f1 = frames[i0 + 1]
  if (!f1 || f1.t <= f0.t) return f0.persons
  const a = Math.min(1, Math.max(0, (t - f0.t) / (f1.t - f0.t)))
  return f0.persons.map((p) => {
    const q = f1.persons.find((x) => x.track_id === p.track_id)
    if (!q?.kpts3d || !p.kpts3d) return p
    return { ...p, kpts3d: p.kpts3d.map((v, j) => { const w = q.kpts3d![j]; return w ? v.map((c, d) => c + (w[d] - c) * a) : v }) }
  })
}

function personAnchor(p: Person) {
  const J = joints(p)
  const valid = J.filter(Boolean) as THREE.Vector3[]
  if (!valid.length) return null
  const hips = [J[11], J[12]].filter(Boolean) as THREE.Vector3[]
  const feet = [J[15], J[16]].filter(Boolean) as THREE.Vector3[]
  const center = (hips.length ? hips : valid).reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / (hips.length || valid.length))
  const feetY = feet.length ? Math.min(...feet.map((v) => v.y)) : Math.min(...valid.map((v) => v.y))
  const headY = Math.max(...valid.map((v) => v.y))
  const head = J[0] ?? valid.reduce((a, b) => (b.y > a.y ? b : a))
  return { J, center, feetY, headY, head }
}

function WorkerRig({ p, color, worker, selected, show, trail, onSelect }: {
  p: Person | null; color: string; worker?: Worker; selected: boolean; show: boolean; trail: THREE.Vector3[]; onSelect: () => void
}) {
  const halo = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (halo.current) { const k = 1 + 0.12 * Math.sin(clock.elapsedTime * 5); halo.current.scale.set(k, k, k) }
  })
  const A = p ? personAnchor(p) : null
  const vis = show && !!A
  const bones = useMemo(() => {
    if (!A) return []
    return COCO_EDGES.flatMap(([i, j]) => {
      const a = A.J[i], b = A.J[j]
      if (!a || !b) return []
      const len = a.distanceTo(b)
      if (len < 0.02 || len > 1.6) return []
      const dir = b.clone().sub(a).normalize()
      return [{ mid: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(UP, dir), len, key: `${i}-${j}` }]
    })
  }, [A])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 }), [color])
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }), [])
  useEffect(() => () => { mat.dispose() }, [mat])

  const base = A ? (p!.height_m > 0.3 ? A.feetY - p!.height_m : A.feetY) : 0
  const fat = worker?.fatigue ?? p?.fatigue ?? 0
  const sel = selected ? 1.6 : 1
  return (
    <group visible={vis}>
      {A && (
        <group onClick={(e) => { e.stopPropagation(); onSelect() }} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
          {bones.map((b) => (
            <group key={b.key} position={b.mid} quaternion={b.q}>
              <mesh geometry={BONE_GEOM} material={mat} scale={[0.05 * sel, b.len, 0.05 * sel]} />
            </group>
          ))}
          {A.J.map((v, i) => v && <mesh key={i} geometry={JOINT_GEOM} material={i === 0 ? mat : white} position={v} scale={i === 0 ? 0.12 : 0.05} />)}
          {/* invisible fat hit volume for easy clicking */}
          <mesh position={[A.center.x, (A.feetY + A.headY) / 2, A.center.z]}>
            <cylinderGeometry args={[0.45, 0.45, Math.max(0.5, A.headY - A.feetY + 0.3), 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      )}
      {A && (
        <>
          <mesh ref={halo} position={[A.center.x, A.feetY + 0.02, A.center.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.42, 0.55, 48]} />
            <meshBasicMaterial color={color} transparent opacity={selected ? 1 : 0.75} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {selected && (
            <mesh position={[A.center.x, A.feetY + 0.02, A.center.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.75, 0.8, 64]} />
              <meshBasicMaterial color="#1F1F1F" transparent opacity={0.8} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          )}
          {p!.height_m > 0.3 && (
            <>
              <Line points={[[A.center.x, A.feetY, A.center.z], [A.center.x, base, A.center.z]]} color={color} lineWidth={1.5} dashed dashSize={0.18} gapSize={0.12} toneMapped={false} />
              <mesh position={[A.center.x, base + 0.02, A.center.z]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.15, 0.22, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} side={THREE.DoubleSide} />
              </mesh>
            </>
          )}
        </>
      )}
      {trail.length > 1 && show && (
        <Line points={trail} vertexColors={trail.map((_, i) => { const k = i / (trail.length - 1); const c = new THREE.Color("#f3f3f2").lerp(new THREE.Color(color), k); return [c.r, c.g, c.b] as V3 })} lineWidth={2.5} transparent opacity={0.9} toneMapped={false} />
      )}
      <Html position={A ? [A.center.x, A.headY + 0.55, A.center.z] : [0, -9999, 0]} center zIndexRange={[30, 0]} style={{ display: vis ? "block" : "none" }}>
        <button onClick={onSelect}
          className={cn("select-none whitespace-nowrap rounded-xl border bg-white px-2.5 py-1.5 text-left text-xs leading-tight text-ink shadow-soft transition hover:-translate-y-0.5", selected ? "border-ink" : "border-hairline")}>
          <div className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: color }} />Worker #{p?.track_id}<span className="font-normal capitalize text-muted-foreground">{worker?.status ?? `${Math.round((p?.risk ?? 0) * 100)}%`}{p?.near_edge ? " · edge" : ""}</span></div>
          <div className="tnum mt-0.5 text-[10px] text-muted-foreground">Fatigue {Math.round(fat * 100)}% · {(p?.height_m ?? 0).toFixed(1)} m up</div>
        </button>
      </Html>
    </group>
  )
}

/* ---------------- scanner ring on ground ---------------- */
function Scanner({ center, radius, show }: { center: V3; radius: number; show: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const s = (clock.elapsedTime * 0.25) % 1
    ref.current.scale.setScalar(0.01 + s * radius)
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - s)
  })
  return (
    <mesh ref={ref} position={center} rotation={[-Math.PI / 2, 0, 0]} visible={show}>
      <ringGeometry args={[0.985, 1, 128]} />
      <meshBasicMaterial color="#19B6E8" transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function GroundGrid({ center, size }: { center: V3; size: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uR: { value: size / 2 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uR; varying vec2 vP;
      float ln(vec2 p, float s){ vec2 g = abs(fract(p/s-0.5)-0.5)/fwidth(p/s); return 1.-min(min(g.x,g.y),1.); }
      void main(){ float f = 1.-smoothstep(uR*0.3, uR, length(vP));
        float a = ln(vP,1.)*0.10 + ln(vP,5.)*0.22;
        gl_FragColor = vec4(vec3(0.45,0.45,0.43), a*f); }`,
  }), [size])
  return <mesh position={center} rotation={[-Math.PI / 2, 0, 0]} material={mat}><planeGeometry args={[size, size]} /></mesh>
}

/* ---------------- camera rig ---------------- */
function Rig({ goal, orbit, onInteract, follow }: { goal: Goal | null; orbit: boolean; onInteract: () => void; follow: React.RefObject<THREE.Vector3 | null> }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Ctl | null
  const anim = useRef<{ fp: THREE.Vector3; ft: THREE.Vector3; to: Goal; t0: number } | null>(null)
  useEffect(() => {
    if (!goal || !controls) return
    anim.current = { fp: camera.position.clone(), ft: controls.target.clone(), to: goal, t0: performance.now() }
  }, [goal, controls, camera])
  useEffect(() => {
    if (!controls) return
    const f = () => { anim.current = null; onInteract() }
    controls.addEventListener("start", f)
    return () => controls.removeEventListener("start", f)
  }, [controls, onInteract])
  useFrame(() => {
    if (!controls) return
    const a = anim.current
    controls.autoRotate = orbit && !a
    if (a) {
      const k = ease(Math.min(1, (performance.now() - a.t0) / (a.to.dur * 1000)))
      camera.position.lerpVectors(a.fp, a.to.pos, k)
      controls.target.lerpVectors(a.ft, a.to.target, k)
      if (k >= 1) anim.current = null
    } else if (follow.current) {
      // gently keep a focused worker centred
      const d = follow.current.clone().sub(controls.target).multiplyScalar(0.05)
      controls.target.add(d); camera.position.add(d)
    }
    controls.update()
  })
  return null
}

/* ---------------- mini-map ---------------- */
function MiniMap({ pts, scene, hmData, persons, colorOf, selected, onPick }: {
  pts: Float32Array | null; scene: Scene; hmData: Float32Array | null; persons: Person[]; colorOf: (p: Person) => string; selected: number | null; onPick: (id: number) => void
}) {
  const S = 180
  const bg = useRef<HTMLCanvasElement | null>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  const [mnx, mnz] = [scene.bounds.min[0], scene.bounds.min[2]]
  const span = Math.max(scene.bounds.max[0] - mnx, scene.bounds.max[2] - mnz, 1)
  const pad = 8
  const proj = useCallback((x: number, z: number) => [pad + ((x - mnx) / span) * (S - 2 * pad), pad + ((z - mnz) / span) * (S - 2 * pad)] as const, [mnx, mnz, span])
  useEffect(() => {
    const c = document.createElement("canvas"); c.width = S; c.height = S
    const g = c.getContext("2d")!
    g.fillStyle = "#F7F7F6"; g.fillRect(0, 0, S, S)
    const hm = scene.heightmap
    if (hm && hmData) {
      let lo = Infinity, hi = -Infinity
      for (const v of hmData) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
      const step = Math.max(1, Math.floor(Math.max(hm.w, hm.h) / 200))
      for (let r = 0; r < hm.h; r += step) for (let q = 0; q < hm.w; q += step) {
        const v = hmData[r * hm.w + q]
        if (!Number.isFinite(v)) continue
        const [u, w] = proj(hm.origin[0] + q * hm.cell, hm.origin[1] + r * hm.cell)
        g.fillStyle = turbo((v - lo) / Math.max(hi - lo, 0.01))
        g.globalAlpha = 0.45
        const cs = Math.max(1.2, (hm.cell * step / span) * (S - 2 * pad))
        g.fillRect(u, w, cs, cs)
      }
      g.globalAlpha = 1
    } else if (pts) {
      const n = pts.length / 6, st = Math.max(1, Math.floor(n / 25000))
      g.globalAlpha = 0.6
      for (let i = 0; i < n; i += st) {
        const [u, w] = proj(pts[i * 6], pts[i * 6 + 2])
        g.fillStyle = `rgb(${pts[i * 6 + 3] * 255 | 0},${pts[i * 6 + 4] * 255 | 0},${pts[i * 6 + 5] * 255 | 0})`
        g.fillRect(u, w, 1.2, 1.2)
      }
      g.globalAlpha = 1
    }
    g.strokeStyle = "rgba(0,0,0,.06)"
    for (let i = 0; i <= 6; i++) { const v = pad + (i / 6) * (S - 2 * pad); g.beginPath(); g.moveTo(v, pad); g.lineTo(v, S - pad); g.moveTo(pad, v); g.lineTo(S - pad, v); g.stroke() }
    bg.current = c
  }, [pts, hmData, scene, proj])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext("2d")!
    g.clearRect(0, 0, S, S)
    if (bg.current) g.drawImage(bg.current, 0, 0)
    const now = performance.now() / 1000
    g.lineWidth = 2
    for (const e of scene.edges) {
      const o = orderPolyline(e.polyline)
      g.strokeStyle = "#E5484D"; g.shadowBlur = 0
      g.beginPath(); o.forEach((v, i) => { const [u, w] = proj(v.x, v.z); if (i) g.lineTo(u, w); else g.moveTo(u, w) }); g.stroke()
    }
    for (const z of scene.hazard_zones ?? []) {
      const [u, w] = proj(z.center[0], z.center[2])
      const r = (z.radius / span) * (S - 2 * pad)
      g.strokeStyle = `rgba(255,36,72,${0.5 + 0.5 * Math.sin(now * 4)})`
      g.beginPath(); g.arc(u, w, Math.max(3, r), 0, 7); g.stroke()
    }
    g.shadowBlur = 0
    // camera
    const [cu, cw] = proj(0, 0)
    g.fillStyle = "#1F1F1F"; g.beginPath(); g.moveTo(cu, cw - 6); g.lineTo(cu - 4, cw + 3); g.lineTo(cu + 4, cw + 3); g.fill()
    for (const p of persons) {
      const A = personAnchor(p)
      if (!A) continue
      const [u, w] = proj(A.center.x, A.center.z)
      const c = colorOf(p)
      g.fillStyle = c; g.shadowBlur = 0
      g.beginPath(); g.arc(u, w, p.track_id === selected ? 5 : 3.5, 0, 7); g.fill()
      if (p.track_id === selected) { g.strokeStyle = "#1F1F1F"; g.lineWidth = 1.5; g.beginPath(); g.arc(u, w, 8, 0, 7); g.stroke() }
    }
    g.shadowBlur = 0
  })
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * S, y = ((e.clientY - r.top) / r.height) * S
    let best: number | null = null, bd = 144
    for (const p of persons) { const A = personAnchor(p); if (!A) continue; const [u, w] = proj(A.center.x, A.center.z); const d = (u - x) ** 2 + (w - y) ** 2; if (d < bd) { bd = d; best = p.track_id } }
    if (best !== null) onPick(best)
  }
  return <canvas ref={ref} width={S} height={S} onClick={click} className="block size-[180px] cursor-crosshair rounded-lg" />
}

/* ---------------- main ---------------- */
const PRESETS = ["Overview", "Top-down", "Worker POV", "Edge close-up"] as const

export default function Twin({ id, scene, frames, t, duration, playing, setPlaying, seek, workers = [] }: Props) {
  const [pts, setPts] = useState<Float32Array | null>(null)
  const [hmData, setHm] = useState<Float32Array | null>(null)
  const [loadErr, setLoadErr] = useState<string>()
  const [orbit, setOrbit] = useState(true)
  const [ptSize, setPtSize] = useState(0.045)
  const [layers, setLayers] = useState<Layers>({ points: true, terrain: false, hazards: true, workers: true, scan: true })
  const [selected, setSelected] = useState<number | null>(null)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [preset, setPreset] = useState<string>("Overview")
  const follow = useRef<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!scene) return
    setPts(null); setHm(null)
    loadPoints(media(id, scene.points || "scene_points.bin")).then(setPts).catch((e) => setLoadErr(String(e)))
    if (scene.heightmap?.file) loadPoints(media(id, scene.heightmap.file)).then((d) => { if (d.length >= scene.heightmap!.w * scene.heightmap!.h) setHm(d) }).catch(() => {})
  }, [id, scene])

  const groundY = scene?.ground_y ?? 0
  const geo = useMemo(() => {
    if (!scene) return null
    const mn = new THREE.Vector3(...(scene.bounds.min as V3)), mx = new THREE.Vector3(...(scene.bounds.max as V3))
    const center = mn.clone().add(mx).multiplyScalar(0.5)
    const radius = Math.max(4, mn.distanceTo(mx) / 2)
    const ic = scene.intro_camera
    const okv = (v?: number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
    const introTarget = ic && okv(ic.target) ? new THREE.Vector3(...(ic.target as V3)) : new THREE.Vector3(center.x, groundY + (mx.y - groundY) * 0.25, center.z)
    const introPos = ic && okv(ic.position) ? new THREE.Vector3(...(ic.position as V3)) : new THREE.Vector3(center.x + radius * 0.55, center.y + radius * 0.55, mx.z + radius * 0.35)
    const start = introTarget.clone().add(new THREE.Vector3(radius * 0.3, radius * 3.2, radius * 0.9))
    return { center, radius, introPos, introTarget, start }
  }, [scene, groundY])

  // intro fly-in
  useEffect(() => { if (geo) setGoal({ pos: geo.introPos.clone(), target: geo.introTarget.clone(), dur: 3.2 }) }, [geo])

  const persons = useMemo(() => lerpPersons(frames, t).filter((p) => p.kpts3d?.length), [frames, t])
  const frame = frameAt(frames, t)
  const trackIds = useMemo(() => [...new Set(frames.flatMap((f) => f.persons.filter((p) => p.kpts3d?.length).map((p) => p.track_id)))], [frames])
  const anchors = useMemo(() => {
    // per track: list of (t, hip-centre on ground) for trails
    const m = new Map<number, { t: number; v: THREE.Vector3 }[]>()
    for (const f of frames) for (const p of f.persons) {
      const A = personAnchor(p); if (!A) continue
      if (!m.has(p.track_id)) m.set(p.track_id, [])
      m.get(p.track_id)!.push({ t: f.t, v: new THREE.Vector3(A.center.x, A.feetY + 0.06, A.center.z) })
    }
    return m
  }, [frames])
  const wmap = useMemo(() => new Map(workers.map((w) => [w.track_id, w])), [workers])
  const colorOf = useCallback((p: Person) => { const w = wmap.get(p.track_id); return w ? STATUS_COLOR[w.status] : riskColor(p.risk) }, [wmap])

  const edgeList = useMemo(() => (scene?.edges ?? []).filter((e) => e.polyline?.length).map((e, i) => ({ ...e, i })), [scene])
  const labelled = useMemo(() => new Set([...edgeList].sort((a, b) => b.drop_m - a.drop_m).slice(0, 5).map((e) => e.i)), [edgeList])
  const maxDrop = Math.max(0, ...edgeList.map((e) => e.drop_m), ...(scene?.hazard_zones ?? []).map((z) => z.drop_m))
  const atRisk = frame?.persons.filter((p) => p.near_edge || p.height_m > 2).length ?? 0

  const selPerson = persons.find((p) => p.track_id === selected) ?? null
  const selAnchor = selPerson ? personAnchor(selPerson) : null
  useEffect(() => { follow.current = selAnchor ? selAnchor.center.clone() : null })

  const focusWorker = useCallback((tid: number) => {
    setSelected(tid)
    const p = lerpPersons(frames, t).find((q) => q.track_id === tid)
    const A = p ? personAnchor(p) : null
    if (!A) return
    const tgt = A.center.clone()
    const dirToCam = new THREE.Vector3(-tgt.x, 0, -tgt.z).normalize()
    const pos = tgt.clone().add(dirToCam.multiplyScalar(5)).add(new THREE.Vector3(1.5, 2.5, 0))
    setOrbit(false); setPreset("")
    setGoal({ pos, target: tgt, dur: 1.4 })
  }, [frames, t])

  const applyPreset = (name: string) => {
    if (!geo || !scene) return
    setPreset(name)
    const { center, radius } = geo
    if (name !== "Worker POV") setSelected(null)
    if (name === "Overview") setGoal({ pos: geo.introPos.clone(), target: geo.introTarget.clone(), dur: 1.8 })
    if (name === "Top-down") setGoal({ pos: new THREE.Vector3(center.x, groundY + radius * 2.4, center.z + 0.01), target: new THREE.Vector3(center.x, groundY, center.z), dur: 1.8 })
    if (name === "Worker POV") {
      const p = persons.find((q) => q.track_id === selected) ?? persons[0]
      const A = p ? personAnchor(p) : null
      if (!A) return
      setSelected(p!.track_id)
      const eye = new THREE.Vector3(A.center.x, A.headY + 0.15, A.center.z)
      const look = new THREE.Vector3(center.x, A.headY, center.z)
      const back = eye.clone().sub(look).setY(0).normalize().multiplyScalar(0.6)
      setOrbit(false)
      setGoal({ pos: eye.add(back), target: look, dur: 1.8 })
    }
    if (name === "Edge close-up") {
      const e = [...edgeList].sort((a, b) => b.drop_m - a.drop_m)[0]
      const z = scene.hazard_zones?.[0]
      let tgt: THREE.Vector3 | null = null
      if (e) { const o = orderPolyline(e.polyline); tgt = o[Math.floor(o.length / 2)] ?? null }
      else if (z) tgt = new THREE.Vector3(z.center[0], z.center[1], z.center[2])
      if (!tgt) return
      const toCam = new THREE.Vector3(-tgt.x, 0, -tgt.z).normalize()
      setOrbit(false)
      setGoal({ pos: tgt.clone().add(toCam.multiplyScalar(4)).add(new THREE.Vector3(2, 2.2, 0)), target: tgt.clone().add(new THREE.Vector3(0, -1, 0)), dur: 1.8 })
    }
  }
  const onInteract = useCallback(() => { setOrbit(false); setPreset("") }, [])

  if (scene === undefined) return <div className="animate-pulse text-muted-foreground">Loading 3D scene…</div>
  if (scene === null || !geo) return <Glass className="p-8 text-center text-muted-foreground">No 3D reconstruction for this clip yet.</Glass>
  const { center, radius, start } = geo
  const selWorker = selected !== null ? wmap.get(selected) : undefined
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }))
  const LAYER_UI: [keyof Layers, string, typeof Eye, boolean][] = [
    ["points", "Points", Sparkles, true], ["terrain", "Terrain", Mountain, !!scene.heightmap && !!hmData],
    ["hazards", "Hazards", AlertTriangle, true], ["workers", "Workers", Users, true], ["scan", "Scan", Scan, true],
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Glass className="relative h-[74vh] min-h-[520px] overflow-hidden rounded-[18px] border border-hairline bg-canvas p-0">
        <Canvas camera={{ position: start.toArray() as V3, fov: scene.camera?.fov ?? 55, near: 0.05, far: radius * 20 }} dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => setSelected(null)}>
          <Sky radius={radius} />
          <ambientLight intensity={0.9} /><directionalLight position={[5, 10, 4]} intensity={1.4} />
          <GroundGrid center={[center.x, groundY - 0.01, center.z]} size={radius * 5} />
          <Scanner center={[center.x, groundY + 0.02, center.z]} radius={radius * 1.8} show={layers.scan} />
          {pts && <PointCloud data={pts} size={ptSize} scan={layers.scan} bounds={scene.bounds} fogNear={radius * 1.2} fogFar={radius * 4.5} visible={layers.points} />}
          {scene.heightmap && hmData && <Terrain hm={scene.heightmap} data={hmData} visible={layers.terrain} />}
          {edgeList.map((e) => <DangerEdge key={e.i} polyline={e.polyline} drop={e.drop_m} show={layers.hazards} label={labelled.has(e.i)} />)}
          {(scene.hazard_zones ?? []).filter((z) => z.center?.length === 3 && z.radius > 0).map((z, i) => (
            <HazardZone key={i} center={z.center} radius={z.radius} drop={z.drop_m} show={layers.hazards} groundY={groundY} />
          ))}
          {trackIds.map((tid) => {
            const p = persons.find((q) => q.track_id === tid) ?? null
            const tr = (anchors.get(tid) ?? []).filter((a) => a.t <= t && a.t > t - 2.5).map((a) => a.v)
            return <WorkerRig key={tid} p={p} color={p ? colorOf(p) : "#1F9D55"} worker={wmap.get(tid)} selected={selected === tid}
              show={layers.workers} trail={p ? tr : []} onSelect={() => focusWorker(tid)} />
          })}
          <OrbitControls makeDefault target={geo.introTarget} autoRotateSpeed={0.45} enableDamping dampingFactor={0.08} maxDistance={radius * 6} />
          <Rig goal={goal} orbit={orbit} onInteract={onInteract} follow={follow} />
        </Canvas>

        {/* HUD corners */}
        <div className="pointer-events-none absolute left-6 top-6 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><span className="size-1.5 rounded-full bg-ok" />Digital twin</div>
          <div className="tnum text-xs text-muted-foreground">{scene.n_points.toLocaleString()} pts · {edgeList.length} edges · {(scene.hazard_zones ?? []).length} zones · T+{t.toFixed(1)}s</div>
          {pts === null && !loadErr && <div className="text-xs text-muted-foreground animate-pulse">Loading point cloud…</div>}
          {loadErr && <div className="text-xs text-risk">Point cloud failed: {loadErr}</div>}
        </div>

        {/* presets */}
        <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-hairline bg-white p-1 shadow-soft">
          {PRESETS.map((n) => (
            <Button key={n} size="sm" variant="ghost" className={cn("h-7 rounded-lg px-2.5 text-xs", preset === n ? "bg-subtle text-ink" : "text-muted-foreground")} onClick={() => applyPreset(n)}>{n}</Button>
          ))}
        </div>

        {/* minimap */}
        <div className="absolute right-6 top-6 rounded-2xl border border-hairline bg-white p-2 shadow-soft">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground"><MapIcon className="size-3.5" strokeWidth={1.5} />Plan view</div>
          <MiniMap pts={pts} scene={scene} hmData={hmData} persons={persons} colorOf={colorOf} selected={selected} onPick={focusWorker} />
        </div>

        {/* layers */}
        <div className="absolute left-6 top-24 flex flex-col gap-1 rounded-2xl border border-hairline bg-white p-1.5 shadow-soft">
          {LAYER_UI.map(([k, label, Icon, avail]) => (
            <button key={k} disabled={!avail} onClick={() => toggle(k)}
              className={cn("flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition", !avail && "opacity-30",
                layers[k] && avail ? "border border-hairline bg-subtle text-ink" : "border border-transparent text-muted-foreground hover:text-ink")}>
              <Icon className="size-3.5" strokeWidth={1.5} />{label}
            </button>
          ))}
        </div>

        {/* timeline */}
        <div className="absolute inset-x-6 bottom-6 flex items-center gap-3 rounded-2xl border border-hairline bg-white p-2 shadow-soft">
          <Button size="icon" variant="primary" onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}</Button>
          <span className="w-14 tnum text-xs text-ink">{t.toFixed(1)}s</span>
          <Slider className="flex-1" min={0} max={duration} step={0.05} value={[t]} onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)} />
          <span className="font-mono-num text-xs text-muted-foreground">{duration.toFixed(1)}s</span>
          <Button size="icon" variant={orbit ? "default" : "ghost"} title="Auto-orbit" onClick={() => setOrbit(!orbit)}><RotateCw /></Button>
        </div>
      </Glass>

      <div className="space-y-4">
        <Glass className="relative overflow-hidden p-5">
          <HalftoneAccent corner="tr" />
          <div className="relative text-sm text-muted-foreground">Max drop height</div>
          <div className="relative mt-1 tnum text-4xl font-semibold tracking-tight text-ink">{maxDrop.toFixed(1)}<span className="ml-1 text-lg font-normal text-muted-foreground">m</span></div>
          <div className="relative mt-3 flex items-center gap-2 text-sm text-ink">
            <AlertTriangle className="size-4 text-warn" strokeWidth={1.5} />
            <span>{atRisk} worker{atRisk === 1 ? "" : "s"} at height / near edge now</span>
          </div>
        </Glass>

        {selected !== null && (
          <Glass className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Crosshair className="size-4 text-muted-foreground" strokeWidth={1.5} />
              <div className="flex-1 tnum text-sm font-semibold text-ink">Worker #{selected}</div>
              {selWorker && <StatusBadge status={selWorker.status} />}
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-ink"><X className="size-4" /></button>
            </div>
            {selPerson ? (
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-subtle p-2"><div className="text-muted-foreground">Height</div><div className="font-mono-num text-base">{selPerson.height_m.toFixed(1)} m</div></div>
                <div className="rounded-xl bg-subtle p-2"><div className="text-muted-foreground">Posture</div><div className="text-sm capitalize">{selPerson.posture.replace("_", " ")}</div></div>
                <div className="rounded-xl bg-subtle p-2"><div className="text-muted-foreground">Risk</div><div className="font-mono-num text-base" style={{ color: riskColor(selPerson.risk) }}>{Math.round(selPerson.risk * 100)}%</div></div>
              </div>
            ) : <div className="text-xs text-muted-foreground">Not in view at this moment.</div>}
            <div className="grid grid-cols-3 gap-2">
              <MiniBar label="Fatigue" value={selPerson?.fatigue ?? selWorker?.fatigue ?? 0} />
              <MiniBar label="Withdraw" value={selPerson?.withdrawal ?? selWorker?.withdrawal ?? 0} />
              <MiniBar label="Height" value={selWorker?.height_risk ?? 0} />
            </div>
            {selPerson?.near_edge && <div className="rounded-lg bg-risk/10 px-2 py-1 text-xs text-risk">Working near an unprotected drop edge</div>}
            {selWorker && selWorker.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">{selWorker.flags.map((f) => <span key={f} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink">{f}</span>)}</div>
            )}
          </Glass>
        )}

        <Glass className="space-y-2 p-4 text-sm">
          <div className="text-sm text-muted-foreground">In scene now</div>
          {(frame?.persons ?? []).map((p) => (
            <button key={p.track_id} onClick={() => focusWorker(p.track_id)}
              className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition hover:bg-subtle", selected === p.track_id && "bg-subtle")}>
              <span className="flex items-center gap-2 text-ink"><span className="size-2 rounded-full" style={{ background: colorOf(p) }} />#{p.track_id} <span className="capitalize text-muted-foreground">{p.posture.replace("_", " ")}</span></span>
              <span className="tnum text-ink">{p.height_m.toFixed(1)} m · {Math.round(p.risk * 100)}%</span>
            </button>
          ))}
          {!trackIds.length && <div className="text-xs text-muted-foreground">No 3D pose for this clip.</div>}
        </Glass>

        <Glass className="space-y-2 p-4">
          <div className="text-sm text-muted-foreground">Point size</div>
          <Slider min={0.01} max={0.15} step={0.005} value={[ptSize]} onValueChange={(v) => setPtSize(Array.isArray(v) ? v[0] : v)} />
          <p className="text-xs text-muted-foreground">Drag to orbit, scroll to zoom, click a worker to focus. Red planes mark unprotected edges; the label shows the drop height.</p>
        </Glass>
      </div>
    </div>
  )
}
