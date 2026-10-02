/**
 * 24-HOUR CLOUD ENGINE — Screen: Playlists
 * cloud-engine-ui/js/screens/ce-screen-playlists.js
 *
 * Playlist management for TV Station programming.
 * Maps to: TVStationManager playlist methods (createPlaylist, addToPlaylist, etc.)
 */

import * as Store from '../ce-store.js';
import { _escapeHtml, toast, confirm } from '../ce-utils.js';

export function renderPlaylists(container) {
  container.innerHTML = buildPlaylistsHTML();
  bindPlaylistEvents(container);
  refreshPlaylists(container);
  const unsub = Store.subscribe('playlists', () => refreshPlaylists(container));
  return () => unsub();
}

function buildPlaylistsHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Playlists</h1>
  <p class="ce-screen-subtitle">Create and manage programming playlists for TV Station</p>
  <div class="ce-screen-actions">
    <button class="ce-btn ce-btn-primary" id="pl-create-btn">+ Create Playlist</button>
  </div>
</div>

<!-- Create form -->
<div class="ce-section" id="pl-form-section" style="display:none">
  <div class="ce-card">
    <div class="ce-card-title">Create Playlist</div>
    <div style="display:grid;gap:12px">
      <div class="ce-form-group">
        <label class="ce-label" for="pl-name">Playlist Name</label>
        <input class="ce-input" id="pl-name" type="text" placeholder="Morning Shows, Prime Time, etc." />
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="pl-desc">Description (optional)</label>
        <input class="ce-input" id="pl-desc" type="text" placeholder="Brief description" />
      </div>
      <div style="display:flex;gap:10px">
        <button class="ce-btn ce-btn-primary" id="pl-save-btn">Create</button>
        <button class="ce-btn ce-btn-ghost" id="pl-cancel-btn">Cancel</button>
      </div>
    </div>
  </div>
</div>

<!-- Playlist list -->
<div class="ce-section">
  <div class="ce-section-title">Playlists</div>
  <div id="pl-list" style="display:flex;flex-direction:column;gap:12px">
    <div class="ce-empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h9"/></svg>
      <div class="ce-empty-state-title">No playlists yet</div>
      <div class="ce-empty-state-body">Create a playlist to organize your TV Station programming.</div>
    </div>
  </div>
</div>
`;
}

function refreshPlaylists(container) {
  const playlists = Store.get('playlists') ?? [];
  const listEl = container.querySelector('#pl-list');
  if (!listEl) return;

  if (playlists.length === 0) {
    listEl.innerHTML = `
      <div class="ce-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h9"/></svg>
        <div class="ce-empty-state-title">No playlists yet</div>
        <div class="ce-empty-state-body">Create a playlist to organize your TV Station programming.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = playlists.map(pl => `
    <div class="ce-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="font-weight:600;font-size:14px;color:var(--ce-text-heading)">${_escapeHtml(pl.name)}</div>
          ${pl.description ? `<div style="font-size:11px;color:var(--ce-text-muted)">${_escapeHtml(pl.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          <button class="ce-btn ce-btn-outline ce-btn-sm">Add Item</button>
          <button class="ce-btn ce-btn-ghost ce-btn-sm" style="color:var(--ce-error)" data-pl-remove="${_escapeHtml(pl.id ?? '')}">Delete</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--ce-text-muted)">
        ${(pl.items ?? []).length} item(s) ·
        Total duration: ${pl.totalDuration ?? '—'}
      </div>
      ${(pl.items ?? []).length > 0 ? `
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
          ${(pl.items ?? []).map((item, idx) => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;background:var(--ce-bg-input);border-radius:var(--ce-radius-sm);font-size:12px">
              <span style="color:var(--ce-text-muted);width:20px;text-align:right">${idx + 1}</span>
              <span style="flex:1">${_escapeHtml(item.title ?? item.mediaId ?? 'Untitled')}</span>
              <span class="ce-mono" style="color:var(--ce-text-muted)">${item.durationSec ? `${Math.floor(item.durationSec/60)}m` : '—'}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`).join('');

  listEl.querySelectorAll('[data-pl-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-pl-remove');
      const ok = await confirm('Delete Playlist?', 'This will remove the playlist and all its items.', 'Delete');
      if (!ok) return;
      const updated = Store.get('playlists').filter(p => p.id !== id);
      Store.set('playlists', updated);
      toast('Playlist deleted.', 'success');
    });
  });
}

function bindPlaylistEvents(container) {
  const createBtn   = container.querySelector('#pl-create-btn');
  const formSection = container.querySelector('#pl-form-section');
  const cancelBtn   = container.querySelector('#pl-cancel-btn');
  const saveBtn     = container.querySelector('#pl-save-btn');

  createBtn?.addEventListener('click', () => {
    formSection.style.display = '';
    createBtn.style.display = 'none';
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelBtn?.addEventListener('click', () => {
    formSection.style.display = 'none';
    createBtn.style.display = '';
  });

  saveBtn?.addEventListener('click', () => {
    const name = container.querySelector('#pl-name')?.value?.trim();
    const desc = container.querySelector('#pl-desc')?.value?.trim();
    if (!name) { toast('Playlist name is required.', 'warn'); return; }
    const playlists = [...(Store.get('playlists') ?? [])];
    playlists.push({ id: `pl-${Date.now()}`, name, description: desc, items: [] });
    Store.set('playlists', playlists);
    toast(`Playlist "${name}" created.`, 'success');
    formSection.style.display = 'none';
    createBtn.style.display = '';
    const inp = container.querySelector('#pl-name');
    if (inp) inp.value = '';
  });
}
