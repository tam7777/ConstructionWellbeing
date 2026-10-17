// Run with Node 20+; exercises the actual dashboard logic without controlling a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    dataset:{},className:'',value:'',hidden:false,innerHTML:'',textContent:'',
    addEventListener(){},classList:{toggle(){}},
    attributes:{},paused:true,currentTime:0,duration:5,readyState:4,
    pause(){this.paused=true;},async play(){this.paused=false;},load(){},
    getAttribute(name){return this.attributes[name] ?? null;},
    setAttribute(name,value){this.attributes[name]=value;},
    removeAttribute(name){delete this.attributes[name];},
  });
  return elements.get(id);
}
const context = vm.createContext({
  document:{getElementById:element,querySelectorAll:()=>[]},
  fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},clearTimeout(){},
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/control-center.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/vision.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/overview.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/catalog.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/workspace.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/app.js'),'utf8'),context);
vm.runInContext(`
  state.analyses=[
    {track_key:'a',status:'complete',reviewed:false,report:{review_priority:'review'}},
    {track_key:'a',status:'complete',reviewed:true,report:{review_priority:'review'}},
    {track_key:'a',status:'stale',reviewed:false,report:{review_priority:'review'}},
    {track_key:'b',status:'complete',reviewed:false,report:{review_priority:'review'}}
  ];
`,context);
assert.equal(vm.runInContext("workerReviewSummary('a').pending",context),1,'Only current unreviewed observations count toward a worker flag');
assert.equal(vm.runInContext("workerReviewSummary('missing').pending",context),0);
vm.runInContext(`
  frameSamples=[{time:0,bbox:[10,20,40,80]},{time:.1,bbox:[12,20,42,80]},{time:2,bbox:[30,20,60,80]}];
`,context);
assert.equal(vm.runInContext('sampleAtTime(frameSamples,.08,30).bbox[0]',context),12);
assert.equal(vm.runInContext('sampleAtTime(frameSamples,1,30)',context),null,'A detection gap must not fabricate a tracking box');
vm.runInContext(`
  state={tracks:[{id:'t',recording_id:'r',task:'walking'}],
    clips:[{id:'c',track_key:'t',track_id:1,recording_id:'r',offset:5,duration:5,started_at:5,
            task:'walking',window_coverage:1,demo:true,media_path:'c.mp4',context_path:'scene.mp4'}],
    analyses:[],busy:true};
  selectedTrack='t'; selectedClip='c'; renderEvidence(); state.busy=false; renderEvidence();
`,context);
assert.equal(element('identity-save').disabled,false,'Identity confirmation must unlock when processing finishes');
assert.equal(element('review-save').disabled,false,'Human review must unlock when processing finishes');
vm.runInContext(`
  state.clips.push({...state.clips[0],id:'ref',started_at:0});
  state.analyses=[{clip_id:'c',status:'stale',reference_id:'ref',reference_candidates:[{clip_id:'ref'}]}];
  renderedKey='';renderEvidence();
`,context);
assert.equal(element('reference-video').hidden,true,'Invalidated identity mappings must not keep showing the old match');
assert.equal(element('matches-section').hidden,true,'Invalidated candidates must stay hidden until recomputed');
vm.runInContext(`
  state={recordings:[],tracks:[{id:'old',recording_id:'r1'},{id:'new',recording_id:'r2'}],
         clips:[],analyses:[],busy:false,jobs:[{id:'job2',status:'completed',stage:'Ready',
         progress:100,events:[],result:{recording_id:'r2'}}]};
  selectedTrack='old'; completedJob='job1'; renderPipeline();
`,context);
assert.equal(vm.runInContext('selectedTrack',context),'new', 'Completed recording must open its own track, not the previously selected recording');
vm.runInContext(`
  state.tracks.push({id:'second',recording_id:'r2'});
  state.jobs=[{id:'job3',status:'completed',stage:'Ready',progress:100,events:[],
               result:{recording_id:'r2',track_key:'second'}}];
  selectedTrack='second'; renderPipeline();
`,context);
assert.equal(vm.runInContext('selectedTrack',context),'second','Recomparison must preserve the selected person when multiple tracks share a recording');
console.log('Dashboard regressions: controls unlock, new recording opens, reanalysis selects correct person — passed');
vm.runInContext(`
  state.clips=[{id:'now',track_key:'t',offset:3,duration:3,started_at:3,capture_time_known:false,worker_id:'a',task:'construction',identity_confirmed:true},
    {id:'other-session',track_key:'other',offset:0,duration:3,started_at:0,capture_time_known:false,worker_id:'a',task:'construction',identity_confirmed:true}];
  renderTimeline(state.clips[0],{id:'t',worker_id:'a',identity_confirmed:true});
`,context);
assert.equal(element('history-count').textContent,1,'Undated recordings must not merge into one worker chronology');
vm.runInContext(`
  renderOverviewChart({duration:9,window_seconds:3},[{id:'a'},{id:'b'}],[
    {id:'a1',track_key:'a',offset:0,duration:3},{id:'a2',track_key:'a',offset:3,duration:3},{id:'a3',track_key:'a',offset:6,duration:3},
    {id:'b1',track_key:'b',offset:.1,duration:3},{id:'b2',track_key:'b',offset:3.1,duration:3},{id:'b3',track_key:'b',offset:6.1,duration:2.9}]);
`,context);
assert.equal((element('overview-chart').innerHTML.match(/text-anchor="middle"/g)||[]).length,3,'Multiple workers must share readable time bins rather than duplicate near-identical timestamps');

async function checkPairedPlayback() {
  const earlier=element('reference-video'),current=element('current-video');
  earlier.hidden=false; element('pair-scrub').value=0;
  await vm.runInContext('playPair()',context);
  assert.equal(earlier.paused,false);
  assert.equal(current.paused,false);
  vm.runInContext('seekPair(3)',context);
  assert.equal(earlier.currentTime,3);
  assert.equal(current.currentTime,3);
  earlier.duration=2.5;
  vm.runInContext('seekPair(20)',context);
  assert.equal(earlier.currentTime,2.5,'Shared seeking must stop at the shorter clip');
  assert.equal(current.currentTime,2.5);
  vm.runInContext('pausePair()',context);
  assert.equal(earlier.paused,true);
  assert.equal(current.paused,true);
  current.play=async()=>{throw new Error('Playback unavailable');};
  await assert.rejects(vm.runInContext('playPair()',context));
  assert.equal(earlier.paused,true,'A failed video must not leave the other playing');
  assert.equal(current.paused,true);
  console.log('Paired playback: shared play, pause, seek, duration clamp and failure handling passed');
  vm.runInContext(`trackingCache.clear();state={recordings:[{id:'r',status:'processing'}],tracks:[{id:'a',recording_id:'r'}],clips:[],analyses:[]};`,context);
  let requests=0;
  context.fetch=async()=>({ok:true,json:async()=>{requests++;return {recording_id:'r',tracks:requests===1?[{id:'a'}]:[{id:'a'},{id:'b'}]};}});
  await vm.runInContext("ensureTracking('r')",context);
  vm.runInContext("state.tracks.push({id:'b',recording_id:'r'});",context);
  await vm.runInContext("ensureTracking('r')",context);
  assert.equal(requests,2,'Newly indexed workers must refresh cached tracking data');
  vm.runInContext("state.recordings[0].status='ready'",context);
  await vm.runInContext("ensureTracking('r')",context);
  assert.equal(requests,3,'Finishing processing must refresh the final tracking snapshot');
  console.log('Tracking cache refresh after new workers and job completion: passed');
  vm.runInContext(`visionCache.clear();visionPending.clear();state={recordings:[{id:'r',status:'ready'}],tracks:[{id:'a',recording_id:'r'}],clips:[],analyses:[],jobs:[{id:'import',label:'Dataset · source.mp4',recording_id:'r',status:'running'}]};`,context);
  let poseRequests=0;
  context.fetch=async()=>({ok:true,json:async()=>({recording_id:'r',status:++poseRequests===1?'processing':'ready',tracks:[]})});
  await vm.runInContext("ensureVision('r')",context);
  vm.runInContext("state.jobs[0].status='completed'",context);
  await vm.runInContext("ensureVision('r')",context);
  assert.equal(poseRequests,2,'Automatic pose completion during a normal import must refresh a cached processing artifact');
  console.log('Pose cache refresh after normal ingestion finishes: passed');
  vm.runInContext('visionCache.clear()',context);
  let poseRetryRequests=0;
  context.fetch=async()=>{if(++poseRetryRequests===1)throw new Error('Temporary connection failure');return {ok:true,json:async()=>({recording_id:'r',status:'ready',tracks:[]})};};
  await vm.runInContext("ensureVision('r')",context);
  await vm.runInContext("ensureVision('r')",context);
  assert.equal(poseRetryRequests,2,'A transient pose fetch failure must retry without a page reload');
  console.log('Pose fetch recovers after a transient connection failure: passed');
}
checkPairedPlayback().catch(error=>{console.error(error);process.exitCode=1;});
