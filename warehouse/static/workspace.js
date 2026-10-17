'use strict';
function renderExploreFootage() {
  const target=$('overview-footage');if(!target)return;
  const items=buildCatalogItems(libraryVideos,state).slice(0,4);
  const key=JSON.stringify([items,state.busy]);if(target.dataset.key===key)return;
  target.dataset.key=key;target.innerHTML=items.map(item=>catalogCard(item,state.busy)).join('');
  $('nav-clip-count').textContent=buildCatalogItems(libraryVideos,state).length;
}
function initializeWorkspace() {
  const browse=()=>showWorkspace('clips');
  $('nav-clips').addEventListener('click',browse);
  $('browse-footage').addEventListener('click',browse);
  $('overview-all-clips').addEventListener('click',browse);
  $('nav-search').addEventListener('click',()=>{browse();focusCatalogSearch();});
  $('nav-analyse').addEventListener('click',()=>$('upload-open').click());
  $('catalog-upload').addEventListener('click',()=>$('upload-open').click());
  $('nav-models').addEventListener('click',()=>{showWorkspace('detail');$('details-panel').open=true;$('services').scrollIntoView({behavior:'smooth',block:'center'});});
  $('overview-footage').addEventListener('click',event=>{
    const button=event.target.closest('[data-catalog-action]');if(!button)return;
    const item=buildCatalogItems(libraryVideos,state).find(item=>item.key===button.dataset.catalogKey);if(!item)return;
    if(button.dataset.catalogAction==='preview')openCatalogPreview(item);else activateCatalogItem(item);
  });
  document.addEventListener?.('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable],dialog'))return;
    if(event.key==='/'){event.preventDefault();browse();focusCatalogSearch();return;}
    if(workspaceView!=='detail'||event.target.closest('button'))return;
    if(event.key===' '){event.preventDefault();toggleScenePlayback();}
    if(event.key==='ArrowLeft'){event.preventDefault();seekScene($('scene-video').currentTime-1);}
    if(event.key==='ArrowRight'){event.preventDefault();seekScene($('scene-video').currentTime+1);}
  });
}
