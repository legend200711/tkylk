/**
 * 24-HOUR CLOUD ENGINE — Screen: Hybrid Mode
 * cloud-engine-ui/js/screens/ce-screen-hybrid.js
 *
 * Hybrid Mode control interface.
 * Maps to: HybridManager in cloud-engine/hybrid/hybrid-manager.js
 *
 * Hybrid states (from hybrid-errors.js HYBRID_STATE):
 *   STATION, PREPARING_LIVE, LIVE, RETURNING_TO_STATION, ERROR, OFFLINE
 *
 * Resume strategies (from hybrid-errors.js RESUME_STRATEGY):
 *   CURRENT_SCHEDULE  — determine what should be airing NOW (default)
 *   RESUME_INTERRUPTED — resume the item that was interrupted
 *   NEXT_ITEM         — skip interrupted item, go to next scheduled
 *
 * Flow:
 *   TV Station ON AIR → GO LIVE (takeover) → END LIVE → Resume Strategy → Station resumes
 */

import * as Store from '../ce-store.js';
import { badge, hybridStateBadge, stationStateBadge, formatTime, _escapeHtml, toast } from '../ce-utils.js';

const RESUME_STRATEGIES = [
  {
    id:    'CURRENT_SCHEDULE',
    label: 'Current Schedule (Recommended)',
    desc:  'Determine what SHOULD be airing now according to the schedule. Seamless recovery.',
  },
  {
    id:    'RESUME_INTERRUPTED',
    label: 'Resume Interrupted',
    desc:  'Resume the program that was playing when live started, from its interrupted position.',
  },
  {
    id:    'NEXT_ITEM',
    label: 'Next Item',
    desc:  'Skip the interrupted program entirely and advance to the next scheduled or queued item.',
  },
];

