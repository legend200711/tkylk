/**
 * 24-HOUR CLOUD ENGINE — Screen: Destinations
 * cloud-engine-ui/js/screens/ce-screen-destinations.js
 *
 * Destination management UI.
 * Maps to: FanOutManager.addDestination(), removeDestination(), restartDestination()
 * Control via: CONTROL_COMMAND.ADD_DESTINATION, REMOVE_DESTINATION, RECONNECT_DESTINATION
 *
 * SECURITY:
 *   Stream keys are NEVER displayed.
 *   After a destination is configured the key is shown as "Configured".
 *   The key is stored server-side (env var referenced by streamKeyEnvVar).
 *
 * Protocols (from broadcast/destination-manager.js BROADCAST_PROTOCOL):
 *   RTMP, RTMPS
 *
 * Platforms:
 *   YouTube, Twitch, Facebook, Custom RTMP, Custom RTMPS
 */

import * as Store from '../ce-store.js';
import { badge, formatUptime, _escapeHtml, toast, confirm } from '../ce-utils.js';
import { sendControlCommand, subscribeDestinations } from '../ce-firebase-bridge.js';

const CC = {
  ADD_DESTINATION:       'ADD_DESTINATION',
  REMOVE_DESTINATION:    'REMOVE_DESTINATION',
  RECONNECT_DESTINATION: 'RECONNECT_DESTINATION',
};

export function renderDestinations(container) {
  container.innerHTML = buildDestinationsHTML();
  bindDestinationsEvents(container);
  refreshDestinations(container);

  const unsubs = [
    Store.subscribe('destinations', () => refreshDestinations(container)),
  ];

  // Subscribe to Firebase destinations
  let fbUnsub = subscribeDestinations((dests) => {
    Store.set('destinations', dests);
  });

  return () => {
    unsubs.forEach(fn => fn());
    fbUnsub?.();
  };
}

function buildDestinationsHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Destinations</h1>
  <p class="ce-screen-subtitle">Manage RTMP/RTMPS broadcast destinations</p>
  <div class="ce-screen-actions">
    <button class="ce-btn ce-btn-primary" id="dest-add-btn">+ Add Destination</button>
  </div>
</div>

<!-- Security notice -->
<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 7v4m0-6v.5" stroke-linecap="round"/></svg>
    <div>
      <strong>Stream Key Security:</strong>
      Stream keys are stored server-side as environment variables and are <strong>never displayed</strong>
      after configuration. The destination URL is shown; the key is shown only as "Configured".
    </div>
  </div>
</div>

<!-- Destination list -->
<div class="ce-section" id="dest-list-section">
  <div class="ce-section-title">Configured Destinations</div>
  <div id="dest-cards" class="ce-grid-auto"></div>
</div>

<!-- Add Destination Form (hidden by default) -->
<div class="ce-section" id="dest-form-section" style="display:none">
  <div class="ce-card">
    <div class="ce-card-title">Add Destination</div>
    <div style="display:grid;gap:14px">
      <div class="ce-form-group">
        <label class="ce-label" for="df-name">Destination Name</label>
        <input class="ce-input" id="df-name" type="text" placeholder="e.g. YouTube Main, Twitch Backup" />
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="df-protocol">Protocol</label>
        <select class="ce-select" id="df-protocol">
          <option value="RTMPS">RTMPS (recommended, TLS)</option>
          <option value="RTMP">RTMP (unencrypted)</option>
        </select>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="df-server">Server URL</label>
        <input class="ce-input ce-mono" id="df-server" type="text" placeholder="rtmps://live.example.com/live/" />
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:3px">Base RTMP/RTMPS server address (without stream key)</div>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="df-keyenv">Stream Key Environment Variable Name</label>
        <input class="ce-input ce-mono" id="df-keyenv" type="text" placeholder="YOUTUBE_STREAM_KEY" />
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:3px">
          The environment variable on the Cloud Engine server that contains the stream key.
          The key itself is NEVER stored here.
        </div>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="df-platform">Platform (optional)</label>
        <select class="ce-select" id="df-platform">
          <option value="">— None / Custom —</option>
          <option value="YOUTUBE">YouTube</option>
          <option value="TWITCH">Twitch</option>
          <option value="FACEBOOK">Facebook</option>
        </select>
      </div>
      <div class="ce-form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="df-autoreconnect" checked>
          Enable auto-reconnect on failure
        </label>
      </div>
      <div style="display:flex;gap:10px">
        <button class="ce-btn ce-btn-primary" id="df-save-btn">Save Destination</button>
        <button class="ce-btn ce-btn-ghost" id="df-cancel-btn">Cancel</button>
      </div>
      <div id="df-error" style="font-size:12px;color:var(--ce-error)"></div>
    </div>
  </div>
