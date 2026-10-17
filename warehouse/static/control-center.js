'use strict';
// Geometry and review states come from recorded observations, never synthetic scores.
const trackingCache=new Map(),trackingPending=new Set();
let sceneSelectionKey='',sceneSeekPending=null,overlayFrame=0,trackingVisible=true;

function sampleAtTime(samples,time,fps=30) {
  if(!samples?.length||!Number.isFinite(time))return null;
  let low=0,high=samples.length;
  while(low<high){const mid=(low+high)>>1;if(samples[mid].time<time)low=mid+1;else high=mid;}
  const after=samples[low],before=samples[low-1];
  const sample=!before?after:!after?before:Math.abs(after.time-time)<Math.abs(before.time-time)?after:before;
  return sample&&Math.abs(sample.time-time)<=Math.max(.12,1.5/fps)?sample:null;
}
function workerReviewSummary(trackKey) {
  const reports=state.analyses.filter(a=>a.track_key===trackKey&&a.status==='complete');
  const flags=reports.filter(a=>!a.reviewed&&a.report.review_priority==='review');
  return {pending:flags.length,flags,reports,reviewed:reports.filter(a=>a.reviewed).length};
}
function clipAtTime(trackKey,time) {
  return state.clips.find(c=>c.track_key===trackKey&&time>=c.offset-.001&&time<c.offset+c.duration-.001);
}
function trackFrameState(trackKey,time) {
  const clip=clipAtTime(trackKey,time),report=analysisFor(clip);
  if(report?.status!=='complete'||report.report.review_priority==='insufficient_evidence')return 'unassessed';
  if(report.reviewed)return 'reviewed';
  return report.report.review_priority==='review'?'review':'tracked';
}
function trackingVersion(recordingId) {
  return JSON.stringify([state.recordings?.find(r=>r.id===recordingId)?.status,
    state.tracks.filter(t=>t.recording_id===recordingId).map(t=>t.id).sort()]);
}
async function ensureTracking(recordingId) {
  const version=trackingVersion(recordingId);
  if(trackingCache.get(recordingId)?._version===version||trackingPending.has(recordingId))return;
  trackingPending.add(recordingId);
  try {
    const data=await api(`/api/recordings/${encodeURIComponent(recordingId)}/tracking`);
    trackingCache.set(recordingId,{...data,_version:version});
    renderedKey='';renderEvidence();
  } catch(error) {
    $('tracking-state').textContent='Tracking unavailable';
  } finally {trackingPending.delete(recordingId);}
}
function selectedRecording() {
  const track=state.tracks.find(t=>t.id===selectedTrack);
  return state.recordings?.find(r=>r.id===track?.recording_id);
}
function selectObservation(clip,seek=true) {
  if(!clip)return;
  pausePair();selectedTrack=clip.track_key;selectedClip=clip.id;
  if(!seek)sceneSelectionKey=clip.id;
  renderedKey='';renderEvidence();
}
function seekScene(time) {
  const video=$('scene-video'),recording=selectedRecording();
  if(!recording)return;
  video.pause();
  const target=Math.max(0,Math.min(recording.duration-.01,Number(time)||0));
  if(video.readyState>=1)video.currentTime=target;else sceneSeekPending=target;
  selectObservation(clipAtTime(selectedTrack,target),false);
  updateSceneFrame();
}
function renderControlCenter(current,track,analysis) {
  const recording=state.recordings?.find(r=>r.id===current.recording_id);
  if(!recording)return;
  $('command-center').hidden=false;
  const selectionChanged=sceneSelectionKey!==current.id;
  setVideo('scene-video',recording.media_path);
  if(selectionChanged) {
    sceneSelectionKey=current.id;
    const video=$('scene-video');video.pause();
    if(video.readyState>=1)video.currentTime=current.offset+.01;else sceneSeekPending=current.offset+.01;
  }
  const summary=workerReviewSummary(track.id);
  const windows=state.clips.filter(c=>c.track_key===track.id);
  const total=windows.length;
  $('case-title').closest?.('.case-panel')?.classList.toggle('no-pending',!summary.pending);
  $('site-name').textContent=recording.demo?'Warehouse demo':recording.filename;
  $('site-meta').textContent=`${recording.detector_frames||Math.round(recording.duration*recording.fps)} frames · ${recording.fps.toFixed(0)} fps · ${recording.duration.toFixed(1)}s`;
  $('selected-worker-name').textContent=track.worker_id||`Track #${track.track_id}`;
  $('recorded-label').textContent=recording.demo?'RECORDED DEMO':'RECORDED VIDEO';
  $('case-status').className='case-status '+(summary.pending?'review':'neutral');
  $('case-status').textContent=summary.pending?'Check-in suggested':'No pending flags';
  const stale=state.analyses.some(a=>a.track_key===track.id&&a.status==='stale');
  $('case-title').textContent=summary.pending?'Needs your review':stale?'Refresh needed':summary.reports.length?'No pending flags':'Not yet assessed';
  $('case-subtitle').textContent=`${summary.pending} of ${total} windows flagged for human review`;
  const ring=2*Math.PI*40;
  $('review-ring').setAttribute('stroke-dasharray',`${total?summary.pending/total*ring:0} ${ring}`);
  $('review-count').textContent=summary.pending;
  $('case-observation').textContent=analysis?.status==='complete'?shortObservation(analysis.report.human_review_summary,135):'No earlier comparison for this window.';
  $('quick-review').disabled=state.busy||analysis?.status!=='complete'||analysis.reviewed;
  $('quick-review').textContent=analysis?.reviewed?'✓ Window reviewed':'Mark window reviewed';
  $('recording-select').value=recording.id;
  renderWorkers(recording);
  renderSignalTimeline(recording,track);
  ensureTracking(recording.id);
  ensureVision(recording.id);renderVisionControls();renderViewerWindows(recording,track);
  updateSceneFrame();
}
function shortObservation(text,length=100) {
  const sentence=String(text||'').split(/(?<=[.!?])\s+/)[0];
  return sentence.length>length?sentence.slice(0,length-1).replace(/\s+\S*$/,'')+'…':sentence;
}
function renderWorkers(recording) {
  const tracks=state.tracks.filter(t=>t.recording_id===recording.id).sort((a,b)=>workerReviewSummary(b.id).pending-workerReviewSummary(a.id).pending);
  $('worker-count').textContent=`${tracks.length} tracked`;
  const key=JSON.stringify(tracks.map(t=>[t.id,t.worker_id,workerReviewSummary(t.id).pending,t.id===selectedTrack]));
  if($('worker-list').dataset.key===key)return;
  $('worker-list').dataset.key=key;
  $('worker-list').innerHTML=tracks.map(t=>{
    const summary=workerReviewSummary(t.id),clips=state.clips.filter(c=>c.track_key===t.id),last=clips.at(-1);
    const confidence=Math.round((t.mean_confidence||0)*100),coverage=Math.round((t.coverage||0)*100);
    return `<button class="worker-card ${summary.pending?'flagged':''} ${t.id===selectedTrack?'selected':''}" data-worker="${esc(t.id)}" aria-label="Select ${esc(t.worker_id||`Track ${t.track_id}`)}"><div class="worker-card-top"><span class="worker-avatar">${last?`<img src="${media(last.thumbnail_path)}" alt="">`:`#${t.track_id}`}</span><div class="worker-name"><strong>${esc(t.worker_id||`Track #${t.track_id}`)}</strong><small>${t.identity_confirmed?'Confirmed worker':'Identity unconfirmed'}</small></div><span class="worker-status ${summary.pending?'review':''}">${summary.pending?'REVIEW':'TRACKED'}</span></div><div class="worker-metrics"><span>Detection <b>${confidence}%</b></span><span>Observed <b>${coverage}%</b></span></div><svg class="confidence-bar" viewBox="0 0 240 3" aria-hidden="true"><rect width="240" height="3" class="bar-bg"/><rect width="${confidence*2.4}" height="3" class="bar-fill"/></svg><div class="worker-card-foot"><span>${summary.pending?`${summary.pending} windows need review`:'No pending review flags'}</span><span>View →</span></div></button>`;
  }).join('');
  document.querySelectorAll('[data-worker]').forEach(button=>button.addEventListener('click',()=>{
    const summary=workerReviewSummary(button.dataset.worker);
    const flagged=summary.flags.at(-1);
    if(flagged)selectObservation(state.clips.find(c=>c.id===flagged.clip_id));else selectTrack(button.dataset.worker);
  }));
}
function renderSignalTimeline(recording,track) {
  const windows=state.clips.filter(c=>c.track_key===track.id).sort((a,b)=>a.offset-b.offset);
  const tracking=trackingCache.get(recording.id);
  const samples=tracking?.tracks.find(t=>t.id===track.id)?.samples||[];
  const points=samples.filter((s,i)=>i%3===0||i===samples.length-1).map(s=>`${(s.time/recording.duration*1000).toFixed(1)},${(70-s.confidence*52).toFixed(1)}`).join(' ');
  const segments=windows.map(c=>{
    const report=analysisFor(c),status=report?.status!=='complete'||report.report.review_priority==='insufficient_evidence'?'unknown':report.reviewed?'reviewed':report.report.review_priority==='review'?'review':'routine';
    return `<g data-seek="${c.offset}" role="button" tabindex="0" aria-label="Seek to ${windowLabel(c)}, ${status==='review'?'needs review':status}"><rect x="${c.offset/recording.duration*1000}" y="8" width="${Math.max(1,c.duration/recording.duration*1000-2)}" height="70" class="signal-window ${status}"/><rect x="${c.offset/recording.duration*1000}" y="85" width="${Math.max(1,c.duration/recording.duration*1000-2)}" height="6" class="signal-band ${status}"/></g>`;
  }).join('');
  const ticks=Array.from({length:6},(_,i)=>`<text x="${i*200}" y="111" text-anchor="${i===0?'start':i===5?'end':'middle'}">${(recording.duration*i/5).toFixed(0)}s</text>`).join('');
  const key=JSON.stringify([track.id,windows.map(c=>[c.id,analysisFor(c)?.reviewed,analysisFor(c)?.status,analysisFor(c)?.report?.review_priority]),points]);
  if($('signal-chart').dataset.key!==key) {
    $('signal-chart').dataset.key=key;
    $('signal-chart').innerHTML=`<line x1="0" y1="26" x2="1000" y2="26" class="chart-grid"/><line x1="0" y1="55" x2="1000" y2="55" class="chart-grid"/>${segments}${points?`<polyline points="${points}" class="confidence-line"/>`:''}<line id="scene-playhead" x1="0" y1="5" x2="0" y2="95" class="chart-playhead"/>${ticks}`;
  }
}
function updateSceneFrame() {
  const recording=selectedRecording();if(!recording)return;
  const video=$('scene-video'),time=Number(video.currentTime)||0;
  $('scene-clock').textContent=`${time.toFixed(1)}s / ${recording.duration.toFixed(1)}s`;
  const playhead=$('scene-playhead');if(playhead){const x=time/recording.duration*1000;playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);}
  const data=trackingCache.get(recording.id);
  const overlay=$('scene-overlay');
  overlay.setAttribute('viewBox',`0 0 ${recording.width} ${recording.height}`);
  overlay.classList.toggle('hidden-overlay',!trackingVisible);
  if(!data){overlay.innerHTML='';$('tracking-state').textContent='Loading tracking…';return;}
  let visible=0;
  const boxes=data.tracks.map(t=>{
    const sample=sampleAtTime(t.samples,time,data.fps);if(!sample)return '';
    visible++;
    const metadata=state.tracks.find(item=>item.id===t.id)||t;
    const status=trackFrameState(t.id,time),[x1,y1,x2,y2]=sample.bbox;
    const width=x2-x1,height=y2-y1,label=`${metadata.worker_id||`Track #${t.track_id}`} · ${status==='review'?'REVIEW':status==='reviewed'?'REVIEWED':'TRACKED'}`;
    const labelY=Math.max(22,y1-8),labelWidth=Math.min(270,Math.max(150,label.length*8.5)),labelX=Math.max(0,Math.min(x1,recording.width-labelWidth));
    return `<g class="tracked-person ${status} ${t.id===selectedTrack?'active':''}" data-person="${esc(t.id)}" role="button" tabindex="0" aria-label="Select ${esc(metadata.worker_id||`Track ${t.track_id}`)} in video"><rect x="${x1}" y="${y1}" width="${width}" height="${height}" rx="3" class="person-box"/><rect x="${labelX}" y="${labelY-22}" width="${labelWidth}" height="27" rx="3" class="person-label-bg"/><text x="${labelX+8}" y="${labelY-3}" class="person-label">${esc(label)}</text></g>`;
  }).join('');
  overlay.innerHTML=boxes+renderVisionLayers(data,recording,time);
  $('tracking-state').textContent=`${visible} ${visible===1?'person':'people'} visible`;
}
function startOverlayLoop() {
  if(typeof requestAnimationFrame!=='function')return;
  if(overlayFrame)cancelAnimationFrame(overlayFrame);
  const tick=()=>{updateSceneFrame();if(!$('scene-video').paused)overlayFrame=requestAnimationFrame(tick);};
  overlayFrame=requestAnimationFrame(tick);
}
function initializeControlCenter() {
  $('scene-video').addEventListener('loadedmetadata',()=>{
    if(sceneSeekPending!==null){$('scene-video').currentTime=sceneSeekPending;sceneSeekPending=null;}
    updateSceneFrame();
  });
  $('scene-video').addEventListener('play',startOverlayLoop);
  $('scene-video').addEventListener('timeupdate',()=>{
    updateSceneFrame();
    const clip=clipAtTime(selectedTrack,$('scene-video').currentTime);
    if(clip&&clip.id!==selectedClip)selectObservation(clip,false);
  });
  $('scene-video').addEventListener('pause',updateSceneFrame);
  $('scene-video').addEventListener('seeked',updateSceneFrame);
  $('tracking-toggle').addEventListener('click',()=>{
    trackingVisible=!trackingVisible;$('tracking-toggle').setAttribute('aria-pressed',String(trackingVisible));
    $('tracking-toggle').textContent=trackingVisible?'Tracking on':'Tracking off';updateSceneFrame();
  });
  $('signal-chart').addEventListener('click',event=>{const segment=event.target.closest('[data-seek]');if(segment)seekScene(segment.dataset.seek);});
  $('signal-chart').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const segment=event.target.closest('[data-seek]');if(segment){event.preventDefault();seekScene(segment.dataset.seek);}}});
  $('scene-overlay').addEventListener('click',event=>{
    const person=event.target.closest('[data-person]');if(!person)return;
    const time=$('scene-video').currentTime;
    selectObservation(clipAtTime(person.dataset.person,time),false);
  });
  $('scene-overlay').addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const person=event.target.closest('[data-person]');if(!person)return;
    event.preventDefault();selectObservation(clipAtTime(person.dataset.person,$('scene-video').currentTime),false);
  });
  $('recording-select').addEventListener('change',event=>{const track=state.tracks.find(t=>t.recording_id===event.target.value);if(track){selectTrack(track.id);renderOverview();}});
  $('jump-evidence').addEventListener('click',()=>$('supporting-evidence').scrollIntoView({behavior:'smooth',block:'start'}));
  $('quick-review').addEventListener('click',()=>$('review-save').click());
}
