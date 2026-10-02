/**
 * 24-HOUR CLOUD ENGINE — Screen: Dashboard
 * cloud-engine-ui/js/screens/ce-screen-dashboard.js
 *
 * Main dashboard showing engine status, broadcast health, quick actions,
 * metrics, and recent events.
 *
 * Data sources (from existing backend):
 *   - cloud_engine_state/current (Firestore) → engine.status, broadcast metrics
 *   - BroadcastStudio.getDashboard() via Firebase control plane
 *   - CLOUD_ENGINE_EVENTS emitted by the backend
 *
 * All metric values that cannot be measured display "Unavailable".
 */

import * as Store from '../ce-store.js';
import { badge, engineStatusBadge, broadcastStateBadge, stationStateBadge,
         hybridStateBadge, formatUptime, formatBytes, formatTime,
         UNAVAILABLE, _escapeHtml } from '../ce-utils.js';
import { sendControlCommand } from '../ce-firebase-bridge.js';

/* ── CONTROL_COMMAND constants (mirrors firebase-control.js) ─ */
const CC = {
  START_BROADCAST:      'START_BROADCAST',
  STOP_BROADCAST:       'STOP_BROADCAST',
  GET_ENGINE_STATUS:    'GET_ENGINE_STATUS',
  GET_BROADCAST_STATUS: 'GET_BROADCAST_STATUS',
};

/* ═══════════════════════════════════
   RENDER
═══════════════════════════════════ */
export function renderDashboard(container) {
  container.innerHTML = buildDashboardHTML();
  bindDashboardEvents(container);
  refreshDashboard(container);

  // Subscribe to state updates
  const unsubs = [
    Store.subscribe('engine',    () => refreshDashboard(container)),
    Store.subscribe('broadcast', () => refreshDashboard(container)),
    Store.subscribe('encoder',   () => refreshDashboard(container)),
    Store.subscribe('ingest',    () => refreshDashboard(container)),
    Store.subscribe('destinations', () => refreshDashboard(container)),
    Store.subscribe('events',    () => refreshEventFeed(container)),
    Store.subscribe('tvStation', () => refreshDashboard(container)),
    Store.subscribe('watchdog',  () => refreshDashboard(container)),
    Store.subscribe('recovery',  () => refreshDashboard(container)),
    Store.subscribe('firebase',  () => refreshDashboard(container)),
  ];

  return () => unsubs.forEach(fn => fn());
}

