/**
 * 24-HOUR CLOUD ENGINE — Screen: Now Playing
 * cloud-engine-ui/js/screens/ce-screen-now-playing.js
 *
 * Shows the current live state across all active systems.
 * Maps to: BroadcastStudio.getDashboard(), StationState, HybridModeState
 *
 * Shows real data only. Unavailable values display "Unavailable" or "—".
 * Does NOT fabricate playback progress.
 */

import * as Store from '../ce-store.js';
import { broadcastStateBadge, stationStateBadge, hybridStateBadge,
         badge, formatUptime, formatTime, formatBytes,
         UNAVAILABLE, _escapeHtml } from '../ce-utils.js';

export function renderNowPlaying(container) {
  container.innerHTML = buildNowPlayingHTML();
  refreshNowPlaying(container);

  const unsubs = [
    Store.subscribe('broadcast', () => refreshNowPlaying(container)),
    Store.subscribe('tvStation', () => refreshNowPlaying(container)),
    Store.subscribe('hybrid',    () => refreshNowPlaying(container)),
    Store.subscribe('encoder',   () => refreshNowPlaying(container)),
    Store.subscribe('ingest',    () => refreshNowPlaying(container)),
    Store.subscribe('destinations', () => refreshNowPlaying(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildNowPlayingHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Now Playing</h1>
  <p class="ce-screen-subtitle">Current broadcast, source, and destination status</p>
</div>

<!-- Broadcast Now Playing -->
<div class="ce-section">
  <div class="ce-section-title">Broadcast</div>
  <div class="ce-card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;color:var(--ce-text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">Broadcast State</div>
        <div id="np-broadcast-badge"></div>
        <div id="np-broadcast-title" style="font-size:16px;font-weight:600;color:var(--ce-text-heading);margin-top:8px">—</div>
        <div id="np-broadcast-mode" style="font-size:11px;color:var(--ce-text-muted)">—</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--ce-text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">Duration</div>
        <div class="ce-mono" style="font-size:20px;font-weight:700;color:var(--ce-text-heading)" id="np-uptime">--:--:--</div>
        <div style="font-size:10px;color:var(--ce-text-muted);margin-top:2px" id="np-started">—</div>
      </div>
    </div>
  </div>
</div>

<!-- Source Status -->
<div class="ce-section">
  <div class="ce-section-title">Source / Ingest</div>
  <div class="ce-card">
    <div style="display:grid;gap:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Source Type</span>
        <span id="np-source-type">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Ingest State</span>
        <span id="np-ingest-state"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Session ID</span>
        <span class="ce-mono" style="font-size:11px" id="np-session-id">—</span>
      </div>
    </div>
  </div>
</div>

<!-- Encoder Status -->
<div class="ce-section">
  <div class="ce-section-title">Encoder</div>
  <div class="ce-metric-grid" style="margin-top:0">
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Speed</div>
      <div class="ce-metric-value ce-mono" id="np-enc-speed">—</div>
      <div class="ce-metric-sub">x realtime</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">FPS</div>
      <div class="ce-metric-value ce-mono" id="np-enc-fps">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Bitrate</div>
      <div class="ce-metric-value ce-mono" id="np-enc-bitrate">—</div>
      <div class="ce-metric-sub">kbps</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Bytes Sent</div>
      <div class="ce-metric-value ce-mono" id="np-bytes">—</div>
    </div>
  </div>
</div>

<!-- Destinations -->
<div class="ce-section">
  <div class="ce-section-title">Destination Status</div>
  <div id="np-dests" style="display:flex;flex-direction:column;gap:6px">
    <div class="ce-text-muted" style="font-style:italic">No active destinations</div>
  </div>
</div>

<!-- TV Station Status -->
<div class="ce-section">
  <div class="ce-section-title">TV Station</div>
  <div class="ce-card">
    <div style="display:grid;gap:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Station State</span>
        <span id="np-tv-state"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Current Program</span>
        <span id="np-tv-current">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Next Program</span>
        <span id="np-tv-next">—</span>
      </div>
    </div>
  </div>
</div>

<!-- Hybrid State -->
<div class="ce-section">
  <div class="ce-section-title">Hybrid Mode</div>
  <div class="ce-card">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span class="ce-text-muted" style="font-size:13px">Hybrid State</span>
      <span id="np-hybrid-state"></span>
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--ce-text-muted)" id="np-hybrid-detail">—</div>
  </div>
</div>
`;
}

function refreshNowPlaying(container) {
  const broadcast = Store.get('broadcast');
  const encoder   = Store.get('encoder');
  const ingest    = Store.get('ingest');
  const dests     = Store.get('destinations');
  const tvStation = Store.get('tvStation');
  const hybrid    = Store.get('hybrid');
  const isLive    = broadcast.state === 'BROADCASTING' || broadcast.state === 'PARTIAL';

  // Broadcast section
  _setHTML(container, '#np-broadcast-badge', broadcastStateBadge(broadcast.state));
  _setText(container, '#np-broadcast-title', broadcast.title ?? (isLive ? 'Untitled Broadcast' : 'No active broadcast'));
  _setText(container, '#np-broadcast-mode',  broadcast.mode  ?? '—');
  _setText(container, '#np-uptime', formatUptime(broadcast.uptimeSec));
  _setText(container, '#np-started', broadcast.startedAt ? `Started ${formatTime(broadcast.startedAt)}` : '—');

  // Source
  _setText(container, '#np-source-type',  ingest.sourceType ?? '—');
  _setHTML(container, '#np-ingest-state',  badge(
    ingest.state === 'ACTIVE' ? 'ACTIVE' : ingest.state ?? '—',
    ingest.state === 'ACTIVE' ? 'live' : 'offline'
  ));
  _setText(container, '#np-session-id', ingest.activeSessionId ?? '—');

  // Encoder metrics
  _setMetric(container, '#np-enc-speed',   encoder.speed   != null ? `${encoder.speed}x` : null);
  _setMetric(container, '#np-enc-fps',     encoder.fps     != null ? `${encoder.fps}`     : null);
  _setMetric(container, '#np-enc-bitrate', encoder.bitrate != null ? `${encoder.bitrate}` : null);
  _setMetric(container, '#np-bytes', broadcast.totalBytesSent != null
    ? formatBytes(broadcast.totalBytesSent) : null);

  // Destinations
  const destEl = container.querySelector('#np-dests');
  if (destEl) {
    if (!dests || dests.length === 0) {
      destEl.innerHTML = `<div class="ce-text-muted" style="font-style:italic">No active destinations</div>`;
    } else {
      const stateMap = { 'BROADCASTING':'live','CONNECTED':'ready','DISCONNECTED':'offline','FAILED':'error','RECONNECTING':'recovering' };
      destEl.innerHTML = dests.map(d => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--ce-bg-card);border:1px solid var(--ce-border);border-radius:var(--ce-radius);font-size:12px">
          <span style="flex:1;font-weight:500">${_escapeHtml(d.name ?? d.destinationId ?? '—')}</span>
          ${badge(d.state ?? '—', stateMap[d.state] ?? 'offline')}
          <span class="ce-mono" style="color:var(--ce-text-muted)">${formatUptime(d.uptimeSec)}</span>
        </div>`).join('');
    }
  }

  // TV Station
  _setHTML(container, '#np-tv-state',   stationStateBadge(tvStation.stationState));
  _setText(container, '#np-tv-current', tvStation.currentProgram?.title ?? '—');
  _setText(container, '#np-tv-next',    tvStation.nextProgram?.title    ?? '—');

  // Hybrid
  _setHTML(container, '#np-hybrid-state',  hybridStateBadge(hybrid.hybridState));
  _setText(container, '#np-hybrid-detail', hybrid.hybridState === 'LIVE'
    ? 'Live override active — station paused'
    : hybrid.hybridState === 'STATION'
    ? 'Station running normally'
    : hybrid.hybridState === 'RETURNING_TO_STATION'
    ? 'Returning to station programming…'
    : '—');
}

function _setText(container, sel, text) {
  const el = container.querySelector(sel);
  if (el) el.textContent = text ?? '—';
}

function _setHTML(container, sel, html) {
  const el = container.querySelector(sel);
  if (el) el.innerHTML = html ?? '';
}

function _setMetric(container, sel, value) {
  const el = container.querySelector(sel);
  if (!el) return;
  el.innerHTML = value ?? UNAVAILABLE;
}
