import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Play, LoaderCircle, ArrowUpRight } from 'lucide-react'
import { SectionCard, StatusPill } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { useWorkspace, request, buildItems, type Job } from '@/lib/sitesense'

export default function LibraryPage(){
  const {id=''}=useParams()
  const {state,library,error,refresh}=useWorkspace()
  const item=state?buildItems(state,library).find(i=>i.libraryId===id):undefined
  const [jobId,setJobId]=useState('')
  const [sending,setSending]=useState(false)
  const [message,setMessage]=useState('')
  const job=state?.jobs.find(j=>j.id===jobId)
  async function analyse(){setSending(true);setMessage('');try{const j=await request<Job>(`/api/library/${id}/analyse`,{method:'POST'});setJobId(j.id);await refresh()}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setSending(false)}}
  if(!state)return <p role="status" className="text-sm text-muted-foreground">{error||'Loading footage…'}</p>
  if(!item)return <div className="space-y-3"><h1 className="text-xl">Video not found</h1><Link to="/clips">Back to clips</Link></div>
  const completed=job?.status==='completed'&&job.result?.recording_id
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><Link to="/clips"><Button variant="secondary" size="sm"><ArrowLeft/>Clips</Button></Link><h1 className="min-w-0 break-words text-xl font-semibold tracking-tight">{item.title}</h1><StatusPill tone={item.recording?.status==='ready'?'ok':'neutral'}>{item.recording?.status==='ready'?'Analysed':'Source footage'}</StatusPill></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-[18px] border border-hairline bg-white p-2 shadow-soft"><video src={item.video} poster={item.poster} controls playsInline muted preload="metadata" className="aspect-video w-full rounded-xl bg-[#14202a] object-contain" aria-label="Source recording preview"/><div className="flex justify-between gap-3 px-3 py-3 text-xs text-muted-foreground"><span>{item.collection} · {item.group}</span><span>{item.duration.toFixed(1)} seconds</span></div></section>
      <div className="space-y-4"><SectionCard title="Video analysis">
        <div className="text-lg font-semibold">{item.recording?.status==='ready'?'Evidence ready':'Take a closer look'}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Detect workers, track their movement and compare earlier video windows with Cosmos.</p>
        {item.recording?.status==='ready'?<Link to={`/video/${item.recording.id}`} className="btn-dark mt-5 inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm">Open worker analysis<ArrowUpRight className="size-4"/></Link>:<Button className="mt-5" disabled={state.busy||sending} onClick={()=>void analyse()}>{sending||state.busy?<LoaderCircle className="size-4 animate-spin"/>:<Play className="size-4"/>}{sending?'Starting…':state.busy?'Pipeline busy':'Analyse this clip'}</Button>}
        <div className="mt-5 divide-y border-t border-hairline text-xs"><div className="flex justify-between py-3"><span className="text-muted-foreground">Capture time</span><span>Unknown</span></div><div className="flex justify-between py-3"><span className="text-muted-foreground">Identity scope</span><span>One recording</span></div></div>
      </SectionCard>{job&&<SectionCard title={job.stage} action={<StatusPill tone={job.status==='failed'?'risk':completed?'ok':'neutral'}>{job.status}</StatusPill>}><progress value={job.progress} max={100} className="w-full accent-[#262626]"/><p className="mt-2 text-xs text-muted-foreground">{job.error||job.events?.at(-1)?.detail||'Processing on the VM.'}</p>{completed&&<Link to={`/video/${completed}`} className="btn-dark mt-4 inline-flex h-9 items-center rounded-[10px] px-3 text-sm">Open worker analysis →</Link>}</SectionCard>}</div>
    </div>
    {(error||message)&&<p role="alert" className="rounded-xl border border-hairline bg-white p-4 text-sm">{error||message}</p>}
  </div>
}
