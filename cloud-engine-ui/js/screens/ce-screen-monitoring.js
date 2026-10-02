/**
 * 24-HOUR CLOUD ENGINE — Screen: Monitoring
 * cloud-engine-ui/js/screens/ce-screen-monitoring.js
 *
 * Real-time component health monitoring.
 * Maps to: Watchdog, RecoveryEngine, HealthMonitor
 *
 * Components monitored (from watchdog.js):
 *   Engine Core, Shadow Encoder, Ingest, Media Playback,
 *   Fan-Out Manager, Destination Sessions, Platform Connectors,
 *   TV Station, Hybrid Mode, Firebase Control
 */

import * as Store from '../ce-store.js';
import { badge, formatTime, formatUptime, _escapeHtml, UNAVAILABLE } from '../ce-utils.js';

export function renderMonitoring(container) {
  container.innerHTML = buildMonitoringHTML();
  refreshMonitoring(container);

  const unsubs = [
    Store.subscribe('engine',      () => refreshMonitoring(container)),
    Store.subscribe('broadcast',   () => refreshMonitoring(container)),
    Store.subscribe('encoder',     () => refreshMonitoring(container)),
    Store.subscribe('ingest',      () => refreshMonitoring(container)),
    Store.subscribe('tvStation',   () => refreshMonitoring(container)),
    Store.subscribe('hybrid',      () => refreshMonitoring(container)),
    Store.subscribe('watchdog',    () => refreshMonitoring(container)),
    Store.subscribe('recovery',    () => refreshMonitoring(container)),
    Store.subscribe('firebase',    () => refreshMonitoring(container)),
    Store.subscribe('destinations',() => refreshMonitoring(container)),
    Store.subscribe('events',      () => refreshEventLog(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildMonitoringHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Monitoring</h1>
  <p class="ce-screen-subtitle">Real-time component health and system events</p>
</div>

<!-- Component Overview -->
<div class="ce-section">
  <div class="ce-section-title">Components</div>
  <div style="display:flex;flex-direction:column;gap:6px" id="mon-components">
    ${monitorRow('engine-core',  'Engine Core')}
    ${monitorRow('encoder',      'Shadow Encoder')}
    ${monitorRow('broadcast',    'Broadcast / Fan-Out')}
    ${monitorRow('ingest',       'Ingest')}
    ${monitorRow('destinations', 'Destinations')}
    ${monitorRow('platforms',    'Platform Connectors')}
    ${monitorRow('tv-station',   'TV Station')}
    ${monitorRow('hybrid',       'Hybrid Mode')}
    ${monitorRow('watchdog',     'Watchdog')}
    ${monitorRow('recovery',     'Recovery Engine')}
    ${monitorRow('firebase',     'Firebase Control')}
    ${monitorRow('control-plane','Control Plane')}
  </div>
</div>

<!-- Broadcast Metrics -->
<div class="ce-section">
  <div class="ce-section-title">Broadcast Metrics</div>
  <div class="ce-metric-grid" style="margin-top:0">
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Broadcast State</div>
      <div class="ce-metric-value" id="mon-bc-state">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Active Destinations</div>
      <div class="ce-metric-value ce-mono" id="mon-active-dests">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Failed Destinations</div>
      <div class="ce-metric-value ce-mono" id="mon-failed-dests">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Encoder Speed</div>
      <div class="ce-metric-value ce-mono" id="mon-enc-speed">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">FPS</div>
      <div class="ce-metric-value ce-mono" id="mon-enc-fps">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Uptime</div>
      <div class="ce-metric-value ce-mono" id="mon-uptime">—</div>
    </div>
  </div>
</div>

<!-- Destination Details -->
<div class="ce-section">
  <div class="ce-section-title">Destination Details</div>
  <div class="ce-card" style="padding:0;overflow:hidden">
    <table class="ce-table">
      <thead><tr>
        <th>Name</th>
        <th>State</th>
        <th>Uptime</th>
        <th>Reconnects</th>
        <th>Last Error</th>
      </tr></thead>
      <tbody id="mon-dest-tbody">
        <tr><td colspan="5" class="ce-text-muted" style="text-align:center;padding:16px">No destinations</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Event Log -->
<div class="ce-section">
  <div class="ce-section-title">System Event Log (Last 50)</div>
  <div class="ce-event-feed" id="mon-event-log" style="max-height:400px"></div>
</div>
`;
}

function monitorRow(id, label) {
  return `
  <div class="ce-monitor-component">
    <div class="ce-monitor-name">${_escapeHtml(label)}</div>
    <div class="ce-monitor-detail" id="mon-detail-${id}"></div>
    <div id="mon-badge-${id}"></div>
  </div>`;
}

function refreshMonitoring(container) {
  const engine    = Store.get('engine');
  const broadcast = Store.get('broadcast');
  const encoder   = Store.get('encoder');
  const ingest    = Store.get('ingest');
  const tvStation = Store.get('tvStation');
  const hybrid    = Store.get('hybrid');
  const watchdog  = Store.get('watchdog');
  const recovery  = Store.get('recovery');
  const firebase  = Store.get('firebase');
  const dests     = Store.get('destinations') ?? [];

  const isOnline = engine.status !== 'OFFLINE' && engine.status !== 'UNKNOWN';
  const isLive   = broadcast.state === 'BROADCASTING' || broadcast.state === 'PARTIAL';

  // Component rows
  _setMon(container, 'engine-core',  isOnline ? 'ok' : 'offline', engine.status);
  _setMon(container, 'encoder',
    encoder.status === 'ENCODING' ? 'live' : encoder.status === 'ERROR' ? 'error' : 'offline',
    encoder.status, encoder.status);
  _setMon(container, 'broadcast', isLive ? 'live' : broadcast.state === 'PARTIAL' ? 'partial' : 'offline',
    broadcast.state, broadcast.title ?? '—');
  _setMon(container, 'ingest',
    ingest.state === 'ACTIVE' ? 'live' : 'offline',
    ingest.state, ingest.sourceType ?? '—');
  _setMon(container, 'destinations',
    dests.some(d => d.state === 'FAILED') ? 'error' : dests.some(d => d.state === 'BROADCASTING' || d.state === 'CONNECTED') ? 'live' : 'offline',
    `${dests.filter(d => d.state === 'BROADCASTING' || d.state === 'CONNECTED').length}/${dests.length} active`);
  _setMon(container, 'platforms',   'arch',    'ARCHITECTURE READY');
  _setMon(container, 'tv-station',
    tvStation.stationState === 'ON_AIR' ? 'live' : tvStation.stationState === 'ERROR' ? 'error' : 'offline',
    tvStation.stationState, tvStation.currentProgram?.title ?? '—');
  _setMon(container, 'hybrid',
    hybrid.hybridState === 'LIVE' ? 'live' : hybrid.hybridState === 'ERROR' ? 'error' : 'offline',
    hybrid.hybridState);
  _setMon(container, 'watchdog',  watchdog.active ? 'ok' : 'offline', watchdog.active ? 'ACTIVE' : 'INACTIVE');
  _setMon(container, 'recovery',  recovery.status === 'UNKNOWN' ? 'offline' : 'ok', recovery.status);
  _setMon(container, 'firebase',  firebase.status === 'CONNECTED' ? 'ok' : 'offline', firebase.status);
  _setMon(container, 'control-plane', firebase.status === 'CONNECTED' ? 'ok' : 'offline', 'Firebase command queue');

  // Metrics
  _setMetric(container, '#mon-bc-state',      broadcast.state ?? '—');
  _setMetric(container, '#mon-active-dests',  String(broadcast.activeSessions ?? 0));
  _setMetric(container, '#mon-failed-dests',  String(broadcast.failedSessions ?? 0));
  _setMetric(container, '#mon-enc-speed',     encoder.speed   != null ? `${encoder.speed}x` : null);
  _setMetric(container, '#mon-enc-fps',       encoder.fps     != null ? `${encoder.fps}`    : null);
  _setMetric(container, '#mon-uptime',        formatUptime(engine.uptime));

  // Destination table
  const tbody = container.querySelector('#mon-dest-tbody');
  if (tbody) {
    if (dests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="ce-text-muted" style="text-align:center;padding:16px">No destinations</td></tr>`;
    } else {
      const stateMap = { 'CONNECTED':'connected','BROADCASTING':'live','DISCONNECTED':'disconnected','FAILED':'error','RECONNECTING':'recovering','STOPPED':'offline' };
      tbody.innerHTML = dests.map(d => `
        <tr>
          <td>${_escapeHtml(d.name ?? d.destinationId ?? '—')}</td>
          <td>${badge(d.state ?? '—', stateMap[d.state] ?? 'offline')}</td>
          <td class="ce-mono">${formatUptime(d.uptimeSec)}</td>
          <td class="ce-mono">${d.reconnectCount ?? 0}</td>
          <td style="font-size:11px;color:var(--ce-text-muted)">${_escapeHtml(String(d.error?.message ?? d.lastError?.message ?? '—'))}</td>
        </tr>`).join('');
    }
  }

  refreshEventLog(container);
}

function _setMon(container, id, variant, statusLabel, detail = '') {
  const badgeEl  = container.querySelector(`#mon-badge-${id}`);
  const detailEl = container.querySelector(`#mon-detail-${id}`);

  const vmap = {
    ok:      ['OK',         'ready'],
    live:    ['LIVE',       'live'],
    error:   ['ERROR',      'error'],
    offline: ['OFFLINE',    'offline'],
    arch:    ['ARCH READY', 'arch'],
    partial: ['PARTIAL',    'partial'],
    warn:    ['WARN',       'warn'],
    recovering: ['RECOVERING','recovering'],
  };
  const [bLabel, bCls] = vmap[variant] ?? [statusLabel ?? '—', 'offline'];
  if (badgeEl)  badgeEl.innerHTML  = badge(bLabel, bCls);
  if (detailEl) detailEl.textContent = detail || statusLabel || '';
}

function _setMetric(container, sel, value) {
  const el = container.querySelector(sel);
  if (!el) return;
  el.innerHTML = value ?? UNAVAILABLE;
}

function refreshEventLog(container) {
  const logEl = container.querySelector('#mon-event-log');
  if (!logEl) return;
  const events = Store.get('events').slice(0, 50);
  if (events.length === 0) {
    logEl.innerHTML = `<div class="ce-text-muted" style="font-style:italic;padding:12px">No events recorded yet.</div>`;
    return;
  }
  logEl.innerHTML = events.map(evt => {
    const typeClass = evt.type?.includes('error') || evt.type?.includes('fail') ? 'error'
      : evt.type?.includes('broadcast') ? 'broadcast'
      : evt.type?.includes('dest') ? 'destination'
      : evt.type?.includes('encoder') ? 'encoder'
      : evt.type?.includes('ingest') ? 'ingest' : '';
    const body = typeof evt.data === 'object'
      ? (evt.data?.message ?? JSON.stringify(evt.data).slice(0, 100))
      : String(evt.data ?? '');
    return `<div class="ce-event-item">
      <span class="ce-event-time">${formatTime(evt.timestamp)}</span>
      <span class="ce-event-type ${typeClass}">${_escapeHtml((evt.type ?? '').replace(/_/g,' '))}</span>
      <span class="ce-event-body">${_escapeHtml(body)}</span>
    </div>`;
  }).join('');
}
