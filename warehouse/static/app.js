'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const media = path => '/media/' + String(path).split('/').map(encodeURIComponent).join('/');
let state = {recordings:[], tracks:[], clips:[], analyses:[], jobs:[]};
let selectedTrack = null, selectedClip = null, renderedKey = '', completedJob = null;
let toastTimer, polling = false;
let videoView = 'scene';

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Check the form and try again.');
  return body;
}
const post = (path, data) => api(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data ?? {})});
function toast(message, error=false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = 'toast' + (error ? ' error':'');
  $('toast').hidden = false; toastTimer = setTimeout(() => {$('toast').hidden=true;}, error ? 9000:4500);
}
async function action(callback) { try { await callback(); await refresh(); } catch(error) { toast(error.message, true); } }
function setVideo(id, path, poster) {
  const video = $(id);
  const url = path ? media(path) : '';
  if (video.getAttribute('src') !== url) {
    video.pause();
    if (url) video.setAttribute('src', url); else video.removeAttribute('src');
    if (poster) video.setAttribute('poster', media(poster)); else video.removeAttribute('poster');
    video.load();
  }
}
const windowLabel = clip => `${clip.offset.toFixed(1)}–${(clip.offset+clip.duration).toFixed(1)}s`;
const dateLabel = (clip) => clip.demo ? 'Sample · relative recording time' : clip.capture_time_known===false ? 'Dataset · relative recording time' : new Date(clip.started_at*1000).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
function analysisFor(clip) { return state.analyses.find(a => a.clip_id === clip?.id); }

function pairDuration() {
  const earlier=$('reference-video'),current=$('current-video');
  if(earlier.hidden) return 0;
  const durations=[earlier.duration,current.duration];
  return durations.every(n=>Number.isFinite(n)&&n>0) ? Math.min(...durations):0;
}
const clock = value => `${Math.floor(Math.max(0,value)/60)}:${String(Math.floor(Math.max(0,value)%60)).padStart(2,'0')}`;
function syncPairControls() {
  const duration=pairDuration(),current=$('current-video'),earlier=$('reference-video');
  $('pair-play').disabled=duration<=0;
  $('pair-scrub').disabled=duration<=0;
  $('pair-scrub').max=duration || 5;
  $('pair-scrub').value=Math.min(duration,Number(current.currentTime)||0);
  $('pair-time').textContent=`${clock(current.currentTime||0)} / ${clock(duration)}`;
  $('pair-play').textContent=!current.paused&&!earlier.paused ? 'Ⅱ Pause together':'▶ Play together';
}
function pausePair() {
  $('reference-video').pause();$('current-video').pause();syncPairControls();
}
function seekPair(value) {
  const time=Math.max(0,Math.min(Number(value)||0,pairDuration()));
  for(const id of ['reference-video','current-video']) {
    const video=$(id);if(video.readyState>=1)video.currentTime=time;
  }
  syncPairControls();
}
async function playPair() {
  if(!pairDuration())throw new Error('Wait for both clips to load.');
  let start=Number($('pair-scrub').value)||0;
  if(start>=pairDuration()-.05)start=0;
  seekPair(start);
  try {await Promise.all([$('reference-video').play(),$('current-video').play()]);}
  catch(error){pausePair();throw new Error('Playback unavailable. Try the video controls.');}
  syncPairControls();
}
function setVideoView(view) {
  pausePair();videoView=view;
  for(const name of ['scene','person']) {
    $('view-'+name).classList.toggle('active',name===view);
    $('view-'+name).setAttribute('aria-pressed',String(name===view));
  }
  renderedKey='';renderEvidence();
}