function buildDashboardHTML() {
  return `
<div class="ce-screen-header">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <h1 class="ce-screen-title">Dashboard</h1>
      <p class="ce-screen-subtitle">Live engine status and broadcast control</p>
    </div>
    <div style="font-size:11px;color:var(--ce-text-muted);text-align:right;margin-top:4px">
      24-Hour Cloud Engine v0.13.0 · Stage 13
    </div>
  </div>
</div>

<!-- Engine Offline Banner -->
<div class="ce-section" id="db-offline-banner" style="display:none">
  <div class="ce-engine-offline-banner">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" style="width:18px;height:18px;flex-shrink:0"><circle cx="10" cy="10" r="7"/><path d="M10 7v4m0 2v.5" stroke-linecap="round"/></svg>
    <div>
      <strong>Cloud Engine Offline</strong> —
      The frontend is loaded but the Cloud Engine runtime is not reachable.
      The engine must be running on a persistent server host (not GitHub Pages).
    </div>
  </div>
</div>

<!-- Engine Status Card -->
<div class="ce-section">
  <div class="ce-dashboard-status-card" id="db-status-card">
    <div class="ce-dashboard-status-icon ce-status-icon-offline" id="db-status-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="ce-dashboard-status-info">
      <div class="ce-dashboard-status-state" id="db-engine-state">OFFLINE</div>
      <div class="ce-dashboard-status-detail" id="db-engine-detail">Cloud Engine runtime not connected</div>
    </div>
    <div id="db-engine-badge"></div>
  </div>
</div>

<!-- Quick Actions -->
<div class="ce-section">
  <div class="ce-section-title">Quick Actions</div>
  <div class="ce-quick-actions">
    <button class="ce-btn ce-btn-live" id="db-go-live-btn" data-screen="studio">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="10" cy="10" r="4" fill="currentColor"/><circle cx="10" cy="10" r="8"/></svg>
      GO LIVE
    </button>
    <button class="ce-btn ce-btn-stop" id="db-stop-btn" style="display:none">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px"><rect x="4" y="4" width="12" height="12" rx="1"/></svg>
      STOP BROADCAST
    </button>
    <button class="ce-btn ce-btn-outline" id="db-studio-btn" data-screen="studio">Open Studio</button>
    <button class="ce-btn ce-btn-outline" id="db-tv-btn" data-screen="tv-station">TV Station</button>
    <button class="ce-btn ce-btn-outline" id="db-media-btn" data-screen="media">Media</button>
  </div>
</div>

<!-- Metrics -->
<div class="ce-section">
  <div class="ce-section-title">Engine Metrics</div>
  <div class="ce-metric-grid" id="db-metrics-grid">
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Status</div>
      <div class="ce-metric-value" id="db-m-status">OFFLINE</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Uptime</div>
      <div class="ce-metric-value ce-mono" id="db-m-uptime">--:--:--</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Active Destinations</div>
      <div class="ce-metric-value" id="db-m-dests">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Failed Destinations</div>
      <div class="ce-metric-value" id="db-m-failed">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Encoder Speed</div>
      <div class="ce-metric-value ce-mono" id="db-m-speed">Unavailable</div>
      <div class="ce-metric-sub">x realtime</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">FPS</div>
      <div class="ce-metric-value ce-mono" id="db-m-fps">Unavailable</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Bitrate</div>
      <div class="ce-metric-value ce-mono" id="db-m-bitrate">Unavailable</div>
      <div class="ce-metric-sub">kbps</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Bytes Sent</div>
      <div class="ce-metric-value ce-mono" id="db-m-bytes">Unavailable</div>
    </div>
  </div>
</div>

<!-- Component Health Grid -->
<div class="ce-section">
  <div class="ce-section-title">Component Health</div>
  <div class="ce-health-grid" id="db-health-grid">
    ${healthRow('Engine Core',    'engine-core')}
    ${healthRow('Encoder',        'encoder-h')}
    ${healthRow('Broadcast',      'broadcast-h')}
    ${healthRow('Fan-Out',        'fanout-h')}
    ${healthRow('Ingest',         'ingest-h')}
    ${healthRow('Firebase',       'firebase-h')}
    ${healthRow('TV Station',     'tv-h')}
    ${healthRow('Hybrid Mode',    'hybrid-h')}
    ${healthRow('Watchdog',       'watchdog-h')}
    ${healthRow('Recovery',       'recovery-h')}
  </div>
</div>

<!-- Broadcast / Destination Summary -->
<div class="ce-section" id="db-dest-section">
  <div class="ce-section-title">Destination Status</div>
  <div id="db-dest-list" class="ce-card" style="padding:0;overflow:hidden">
    <table class="ce-table">
      <thead><tr>
        <th>Destination</th>
        <th>State</th>
        <th>Uptime</th>
        <th>Reconnects</th>
        <th>Last Error</th>
      </tr></thead>
      <tbody id="db-dest-tbody">
        <tr><td colspan="5" class="ce-text-muted" style="text-align:center;padding:20px">No destinations configured</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Recent Events -->
<div class="ce-section">
  <div class="ce-section-title">Recent Events</div>
  <div class="ce-event-feed" id="db-event-feed">
    <div class="ce-event-item">
      <span class="ce-event-time">—</span>
      <span class="ce-event-type">SYSTEM</span>
      <span class="ce-event-body">Frontend loaded. Waiting for engine connection.</span>
    </div>
  </div>
</div>
`;
}

function healthRow(label, id) {
  return `
    <div class="ce-health-item">
      <span class="ce-health-item-name">${_escapeHtml(label)}</span>
      <span id="db-h-${id}"></span>
    </div>`;
}

