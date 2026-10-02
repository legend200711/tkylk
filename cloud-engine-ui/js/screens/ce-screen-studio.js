/**
 * 24-HOUR CLOUD ENGINE — Screen: Broadcast Studio
 * cloud-engine-ui/js/screens/ce-screen-studio.js
 *
 * Professional broadcast control interface.
 *
 * Maps to: BroadcastStudio.goLive(), stopBroadcast(), getDashboard()
 * Control via: Firebase control commands (CONTROL_COMMAND in firebase-control.js)
 *
 * Source types (from ingest-errors.js SOURCE_TYPE + SOURCE_TYPE_STATUS):
 *   MEDIA_FILE       → OPERATIONAL
 *   RTMP_INPUT       → ARCHITECTURE_READY
 *   EXTERNAL_ENCODER → ARCHITECTURE_READY
 *   CAMERA           → NOT_IMPLEMENTED
 *   MICROPHONE       → NOT_IMPLEMENTED
 *   FUTURE_WEBRTC    → NOT_IMPLEMENTED
 *
 * Broadcast modes (from broadcast-studio.js BROADCAST_MODE):
 *   LIVE             → OPERATIONAL
 *   PRERECORDED      → OPERATIONAL
 *   TV_STATION       → NOT_IMPLEMENTED (Stage 10 — use TV Station screen)
 *   HYBRID           → NOT_IMPLEMENTED (Stage 11 — use Hybrid screen)
 */

import * as Store from '../ce-store.js';
import { badge, broadcastStateBadge, engineStatusBadge, sourceTypeBadge,
         formatUptime, formatTime, UNAVAILABLE, _escapeHtml, toast, confirm
       } from '../ce-utils.js';
import { sendControlCommand } from '../ce-firebase-bridge.js';

const CC = {
  START_BROADCAST:      'START_BROADCAST',
  STOP_BROADCAST:       'STOP_BROADCAST',
  GET_BROADCAST_STATUS: 'GET_BROADCAST_STATUS',
};

// Source types (from ingest-errors.js)
const SOURCE_TYPES = [
  { type: 'MEDIA_FILE',       label: 'Prerecorded Media',    status: 'OPERATIONAL',       hint: 'Upload or select a media file from the library' },
  { type: 'RTMP_INPUT',       label: 'RTMP Input',           status: 'ARCHITECTURE_READY',hint: 'External RTMP push stream (RTMP server not yet running)' },
  { type: 'EXTERNAL_ENCODER', label: 'External Encoder',     status: 'ARCHITECTURE_READY',hint: 'OBS, Wirecast, or compatible encoder (RTMP listener not yet running)' },
  { type: 'CAMERA',           label: 'Camera',               status: 'NOT_IMPLEMENTED',   hint: 'No physical camera access in this environment' },
  { type: 'MICROPHONE',       label: 'Microphone',           status: 'NOT_IMPLEMENTED',   hint: 'No microphone access in this environment' },
  { type: 'FUTURE_WEBRTC',    label: 'Browser (WebRTC)',     status: 'NOT_IMPLEMENTED',   hint: 'WebRTC browser source — not implemented' },
];

// Broadcast modes (from broadcast-studio.js)
const BROADCAST_MODES = [
  { mode: 'PRERECORDED', label: 'Prerecorded Media', status: 'OPERATIONAL' },
  { mode: 'LIVE',        label: 'Live Ingest',       status: 'OPERATIONAL' },
  { mode: 'TV_STATION',  label: 'TV Station Mode',   status: 'NOT_IMPLEMENTED' },
  { mode: 'HYBRID',      label: 'Hybrid Mode',       status: 'NOT_IMPLEMENTED' },
];