function renderMetrics() {
  $('metric-recordings').textContent = state.recordings.length;
  $('recording-count').textContent = state.recordings.length;
  $('metric-tracks').textContent = state.tracks.length;
  const identities = new Set(state.tracks.filter(t=>t.identity_confirmed).map(t=>t.worker_id));
  $('metric-identities').textContent = `${identities.size} confirmed worker ${identities.size === 1 ? 'identity':'identities'}`;
  $('metric-clips').textContent = state.clips.length;
  $('metric-reviews').textContent = state.analyses.filter(a=>a.status==='complete'&&!a.reviewed).length;
  $('sample-run').disabled = state.busy; $('empty-run').disabled = state.busy; $('upload-open').disabled=state.busy;
  $('sample-run').textContent = state.recordings.some(r=>r.demo&&r.status==='ready') ? '▶ Open demo':'▶ Run demo';
}
function renderAlerts() {
  const byTrack=new Map();
  for(const a of [...state.analyses].sort((a,b)=>b.created_at-a.created_at)) {
    if(a.status==='complete'&&!a.reviewed&&a.report.review_priority==='review'&&!byTrack.has(a.track_key))byTrack.set(a.track_key,a);
  }
  $('alert-list').innerHTML=[...byTrack.values()].map(a=>{
    const track=state.tracks.find(t=>t.id===a.track_key);
    return `<button class="alert-card" data-alert="${esc(a.clip_id)}"><span class="alert-orb"></span><strong>${esc(track?.worker_id || track?.label || 'Unconfirmed worker')}</strong><span>Check-in suggested</span><b>→</b></button>`;
  }).join('') || '<span class="quiet">No pending alerts</span>';
  document.querySelectorAll('.alert-card').forEach(button=>button.addEventListener('click',()=>{
    const clip=state.clips.find(c=>c.id===button.dataset.alert);
    if(clip){pausePair();selectedTrack=clip.track_key;selectedClip=clip.id;renderedKey='';renderEvidence();}
  }));
}
function renderPipeline() {
  const job = state.jobs.at(-1);
  $('pipeline').hidden=!state.busy&&job?.status!=='failed';
  if (!job) return;
  $('pipeline-title').textContent = job.status==='failed' ? 'Processing stopped' : job.stage;
  $('pipeline-detail').textContent = job.error || job.events?.at(-1)?.detail || 'Preparing a processing job.';
  $('pipeline-orb').className = 'status-orb' + (['queued','running'].includes(job.status) ? ' running':job.status==='failed'?' failed':'');
  $('pipeline-percent').textContent = job.status==='failed' ? 'RETRY AVAILABLE':`${job.progress}%`;
  $('pipeline-progress').value = job.progress;
  document.querySelectorAll('.steps span').forEach((span,i)=>span.classList.toggle('done',job.progress >= [30,34,40,65,90,100][i]));
  if (job.status==='completed' && completedJob !== job.id) {
    if (completedJob !== null) toast(job.result?.cached ? 'Opened the saved warehouse demo.':'Processing complete. Evidence is ready to review.');
    completedJob = job.id;
    if (job.result?.recording_id) {
      const track = state.tracks.find(t=>t.id===job.result.track_key)
        || state.tracks.find(t=>t.recording_id===job.result.recording_id);
      if (track) { selectedTrack=track.id; selectedClip=null; }
    }
  }
}
function renderRecordings() {
  $('recording-rows').innerHTML = state.recordings.length ? [...state.recordings].reverse().map((r,i)=>`<tr><td title="${esc(r.filename)}">${r.demo?'Warehouse sample':esc(r.filename)}<small>${esc(r.id.slice(0,8))} · ${r.demo?'Supplied simulation · no real capture date':r.captured_at==null?'Capture date unavailable':new Date(r.captured_at*1000).toLocaleString()}</small></td><td>${esc(r.location)}<small>${esc(r.task)}</small></td><td>${r.duration.toFixed(1)}s</td><td>${r.processed_tracks ?? '—'}</td><td><span class="recording-status ${r.status==='failed'?'failed':''}">${esc(r.status.replaceAll('_',' '))}</span></td><td><button class="text-button recording-open" data-id="${esc(r.id)}">Open ↗</button></td></tr>`).join('') : '<tr><td colspan="6" class="table-empty">No recordings imported yet.</td></tr>';
  document.querySelectorAll('.recording-open').forEach(button=>button.addEventListener('click',()=>{
    const track=state.tracks.find(t=>t.recording_id===button.dataset.id);
    if(track){selectTrack(track.id); $('evidence').scrollIntoView({behavior:'smooth',block:'start'});}else toast('This recording has no usable person tracks yet.');
  }));
}
function selectTrack(id) { pausePair();selectedTrack=id; selectedClip=null; renderedKey=''; renderEvidence(); }
function renderEvidence() {
  if (!state.tracks.some(t=>t.id===selectedTrack)) {selectedTrack=state.tracks[0]?.id; selectedClip=null;}
  const track = state.tracks.find(t=>t.id===selectedTrack);
  const optionsKey = JSON.stringify(state.tracks.map(t=>[t.id,t.worker_id,t.identity_confirmed]));
  if ($('track-select').dataset.key !== optionsKey) {
    $('track-select').innerHTML = state.tracks.length ? state.tracks.map(t=>`<option value="${esc(t.id)}">${esc(t.worker_id || t.label)} · ${esc(t.recording_id.slice(0,4))}</option>`).join('') : '<option>No tracks yet</option>';
    $('track-select').dataset.key=optionsKey;
  }
  $('track-select').disabled=!track; $('track-select').value=track?.id ?? '';
  const clips = state.clips.filter(c=>c.track_key===selectedTrack).sort((a,b)=>a.started_at-b.started_at);
  if (!clips.some(c=>c.id===selectedClip)) selectedClip=clips.at(-1)?.id;
  const current = clips.find(c=>c.id===selectedClip);
  $('empty-state').hidden=!!current; $('evidence').hidden=!current;
  if (!current) return;
  const analysis=analysisFor(current), reference=analysis?.status==='complete' ? state.clips.find(c=>c.id===analysis.reference_id):undefined;
  const key=JSON.stringify([track,current,analysis,reference,videoView]);
  $('identity-save').disabled=state.busy;
  $('review-save').disabled=state.busy;
  renderControlCenter(current,track,analysis);
  if(key===renderedKey) return;
  pausePair();
  renderedKey=key;
  $('identity-badge').textContent=track.identity_confirmed ? `✓ ${track.worker_id}`:'One continuous track';
  $('task-label').textContent=current.task;
  $('current-label').textContent=windowLabel(current); $('ref-label').textContent=reference ? windowLabel(reference):'—';
  $('current-caption').textContent=track.worker_id || `Track ${current.track_id}`;
  $('reference-caption').textContent=reference ? (track.worker_id || `Track ${reference.track_id}`):'Baseline';
  setVideo('current-video',videoView==='scene'?current.context_path:current.media_path,videoView==='person'?current.thumbnail_path:undefined);
  setVideo('reference-video',reference && (videoView==='scene'?reference.context_path:reference.media_path),videoView==='person'?reference?.thumbnail_path:undefined);
  $('reference-video').hidden=!reference; $('no-reference').hidden=!!reference;
  $('similarity-label').textContent=analysis?.status==='complete' ? 'MATCHED':'';
  $('worker-id').value=track.worker_id || ''; $('task-input').value=track.task;
  $('identity-save').disabled=state.busy;
  $('report').innerHTML=renderReport(analysis,current);
  $('report-details').innerHTML=renderDetailedReport(analysis,current);
  $('review-actions').hidden=analysis?.status!=='complete';
  $('review-note').value=analysis?.review_note || '';
  $('review-save').textContent=analysis?.reviewed?'✓ Reviewed · save note':'Mark reviewed';
  $('review-save').disabled=state.busy;
  renderTimeline(current,track);
  renderMatches(analysis,current);
  syncPairControls();
}
function renderMatches(analysis,current) {
  const candidates=analysis?.status==='complete' ? (analysis.reference_candidates || (analysis.reference_id?[{clip_id:analysis.reference_id}]:[])):[];
  const matches=candidates.map(c=>({clip:state.clips.find(item=>item.id===c.clip_id),similarity:c.similarity})).filter(c=>c.clip);
  $('matches-section').hidden=matches.length===0;
  $('matches-count').textContent=matches.length;
  const key=JSON.stringify([current.id,matches.map(m=>m.clip.id)]);
  if($('match-gallery').dataset.key===key)return;
  $('match-gallery').dataset.key=key;
  $('match-gallery').innerHTML=matches.map((m,i)=>`<article class="match-card ${m.clip.id===analysis.reference_id?'top-match':''}"><div class="match-card-title"><span>${esc(windowLabel(m.clip))}</span><span>${m.clip.id===analysis.reference_id?'In report':`Match ${i+1}`}</span></div><video src="${media(m.clip.context_path)}#t=0.01" controls muted playsinline preload="metadata" aria-label="Earlier match ${i+1}, ${esc(windowLabel(m.clip))}"></video></article>`).join('');
}
function renderReport(analysis,clip) {
  if(!analysis||analysis.status!=='complete') {
    return `<div class="report-label">${analysis?.status==='stale'?'REFRESH NEEDED':'BASELINE'}</div><p class="report-summary">${analysis?.status==='stale'?'Worker or task changed. Compare again.':'No earlier match yet.'}</p>`;
  }
  const labels={routine:'COMPARISON READY',review:'REVIEW SUGGESTED',insufficient_evidence:'LIMITED EVIDENCE'};
  const firstSentence=analysis.report.human_review_summary.split(/(?<=[.!?])\s+/)[0];
  const short=firstSentence.length>155 ? firstSentence.slice(0,152).replace(/\s+\S*$/,'')+'…':firstSentence;
  return `<div class="report-label">COSMOS OBSERVATION<span class="report-badge ${analysis.report.review_priority==='review'?'review':''}">${analysis.reviewed?'✓ REVIEWED':labels[analysis.report.review_priority]}</span></div><p class="report-summary">${esc(short)}</p>`;
}
function renderDetailedReport(analysis,clip) {
  if(!analysis || analysis.status!=='complete') return `<div class="report-top"><strong>${analysis?.status==='stale'?'Comparison needs refreshing':'Establishing a reference'}</strong><span class="report-badge">${analysis?.status==='stale'?'MAPPING UPDATED':'BASELINE'}</span></div><p class="report-summary">${esc(analysis?.summary || 'This window has been indexed. A comparison will appear after a suitable earlier reference is available.')}</p><div class="scope-note">An earlier window from the same continuous track can be compared directly. Across recordings, confirm the worker, match the task and use real capture times.</div>`;
  const report=analysis.report;
  const labels={routine:'CONTEXT REVIEW',review:'HUMAN REVIEW SUGGESTED',insufficient_evidence:'INSUFFICIENT EVIDENCE'};
  return `<div class="report-top"><strong>What changed in the footage</strong><span class="report-badge ${report.review_priority==='review'?'review':''}">${analysis.reviewed?'✓ REVIEWED':labels[report.review_priority]}</span></div><p class="report-summary">${esc(report.human_review_summary)}</p><div class="small-label">VISIBLE OBSERVATIONS</div><ul class="evidence-list">${report.observable_changes.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><div class="report-context"><strong>Task & context</strong><br>${esc(report.task_context)}</div><details><summary>Evidence limits & uncertainty (${report.limitations.length})</summary><ul class="limitations">${report.limitations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details><div class="scope-note">${clip.demo?'DEMO SCOPE · The earlier and current windows are from one short simulated warehouse scene. They do not establish a trend over days or months.':analysis.within_recording?'SCOPE · This comparison is within one recording.':'SCOPE · Cross-recording identity was confirmed by a human.'} Model observations are unvalidated and require review.</div>`;
}
function renderTimeline(current,track) {
  const history=state.clips.filter(c=>c.track_key===track.id || (!c.demo&&!current.demo&&c.capture_time_known!==false&&current.capture_time_known!==false&&track.identity_confirmed&&c.identity_confirmed&&c.worker_id===track.worker_id&&c.task===current.task)).sort((a,b)=>b.started_at-a.started_at);
  $('history-count').textContent=history.length;
  $('timeline').innerHTML=history.map(clip=>{
    const a=analysisFor(clip);
    const title=clip.id===current.id?'Selected':a?.status==='complete'?(a.reviewed?'Reviewed':'Compared'):a?.status==='stale'?'Refresh':'Baseline';
    return `<button class="timeline-item ${clip.id===current.id?'active':''}" data-clip="${esc(clip.id)}" aria-label="${esc(windowLabel(clip))}, ${title}" title="${esc(dateLabel(clip))}"><span class="timeline-marker"></span><video class="timeline-thumb" src="${media(clip.context_path)}#t=0.01" muted playsinline preload="metadata" aria-hidden="true"></video><div class="timeline-card-caption"><strong>${esc(windowLabel(clip))}</strong><span>${title}</span></div></button>`;
  }).join('');
  document.querySelectorAll('.timeline-item').forEach(button=>button.addEventListener('click',()=>{
    const clip=state.clips.find(c=>c.id===button.dataset.clip);pausePair();selectedTrack=clip.track_key; selectedClip=clip.id;renderedKey='';renderEvidence();
  }));
}
async function refresh() {
  if(polling)return;polling=true;
  try {state=await api('/api/state');renderMetrics();renderPipeline();renderRecordings();renderAlerts();renderEvidence();renderOverview();}
  catch(error) {$('pipeline-title').textContent='VM connection unavailable';$('pipeline-detail').textContent='Check the SSH tunnel. Retrying automatically.';}
  finally{polling=false;}
}
async function health() {
  $('health-refresh').disabled=true;
  try {const result=await api('/api/health');$('services').innerHTML=result.services.map(service=>`<div class="service-row"><span>${esc(service.name)}</span><span class="service-status ${service.ready?'':'offline'}">${service.ready?'Connected':'Unavailable'}</span></div>`).join('');}
  catch(error){$('services').innerHTML='<div class="service-row"><span>Service health unavailable</span><span class="service-status offline">Retry</span></div>';}
  finally{$('health-refresh').disabled=false;}
}
async function sample() {
  await action(async()=>{await post('/api/sample');selectedTrack=null;selectedClip=null;toast('Warehouse demo started. Processing runs on the VM.');});
}
$('sample-run').addEventListener('click',sample);$('empty-run').addEventListener('click',sample);
$('track-select').addEventListener('change',event=>selectTrack(event.target.value));
$('view-scene').addEventListener('click',()=>setVideoView('scene'));
$('view-person').addEventListener('click',()=>setVideoView('person'));
$('pair-play').addEventListener('click',()=>action(async()=>{
  if(!$('reference-video').paused&&!$('current-video').paused)pausePair();else await playPair();
}));
$('pair-reset').addEventListener('click',()=>{pausePair();seekPair(0);});
$('pair-scrub').addEventListener('input',event=>seekPair(event.target.value));
for(const id of ['reference-video','current-video']) {
  $(id).addEventListener('loadedmetadata',syncPairControls);
  $(id).addEventListener('ended',pausePair);
  $(id).addEventListener('play',syncPairControls);
  $(id).addEventListener('pause',syncPairControls);
}
$('current-video').addEventListener('timeupdate',()=>{
  const current=$('current-video'),earlier=$('reference-video');
  if(!current.paused&&!earlier.paused) {
    if(current.currentTime>=pairDuration()-.04){pausePair();return;}
    if(Math.abs(current.currentTime-earlier.currentTime)>.2)earlier.currentTime=current.currentTime;
  }
  syncPairControls();
});
$('details-open').addEventListener('click',()=>{$('details-panel').open=true;$('details-panel').scrollIntoView({behavior:'smooth',block:'start'});});
$('health-refresh').addEventListener('click',health);
$('identity-save').addEventListener('click',()=>action(async()=>{
  const worker=$('worker-id').value.trim(),task=$('task-input').value.trim();
  if(!task)throw new Error('Enter a task label.');
  await post(`/api/tracks/${selectedTrack}/identity`,{worker_id:worker,task});
  await post(`/api/tracks/${selectedTrack}/compare`); renderedKey='';toast(worker?'Identity confirmed. Rebuilding eligible comparisons.':'Worker link cleared. Rebuilding within-recording comparisons.');
}));
$('review-save').addEventListener('click',()=>action(async()=>{
  const analysis=analysisFor(state.clips.find(c=>c.id===selectedClip));
  await post(`/api/analyses/${analysis.id}/review`,{reviewed:true,note:$('review-note').value});renderedKey='';toast('Human review saved on the VM.');
}));
$('upload-open').addEventListener('click',()=>$('upload-dialog').showModal());$('upload-close').addEventListener('click',()=>$('upload-dialog').close());
$('upload-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const data=new FormData(event.target);const file=data.get('file');
  if(file.size>80_000_000)throw new Error('The upload limit is 80 MB.');
  data.set('captured_at',new Date(data.get('captured_at')).toISOString());
  await api('/api/upload',{method:'POST',body:data});$('upload-dialog').close();selectedTrack=null;selectedClip=null;toast('Recording uploaded. Processing has started.');
});});
initializeControlCenter();initializeVision();initializeCatalog();initializeOverview();initializeWorkspace();refresh();health();setInterval(refresh,2500);
