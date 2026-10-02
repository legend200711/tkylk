/**
 * 24-HOUR CLOUD ENGINE — Screen: Recovery
 * cloud-engine-ui/js/screens/ce-screen-recovery.js
 *
 * Recovery status and manual controls.
 * Maps to: RecoveryEngine, HealthMonitor, ProcessSupervisor
 *
 * Recovery states:
 *   healthy, degraded, recovering, retry attempt, cooldown, recovered, failed, escalated
 *
 * Failure types (from recovery-policy.js FAILURE_TYPE):
 *   ENCODER_CRASH, ENCODER_STALLED, ENCODER_BEHIND,
 *   INGEST_DISCONNECTED, INGEST_STALLED,
 *   DESTINATION_DISCONNECTED, TRANSPORT_CRASH, RECONNECT_EXHAUSTED,
 *   MEDIA_PLAYBACK_FAILURE, STATION_PLAYBACK_FAILURE,
 *   HYBRID_LIVE_FAILURE, CONTROL_PLANE_FAILURE, PROCESS_CRASH
 *
 * SECURITY: Manual retry only — frontend does NOT bypass recovery policy.
 */

import * as Store from '../ce-store.js';
import { badge, formatTime, _escapeHtml, toast } from '../ce-utils.js';

export function renderRecovery(container) {
  container.innerHTML = buildRecoveryHTML();
  refreshRecovery(container);

  const unsubs = [
    Store.subscribe('recovery', () => refreshRecovery(container)),
    Store.subscribe('watchdog', () => refreshRecovery(container)),
    Store.subscribe('engine',   () => refreshRecovery(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildRecoveryHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Recovery</h1>
  <p class="ce-screen-subtitle">Watchdog and automatic recovery status</p>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4a6 6 0 1 1-5.2 3" stroke-linecap="round"/><path d="M4 4l1 3h3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div>
      The Cloud Engine's Stage 12 Watchdog and Recovery Engine automatically detect and recover from failures.
      Recovery policies enforce retry limits, exponential backoff, jitter, and cooldown periods.
      <strong>Frontend cannot override recovery policy</strong> — it may only request a safe manual retry
      if the backend permits it.
    </div>
  </div>
</div>

<!-- Watchdog Status -->
<div class="ce-section">
  <div class="ce-section-title">Watchdog</div>
  <div class="ce-card">
    <div style="display:grid;gap:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Watchdog Active</span>
        <span id="rec-watchdog-active"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Last Check</span>
        <span id="rec-watchdog-check" class="ce-mono" style="font-size:11px">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Check Interval</span>
        <span class="ce-text-muted">10 seconds (default)</span>
      </div>
    </div>
  </div>
</div>

<!-- Recovery Engine Status -->
<div class="ce-section">
  <div class="ce-section-title">Recovery Engine</div>
  <div class="ce-card">
    <div style="display:grid;gap:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Recovery Status</span>
        <span id="rec-engine-status"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Last Attempt</span>
        <span id="rec-last-attempt" class="ce-mono" style="font-size:11px">—</span>
      </div>
    </div>
  </div>
</div>

<!-- Component Recovery Details -->
<div class="ce-section">
  <div class="ce-section-title">Component Recovery Policies</div>
  <div style="display:flex;flex-direction:column;gap:8px" id="rec-components">
    ${recoveryRow('ENCODER_CRASH',           'Encoder Crash',             '3 attempts · 2s base delay · 30s max · 60s cooldown')}
    ${recoveryRow('ENCODER_STALLED',         'Encoder Stalled',           '2 attempts · 5s base delay · 30s max · 120s cooldown')}
    ${recoveryRow('INGEST_DISCONNECTED',     'Ingest Disconnected',       '5 attempts · 1s base delay · 30s max · 30s cooldown')}
    ${recoveryRow('DESTINATION_DISCONNECTED','Destination Disconnected',  '10 attempts · 2s base delay · 60s max · 30s cooldown')}
    ${recoveryRow('TRANSPORT_CRASH',         'Transport Crash',           '5 attempts · 3s base delay · 30s max · 60s cooldown')}
    ${recoveryRow('MEDIA_PLAYBACK_FAILURE',  'Media Playback Failure',    '2 attempts · 2s base delay · 15s max · 30s cooldown')}
    ${recoveryRow('STATION_PLAYBACK_FAILURE','Station Playback Failure',  '3 attempts · 3s base delay · 30s max · 60s cooldown')}
    ${recoveryRow('CONTROL_PLANE_FAILURE',   'Control Plane Failure',     '3 attempts · 5s base delay · 60s max · 120s cooldown')}
  </div>
</div>

<!-- Active Recovery Events -->
<div class="ce-section">
  <div class="ce-section-title">Recovery Events</div>
  <div id="rec-events" class="ce-event-feed" style="max-height:300px">
    <div class="ce-text-muted" style="font-style:italic;padding:12px">No recovery events recorded.</div>
  </div>
</div>
`;
}

function recoveryRow(id, label, policy) {
  return `
  <div class="ce-recovery-item" id="rec-row-${id}">
    <div>
      <div class="ce-recovery-component">${_escapeHtml(label)}</div>
      <div class="ce-recovery-detail">${_escapeHtml(policy)}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <span id="rec-badge-${id}">${badge('STANDBY', 'offline')}</span>
    </div>
  </div>`;
}

function refreshRecovery(container) {
  const watchdog  = Store.get('watchdog');
  const recovery  = Store.get('recovery');

  // Watchdog
  _setHTML(container, '#rec-watchdog-active', badge(
    watchdog.active ? 'ACTIVE' : 'INACTIVE',
    watchdog.active ? 'ready' : 'offline'
  ));
  _setText(container, '#rec-watchdog-check', watchdog.lastCheck ? formatTime(watchdog.lastCheck) : '—');

  // Recovery engine status
  const recStatusMap = {
    'healthy':    ['HEALTHY',    'live'],
    'degraded':   ['DEGRADED',   'warn'],
    'recovering': ['RECOVERING', 'recovering'],
    'failed':     ['FAILED',     'error'],
    'escalated':  ['ESCALATED',  'error'],
    'UNKNOWN':    ['UNKNOWN',    'offline'],
  };
  const [rLabel, rCls] = recStatusMap[recovery.status] ?? ['UNKNOWN', 'offline'];
  _setHTML(container, '#rec-engine-status', badge(rLabel, rCls));
  _setText(container, '#rec-last-attempt', recovery.lastAttempt ? formatTime(recovery.lastAttempt) : '—');

  // Component badges — show actual metrics if available
  if (recovery.components) {
    Object.entries(recovery.components).forEach(([id, comp]) => {
      const badgeEl = container.querySelector(`#rec-badge-${id}`);
      if (!badgeEl) return;
      const statusMap = {
        'healthy':    ['HEALTHY',    'live'],
        'recovering': ['RECOVERING', 'recovering'],
        'failed':     ['FAILED',     'error'],
        'cooldown':   ['COOLDOWN',   'warn'],
        'standby':    ['STANDBY',    'offline'],
      };
      const [sl, sc] = statusMap[comp.status] ?? ['STANDBY', 'offline'];
      let badgeHtml = badge(sl, sc);
      if (comp.attempts > 0) {
        badgeHtml += `<span style="font-size:10px;color:var(--ce-text-muted);margin-left:5px">${comp.attempts} attempt(s)</span>`;
      }
      badgeEl.innerHTML = badgeHtml;
    });
  }

  // Recovery events from event feed
  const recEvents = Store.get('events').filter(e =>
    e.type?.includes('recovery') || e.type?.includes('watchdog') || e.type?.includes('restart')
  );
  const eventsEl = container.querySelector('#rec-events');
  if (eventsEl && recEvents.length > 0) {
    eventsEl.innerHTML = recEvents.slice(0, 30).map(evt => `
      <div class="ce-event-item">
        <span class="ce-event-time">${formatTime(evt.timestamp)}</span>
        <span class="ce-event-type error">${_escapeHtml((evt.type ?? '').replace(/_/g,' '))}</span>
        <span class="ce-event-body">${_escapeHtml(String(evt.data?.message ?? ''))}</span>
      </div>`).join('');
  }
}

function _setHTML(container, sel, html) {
  const el = container.querySelector(sel);
  if (el) el.innerHTML = html;
}
function _setText(container, sel, text) {
  const el = container.querySelector(sel);
  if (el) el.textContent = text;
}