/* ═══════════════════════════════════
   REFRESH
═══════════════════════════════════ */
function refreshDashboard(container) {
  const engine    = Store.get('engine');
  const broadcast = Store.get('broadcast');
  const encoder   = Store.get('encoder');
  const ingest    = Store.get('ingest');
  const dests     = Store.get('destinations');
  const fb        = Store.get('firebase');
  const tvStation = Store.get('tvStation');
  const hybrid    = Store.get('hybrid');
  const watchdog  = Store.get('watchdog');
  const recovery  = Store.get('recovery');

  const isOnline  = engine.status !== 'OFFLINE' && engine.status !== 'UNKNOWN';
  const isLive    = broadcast.state === 'BROADCASTING' || broadcast.state === 'PARTIAL';

  // Offline banner
  const banner = container.querySelector('#db-offline-banner');
  if (banner) banner.style.display = isOnline ? 'none' : '';

  // Status card
  const stateEl  = container.querySelector('#db-engine-state');
  const detailEl = container.querySelector('#db-engine-detail');
  const iconEl   = container.querySelector('#db-status-icon');
  const badgeEl  = container.querySelector('#db-engine-badge');

  if (stateEl) stateEl.textContent = isLive ? 'LIVE — BROADCASTING' : engine.status;
  if (detailEl) {
    if (isLive) {
      detailEl.textContent = `${broadcast.title ?? 'Untitled'} · ${broadcast.activeSessions} destination(s) active`;
    } else if (isOnline) {
      detailEl.textContent = `Engine version ${engine.version?.version ?? '—'} · Uptime ${formatUptime(engine.uptime)}`;
    } else {
      detailEl.textContent = 'Cloud Engine runtime not connected. Deploy and start the Node.js server.';
    }
  }
  if (iconEl) {
    iconEl.className = `ce-dashboard-status-icon ${isLive ? 'ce-status-icon-live' : isOnline ? 'ce-status-icon-ready' : 'ce-status-icon-offline'}`;
  }
  if (badgeEl) badgeEl.innerHTML = engineStatusBadge(isLive ? 'RUNNING' : engine.status);

  // Stop button visibility
  const stopBtn = container.querySelector('#db-stop-btn');
  if (stopBtn) stopBtn.style.display = isLive ? '' : 'none';

  // Metrics
  setMetric(container, '#db-m-status',  isLive ? 'LIVE' : engine.status);
  setMetric(container, '#db-m-uptime',  formatUptime(engine.uptime));
  setMetric(container, '#db-m-dests',   broadcast.activeSessions != null ? String(broadcast.activeSessions) : '—');
  setMetric(container, '#db-m-failed',  broadcast.failedSessions != null ? String(broadcast.failedSessions) : '—', broadcast.failedSessions > 0 ? 'err' : '');
  setMetric(container, '#db-m-speed',   encoder.speed   != null ? `${encoder.speed}x`  : null);
  setMetric(container, '#db-m-fps',     encoder.fps     != null ? String(encoder.fps)  : null);
  setMetric(container, '#db-m-bitrate', encoder.bitrate != null ? String(encoder.bitrate) : null);
  setMetric(container, '#db-m-bytes',   broadcast.totalBytesSent != null ? formatBytes(broadcast.totalBytesSent) : null);

  // Component health
  const fbOk = fb.status === 'CONNECTED';
  setHealth(container, 'engine-core', isOnline  ? 'ok'   : 'offline',  engine.status);
  setHealth(container, 'encoder-h',   encoder.status !== 'UNINITIALIZED' && encoder.status !== 'ERROR' ? 'ok' : encoder.status === 'ERROR' ? 'error' : 'offline', encoder.status);
  setHealth(container, 'broadcast-h', isLive    ? 'live' : broadcast.state === 'IDLE' ? 'offline' : 'ok', broadcast.state);
  setHealth(container, 'fanout-h',    isLive    ? 'live' : 'offline',  broadcast.state);
  setHealth(container, 'ingest-h',    ingest.state === 'ACTIVE' ? 'live' : 'offline', ingest.state);
  setHealth(container, 'firebase-h',  fbOk       ? 'ok'  : 'offline',  fb.status);
  setHealth(container, 'tv-h',        tvStation.stationState === 'ON_AIR' ? 'live' : tvStation.stationState === 'OFFLINE' ? 'offline' : 'ok', tvStation.stationState);
  setHealth(container, 'hybrid-h',    hybrid.hybridState === 'LIVE' ? 'live' : hybrid.hybridState === 'OFFLINE' ? 'offline' : 'ok', hybrid.hybridState);
  setHealth(container, 'watchdog-h',  watchdog.active ? 'ok' : 'offline', watchdog.active ? 'ACTIVE' : 'INACTIVE');
  setHealth(container, 'recovery-h',  recovery.status === 'UNKNOWN' ? 'offline' : 'ok', recovery.status);

  // Destinations table
  refreshDestinationsTable(container, dests);

  // Event feed
  refreshEventFeed(container);
}

function setMetric(container, sel, value, cls = '') {
  const el = container.querySelector(sel);
  if (!el) return;
  if (value == null) { el.innerHTML = UNAVAILABLE; el.className = 'ce-metric-value'; }
  else { el.textContent = value; el.className = `ce-metric-value ce-mono${cls ? ' '+cls : ''}`; }
}

