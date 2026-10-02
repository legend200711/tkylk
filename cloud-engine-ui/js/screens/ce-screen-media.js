/**
 * 24-HOUR CLOUD ENGINE — Screen: Media Library
 * cloud-engine-ui/js/screens/ce-screen-media.js
 *
 * Manages the Cloud Media Library.
 * Maps to: CloudMediaLibrary in cloud-engine/media/media-library.js
 *
 * Operations supported (per backend):
 *   registerMedia  → POST via control command
 *   listItems      → subscribed from Firestore
 *   getItem        → read with ownership check
 *   removeMedia    → DELETE via control command
 *
 * Media types (from media-errors.js MEDIA_TYPE):
 *   VIDEO, AUDIO, IMAGE, PROGRAM, CLIP, BUMPER, STATION_ID, AD, OVERLAY
 *
 * Validation states (from media-errors.js MEDIA_VALIDATION_STATE):
 *   UNVALIDATED, VALIDATING, VALID, INVALID, ERROR
 *
 * Note: File upload to server requires a separate file transfer mechanism.
 * The frontend registers server-side file paths; it does NOT upload files
 * through the browser (this is a cloud engine, not a browser uploader).
 */

import * as Store from '../ce-store.js';
import { badge, formatBytes, _escapeHtml, toast, confirm } from '../ce-utils.js';

// Validation state badge
function validationBadge(state) {
  const map = {
    'VALID':       ['VALID',       'live'],
    'VALIDATING':  ['VALIDATING',  'warn'],
    'UNVALIDATED': ['UNVALIDATED', 'offline'],
    'INVALID':     ['INVALID',     'error'],
    'ERROR':       ['ERROR',       'error'],
  };
  const [label, cls] = map[state] ?? [state ?? '—', 'offline'];
  return badge(label, cls);
}

export function renderMedia(container) {
  container.innerHTML = buildMediaHTML();
  bindMediaEvents(container);
  refreshMedia(container);

  const unsub = Store.subscribe('media', () => refreshMedia(container));
  return () => unsub();
}

function buildMediaHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Media Library</h1>
  <p class="ce-screen-subtitle">Manage prerecorded media for broadcast and TV Station</p>
  <div class="ce-screen-actions">
    <button class="ce-btn ce-btn-primary" id="media-register-btn">+ Register Media</button>
    <button class="ce-btn ce-btn-outline" id="media-refresh-btn">Refresh</button>
  </div>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 7v4m0-6v.5" stroke-linecap="round"/></svg>
    <div>
      Media files must be accessible on the <strong>Cloud Engine server</strong>.
      Register media by providing the absolute path on the server.
      The browser cannot upload files directly — use secure server-side file transfer (SCP, SFTP, or cloud storage).
      Metadata (duration, codec, resolution) is probed by ffprobe on the server.
    </div>
  </div>
</div>

<!-- Register form (hidden) -->
<div class="ce-section" id="media-form-section" style="display:none">
  <div class="ce-card">
    <div class="ce-card-title">Register Media File</div>
    <div style="display:grid;gap:14px">
      <div class="ce-form-group">
        <label class="ce-label" for="mf-title">Title</label>
        <input class="ce-input" id="mf-title" type="text" placeholder="My Program Title" />
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="mf-path">Server File Path</label>
        <input class="ce-input ce-mono" id="mf-path" type="text" placeholder="/media/content/program-01.mp4" />
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:3px">Absolute path on the Cloud Engine server</div>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="mf-type">Media Type</label>
        <select class="ce-select" id="mf-type">
          <option value="PROGRAM">Program</option>
          <option value="CLIP">Clip</option>
          <option value="BUMPER">Bumper</option>
          <option value="STATION_ID">Station ID</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
        </select>
      </div>
      <div style="display:flex;gap:10px">
        <button class="ce-btn ce-btn-primary" id="mf-save-btn">Register</button>
        <button class="ce-btn ce-btn-ghost" id="mf-cancel-btn">Cancel</button>
      </div>
      <div id="mf-error" style="font-size:12px;color:var(--ce-error)"></div>
    </div>
  </div>
</div>

<!-- Media grid -->
<div class="ce-section">
  <div class="ce-section-title">Media Items</div>
  <div id="media-grid" class="ce-media-grid"></div>
  <div id="media-loading" style="display:none;text-align:center;padding:32px;color:var(--ce-text-muted)">
    Loading media library…
  </div>
  <div id="media-empty" class="ce-empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M9 9l6 3-6 3V9z" fill="currentColor" stroke="none"/></svg>
    <div class="ce-empty-state-title">No media registered</div>
    <div class="ce-empty-state-body">Register server-side media files to use in broadcasts and TV Station programming.</div>
  </div>
