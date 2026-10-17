import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pause, Play, Maximize2, Camera, SkipForward, Users, HeartHandshake, Check, Film } from 'lucide-react'
import { SectionCard, StatusPill, HalftoneAccent, toneColor } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace, request, media, pending, sampleAt, joint, POSE_EDGES, windowLabel, type Tracking, type Visuals, type Track, type Clip, type Workspace, type Analysis } from '@/lib/sitesense'

type Mode = 'annotated' | 'raw' | 'skeleton'
// Uses hack2's Detail page composition and kit with our recorded, frame-aligned results.
export default function WorkerDetail() {
  const { id = '' } = useParams()
  const [query,setQuery] = useSearchParams()
  const {state,error,refresh} = useWorkspace()
  const r = state?.recordings.find(r=>r.id===id)
  const tracks = state?.tracks.filter(t=>t.recording_id===id) ?? []
  const [tracking,setTracking] = useState<Tracking>()
  const [poses,setPoses] = useState<Visuals>()
  const [loadError,setLoadError] = useState('')
  const [mode,setMode] = useState<Mode>('annotated')
  const [trails,setTrails] = useState(false)
  const [time,setTime] = useState(0)
  const [playing,setPlaying] = useState(false)
  const [clipId,setClipId] = useState('')
  const [message,setMessage] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const panel = useRef<HTMLElement>(null)
  const overlay = useRef<SVGSVGElement>(null)
  const jobVersion = JSON.stringify(state?.jobs.filter(j=>j.recording_id===id || j.result?.recording_id===id).map(j=>[j.id,j.status]))
  useEffect(()=> {
    if(!r) return
    const control = new AbortController()
    setLoadError('')
    request<Tracking>(`/api/recordings/${id}/tracking`,{signal:control.signal}).then(setTracking).catch(e=>{if(e.name!=='AbortError')setLoadError(e.message)})
    let retry: number | undefined
    const loadPose=()=>request<Visuals>(`/api/recordings/${id}/visuals`,{signal:control.signal}).then(setPoses).catch(()=>{if(!control.signal.aborted){setPoses(undefined);retry=window.setTimeout(loadPose,4000)}})
    void loadPose()
    return ()=>{control.abort();window.clearTimeout(retry)}
  },[id,r?.status,jobVersion])
  useEffect(()=>{setTime(0);setClipId('');setTracking(undefined);setPoses(undefined);setMode('annotated')},[id])
  useEffect(()=> {
    let raf=0
    const tick=()=>{const v=video.current;if(v){setTime(old=>Math.abs(old-v.currentTime)>.025?v.currentTime:old);setPlaying(!v.paused)}raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)
  },[])
  const selected = tracks.find(t=>t.id===query.get('worker')) ?? tracks.find(t=>state?.analyses.some(a=>a.track_key===t.id&&pending(a))) ?? tracks[0]
  useEffect(()=>{
    const v=video.current;if(!v||!selected)return
    const cs=state?.clips.filter(c=>c.track_key===selected.id).sort((a,b)=>a.offset-b.offset)??[]
    const first=cs.find(c=>state?.analyses.some(a=>a.clip_id===c.id&&pending(a)))??cs[0]
    const position=()=>{v.currentTime=Math.min(r?.duration??0,(first?.offset??selected.start)+.01);setTime(v.currentTime)}
    if(v.readyState>=1)position();else v.addEventListener('loadedmetadata',position,{once:true})
    return()=>v.removeEventListener('loadedmetadata',position)
  },[selected?.id])
  const windows = (state?.clips.filter(c=>c.track_key===selected?.id)??[]).sort((a,b)=>a.offset-b.offset)
  const current = windows.find(c=>time>=c.offset-.015 && time<c.offset+c.duration)
  const analysis = state?.analyses.find(a=>a.clip_id===current?.id)
  const complete = analysis?.status==='complete'
  const earlier = complete ? state?.clips.find(c=>c.id===analysis.reference_id) : undefined
  const matches = (analysis?.status==='complete' ? analysis.reference_candidates ?? [] : []).map(m=>({clip:state?.clips.find(c=>c.id===m.clip_id),similarity:m.similarity})).filter(m=>m.clip) as {clip:Clip;similarity?:number}[]
  const recordAnalyses = state?.analyses.filter(a=>a.recording_id===id)??[]
  const flagged = tracks.filter(t=>recordAnalyses.some(a=>a.track_key===t.id&&pending(a)))
  const hasPoses = poses?.status==='ready'&&poses.tracks?.some(t=>t.samples.length)
  function select(t:Track) {setQuery({worker:t.id},{replace:true});setClipId('');setMessage('');const cs=state?.clips.filter(c=>c.track_key===t.id).sort((a,b)=>a.offset-b.offset)??[];const flag=cs.find(c=>state?.analyses.some(a=>a.clip_id===c.id&&pending(a)));seek((flag??cs[0])?.offset??t.start)}
  function seek(t:number) {const v=video.current;if(v&&v.readyState>=1){v.currentTime=Math.max(0,Math.min(t,v.duration));setTime(v.currentTime)}}
  async function toggle(){try{const v=video.current;if(!v)return;if(v.paused)await v.play();else v.pause()}catch{setMessage('Use play again when the recording has loaded.')}}
  async function snapshot(){
    const v=video.current;if(!r||!v||v.readyState<2)return
    const canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height
    const g=canvas.getContext('2d')!;g.fillStyle='#14202a';g.fillRect(0,0,r.width,r.height)
    if(mode!=='skeleton')g.drawImage(v,0,0,r.width,r.height)
    if(mode!=='raw'&&overlay.current){const picture=new Image();const markup=new XMLSerializer().serializeToString(overlay.current);picture.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);await picture.decode();g.drawImage(picture,0,0,r.width,r.height)}
    canvas.toBlob(blob=>{if(!blob)return;const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`sitesense-${id.slice(0,6)}-${time.toFixed(1)}s.png`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)})
  }
  async function reviewed(){if(!analysis)return;try{await request(`/api/analyses/${analysis.id}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewed:true,note:analysis.review_note??''})});await refresh();setMessage('Review saved.')}catch(e){setMessage(String(e))}}
  if(!state)return <p role="status" className="text-sm text-muted-foreground">{error||'Loading footage…'}</p>
  if(!r)return <div className="space-y-3"><h1 className="text-xl font-semibold">Recording not found</h1><Link to="/clips">Back to clips</Link></div>
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><Link to="/"><Button variant="secondary" size="sm"><ArrowLeft className="size-4"/>Site</Button></Link><h1 className="text-xl font-semibold tracking-tight">{r.demo?'Warehouse simulation':r.filename.replace(/\.mp4$/i,'').replaceAll('-',' ')}</h1><StatusPill tone={flagged.length?'warn':'neutral'}>{flagged.length?`${flagged.length} to review`:'Analysis ready'}</StatusPill></div>
    {(error||loadError||message)&&<p role="status" className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm">{error||loadError||message}</p>}
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Film className="size-3.5"/>Recorded footage<span>·</span>{r.duration.toFixed(1)}s<span>·</span>{r.task}<span>·</span>{r.demo?'Simulation':r.captured_at?new Date(r.captured_at*1000).toLocaleString():'Capture date unavailable'}</div>
    <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <section ref={panel} className="overflow-hidden rounded-[18px] border border-hairline bg-white p-2 shadow-soft">
          <div className="relative w-full overflow-hidden rounded-[12px] bg-[#14202a]" style={{aspectRatio:`${r.width}/${r.height}`}}>
            <video ref={video} src={media(r.media_path)} muted playsInline preload="auto" aria-label="Site recording" className={cn('absolute inset-0 size-full object-contain',mode==='skeleton'&&'opacity-0')} onLoadedMetadata={()=>setTime(video.current?.currentTime??0)} onError={()=>setMessage('Recording could not be played. Please reload.')} />
            {mode!=='raw'&&tracking&&<TrackingLayer tracking={tracking} poses={poses} time={time} selected={selected?.id} mode={mode} trails={trails} state={state} select={select} svgRef={overlay}/>}
            <div className="pointer-events-none absolute left-3 top-3 flex gap-2"><span className="rounded-md bg-[#12201e]/85 px-2 py-1 text-[10px] font-medium tracking-wide text-white">SITESENSE <span className="ml-1 text-emerald-300">● RECORDED</span></span></div>
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] tabular-nums">{time.toFixed(1)}s · {tracking?.tracks.filter(t=>sampleAt(t.samples,time,Math.max(.04,1.5/r.fps))).length??0} in frame</div>
            {mode!=='raw'&&<div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">{hasPoses?'OpenCV pose · ByteTrack':'YOLO · ByteTrack'}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-1 pt-3 pb-1">
            <Button size="icon" aria-label={playing?'Pause recording':'Play recording'} onClick={toggle}>{playing?<Pause/>:<Play/>}</Button>
            <span className="w-20 text-[11px] tabular-nums text-muted-foreground">{time.toFixed(1)} / {r.duration.toFixed(1)}s</span>
            <input type="range" aria-label="Seek recording" min={0} max={r.duration} step={1/r.fps} value={time} onChange={e=>seek(Number(e.target.value))} className="min-w-20 flex-1 accent-[#262626]" />
            <div className="flex rounded-[10px] bg-subtle p-0.5">{(['annotated','raw','skeleton'] as Mode[]).map(m=><button key={m} disabled={m==='skeleton'&&!hasPoses} aria-pressed={mode===m} onClick={()=>setMode(m)} className={cn('h-7 rounded-[8px] border px-2.5 text-[11px] font-medium capitalize disabled:opacity-40',mode===m?'border-hairline bg-white shadow-soft':'border-transparent text-muted-foreground')}>{m}</button>)}</div>
            <Button size="icon-sm" variant="ghost" aria-label="Next frame" onClick={()=>{video.current?.pause();seek(time+1/r.fps)}}><SkipForward/></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Save annotated frame" onClick={()=>void snapshot().catch(e=>setMessage(String(e)))}><Camera/></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Fullscreen recording" onClick={()=>{void panel.current?.requestFullscreen()}}><Maximize2/></Button>
          </div>
          <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[10px] text-muted-foreground"><span>Click a worker to explore their footage</span><label className="flex items-center gap-1.5"><input type="checkbox" checked={trails} onChange={e=>setTrails(e.target.checked)} className="accent-[#262626]"/>Movement trails</label></div>
        </section>
        {tracking&&<Timeline tracking={tracking} duration={r.duration} time={time} seek={seek} windows={windows} state={state}/>}
      </div>
      <div className="worker-sidebar min-w-0 space-y-4">
        <SectionCard title="Check-in overview" className="worker-verdict relative" footer="Visible observations · human review required">
          <HalftoneAccent corner="tr" className="opacity-40"/>
          <div className="relative flex items-center gap-4"><div className="relative grid size-[72px] shrink-0 place-items-center"><svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90"><circle cx="18" cy="18" r="16" fill="none" stroke="#EFEFED" strokeWidth="2.5"/><circle cx="18" cy="18" r="16" fill="none" stroke={flagged.length?toneColor.warn:toneColor.neutral} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${tracks.length?flagged.length/tracks.length*100.5:0} 100.5`}/></svg><span className="text-2xl font-semibold tabular-nums">{flagged.length}</span></div><div><h2 className="text-xl font-semibold tracking-tight">{flagged.length?'Take a closer look':'No pending flags'}</h2><p className="mt-1 text-xs text-muted-foreground">{flagged.length?'Review the scene before a check-in.':'No automatic alert in this recording.'}</p></div></div>
          <div className="relative mt-4 flex justify-between border-t border-hairline pt-3 text-xs"><span className="text-muted-foreground">Observed tracklets</span><span>{tracks.length}</span></div>
        </SectionCard>
        <SectionCard title="Workers" action={<span className="text-xs tabular-nums text-muted-foreground">{tracks.length} tracked</span>} bodyClassName="px-3 pb-3">
          <div className="worker-list max-h-[420px] space-y-2 overflow-y-auto">{tracks.map(t=>{
            const rows=recordAnalyses.filter(a=>a.track_key===t.id),count=rows.filter(pending).length
            const thumb=state.clips.find(c=>c.track_key===t.id)?.thumbnail_path
            return <button key={t.id} onClick={()=>select(t)} aria-pressed={t.id===selected?.id} className={cn('w-full rounded-[14px] border bg-white p-3 text-left transition hover:bg-[#FAFAF9]',t.id===selected?.id?'border-[#9b9b94] shadow-soft':'border-hairline')}>
              <div className="flex items-center gap-2.5">{thumb?<img src={media(thumb)} alt="" className="size-10 rounded-lg bg-subtle object-cover"/>:<div className="grid size-10 place-items-center rounded-lg bg-subtle text-xs">#{t.track_id}</div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{t.worker_id||`Worker ${t.track_id}`}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{t.identity_confirmed?'Confirmed identity':'This recording only'}</div></div><StatusPill tone={count?'warn':'neutral'} className="px-2 text-[10px]">{count?'Review':'Observed'}</StatusPill></div>
              <div className="mt-3 grid grid-cols-2 gap-3">{[['Detection',t.mean_confidence],['Track coverage',t.coverage]].map(([label,value])=><div key={String(label)}><div className="flex justify-between text-[10px] text-muted-foreground"><span>{label}</span><span className="tabular-nums text-ink">{Math.round(Number(value)*100)}%</span></div><div className="mt-1 h-1 rounded-full bg-subtle"><div className="h-full rounded-full bg-[#18B5A5]" style={{width:`${Math.max(0,Math.min(100,Number(value)*100))}%`}}/></div></div>)}</div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>{rows.filter(a=>a.status==='complete').length} comparisons</span><span className={count?'text-warn':''}>{count?`${count} flagged moments`:'Explore evidence →'}</span></div>
            </button>
          })}{!tracks.length&&<p className="py-5 text-sm text-muted-foreground">No usable worker tracklets.</p>}</div>
        </SectionCard>
        <div className="flex items-start gap-2 px-2 text-[11px] leading-relaxed text-muted-foreground"><HeartHandshake className="mt-0.5 size-4 shrink-0 text-teal"/><span>These observations support a conversation. They do not establish a person’s wellbeing.</span></div>
      </div>
    </div>
    {selected&&current&&<>
      <div className="flex flex-wrap items-end justify-between gap-3 pt-3"><div><p className="text-xs text-muted-foreground">Worker {selected.track_id} · {windowLabel(current)} · supporting footage</p><h2 className="mt-1 text-lg font-semibold tracking-tight">What changed?</h2></div><StatusPill tone={analysis&&pending(analysis)?'warn':'neutral'}>{analysis?.status==='stale'?'Refresh needed':complete&&analysis?.reviewed?'Reviewed':complete?analysis?.report?.review_priority==='review'?'Review suggested':'Comparison ready':'Baseline'}</StatusPill></div>
      <SectionCard className="relative" title="Cosmos observation" action={analysis?.status==='complete'&&<Button size="sm" variant="secondary" disabled={state.busy||analysis.reviewed} onClick={()=>void reviewed()}><Check className="size-3"/>{analysis.reviewed?'Reviewed':'Mark reviewed'}</Button>}>
        <p className="max-w-4xl text-sm leading-relaxed">{analysis?.status==='stale'?'Worker or task mapping changed. Comparisons need refreshing.':complete?analysis?.report?.human_review_summary:analysis?.summary??'No eligible earlier reference for this window.'}</p>
        {complete&&analysis?.report&&<details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Observations & evidence limits</summary><ul className="mt-3 list-disc space-y-1 pl-4">{analysis.report.observable_changes.map((x,i)=><li key={i}>{x}</li>)}</ul><p className="mt-3">{analysis.report.task_context}</p><ul className="mt-2 list-disc space-y-1 pl-4">{analysis.report.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
      </SectionCard>
      <ComparisonPair current={current} earlier={earlier}/>
      {matches.length>0&&<div className="space-y-3"><div className="flex justify-between"><h3 className="text-sm font-medium">Earlier similar moments</h3><span className="text-xs text-muted-foreground">{matches.length} matches · same track & task</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{matches.map((m,i)=><EvidenceVideo key={m.clip.id} clip={m.clip} label={m.clip.id===earlier?.id?'Used in comparison':`Match ${i+1}`} subtitle={m.similarity!==undefined?`${(m.similarity*100).toFixed(1)}% embedding similarity`:undefined}/>)}</div></div>}
      <div className="space-y-3"><div className="flex justify-between"><h3 className="text-sm font-medium">Worker timeline</h3><span className="text-xs text-muted-foreground">{windows.length} moments · one recording</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{windows.map(c=><EvidenceVideo key={c.id} clip={c} label={windowLabel(c)} active={c.id===current.id} onSelect={()=>{setClipId(c.id);seek(c.offset+.01)}} subtitle={state.analyses.find(a=>a.clip_id===c.id)?.status==='complete'?'Compared':'Baseline'}/>)}</div></div>
      <details className="rounded-[18px] border border-hairline bg-white p-5 text-xs text-muted-foreground"><summary className="cursor-pointer">Worker identity & task</summary><p className="mt-3">Tracklets are scoped to this recording. Cross-recording identity requires human confirmation and known capture dates.</p><form key={selected.id} className="mt-3 flex flex-wrap gap-2" onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);try{await request(`/api/tracks/${selected.id}/identity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker_id:data.get('worker_id'),task:data.get('task')})});await request(`/api/tracks/${selected.id}/compare`,{method:'POST'});await refresh();setMessage('Worker mapping saved. Rebuilding comparisons.')}catch(e){setMessage(String(e))}}}><input name="worker_id" aria-label="Confirmed worker ID" defaultValue={selected.worker_id??''} maxLength={60} placeholder="Worker ID (optional)" className="h-9 rounded-lg border px-3 text-ink"/><input name="task" aria-label="Worker task" defaultValue={selected.task} required maxLength={80} className="h-9 rounded-lg border px-3 text-ink"/><Button type="submit" disabled={state.busy}>Save & compare</Button></form></details>
    </>}
  </div>
}

function TrackingLayer({tracking,poses,time,selected,mode,trails,state,select,svgRef}:{tracking:Tracking;poses?:Visuals;time:number;selected?:string;mode:Mode;trails:boolean;state:Workspace;select:(t:Track)=>void;svgRef:React.RefObject<SVGSVGElement|null>}) {
  const tolerance=Math.max(.04,1.5/tracking.fps)
  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${tracking.width} ${tracking.height}`} width={tracking.width} height={tracking.height} className="absolute inset-0 size-full" aria-label="Worker tracking overlay">
    {tracking.tracks.map(track=>{
      const box=sampleAt(track.samples,time,tolerance);if(!box)return null
      const isSelected=track.id===selected,flag=state.analyses.some(a=>a.track_key===track.id&&pending(a)),color=isSelected?'#ffb744':flag?'#f77761':'#41e5b0'
      const pose=poses?.status==='ready'?sampleAt(poses.tracks?.find(t=>t.id===track.id)?.samples,time,.25):undefined
      const points=pose?.keypoints??[];const threshold=poses?.joint_threshold??.55
      const [x1,y1,x2,y2]=box.bbox
      let trail=trails?(track.samples??[]).filter(s=>s.time<=time&&s.time>time-2.5):[]
      const gap=trail.findLastIndex((s,i)=>i>0&&s.time-trail[i-1].time>.2);if(gap>0)trail=trail.slice(gap)
      return <g key={track.id} data-track={track.id} opacity={selected && !isSelected ? .95 : 1}>
        {trail.length>1&&<polyline points={trail.filter((_,i)=>i%3===0).map(s=>`${(s.bbox[0]+s.bbox[2])/2},${s.bbox[3]}`).join(' ')} fill="none" stroke={color} strokeWidth="3" opacity=".75"/>}
        <g data-layer="pose">{POSE_EDGES.map(([a,b])=>joint(points[a],threshold)&&joint(points[b],threshold)?<line key={`${a}-${b}`} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} stroke={color} strokeWidth="4" strokeLinecap="round"/>:null)}{[0,11,12,13,14,15,16,23,24,25,26,27,28].map(i=>joint(points[i],threshold)?<circle key={i} cx={points[i][0]} cy={points[i][1]} r="3.5" fill="#fff" stroke={color} strokeWidth="1.5"/>:null)}</g>
        {mode!=='skeleton'&&<g role="button" tabIndex={0} aria-label={`Select worker ${track.track_id}`} onClick={()=>select(track)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(track)}}} className="cursor-pointer"><rect x={x1} y={y1} width={x2-x1} height={y2-y1} fill="transparent" stroke={color} strokeWidth={isSelected?3:2}/><rect x={x1} y={Math.max(0,y1-24)} width="112" height="23" rx="3" fill={color}/><text x={x1+7} y={Math.max(17,y1-8)} fill="#10201b" fontFamily="Arial,sans-serif" fontSize="14" fontWeight="700">Worker {track.track_id}</text></g>}
      </g>
    })}
  </svg>
}

function Timeline({tracking,duration,time,seek,windows,state}:{tracking:Tracking;duration:number;time:number;seek:(t:number)=>void;windows:Clip[];state:Workspace}){
  const rows=useMemo(()=>Array.from({length:Math.ceil(duration*4)+1},(_,i)=>{const t=Math.min(duration,i/4),boxes=tracking.tracks.map(tr=>sampleAt(tr.samples,t,Math.max(.04,1.5/tracking.fps))).filter(Boolean);return {t,n:boxes.length,confidence:boxes.length?boxes.reduce((v,s)=>v+s!.confidence,0)/boxes.length:0}}),[tracking,duration])
  const W=900,H=104;const path=rows.map((r,i)=>`${i?'L':'M'}${r.t/duration*W},${H-r.confidence*(H-12)}`).join(' ')
  return <SectionCard title="Signals over time" action={<span className="text-[10px] text-muted-foreground"><span className="text-teal">●</span> Detection confidence</span>} footer="Click the chart or a moment to seek.">
    <svg viewBox={`0 0 ${W} ${H+24}`} className="w-full cursor-crosshair" role="slider" tabIndex={0} aria-label="Recording timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Number(time.toFixed(1))} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();seek(time+(e.key==='ArrowRight'?.25:-.25))}}} onClick={e=>{const b=e.currentTarget.getBoundingClientRect();seek((e.clientX-b.left)/b.width*duration)}}>
      {[0,.5,1].map(y=><g key={y}><line x1="0" y1={H-y*(H-12)} x2={W} y2={H-y*(H-12)} stroke="#EFEFED"/><text x="2" y={Math.max(10,H-y*(H-12)-4)} fontSize="10" fill="#74746F">{y}</text></g>)}
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="#18B5A5" opacity=".09"/><path d={path} fill="none" stroke="#18B5A5" strokeWidth="2"/><line x1={time/duration*W} x2={time/duration*W} y1="0" y2={H} stroke="#262626" strokeWidth="1.5"/>
      <text x="0" y={H+20} fontSize="11" fill="#74746F">0s</text><text x={W} y={H+20} textAnchor="end" fontSize="11" fill="#74746F">{duration.toFixed(1)}s</text>
    </svg>
    <div className="mt-2 flex items-center gap-3"><span className="w-20 shrink-0 text-[10px] text-muted-foreground">People in frame</span><div className="flex h-7 flex-1 items-end gap-px">{rows.map((r,i)=><div key={i} className="flex-1 rounded-t-[1px] bg-sky/35" style={{height:`${r.n/Math.max(1,tracking.tracks.length)*100}%`}} title={`${r.t.toFixed(1)}s · ${r.n} people`}/>)}</div></div>
    <div className="mt-4 flex flex-wrap gap-1.5">{windows.map(c=>{const a=state.analyses.find(a=>a.clip_id===c.id);return <button key={c.id} onClick={()=>seek(c.offset+.01)} className={cn('rounded-lg border px-2 py-1 text-[10px] tabular-nums',time>=c.offset&&time<c.offset+c.duration?'border-ink bg-ink text-white':'border-hairline',a&&pending(a)&&'border-warn text-warn')}>{a&&pending(a)?'● ':''}{windowLabel(c)}</button>})}</div>
  </SectionCard>
}

function EvidenceVideo({clip,label,subtitle,active,onSelect}:{clip:Clip;label:string;subtitle?:string;active?:boolean;onSelect?:()=>void}){
  return <article className={cn('overflow-hidden rounded-[16px] border bg-white shadow-soft',active?'border-[#73736c]':'border-hairline')}><video src={media(clip.media_path)} poster={media(clip.thumbnail_path)} controls muted playsInline preload="none" className="aspect-video w-full bg-[#14202a] object-contain" aria-label={label}/><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span>{onSelect&&<button onClick={onSelect} className="text-[10px] text-muted-foreground hover:text-ink">{active?'Selected':'Compare →'}</button>}</div><div className="mt-1 text-[10px] text-muted-foreground">{subtitle??windowLabel(clip)}</div></div></article>
}

function ComparisonPair({current,earlier}:{current:Clip;earlier?:Clip}){
  const left=useRef<HTMLVideoElement>(null),right=useRef<HTMLVideoElement>(null)
  const [playing,setPlaying]=useState(false)
  useEffect(()=>{left.current?.pause();right.current?.pause();setPlaying(false)},[current.id,earlier?.id])
  function pause(){left.current?.pause();right.current?.pause();setPlaying(false)}
  async function toggle(){if(playing){pause();return}const a=left.current,b=right.current;if(!a||!b)return;a.currentTime=0;b.currentTime=0;try{await Promise.all([a.play(),b.play()]);setPlaying(true)}catch{pause()}}
  return <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Earlier & current</h3><Button variant="secondary" size="sm" disabled={!earlier} onClick={()=>void toggle()}>{playing?<Pause className="size-3"/>:<Play className="size-3"/>}{playing?'Pause together':'Play together'}</Button></div><div className="grid gap-4 md:grid-cols-2">{[{clip:earlier,label:'Earlier reference',ref:left},{clip:current,label:'Current moment',ref:right}].map(({clip,label,ref})=><article key={label} className="overflow-hidden rounded-[18px] border border-hairline bg-white shadow-soft"><div className="flex justify-between px-4 py-2.5 text-xs"><span className="font-medium">{label}</span><span className="text-muted-foreground">{clip?windowLabel(clip):'No earlier match'}</span></div>{clip?<video key={clip.id} ref={ref} src={media(clip.media_path)} poster={media(clip.thumbnail_path)} controls muted playsInline preload="metadata" className="aspect-video w-full bg-[#14202a] object-contain" aria-label={label} onEnded={pause} onPause={()=>setPlaying(false)} onTimeUpdate={()=>{if(ref===right&&playing&&left.current&&right.current){const min=Math.min(left.current.duration,right.current.duration);if(right.current.currentTime>=min-.04)pause();else if(Math.abs(left.current.currentTime-right.current.currentTime)>.2)left.current.currentTime=right.current.currentTime}}}/>:<div className="grid aspect-video place-items-center bg-subtle text-xs text-muted-foreground">Baseline · no change comparison</div>}</article>)}</div></section>
}