export function renderStudio(container) {
  container.innerHTML = buildStudioHTML();
  bindStudioEvents(container);
  refreshStudio(container);

  const unsubs = [
    Store.subscribe('broadcast', () => refreshStudio(container)),
    Store.subscribe('encoder',   () => refreshStudio(container)),
    Store.subscribe('ingest',    () => refreshStudio(container)),
    Store.subscribe('engine',    () => refreshStudio(container)),
    Store.subscribe('destinations', () => refreshStudio(container)),
    Store.subscribe('events',    () => refreshStudioEvents(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildStudioHTML() {
  const sourceOptionsHTML = SOURCE_TYPES.map(s => {
    const op  = s.status === 'OPERATIONAL';
    const sel = s.type === 'MEDIA_FILE' ? 'selected' : '';
    return `
    <label class="ce-source-option ${!op ? 'disabled' : ''} ${sel}" data-source="${s.type}">
      <input type="radio" name="ce-source" value="${s.type}" ${!op ? 'disabled' : ''} ${sel ? 'checked' : ''}>
      <div class="ce-source-option-label">
        <div style="font-weight:600;font-size:13px">${_escapeHtml(s.label)}</div>
        <div style="font-size:11px;color:var(--ce-text-muted)">${_escapeHtml(s.hint)}</div>
      </div>
      <span class="ce-source-option-status">${sourceTypeBadge(s.status)}</span>
    </label>`;
  }).join('');

  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Broadcast Studio</h1>
  <p class="ce-screen-subtitle">Configure and start your cloud broadcast</p>
</div>

<!-- Live Status Header -->
<div id="studio-live-header" class="ce-live-header ce-live-header-hidden">
  <div class="ce-status-dot ce-status-live"></div>
  <span id="studio-live-label">LIVE BROADCAST IN PROGRESS</span>
  <span style="margin-left:auto;font-family:var(--ce-font-mono);font-weight:400" id="studio-live-uptime">00:00:00</span>
</div>

<div class="ce-section">
  <div class="ce-studio-layout">

    <!-- LEFT: Main Controls -->
    <div class="ce-studio-main">

      <!-- Preview area -->
      <div class="ce-studio-preview">
        <div id="studio-preview-inner" class="ce-studio-preview-inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4" stroke-linecap="round"/></svg>
          <div>No preview available in this environment</div>
          <div style="font-size:10px;opacity:0.6">Engine preview requires server-side rendering support</div>
        </div>
        <div id="studio-live-badge" class="ce-studio-preview-live-badge" style="display:none">● ON AIR</div>
      </div>

      <!-- Broadcast Config -->
      <div class="ce-card">
        <div class="ce-card-title">Broadcast Configuration</div>

        <div style="display:grid;gap:14px">
          <div class="ce-form-group">
            <label class="ce-label" for="studio-title">Broadcast Title</label>
            <input class="ce-input" id="studio-title" type="text" placeholder="My Cloud Broadcast" maxlength="200" />
          </div>

          <div class="ce-form-group">
            <label class="ce-label">Broadcast Mode</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${BROADCAST_MODES.map(m => `
                <label style="display:flex;align-items:center;gap:7px;cursor:${m.status==='OPERATIONAL'?'pointer':'not-allowed'};opacity:${m.status==='OPERATIONAL'?1:0.45}">
                  <input type="radio" name="ce-mode" value="${m.mode}" ${m.mode==='PRERECORDED'?'checked':''} ${m.status!=='OPERATIONAL'?'disabled':''}>
                  <span style="font-size:13px">${_escapeHtml(m.label)}</span>
                  <span style="font-size:10px;color:var(--ce-text-muted)">${m.status!=='OPERATIONAL'?'('+m.status.replace('_',' ').toLowerCase()+')':''}</span>
                </label>`).join('')}
            </div>
          </div>

          <div class="ce-form-group">
            <label class="ce-label">Source</label>
            <div style="display:flex;flex-direction:column;gap:8px" id="studio-source-list">
              ${sourceOptionsHTML}
            </div>
          </div>

          <div class="ce-form-group" id="studio-media-group">
            <label class="ce-label" for="studio-media-path">Media File Path (server-side)</label>
            <input class="ce-input ce-mono" id="studio-media-path" type="text" placeholder="/path/to/media.mp4" />
            <div style="font-size:11px;color:var(--ce-text-muted);margin-top:4px">
              Absolute path on the Cloud Engine server. Use the Media Library to manage files.
            </div>
          </div>
        </div>
      </div>

      <!-- Studio Controls -->
      <div class="ce-studio-controls">
        <button class="ce-btn ce-btn-live" id="studio-go-live-btn">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="10" cy="10" r="4" fill="currentColor"/><circle cx="10" cy="10" r="8"/></svg>
          GO LIVE
        </button>
        <button class="ce-btn ce-btn-stop" id="studio-stop-btn" style="display:none">
          <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px"><rect x="4" y="4" width="12" height="12" rx="1"/></svg>
          STOP BROADCAST
        </button>
        <div id="studio-status-inline" style="font-size:12px;color:var(--ce-text-muted)">Engine offline</div>
      </div>

    </div><!-- end .ce-studio-main -->

    <!-- RIGHT: Sidebar -->
    <div class="ce-studio-sidebar">

      <!-- Engine Status -->
      <div class="ce-card ce-card-sm">
        <div class="ce-card-title">Engine Status</div>
        <div style="display:grid;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span class="ce-text-muted">Engine</span>
            <span id="studio-engine-badge"></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span class="ce-text-muted">Broadcast</span>
            <span id="studio-broadcast-badge"></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span class="ce-text-muted">Ingest</span>
            <span id="studio-ingest-badge"></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span class="ce-text-muted">Encoder</span>
            <span id="studio-encoder-badge"></span>
          </div>
        </div>
      </div>

      <!-- Encoder Metrics -->
      <div class="ce-card ce-card-sm">
        <div class="ce-card-title">Encoder Metrics</div>
        <div style="display:grid;gap:6px;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span class="ce-text-muted">Speed</span>
            <span class="ce-mono" id="studio-enc-speed">Unavailable</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span class="ce-text-muted">FPS</span>
            <span class="ce-mono" id="studio-enc-fps">Unavailable</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span class="ce-text-muted">Bitrate</span>
            <span class="ce-mono" id="studio-enc-bitrate">Unavailable</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span class="ce-text-muted">Dropped Frames</span>
            <span class="ce-mono" id="studio-enc-dropped">Unavailable</span>
          </div>
        </div>
      </div>

      <!-- Active Destinations -->
      <div class="ce-card ce-card-sm">
        <div class="ce-card-title">Destinations</div>
        <div id="studio-dest-list" style="display:flex;flex-direction:column;gap:6px;font-size:12px">
          <div class="ce-text-muted" style="font-style:italic">No destinations configured</div>
        </div>
        <div style="margin-top:10px">
          <button class="ce-btn ce-btn-outline ce-btn-sm" onclick="location.hash='#destinations'">
            Manage Destinations
          </button>
        </div>
      </div>

      <!-- Studio Event Feed -->
      <div class="ce-card ce-card-sm">
        <div class="ce-card-title">Studio Events</div>
        <div class="ce-event-feed" id="studio-events" style="max-height:180px">
          <div class="ce-event-item">
            <span class="ce-event-body ce-text-muted" style="font-style:italic">Waiting for events…</span>
          </div>
        </div>
      </div>

    </div><!-- end .ce-studio-sidebar -->

  </div><!-- end .ce-studio-layout -->
</div>
`;
}

/* ═══════════════════════════════════
   REFRESH
═══════════════════════════════════ */
function refreshStudio(container) {
  const engine    = Store.get('engine');
  const broadcast = Store.get('broadcast');
  const encoder   = Store.get('encoder');
  const ingest    = Store.get('ingest');
  const dests     = Store.get('destinations');

  const isLive = broadcast.state === 'BROADCASTING' || broadcast.state === 'PARTIAL';
  const isOnline = engine.status !== 'OFFLINE' && engine.status !== 'UNKNOWN';

  // Live header
  const liveHeader = container.querySelector('#studio-live-header');
  if (liveHeader) {
    liveHeader.classList.toggle('ce-live-header-hidden', !isLive);
  }
  const liveUptime = container.querySelector('#studio-live-uptime');
  if (liveUptime) liveUptime.textContent = formatUptime(broadcast.uptimeSec);

  // Live badge on preview
  const liveBadge = container.querySelector('#studio-live-badge');
  if (liveBadge) liveBadge.style.display = isLive ? '' : 'none';

  // Buttons
  const goLiveBtn = container.querySelector('#studio-go-live-btn');
  const stopBtn   = container.querySelector('#studio-stop-btn');
  const statusInline = container.querySelector('#studio-status-inline');

  if (goLiveBtn) goLiveBtn.style.display = isLive ? 'none' : '';
  if (stopBtn)   stopBtn.style.display   = isLive ? '' : 'none';
  if (statusInline) {
    if (isLive)    statusInline.textContent = `Broadcasting to ${broadcast.activeSessions} destination(s)`;
    else if (isOnline) statusInline.textContent = `Engine ${engine.status}`;
    else           statusInline.textContent = 'Engine offline';
  }

  // Status badges (sidebar)
  _setBadge(container, '#studio-engine-badge',    engineStatusBadge(engine.status));
  _setBadge(container, '#studio-broadcast-badge', broadcastStateBadge(broadcast.state));
  _setBadge(container, '#studio-ingest-badge',    badge(
    ingest.state === 'ACTIVE' ? 'ACTIVE' : ingest.state,
    ingest.state === 'ACTIVE' ? 'live' : 'offline'
  ));
  _setBadge(container, '#studio-encoder-badge', badge(
    encoder.status,
    encoder.status === 'ENCODING' ? 'live' : encoder.status === 'ERROR' ? 'error' : 'offline'
  ));

  // Encoder metrics
  _setMetricText(container, '#studio-enc-speed',   encoder.speed   != null ? `${encoder.speed}x` : null);
  _setMetricText(container, '#studio-enc-fps',     encoder.fps     != null ? `${encoder.fps} fps` : null);
  _setMetricText(container, '#studio-enc-bitrate', encoder.bitrate != null ? `${encoder.bitrate} kbps` : null);
  _setMetricText(container, '#studio-enc-dropped', encoder.dropped != null ? `${encoder.dropped}` : null);

  // Destinations sidebar
  const destList = container.querySelector('#studio-dest-list');
  if (destList) {
    if (!dests || dests.length === 0) {
      destList.innerHTML = `<div class="ce-text-muted" style="font-style:italic">No destinations configured</div>`;
    } else {
      destList.innerHTML = dests.map(d => {
        const stateMap = { 'BROADCASTING':'live','CONNECTED':'ready','DISCONNECTED':'offline','FAILED':'error','RECONNECTING':'recovering' };
        const cls = stateMap[d.state] ?? 'offline';
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>${_escapeHtml(d.name ?? d.destinationId ?? '—')}</span>
          ${badge(d.state ?? '—', cls)}
        </div>`;
      }).join('');
    }
  }

  // Input form disabled while live
  const form = container.querySelector('.ce-card:has(#studio-title)');
  container.querySelectorAll('#studio-title, [name="ce-mode"], [name="ce-source"], #studio-media-path')
    .forEach(inp => { if (isLive) inp.setAttribute('disabled',''); else inp.removeAttribute('disabled'); });
}

