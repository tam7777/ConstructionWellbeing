'use strict';
const visionCache=new Map(),visionPending=new Set();
let sceneMode='annotated',trailsVisible=false;
const poseEdges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
const poseJoints=[0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];

function visibleJoint(point,threshold=.55) {
  return Array.isArray(point)&&point.length>=3&&Number.isFinite(point[0])&&Number.isFinite(point[1])&&Number.isFinite(point[2])&&point[2]>=threshold;
}
function visionVersion(recordingId) {
  const r=state.recordings?.find(r=>r.id===recordingId);
  return JSON.stringify([trackingVersion(recordingId),r?.visuals_status,r?.visuals_updated_at,r?.pose_status,
    state.jobs?.filter(j=>j.recording_id===recordingId||j.result?.recording_id===recordingId).map(j=>[j.id,j.status])]);
}
async function ensureVision(recordingId) {
  const version=visionVersion(recordingId);
  if(visionCache.get(recordingId)?._version===version||visionPending.has(recordingId))return;
  visionPending.add(recordingId);
  try {
    const value=await api(`/api/recordings/${encodeURIComponent(recordingId)}/visuals`);
    visionCache.set(recordingId,{...value,_version:version});
    renderVisionControls();updateSceneFrame();
  } catch(error) {
    // A transient service failure must be retried by the next dashboard poll.
    visionCache.delete(recordingId);renderVisionControls();
  } finally {visionPending.delete(recordingId);}
}
function renderPoseMarkup(sample,selected,threshold=.55) {
  if(!sample?.keypoints)return '';
  const points=sample.keypoints,color=selected?'#e1a13c':'#35e5ad';
  const edges=poseEdges.filter(([a,b])=>visibleJoint(points[a],threshold)&&visibleJoint(points[b],threshold)).map(([a,b])=>`<line x1="${points[a][0]}" y1="${points[a][1]}" x2="${points[b][0]}" y2="${points[b][1]}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`).join('');
  const joints=poseJoints.filter(i=>visibleJoint(points[i],threshold)).map(i=>`<circle cx="${points[i][0]}" cy="${points[i][1]}" r="4" fill="#f4fff9" stroke="${color}" stroke-width="2"/>`).join('');
  return `<g class="pose-person">${edges}${joints}</g>`;
}
function trailSamples(samples,time,horizon=2.5) {
  if(!sampleAtTime(samples,time,30))return [];
  const current=samples.filter(s=>s.time<=time+.001&&s.time>=time-horizon);
  const lastGap=current.findLastIndex((s,i)=>i>0&&s.time-current[i-1].time>.2);
  return current.slice(Math.max(0,lastGap)).filter((s,i,array)=>i%3===0||i===array.length-1);
}
function renderVisionLayers(data,recording,time) {
  if(sceneMode==='raw')return '';
  const pose=visionCache.get(recording.id);
  const skeletons=pose?.status==='ready'?pose.tracks.map(t=>{
    // A pose is drawn only while this ByteTrack track is actually detected.
    const boxes=data.tracks.find(item=>item.id===t.id);
    if(!boxes||!sampleAtTime(boxes.samples,time,data.fps))return '';
    const sample=sampleAtTime(t.samples,time,pose.fps||6);
    return renderPoseMarkup(sample,t.id===selectedTrack,pose.joint_threshold||.55);
  }).join(''):'';
  const trails=trailsVisible?data.tracks.map(t=>{
    const samples=trailSamples(t.samples,time);
    if(samples.length<2)return '';
    const points=samples.map(s=>`${(s.bbox[0]+s.bbox[2])/2},${s.bbox[3]}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${t.id===selectedTrack?'#e1a13c':'#31a8bd'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
  }).join(''):'';
  return `<g class="motion-trails">${trails}</g><g class="pose-layer">${skeletons}</g>`;
}
function hasPose(pose) { return pose?.status==='ready'&&pose.tracks?.some(t=>t.samples?.length); }
function setSceneMode(mode) {
  if(mode==='skeleton'&&!hasPose(visionCache.get(selectedRecording()?.id)))return;
  sceneMode=mode;trackingVisible=mode!=='raw';
  const stage=$('scene-stage');if(stage)stage.dataset.mode=mode;
  $('tracking-toggle').setAttribute('aria-pressed',String(trackingVisible));
  renderVisionControls();updateSceneFrame();
}
function renderVisionControls() {
  const recording=selectedRecording(),pose=visionCache.get(recording?.id);
  if(sceneMode==='skeleton'&&!hasPose(pose)){sceneMode='annotated';trackingVisible=true;}
  if($('scene-stage'))$('scene-stage').dataset.mode=sceneMode;
  for(const mode of ['annotated','raw','skeleton']) {
    const button=$('cv-'+mode);if(!button)continue;
    button.classList.toggle('active',sceneMode===mode);
    button.setAttribute('aria-pressed',String(sceneMode===mode));
    if(mode==='skeleton')button.disabled=!hasPose(pose);
  }
  if($('pose-state'))$('pose-state').textContent=hasPose(pose)?'OpenCV pose':'Person tracking';
  if($('cv-trails'))$('cv-trails').setAttribute('aria-pressed',String(trailsVisible));
  updateSceneControls();
}
function updateSceneControls() {
  const video=$('scene-video');if(!video)return;
  const duration=Number.isFinite(video.duration)?video.duration:(selectedRecording()?.duration||0);
  if($('scene-play')){$('scene-play').textContent=video.paused?'▶':'Ⅱ';$('scene-play').setAttribute('aria-label',video.paused?'Play recording':'Pause recording');}
  if($('scene-scrub')){$('scene-scrub').max=duration||1;$('scene-scrub').value=Number(video.currentTime)||0;}
  if($('scene-time'))$('scene-time').textContent=`${(video.currentTime||0).toFixed(1)} / ${duration.toFixed(1)}s`;
  if($('frame-counter'))$('frame-counter').textContent=`F${Math.round((video.currentTime||0)*(selectedRecording()?.fps||30))}`;
}
async function toggleScenePlayback() {
  const video=$('scene-video');if(video.paused){try {await video.play();}catch {toast('Use the player controls to start playback.',true);}}else video.pause();
  updateSceneControls();
}
function renderViewerWindows(recording,track) {
  if(!$('viewer-windows'))return;
  const clips=state.clips.filter(c=>c.track_key===track.id).sort((a,b)=>a.offset-b.offset);
  const key=JSON.stringify([track.id,selectedClip,clips.map(c=>[c.id,analysisFor(c)?.status,analysisFor(c)?.reviewed,analysisFor(c)?.report?.review_priority])]);
  if($('viewer-windows').dataset.key===key)return;
  $('viewer-windows').dataset.key=key;
  $('viewer-windows').innerHTML=clips.map(c=>{
    const a=analysisFor(c),flag=a?.status==='complete'&&!a.reviewed&&a.report.review_priority==='review';
    return `<button class="viewer-window ${flag?'flagged':''} ${c.id===selectedClip?'active':''}" data-window="${esc(c.id)}" aria-label="Jump to ${windowLabel(c)}${flag?', flagged':''}">${flag?'● ':''}${windowLabel(c)}</button>`;
  }).join('');
  document.querySelectorAll('[data-window]').forEach(b=>b.addEventListener('click',()=>{const clip=state.clips.find(c=>c.id===b.dataset.window);if(clip)seekScene(clip.offset+.01);}));
}
async function saveAnnotatedFrame() {
  const video=$('scene-video'),recording=selectedRecording();
  if(!recording||video.readyState<2){toast('Wait for the video frame to load.');return;}
  const canvas=document.createElement('canvas');canvas.width=recording.width;canvas.height=recording.height;
  const context=canvas.getContext('2d');
  if(sceneMode==='skeleton'){context.fillStyle='#111b24';context.fillRect(0,0,canvas.width,canvas.height);}else context.drawImage(video,0,0,canvas.width,canvas.height);
  if(sceneMode!=='raw') {
    const svg=$('scene-overlay').cloneNode(true);
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',canvas.width);svg.setAttribute('height',canvas.height);
    const styles=document.createElementNS('http://www.w3.org/2000/svg','style');
    styles.textContent='.person-box{fill:none;stroke:#35d9a7;stroke-width:3}.person-label-bg{fill:#17392d}.person-label{fill:white;font:14px Arial}.tracked-person.review .person-box,.tracked-person.active .person-box{stroke:#e1a13c}.tracked-person.review .person-label-bg{fill:#8a6028}';
    if(sceneMode==='skeleton')styles.textContent+='.tracked-person{display:none}';
    svg.prepend(styles);
    const picture=new Image();
    await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=reject;picture.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));});
    context.drawImage(picture,0,0);
  }
  canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`worksight-${recording.id.slice(0,6)}-${video.currentTime.toFixed(1)}s.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
}
function initializeVision() {
  for(const mode of ['annotated','raw','skeleton'])$('cv-'+mode).addEventListener('click',()=>setSceneMode(mode));
  $('cv-trails').addEventListener('click',()=>{trailsVisible=!trailsVisible;renderVisionControls();updateSceneFrame();});
  $('scene-play').addEventListener('click',toggleScenePlayback);
  $('scene-scrub').addEventListener('input',()=>{const video=$('scene-video');if(video.readyState>=1)video.currentTime=Number($('scene-scrub').value);updateSceneControls();});
  $('scene-speed').addEventListener('change',()=>{$('scene-video').playbackRate=Number($('scene-speed').value);});
  $('scene-prev-frame').addEventListener('click',()=>seekScene($('scene-video').currentTime-1/(selectedRecording()?.fps||30)));
  $('scene-next-frame').addEventListener('click',()=>seekScene($('scene-video').currentTime+1/(selectedRecording()?.fps||30)));
  $('scene-fullscreen').addEventListener('click',()=>{const target=$('scene-panel');if(document.fullscreenElement)document.exitFullscreen();else target.requestFullscreen?.();});
  $('scene-snapshot').addEventListener('click',()=>action(saveAnnotatedFrame));
  for(const event of ['timeupdate','loadedmetadata','play','pause','ended','seeked'])$('scene-video').addEventListener(event,updateSceneControls);
  $('scene-video').controls=false;
}