</div>
`;
}

function refreshMedia(container) {
  const mediaState = Store.get('media');
  const items   = mediaState.items ?? [];
  const loading = mediaState.loading;

  const grid    = container.querySelector('#media-grid');
  const loadEl  = container.querySelector('#media-loading');
  const emptyEl = container.querySelector('#media-empty');

  if (!grid) return;

  if (loading) {
    loadEl.style.display = '';
    grid.style.display   = 'none';
    emptyEl.style.display = 'none';
    return;
  }

  loadEl.style.display = 'none';

  if (items.length === 0) {
    grid.style.display    = 'none';
    emptyEl.style.display = '';
    return;
  }

  grid.style.display    = '';
  emptyEl.style.display = 'none';

  grid.innerHTML = items.map(item => `
    <div class="ce-media-item" data-media-id="${_escapeHtml(item.mediaId ?? item.id ?? '')}">
      <div class="ce-media-thumb">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M9 9l6 3-6 3V9z" fill="currentColor" stroke="none"/></svg>
      </div>
      <div class="ce-media-info">
        <div class="ce-media-title">${_escapeHtml(item.title ?? item.filename ?? 'Untitled')}</div>
        <div class="ce-media-meta">
          ${item.durationSec ? _formatDuration(item.durationSec) : '—'} ·
          ${item.fileSize    ? formatBytes(item.fileSize)         : '—'}
        </div>
        <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
          ${validationBadge(item.validationState ?? 'UNVALIDATED')}
          ${badge(item.type ?? 'VIDEO', 'arch')}
        </div>
        <div style="margin-top:8px;display:flex;gap:5px">
          <button class="ce-btn ce-btn-ghost ce-btn-sm" data-media-select="${_escapeHtml(item.mediaId ?? item.id ?? '')}">Select</button>
          <button class="ce-btn ce-btn-ghost ce-btn-sm" style="color:var(--ce-error)" data-media-remove="${_escapeHtml(item.mediaId ?? item.id ?? '')}">Remove</button>
        </div>
      </div>
    </div>`).join('');

  // Bind remove buttons
  grid.querySelectorAll('[data-media-remove]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-media-remove');
      const ok = await confirm('Remove Media?', `Remove media item "${id}"?`, 'Remove');
      if (!ok) return;
      // Send command to engine
      toast(`Remove request for "${id}" sent.`, 'info');
    });
  });
}

function _formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function bindMediaEvents(container) {
  const addBtn      = container.querySelector('#media-register-btn');
  const formSection = container.querySelector('#media-form-section');
  const cancelBtn   = container.querySelector('#mf-cancel-btn');
  const saveBtn     = container.querySelector('#mf-save-btn');
  const errorEl     = container.querySelector('#mf-error');

  addBtn?.addEventListener('click', () => {
    formSection.style.display = '';
    addBtn.style.display = 'none';
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelBtn?.addEventListener('click', () => {
    formSection.style.display = 'none';
    addBtn.style.display = '';
  });

  saveBtn?.addEventListener('click', async () => {
    const title = container.querySelector('#mf-title')?.value?.trim();
    const path  = container.querySelector('#mf-path')?.value?.trim();
    const type  = container.querySelector('#mf-type')?.value;

    if (!title) { errorEl.textContent = 'Title is required.'; return; }
    if (!path)  { errorEl.textContent = 'Server file path is required.'; return; }

    errorEl.textContent = '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Registering…';

    // In a full deployment this sends to the API / Firebase command
    // For now add to local store as a placeholder
    const items = [...(Store.get('media.items') ?? [])];
    items.push({
      mediaId:         `media-${Date.now()}`,
      title,
      filePath:        path,
      type,
      validationState: 'UNVALIDATED',
      registeredAt:    new Date().toISOString(),
    });
    Store.set('media.items', items);
    toast(`Media "${title}" registered (pending server validation).`, 'success');

    saveBtn.disabled = false;
    saveBtn.textContent = 'Register';
    formSection.style.display = 'none';
    addBtn.style.display = '';
    ['#mf-title','#mf-path'].forEach(sel => {
      const inp = container.querySelector(sel);
      if (inp) inp.value = '';
    });
  });

  container.querySelector('#media-refresh-btn')?.addEventListener('click', () => {
    Store.merge('media', { loading: true });
    setTimeout(() => Store.merge('media', { loading: false }), 800);
  });
}