export function renderHybrid(container) {
  container.innerHTML = buildHybridHTML();
  refreshHybrid(container);
  bindHybridEvents(container);

  const unsubs = [
    Store.subscribe('hybrid',    () => refreshHybrid(container)),
    Store.subscribe('tvStation', () => refreshHybrid(container)),
    Store.subscribe('broadcast', () => refreshHybrid(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildHybridHTML() {
  const strategyOptionsHTML = RESUME_STRATEGIES.map(s => `
    <div class="ce-hybrid-strategy-option ${s.id === 'CURRENT_SCHEDULE' ? 'selected' : ''}" data-strategy="${s.id}">
      <input type="radio" name="ce-resume-strategy" value="${s.id}" ${s.id === 'CURRENT_SCHEDULE' ? 'checked' : ''}>
      <div>
        <div style="font-weight:600;font-size:12px">${_escapeHtml(s.label)}</div>
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:2px">${_escapeHtml(s.desc)}</div>
      </div>
    </div>`).join('');

  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Hybrid Mode</h1>
  <p class="ce-screen-subtitle">Live broadcast interruption and seamless TV Station resumption</p>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10h4l3-5 3 10 3-5h3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div>
      Hybrid Mode combines 24/7 TV Station programming with creator live broadcasts.
      The TV Station runs continuously. When you go live, it temporarily takes over.
      When live ends, the station resumes at the schedule-correct position.
      <strong>Requires TV Station to be running.</strong>
    </div>
  </div>
</div>

<!-- Current Hybrid State -->
<div class="ce-section">
  <div class="ce-hybrid-state-card">
    <div class="ce-hybrid-state-label">Current Hybrid State</div>
    <div id="hybrid-state-display" class="ce-hybrid-state-value ce-hybrid-state-offline">OFFLINE</div>
    <div id="hybrid-state-detail" style="font-size:12px;color:var(--ce-text-muted);margin-top:8px">—</div>
  </div>
</div>

<!-- Controls -->
<div class="ce-section">
  <div class="ce-grid-2">

    <div class="ce-card">
      <div class="ce-card-title">Live Takeover</div>
      <p style="font-size:12px;color:var(--ce-text-muted);margin-bottom:14px">
        Initiate a live broadcast override. The TV station will pause until you end the live broadcast.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="ce-btn ce-btn-live" id="hybrid-go-live-btn">GO LIVE (Override Station)</button>
        <button class="ce-btn ce-btn-stop" id="hybrid-end-live-btn" style="display:none">END LIVE (Return to Station)</button>
      </div>
    </div>

    <div class="ce-card">
      <div class="ce-card-title">Resume Strategy</div>
      <p style="font-size:12px;color:var(--ce-text-muted);margin-bottom:12px">
        How the station resumes after live ends:
      </p>
      <div class="ce-hybrid-resume-strategy" id="hybrid-strategy-list">
        ${strategyOptionsHTML}
      </div>
    </div>

  </div>
</div>

<!-- Status Overview -->
<div class="ce-section">
  <div class="ce-section-title">System Status</div>
  <div style="display:grid;gap:8px">
    <div class="ce-monitor-component">
      <div class="ce-monitor-name">TV Station</div>
      <div class="ce-monitor-detail" id="hybrid-tv-detail">—</div>
      <div id="hybrid-tv-badge"></div>
    </div>
    <div class="ce-monitor-component">
      <div class="ce-monitor-name">Broadcast</div>
      <div class="ce-monitor-detail" id="hybrid-bc-detail">—</div>
      <div id="hybrid-bc-badge"></div>
    </div>
    <div class="ce-monitor-component">
      <div class="ce-monitor-name">Current Source</div>
      <div class="ce-monitor-detail" id="hybrid-src-detail">—</div>
      <div></div>
    </div>
  </div>
</div>

<!-- Interrupted Program Info -->
<div class="ce-section" id="hybrid-interrupted-section" style="display:none">
  <div class="ce-card">
    <div class="ce-card-title">Interrupted Program</div>
    <div id="hybrid-interrupted-content"></div>
  </div>
</div>
`;
}

function refreshHybrid(container) {
  const hybrid    = Store.get('hybrid');
  const tvStation = Store.get('tvStation');
  const broadcast = Store.get('broadcast');
  const isLive    = hybrid.hybridState === 'LIVE';

  // State display
  const stateDisplay = container.querySelector('#hybrid-state-display');
  const stateDetail  = container.querySelector('#hybrid-state-detail');
  if (stateDisplay) {
    const stateClass = {
      'STATION': 'ce-hybrid-state-station',
      'PREPARING_LIVE': 'ce-hybrid-state-returning',
      'LIVE': 'ce-hybrid-state-live',
      'RETURNING_TO_STATION': 'ce-hybrid-state-returning',
      'ERROR': 'ce-hybrid-state-error',
      'OFFLINE': 'ce-hybrid-state-offline',
    }[hybrid.hybridState] ?? 'ce-hybrid-state-offline';

    stateDisplay.className = `ce-hybrid-state-value ${stateClass}`;

    const stateLabel = {
      'STATION': 'STATION ON AIR',
      'PREPARING_LIVE': 'PREPARING LIVE',
      'LIVE': 'LIVE OVERRIDE',
      'RETURNING_TO_STATION': 'RETURNING TO STATION',
      'ERROR': 'ERROR',
      'OFFLINE': 'OFFLINE',
    }[hybrid.hybridState] ?? hybrid.hybridState;

    stateDisplay.textContent = stateLabel;
  }
  if (stateDetail) {
    stateDetail.textContent = {
      'STATION': 'TV Station is running. Ready for live takeover.',
      'PREPARING_LIVE': 'Live broadcast is being prepared…',
      'LIVE': 'Live override active. TV Station paused.',
      'RETURNING_TO_STATION': 'Transitioning back to station programming…',
      'ERROR': 'An error occurred. Check recovery panel.',
      'OFFLINE': 'Hybrid Mode not active. Start TV Station first.',
    }[hybrid.hybridState] ?? '—';
  }

  // Buttons
  const goLiveBtn    = container.querySelector('#hybrid-go-live-btn');
  const endLiveBtn   = container.querySelector('#hybrid-end-live-btn');
  if (goLiveBtn)  goLiveBtn.style.display  = isLive ? 'none' : '';
  if (endLiveBtn) endLiveBtn.style.display = isLive ? '' : 'none';

  // Status rows
  _setHTML(container, '#hybrid-tv-badge', stationStateBadge(tvStation.stationState));
  const tvEl = container.querySelector('#hybrid-tv-detail');
  if (tvEl) tvEl.textContent = tvStation.currentProgram?.title ?? 'No program playing';

  const bcBadgeEl = container.querySelector('#hybrid-bc-badge');
  if (bcBadgeEl) bcBadgeEl.innerHTML = badge(
    broadcast.state === 'BROADCASTING' ? 'LIVE' : broadcast.state ?? '—',
    broadcast.state === 'BROADCASTING' ? 'live' : 'offline'
  );
  const bcDetailEl = container.querySelector('#hybrid-bc-detail');
  if (bcDetailEl) bcDetailEl.textContent = broadcast.title ?? '—';

  const srcEl = container.querySelector('#hybrid-src-detail');
  if (srcEl) srcEl.textContent = hybrid.currentSource ?? '—';
}

function _setHTML(container, sel, html) {
  const el = container.querySelector(sel);
  if (el) el.innerHTML = html;
}

function bindHybridEvents(container) {
  // Strategy selection
  container.querySelector('#hybrid-strategy-list')?.addEventListener('change', (e) => {
    if (e.target.name === 'ce-resume-strategy') {
      Store.set('hybrid.resumeStrategy', e.target.value);
      container.querySelectorAll('.ce-hybrid-strategy-option').forEach(opt => {
        opt.classList.toggle('selected', opt.getAttribute('data-strategy') === e.target.value);
      });
      toast(`Resume strategy: ${e.target.value.replace(/_/g,' ')}`, 'info', 2000);
    }
  });

  container.querySelector('#hybrid-go-live-btn')?.addEventListener('click', () => {
    toast('Hybrid GO LIVE command sent. Requires engine to be running with TVStation active.', 'info');
  });

  container.querySelector('#hybrid-end-live-btn')?.addEventListener('click', async () => {
    const { confirm: confirmFn } = await import('../ce-utils.js');
    const ok = await confirmFn('End Live Broadcast?', 'The live broadcast will end and the station will resume.', 'End Live & Resume Station');
    if (ok) toast('End Live command sent. Station will resume.', 'info');
  });
}
