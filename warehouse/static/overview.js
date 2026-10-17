'use strict';
let workspaceView='overview';
let libraryVideos=[];
function renderLibrary() {
  if(!$('library-select').dataset.chosen&&selectedRecording()?.library_id)$('library-select').value=selectedRecording().library_id;
  $('library-analyse').disabled=!!state.busy||!libraryVideos.length;
  const selected=libraryVideos.find(v=>v.id===$('library-select').value);
  const indexed=selected&&state.recordings.some(r=>r.library_id===selected.id&&r.status==='ready');
  $('library-analyse').textContent=indexed?'Open recording →':'Analyse video →';
}
async function loadLibrary() {
  try {
    libraryVideos=(await api('/api/library')).videos;
    $('library-count').textContent=`${libraryVideos.length} videos on VM`;
    $('library-select').innerHTML=['Construction','Factory'].map(collection=>`<optgroup label="${collection} · ${libraryVideos.filter(v=>v.collection===collection).length} videos">${libraryVideos.filter(v=>v.collection===collection).map(v=>`<option value="${esc(v.id)}">${esc(v.group)} / ${esc(v.filename)}${v.duration?` · ${v.duration.toFixed(0)}s`:''}</option>`).join('')}</optgroup>`).join('');
    renderLibrary();
  } catch(error) {$('library-count').textContent='Library unavailable';}
}
function showWorkspace(view) {
  workspaceView=view;
  $('overview-page').hidden=view!=='overview';$('review-page').hidden=view!=='detail';
  $('catalog-page').hidden=view!=='clips';
  if(document.body)document.body.dataset.view=view;
  $('nav-overview').classList.toggle('active',view==='overview');
  $('nav-worker').classList.toggle('active',view==='detail');
  $('nav-clips').classList.toggle('active',view==='clips');
  if(view!=='detail'){$('scene-video').pause();pausePair();if(view==='overview')renderOverview();else renderCatalog();}
  else updateSceneFrame();
  if(typeof window!=='undefined')window.scrollTo({top:0,behavior:'instant'});
}
function openWorker(trackKey,clipId) {
  const summary=workerReviewSummary(trackKey);
  const flagged=summary.flags.at(-1);
  const clip=state.clips.find(c=>c.id===(clipId||flagged?.clip_id));
  if(clip)selectObservation(clip);else selectTrack(trackKey);
  showWorkspace('detail');
}
function renderOverview() {
  renderLibrary();
  if(typeof renderCatalog==='function')renderCatalog();
  if(typeof renderExploreFootage==='function')renderExploreFootage();
  const recording=selectedRecording()||state.recordings?.at(-1);
  $('header-recording-kind').textContent=recording?.demo?'● RECORDED DEMO':'● RECORDED FOOTAGE';
  const tracks=state.tracks.filter(t=>t.recording_id===recording?.id).sort((a,b)=>workerReviewSummary(b.id).pending-workerReviewSummary(a.id).pending);
  const keys=new Set(tracks.map(t=>t.id));
  const clips=state.clips.filter(c=>keys.has(c.track_key));
  const reports=state.analyses.filter(a=>keys.has(a.track_key)&&a.status==='complete');
  const flags=reports.filter(a=>!a.reviewed&&a.report.review_priority==='review').sort((a,b)=>b.created_at-a.created_at);
  const needing=new Set(flags.map(a=>a.track_key)).size,reviewed=reports.filter(a=>a.reviewed).length;
  const metrics=[['attention','△',needing,'Workers needing a check-in'],['pending','◷',flags.length,'Flagged windows to review'],['reviewed','✓',reviewed,'Windows reviewed'],['total','♙',tracks.length,'Workers tracked in this recording']];
  $('overview-metrics').innerHTML=metrics.map(([kind,icon,value,label])=>`<div class="overview-metric ${kind}"><span class="metric-symbol">${icon}</span><div><div class="metric-number">${value}</div><div class="metric-label">${label}</div></div></div>`).join('');
  $('overview-alert-count').textContent=flags.length;
  $('overview-period').textContent=recording?`${recording.duration.toFixed(0)}s · recorded footage`:'No footage yet';
  $('overview-scope').textContent=recording?.demo?'Simulated demo · one recording':recording?.source_kind==='dataset'?'Dataset footage · capture date unavailable':'Worker identities require confirmation';
  const optionsKey=JSON.stringify(state.recordings?.map(r=>[r.id,r.filename]));
  if($('recording-select').dataset.key!==optionsKey) {
    $('recording-select').dataset.key=optionsKey;
    $('recording-select').innerHTML=state.recordings?.length?state.recordings.map(r=>`<option value="${esc(r.id)}">${esc(r.demo?'Warehouse demo':r.filename)}</option>`).join(''):'<option>No recordings</option>';
  }
  if(recording)$('recording-select').value=recording.id;
  $('overview-alerts').innerHTML=flags.length?flags.slice(0,4).map(a=>{
    const track=tracks.find(t=>t.id===a.track_key),clip=clips.find(c=>c.id===a.clip_id);
    return `<button class="overview-alert-item" data-open-track="${esc(a.track_key)}" data-open-clip="${esc(a.clip_id)}"><span class="overview-avatar">${clip?`<img src="${media(clip.thumbnail_path)}" alt="">`:''}</span><span class="overview-alert-copy"><strong>${esc(track?.worker_id||`Track #${track?.track_id}`)}</strong><p>${esc(shortObservation(a.report.human_review_summary,70))}</p></span><span class="overview-alert-time">${clip?windowLabel(clip):''}</span><span class="status-pill review">Review</span><span>›</span></button>`;
  }).join(''):'<div class="overview-empty">No pending review flags</div>';
  $('overview-worker-rows').innerHTML=tracks.length?tracks.map(t=>{
    const summary=workerReviewSummary(t.id),windows=clips.filter(c=>c.track_key===t.id).sort((a,b)=>a.offset-b.offset),last=windows.at(-1);
    const bars=windows.map((c,i)=>{
      const a=analysisFor(c),flag=a?.status==='complete'&&!a.reviewed&&a.report.review_priority==='review';
      const color=flag?'#e3ac58':a?.status==='complete'?'#73bfae':'#ccd5e1',height=flag?22:a?.status==='complete'?13:6;
      return `<rect x="${i*100/windows.length+2}" y="${26-height}" width="${Math.max(2,100/windows.length-5)}" height="${height}" rx="2" fill="${color}"/>`;
    }).join('');
    return `<tr><td><span class="table-worker"><span class="overview-avatar">${last?`<img src="${media(last.thumbnail_path)}" alt="">`:''}</span><span><strong>${esc(t.worker_id||`Track #${t.track_id}`)}</strong><small>${t.identity_confirmed?'Confirmed identity':'Identity unconfirmed'}</small></span></span></td><td><span class="status-pill ${summary.pending?'review':summary.reviewed?'reviewed':''}">${summary.pending?'Needs review':summary.reviewed?'Reviewed':'Tracked'}</span><small>${summary.pending} pending windows</small></td><td><svg class="history-spark" viewBox="0 0 100 28" aria-label="Review status across ${windows.length} observation windows">${bars}</svg></td><td>${Math.round((t.coverage||0)*100)}%</td><td>${(t.end||0).toFixed(1)}s<small>Recording time</small></td><td><button class="button secondary" data-open-track="${esc(t.id)}">View worker →</button></td></tr>`;
  }).join(''):'<tr><td colspan="6" class="overview-empty">Upload footage or open the warehouse demo to begin.</td></tr>';
  document.querySelectorAll('[data-open-track]').forEach(button=>button.addEventListener('click',()=>openWorker(button.dataset.openTrack,button.dataset.openClip)));
  renderOverviewChart(recording,tracks,clips);
}
function renderOverviewChart(recording,tracks,clips) {
  if(!recording||!clips.length){$('overview-chart').innerHTML='<div class="overview-empty">Review activity will appear here</div>';return;}
  const bin=recording.window_seconds||5;
  const offsets=Array.from({length:Math.max(1,Math.ceil((recording.duration-1.5+.001)/bin))},(_,i)=>i*bin);
  const max=Math.max(1,tracks.length),width=500,height=150,step=width/offsets.length;
  const grid=[0,.5,1].map(r=>`<line x1="35" y1="${20+(1-r)*height}" x2="550" y2="${20+(1-r)*height}" class="axis-line"/><text x="24" y="${24+(1-r)*height}" text-anchor="end">${Number((max*r).toFixed(1))}</text>`).join('');
  const bars=offsets.map((time,i)=>{
    const counts={review:0,routine:0,unknown:0};
    const end=i===offsets.length-1?recording.duration:Math.min(recording.duration,time+bin);
    const midpoint=(time+end)/2;
    for(const track of tracks){const clip=clips.find(c=>c.track_key===track.id&&midpoint>=c.offset&&midpoint<c.offset+c.duration);if(!clip)continue;const a=analysisFor(clip);counts[a?.status!=='complete'||a.report.review_priority==='insufficient_evidence'?'unknown':!a.reviewed&&a.report.review_priority==='review'?'review':'routine']++;}
    let y=170;
    const stacks=['routine','unknown','review'].map(status=>{const h=counts[status]/max*height;y-=h;return `<rect x="${45+i*step}" y="${y}" width="${Math.min(60,step-18)}" height="${h}" rx="2" fill="${{review:'#e6ae5b',routine:'#76c3af',unknown:'#ccd5e1'}[status]}"/>`;}).join('');
    return `${stacks}<text x="${45+i*step+Math.min(60,step-18)/2}" y="192" text-anchor="middle">${time.toFixed(0)}–${end.toFixed(end%1?1:0)}s</text>`;
  }).join('');
  $('overview-chart').innerHTML=`<svg viewBox="0 0 570 210" role="img" aria-label="Worker review states across the recorded footage">${grid}${bars}<text x="40" y="209">Workers in each observation window</text></svg>`;
}
function initializeOverview() {
  $('library-select').addEventListener('change',()=>{$('library-select').dataset.chosen='true';renderLibrary();});
  $('library-analyse').addEventListener('click',()=>action(async()=>{
    const id=$('library-select').value;
    const existing=state.recordings.find(r=>r.library_id===id&&r.status==='ready');
    const track=existing&&state.tracks.find(t=>t.recording_id===existing.id);
    if(track){selectTrack(track.id);renderOverview();return;}
    await post(`/api/library/${encodeURIComponent(id)}/analyse`);
    toast('Analysing the selected VM video…');
  }));
  loadLibrary();
  $('nav-overview').addEventListener('click',()=>showWorkspace('overview'));
  $('nav-worker').addEventListener('click',()=>showWorkspace('detail'));
  $('back-overview').addEventListener('click',()=>showWorkspace('overview'));
  showWorkspace('overview');
}