function refreshStudioEvents(container) {
  const feed = container.querySelector('#studio-events');
  if (!feed) return;
  const events = Store.get('events').slice(0, 15);
  if (!events.length) return;
  feed.innerHTML = events.map(evt => `
    <div class="ce-event-item">
      <span class="ce-event-time" style="font-size:10px">${formatTime(evt.timestamp)}</span>
      <span class="ce-event-body" style="font-size:11px">${_escapeHtml(evt.type?.replace(/_/g,' ')??'')}: ${_escapeHtml(String(evt.data?.message??''))}</span>
    </div>`).join('');
}

function _setBadge(container, sel, html) {
  const el = container.querySelector(sel);
  if (el) el.innerHTML = html;
}

function _setMetricText(container, sel, value) {
  const el = container.querySelector(sel);
  if (!el) return;
  el.innerHTML = value ?? UNAVAILABLE;
}

/* ═══════════════════════════════════
   EVENTS
═══════════════════════════════════ */
function bindStudioEvents(container) {
  // Source selection toggle
  container.addEventListener('change', (e) => {
    if (e.target.name === 'ce-source') {
      const isMedia = e.target.value === 'MEDIA_FILE';
      const mediaGroup = container.querySelector('#studio-media-group');
      if (mediaGroup) mediaGroup.style.display = isMedia ? '' : 'none';
      // Update selected styling
      container.querySelectorAll('.ce-source-option').forEach(opt => {
        opt.classList.toggle('selected', opt.getAttribute('data-source') === e.target.value);
      });
    }
  });

  // GO LIVE
  const goLiveBtn = container.querySelector('#studio-go-live-btn');
  goLiveBtn?.addEventListener('click', async () => {
    const title   = container.querySelector('#studio-title')?.value?.trim();
    const mode    = container.querySelector('[name="ce-mode"]:checked')?.value;
    const source  = container.querySelector('[name="ce-source"]:checked')?.value;
    const path    = container.querySelector('#studio-media-path')?.value?.trim();

    if (!title) { toast('Broadcast title is required.', 'warn'); return; }
    if (!mode)  { toast('Select a broadcast mode.', 'warn'); return; }
    if (!source){ toast('Select a source.', 'warn'); return; }
    if (source === 'MEDIA_FILE' && !path) {
      toast('Enter the server-side media file path.', 'warn'); return;
    }

    const params = {
      title,
      mode,
      sourceConfig: { sourceType: source, inputPath: path ?? null },
      destinationIds: null,  // null = use all registered destinations
      // ffmpegPath is resolved server-side from environment/config
    };

    const result = await sendControlCommand(CC.START_BROADCAST, params);
    if (result.success) {
      toast('GO LIVE command sent. Waiting for engine confirmation.', 'success');
      Store.pushEvent('broadcast_starting', { title, mode, sourceType: source });
    } else {
      toast(`Go Live failed: ${result.message}`, 'error');
    }
  });

  // STOP
  const stopBtn = container.querySelector('#studio-stop-btn');
  stopBtn?.addEventListener('click', async () => {
    const ok = await confirm(
      'Stop Broadcast?',
      'This will immediately stop the broadcast and disconnect all destinations. This cannot be undone.',
      'STOP BROADCAST'
    );
    if (!ok) return;
    const result = await sendControlCommand(CC.STOP_BROADCAST);
    if (result.success) {
      toast('Stop command sent.', 'info');
    } else {
      toast(`Stop failed: ${result.message}`, 'error');
    }
  });
}
