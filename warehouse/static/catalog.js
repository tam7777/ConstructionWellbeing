'use strict';

// Every status and count is scoped to this recording's saved observations.
function catalogTitle(filename) {
  return String(filename || 'Untitled recording').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function catalogDuration(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  const seconds = Math.round(Number(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function buildCatalogItems(videos, snapshot) {
  const recordings = snapshot.recordings || [], tracks = snapshot.tracks || [], analyses = snapshot.analyses || [], jobs = snapshot.jobs || [];
  function itemFor(video, recording) {
    const recordingTracks = recording ? tracks.filter(track => track.recording_id === recording.id) : [];
    const trackIds = new Set(recordingTracks.map(track => track.id));
    const reports = analyses.filter(report => trackIds.has(report.track_key) && report.status === 'complete');
    const flags = reports.filter(report => !report.reviewed && report.report?.review_priority === 'review');
    const latestJob = [...jobs].reverse().find(job =>
      (recording && (job.recording_id === recording.id || job.result?.recording_id === recording.id)) ||
      (video && (job.library_id === video.id || (job.label === `Dataset · ${video.filename}` && (videos || []).filter(source => source.filename === video.filename).length === 1))));
    const processing = recording?.status === 'processing' || ['queued', 'running'].includes(latestJob?.status);
    const analysed = ['ready', 'no_usable_tracks'].includes(recording?.status);
    const failed = !analysed && (recording?.status === 'failed' || latestJob?.status === 'failed');
    const status = processing ? 'processing' : failed ? 'failed' : flags.length ? 'pending' : analysed ? 'analysed' : 'unanalysed';
    const flag = flags[flags.length - 1];
    const track = recordingTracks.find(track => track.id === flag?.track_key) || recordingTracks[0];
    const clip = recording && (snapshot.clips || []).find(clip => clip.recording_id === recording.id || trackIds.has(clip.track_key));
    const filename = video?.filename || recording?.filename || 'Recording';
    return {
      key: video ? `library:${video.id}` : `recording:${recording.id}`,
      libraryId: video?.id || recording?.library_id || null, recordingId: recording?.id || null,
      filename, title: recording?.demo ? 'Warehouse demo' : catalogTitle(filename),
      collection: video?.collection || (recording?.demo ? 'Demo' : recording?.location || 'Uploaded'),
      group: video?.group || (recording?.demo ? 'Simulated warehouse footage' : 'Uploaded footage'),
      duration: video?.duration || recording?.duration || null,
      status, analysed, reviewed: reports.some(report => report.reviewed) && !flags.length,
      workerCount: recordingTracks.length, flagCount: flags.length,
      trackKey: track?.id || null, clipId: flag?.clip_id || null,
      mediaPath: recording?.media_path || null, thumbnailPath: clip?.thumbnail_path || null,
      progress: processing ? latestJob?.progress : null,
      noTracks: recording?.status === 'no_usable_tracks'
    };
  }
  const items = (videos || []).map(video => {
    const candidates = recordings.filter(recording => recording.library_id === video.id);
    const recording = candidates.find(recording => recording.status === 'ready') || candidates[candidates.length - 1];
    return itemFor(video, recording);
  });
  const libraryIds = new Set((videos || []).map(video => video.id));
  recordings.filter(recording => !recording.library_id || !libraryIds.has(recording.library_id)).forEach(recording => items.push(itemFor(null, recording)));
  const order = {pending: 0, processing: 1, analysed: 2, failed: 3, unanalysed: 4};
  return items.sort((a, b) => order[a.status] - order[b.status]);
}
function filterCatalogItems(items, options = {}) {
  const query = String(options.search || '').trim().toLocaleLowerCase();
  return items.filter(item => {
    const matchesStatus = !options.status || options.status === 'all' ||
      (options.status === 'needs-review' && item.status === 'pending') ||
      (options.status === 'reviewed' && item.reviewed) ||
      (options.status === 'not-analysed' && !item.analysed);
    const matchesCollection = !options.collection || options.collection === 'all' || item.collection === options.collection;
    const matchesSearch = !query || `${item.title} ${item.filename} ${item.collection} ${item.group}`.toLocaleLowerCase().includes(query);
    return matchesStatus && matchesCollection && matchesSearch;
  });
}

const catalogView = {status: 'all', collection: 'all', search: '', limit: 24, gridKey: '', items: [], previewKey: null};
const catalogLabels = {pending: 'Pending review', analysed: 'Analysed', unanalysed: 'Not analysed', processing: 'Processing', failed: 'Failed'};

function catalogEscape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function catalogSource(item) { return item.mediaPath ? media(item.mediaPath) : `/api/library/${encodeURIComponent(item.libraryId)}/video`; }
function catalogThumbnail(item) { return item.libraryId ? `/api/library/${encodeURIComponent(item.libraryId)}/thumbnail` : item.thumbnailPath ? media(item.thumbnailPath) : ''; }
function catalogPrimaryLabel(item) {
  return item.status === 'processing' ? 'Processing…' : item.analysed ? (item.trackKey ? 'Open analysis' : 'View recording') : item.status === 'failed' ? 'Retry analysis' : 'Analyse video';
}
function catalogCard(item, busy) {
  const escape = catalogEscape, thumbnail = catalogThumbnail(item), duration = catalogDuration(item.duration);
  const subtitle = item.analysed ? item.noTracks ? 'No usable worker tracks found' : `${item.workerCount} tracked ${item.workerCount === 1 ? 'worker' : 'workers'}${item.flagCount ? ` · ${item.flagCount} ${item.flagCount === 1 ? 'window needs' : 'windows need'} review` : ''}` : item.status === 'processing' ? 'Analysis in progress' : item.status === 'failed' ? 'Analysis did not complete' : 'Ready for analysis';
  const disabled = item.status === 'processing' || (!item.analysed && busy) || (!item.analysed && !item.libraryId);
  return `<article class="catalog-card" data-catalog-key="${escape(item.key)}">
    <button type="button" class="catalog-thumbnail" data-catalog-action="primary" data-catalog-key="${escape(item.key)}" aria-label="${escape(catalogPrimaryLabel(item))}: ${escape(item.title)}"${disabled ? ' disabled' : ''}>
      ${thumbnail ? `<img src="${escape(thumbnail)}" alt="Frame from ${escape(item.title)}" loading="lazy" decoding="async">` : '<span class="catalog-no-thumbnail">Recorded footage</span>'}
      <span class="catalog-preview-shade"></span><span class="catalog-thumbnail-action" aria-hidden="true">${item.analysed ? '↗' : '▶'}</span>
      <span class="catalog-badge catalog-badge-${item.status}">${catalogLabels[item.status]}</span>${duration ? `<span class="catalog-duration">${duration}</span>` : ''}
    </button>
    <div class="catalog-card-copy"><div class="catalog-card-group"><span>${escape(item.collection)}</span><span title="${escape(item.group)}">${escape(catalogTitle(item.group))}</span></div>
      <h3 title="${escape(item.filename)}">${escape(item.title)}</h3><p class="catalog-card-summary${item.flagCount ? ' catalog-summary-pending' : ''}">${escape(subtitle)}</p>
      <div class="catalog-card-footer"><button type="button" class="catalog-preview-button" data-catalog-action="preview" data-catalog-key="${escape(item.key)}" aria-label="Preview ${escape(item.title)}">▷ Preview</button>
      <button type="button" class="catalog-primary-button" data-catalog-action="primary" data-catalog-key="${escape(item.key)}"${disabled ? ' disabled' : ''}>${catalogPrimaryLabel(item)}${item.status !== 'processing' ? ' <span aria-hidden="true">→</span>' : ''}</button></div>
    </div></article>`;
}
function initializeCatalog() {
  const section = document.getElementById('catalog-section');
  if (!section) return;
  if (!document.getElementById('catalog-controls')) section.innerHTML = `
    <div class="catalog-heading"><div><h2>All recordings</h2><p>Select footage to analyse or open saved observations.</p></div><span id="catalog-total" class="catalog-total"></span></div>
    <div id="catalog-controls" class="catalog-controls"><div class="catalog-controls-top"><div class="catalog-status-filters" role="group" aria-label="Analysis status">
    ${[['all','All footage'],['needs-review','Needs review'],['reviewed','Reviewed'],['not-analysed','Not analysed']].map(([value, label]) => `<button type="button" class="catalog-filter${value === 'all' ? ' active' : ''}" data-catalog-status="${value}" aria-pressed="${value === 'all'}">${label}</button>`).join('')}
    </div><label class="catalog-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m13 13 4 4"></path></svg><input id="catalog-search" type="search" placeholder="Search footage…" aria-label="Search footage by name or group" autocomplete="off"></label></div>
    <div class="catalog-controls-bottom"><div class="catalog-collection-filters" role="group" aria-label="Footage collection"><span>Collection</span>${[['all','All'],['Construction','Construction'],['Factory','Factory']].map(([value, label]) => `<button type="button" class="catalog-collection${value === 'all' ? ' active' : ''}" data-catalog-collection="${value}" aria-pressed="${value === 'all'}">${label}</button>`).join('')}</div><span id="catalog-result-count" class="catalog-result-count" aria-live="polite"></span></div></div>
    <div id="catalog-grid" class="catalog-grid"></div><div class="catalog-pagination"><button id="catalog-load-more" type="button" class="catalog-load-more" hidden>Load more footage <span aria-hidden="true">↓</span></button></div>
    <dialog id="catalog-preview-dialog" class="catalog-preview-dialog" aria-labelledby="catalog-preview-title"><div class="catalog-dialog-header"><div><h2 id="catalog-preview-title"></h2><p id="catalog-preview-meta"></p></div><button type="button" id="catalog-close-preview" class="catalog-close-preview" aria-label="Close video preview">×</button></div><video id="catalog-preview-video" controls playsinline preload="metadata"></video><div class="catalog-dialog-footer"><span id="catalog-preview-status"></span><button type="button" id="catalog-preview-primary" class="catalog-primary-button"></button></div></dialog>`;
  if (section.dataset.catalogInitialized === 'true') return;
  section.dataset.catalogInitialized = 'true';
  const controls = document.getElementById('catalog-controls');
  controls.addEventListener('click', event => {
    const status = event.target.closest('[data-catalog-status]'), collection = event.target.closest('[data-catalog-collection]');
    if (status) setCatalogFilter({status: status.dataset.catalogStatus});
    if (collection) setCatalogFilter({collection: collection.dataset.catalogCollection});
  });
  document.getElementById('catalog-search').addEventListener('input', event => setCatalogFilter({search: event.target.value}));
  document.getElementById('catalog-load-more').addEventListener('click', () => { catalogView.limit += 24; renderCatalog(); });
  document.getElementById('catalog-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-catalog-action]');
    if (!button || button.disabled) return;
    const item = catalogView.items.find(item => item.key === button.dataset.catalogKey);
    if (!item) return;
    if (button.dataset.catalogAction === 'preview') openCatalogPreview(item); else activateCatalogItem(item);
  });
  // A missing JPEG falls back to a real frame from the same video, without autoplay.
  document.getElementById('catalog-grid').addEventListener('error', event => {
    const image = event.target;
    if (image.tagName !== 'IMG') return;
    const item = catalogView.items.find(item => item.key === image.closest('[data-catalog-key]')?.dataset.catalogKey);
    if (!item) return;
    const video = document.createElement('video');
    video.src = catalogSource(item); video.preload = 'metadata'; video.muted = true; video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('loadedmetadata', () => { if (video.duration > .2) video.currentTime = Math.min(1, video.duration / 2); }, {once: true});
    image.replaceWith(video);
  }, true);
  const dialog = document.getElementById('catalog-preview-dialog');
  document.getElementById('catalog-close-preview').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { const video = document.getElementById('catalog-preview-video'); video.pause(); video.removeAttribute('src'); video.load(); catalogView.previewKey = null; });
  document.getElementById('catalog-preview-primary').addEventListener('click', () => {
    const item = catalogView.items.find(item => item.key === catalogView.previewKey);
    if (item) { dialog.close(); activateCatalogItem(item); }
  });
  renderCatalog();
}
function setCatalogFilter(options) {
  Object.assign(catalogView, options); catalogView.limit = 24;
  const input = document.getElementById('catalog-search');
  if (input && input.value !== catalogView.search) input.value = catalogView.search;
  renderCatalog();
}
function focusCatalogSearch() { document.getElementById('catalog-search')?.focus(); }
function renderCatalog() {
  if (typeof document === 'undefined' || !document.getElementById('catalog-section')) return;
  if (!document.getElementById('catalog-grid')) { initializeCatalog(); return; }
  const videos = typeof libraryVideos === 'undefined' ? [] : libraryVideos;
  const snapshot = typeof state === 'undefined' ? {} : state;
  const items = buildCatalogItems(videos, snapshot), filtered = filterCatalogItems(items, catalogView), visible = filtered.slice(0, catalogView.limit);
  catalogView.items = items;
  document.getElementById('catalog-total').textContent = `${items.length} recordings`;
  document.getElementById('catalog-result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'recording' : 'recordings'}${visible.length < filtered.length ? ` · showing ${visible.length}` : ''}`;
  document.querySelectorAll('[data-catalog-status]').forEach(button => { const active = button.dataset.catalogStatus === catalogView.status; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-catalog-collection]').forEach(button => { const active = button.dataset.catalogCollection === catalogView.collection; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  const key = JSON.stringify([visible, !!snapshot.busy]);
  if (key !== catalogView.gridKey) {
    catalogView.gridKey = key;
    document.getElementById('catalog-grid').innerHTML = visible.length ? visible.map(item => catalogCard(item, snapshot.busy)).join('') : `<div class="catalog-empty"><span aria-hidden="true">⌕</span><h3>${items.length ? 'No matching footage' : 'Your footage will appear here'}</h3><p>${items.length ? 'Try another name, collection or review filter.' : 'Upload a recording or choose a video from the VM library.'}</p></div>`;
  }
  document.getElementById('catalog-load-more').hidden = visible.length >= filtered.length;
  if (catalogView.previewKey) updateCatalogPreview(items.find(item => item.key === catalogView.previewKey), snapshot.busy);
}
function updateCatalogPreview(item, busy) {
  if (!item) return;
  const primary = document.getElementById('catalog-preview-primary');
  primary.textContent = catalogPrimaryLabel(item);
  primary.hidden = item.analysed && !item.trackKey;
  primary.disabled = item.status === 'processing' || (!item.analysed && (!!busy || !item.libraryId));
  document.getElementById('catalog-preview-status').textContent = `${catalogLabels[item.status]}${item.analysed ? ` · ${item.workerCount} tracked ${item.workerCount === 1 ? 'worker' : 'workers'}` : ' · Recorded footage'}`;
}
function openCatalogPreview(item) {
  catalogView.previewKey = item.key;
  document.getElementById('catalog-preview-title').textContent = item.title;
  document.getElementById('catalog-preview-meta').textContent = `${item.collection} · ${catalogTitle(item.group)}${catalogDuration(item.duration) ? ` · ${catalogDuration(item.duration)}` : ''}`;
  const video = document.getElementById('catalog-preview-video');
  video.src = catalogSource(item); video.poster = catalogThumbnail(item); video.load();
  updateCatalogPreview(item, typeof state !== 'undefined' && state.busy);
  document.getElementById('catalog-preview-dialog').showModal();
}
function activateCatalogItem(item) {
  if (item.status === 'processing') return;
  if (item.analysed) {
    if (item.trackKey) openWorker(item.trackKey, item.clipId); else openCatalogPreview(item);
    return;
  }
  if (!item.libraryId || state.busy) return;
  action(async () => {
    await post(`/api/library/${encodeURIComponent(item.libraryId)}/analyse`);
    toast('Analysing the selected video…');
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = {catalogTitle, catalogDuration, buildCatalogItems, filterCatalogItems};