</div>
`;
}

function refreshDestinations(container) {
  const dests = Store.get('destinations');
  const cards = container.querySelector('#dest-cards');
  if (!cards) return;

  if (!dests || dests.length === 0) {
    cards.innerHTML = `
      <div class="ce-empty-state" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h10"/><circle cx="19" cy="17" r="3"/></svg>
        <div class="ce-empty-state-title">No destinations configured</div>
        <div class="ce-empty-state-body">Add an RTMP/RTMPS destination to start broadcasting to multiple platforms.</div>
        <button class="ce-btn ce-btn-outline" onclick="document.getElementById('dest-add-btn').click()">Add Destination</button>
      </div>`;
    return;
  }

  cards.innerHTML = dests.map(d => {
    const stateMap = {
      'CONNECTED':'connected','BROADCASTING':'live','DISCONNECTED':'disconnected',
      'RECONNECTING':'recovering','FAILED':'error','STOPPED':'offline','IDLE':'offline',
    };
    const stateClass = stateMap[d.state] ?? 'offline';
    const protocol   = d.protocol ?? 'RTMP';
    const protoClass = protocol === 'RTMPS' ? 'configured' : 'warn';

    return `
    <div class="ce-destination-card ${stateClass === 'live' || stateClass === 'connected' ? 'active' : stateClass === 'error' ? 'error' : ''}">
      <div class="ce-destination-header">
        <div>
          <div class="ce-destination-name">${_escapeHtml(d.name ?? d.id ?? '—')}</div>
          <div class="ce-destination-meta">${_escapeHtml(d.serverUrl ?? d.server ?? '—')}</div>
        </div>
        ${badge(d.state ?? 'UNKNOWN', stateClass)}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px">
        ${badge(protocol, protoClass)}
        ${d.platform ? badge(d.platform, 'arch') : ''}
        ${badge('Stream Key: Configured', 'configured')}
        ${d.autoReconnect ? badge('Auto-Reconnect', 'ready') : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:11px">
        <div><span class="ce-text-muted">Uptime:</span> <span class="ce-mono">${formatUptime(d.uptimeSec)}</span></div>
        <div><span class="ce-text-muted">Reconnects:</span> <span class="ce-mono">${d.reconnectCount ?? 0}</span></div>
        ${d.error || d.lastError ? `<div colspan="2" style="color:var(--ce-error);font-size:10px">${_escapeHtml(String(d.error?.message ?? d.lastError?.message ?? ''))}</div>` : ''}
      </div>
      <div class="ce-destination-actions">
        <button class="ce-btn ce-btn-outline ce-btn-sm" data-dest-reconnect="${_escapeHtml(d.id ?? d.destinationId ?? '')}">Reconnect</button>
        <button class="ce-btn ce-btn-ghost ce-btn-sm ce-btn-danger" data-dest-remove="${_escapeHtml(d.id ?? d.destinationId ?? '')}">Remove</button>
      </div>
    </div>`;
  }).join('');

  // Bind dynamic buttons
  cards.querySelectorAll('[data-dest-reconnect]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-dest-reconnect');
      const result = await sendControlCommand(CC.RECONNECT_DESTINATION, { destinationId: id });
      if (result.success) toast(`Reconnect command sent for "${id}".`, 'info');
      else toast(`Reconnect failed: ${result.message}`, 'error');
    });
  });

  cards.querySelectorAll('[data-dest-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-dest-remove');
      const ok = await confirm('Remove Destination?', `Remove destination "${id}"? This cannot be undone.`, 'Remove');
      if (!ok) return;
      const result = await sendControlCommand(CC.REMOVE_DESTINATION, { destinationId: id });
      if (result.success) toast(`Destination "${id}" removed.`, 'success');
      else toast(`Remove failed: ${result.message}`, 'error');
    });
  });
}

function bindDestinationsEvents(container) {
  const addBtn      = container.querySelector('#dest-add-btn');
  const formSection = container.querySelector('#dest-form-section');
  const cancelBtn   = container.querySelector('#df-cancel-btn');
  const saveBtn     = container.querySelector('#df-save-btn');
  const errorEl     = container.querySelector('#df-error');

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
    const name     = container.querySelector('#df-name')?.value?.trim();
    const protocol = container.querySelector('#df-protocol')?.value;
    const server   = container.querySelector('#df-server')?.value?.trim();
    const keyEnv   = container.querySelector('#df-keyenv')?.value?.trim();
    const platform = container.querySelector('#df-platform')?.value;
    const autoReconnect = container.querySelector('#df-autoreconnect')?.checked ?? true;

    if (!name) { errorEl.textContent = 'Destination name is required.'; return; }
    if (!server) { errorEl.textContent = 'Server URL is required.'; return; }
    if (!keyEnv) { errorEl.textContent = 'Stream key environment variable name is required.'; return; }

    errorEl.textContent = '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const destination = {
      destinationId:  `dest-${Date.now()}`,
      name,
      protocol,
      serverUrl: server,
      streamKeyEnvVar: keyEnv,  // The ENV VAR NAME — not the key itself
      platform: platform || null,
      autoReconnect,
    };

    const result = await sendControlCommand(CC.ADD_DESTINATION, { destination });

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Destination';

    if (result.success) {
      toast(`Destination "${name}" added.`, 'success');
      formSection.style.display = 'none';
      addBtn.style.display = '';
      // Clear form
      ['#df-name','#df-server','#df-keyenv'].forEach(sel => {
        const inp = container.querySelector(sel);
        if (inp) inp.value = '';
      });
    } else {
      errorEl.textContent = result.message ?? 'Failed to add destination.';
    }
  });
}