function setHealth(container, id, variant, label) {
  const el = container.querySelector(`#db-h-${id}`);
  if (!el) return;
  const vmap = {
    'ok':         ['OK',         'ready'],
    'live':       ['LIVE',       'live'],
    'error':      ['ERROR',      'error'],
    'offline':    ['OFFLINE',    'offline'],
    'recovering': ['RECOVERING', 'recovering'],
    'warn':       ['WARN',       'warn'],
  };
  const [badgeLabel, badgeCls] = vmap[variant] ?? [label ?? '—', 'offline'];
  el.innerHTML = badge(badgeLabel, badgeCls);
}

function refreshDestinationsTable(container, dests) {
  const tbody = container.querySelector('#db-dest-tbody');
  if (!tbody) return;
  if (!dests || dests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="ce-text-muted" style="text-align:center;padding:20px">No destinations configured</td></tr>`;
    return;
  }
  tbody.innerHTML = dests.map(d => {
    const stateMap = {
      'CONNECTED': ['CONNECTED', 'connected'],
      'BROADCASTING': ['LIVE', 'live'],
      'DISCONNECTED': ['DISCONNECTED', 'disconnected'],
      'RECONNECTING': ['RECONNECTING', 'recovering'],
      'FAILED': ['FAILED', 'error'],
      'STOPPED': ['STOPPED', 'offline'],
    };
    const [sl, sc] = stateMap[d.state] ?? [d.state ?? '—', 'offline'];
    return `<tr>
      <td><strong>${_escapeHtml(d.name ?? d.destinationId ?? '—')}</strong></td>
      <td>${badge(sl, sc)}</td>
      <td class="ce-mono">${formatUptime(d.uptimeSec)}</td>
      <td class="ce-mono">${d.reconnectCount ?? 0}</td>
      <td style="font-size:11px;color:var(--ce-text-muted)">${_escapeHtml(d.error?.message ?? d.lastError?.message ?? '—')}</td>
    </tr>`;
  }).join('');
}

function refreshEventFeed(container) {
  const feed  = container.querySelector('#db-event-feed');
  if (!feed) return;
  const events = Store.get('events');
  if (!events || events.length === 0) return;

  feed.innerHTML = events.slice(0, 30).map(evt => {
    const typeClass = _eventTypeClass(evt.type);
    const body = _safeEventBody(evt.data);
    return `<div class="ce-event-item">
      <span class="ce-event-time">${formatTime(evt.timestamp)}</span>
      <span class="ce-event-type ${typeClass}">${_escapeHtml(evt.type ?? '').replace(/_/g,' ')}</span>
      <span class="ce-event-body">${_escapeHtml(body)}</span>
    </div>`;
  }).join('');
}

function _eventTypeClass(type) {
  if (!type) return '';
  if (type.includes('broadcast')) return 'broadcast';
  if (type.includes('destination')) return 'destination';
  if (type.includes('encoder')) return 'encoder';
  if (type.includes('error') || type.includes('failed')) return 'error';
  if (type.includes('ingest')) return 'ingest';
  return '';
}

function _safeEventBody(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  // Extract safe fields (no secrets)
  const safe = [];
  if (data.message)        safe.push(data.message);
  if (data.destinationId)  safe.push(`dest=${data.destinationId}`);
  if (data.sourceType)     safe.push(`src=${data.sourceType}`);
  if (data.title)          safe.push(`"${data.title}"`);
  return safe.join(' · ') || JSON.stringify(data).slice(0, 120);
}

/* ═══════════════════════════════════
   EVENTS
═══════════════════════════════════ */
function bindDashboardEvents(container) {
  // Quick action buttons navigate to screens via data-screen
  container.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.getAttribute('data-screen');
      window.location.hash = `#${screen}`;
    });
  });

  // Stop broadcast button
  const stopBtn = container.querySelector('#db-stop-btn');
  stopBtn?.addEventListener('click', async () => {
    const { confirm, toast } = await import('../ce-utils.js');
    const ok = await confirm(
      'Stop Broadcast?',
      'Stopping the broadcast will disconnect all destinations immediately. This cannot be undone.',
      'STOP BROADCAST'
    );
    if (!ok) return;
    const result = await sendControlCommand(CC.STOP_BROADCAST);
    if (result.success) {
      toast('Stop command sent. Waiting for engine to confirm.', 'info');
    } else {
      toast(`Stop failed: ${result.message}`, 'error');
    }
  });
}
