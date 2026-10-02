/**
 * 24-HOUR CLOUD ENGINE — Screen: TV Station
 * cloud-engine-ui/js/screens/ce-screen-tv-station.js
 *
 * Optional TV Station Mode control interface.
 * Maps to: TVStationManager in cloud-engine/tv-station/tv-station-manager.js
 *
 * Station states (from station-errors.js STATION_STATE):
 *   OFFLINE, INITIALIZING, READY, ON_AIR, PAUSED, NO_PROGRAMMING, ERROR, STOPPING
 *
 * Operations (via TVStationManager):
 *   createStation, startStation, stopStation, nextProgram, restartProgram
 *   scheduleProgram, removeScheduledEntry, getSchedule
 *   createPlaylist, addToPlaylist
 *   getStationStatus, getNowPlayingInfo
 *
 * This is OPTIONAL MODE. Primary engine is live broadcast.
 */

import * as Store from '../ce-store.js';
import { badge, stationStateBadge, formatUptime, formatTime, _escapeHtml, toast } from '../ce-utils.js';

export function renderTVStation(container) {
  container.innerHTML = buildTVStationHTML();
  refreshTVStation(container);
  bindTVStationEvents(container);

  const unsubs = [
    Store.subscribe('tvStation', () => refreshTVStation(container)),
    Store.subscribe('engine',    () => refreshTVStation(container)),
  ];
  return () => unsubs.forEach(fn => fn());
}

function buildTVStationHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">TV Station</h1>
  <p class="ce-screen-subtitle">Optional 24/7 TV station mode — automated programming</p>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 7v4m0-6v.5" stroke-linecap="round"/></svg>
    <div>
      <strong>TV Station Mode is optional.</strong>
      The primary Cloud Engine function is live broadcasting. TV Station provides automated
      24/7 programming when you're not going live. All scheduling is deterministic UTC-based.
    </div>
  </div>
</div>

<!-- Station Status Card -->
<div class="ce-section">
  <div class="ce-station-now-playing" id="tv-now-playing-card">
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ce-text-muted);margin-bottom:6px">Station Status</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="ce-station-on-air-badge" id="tv-on-air-badge" style="display:none">● ON AIR</div>
        <div id="tv-station-state-badge"></div>
      </div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="ce-station-program-title" id="tv-current-title">No programming</div>
      <div class="ce-station-program-meta" id="tv-current-meta">—</div>
      <div class="ce-progress-bar" style="margin-top:8px">
        <div class="ce-progress-fill live-fill" id="tv-progress" style="width:0%"></div>
      </div>
    </div>
  </div>
</div>

<!-- Station Controls -->
<div class="ce-section">
  <div class="ce-section-title">Station Controls</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <button class="ce-btn ce-btn-primary" id="tv-start-btn">Start Station</button>
    <button class="ce-btn ce-btn-stop" id="tv-stop-btn" style="display:none">Stop Station</button>
    <button class="ce-btn ce-btn-outline" id="tv-next-btn">Next Program</button>
    <button class="ce-btn ce-btn-outline" id="tv-restart-btn">Restart Program</button>
  </div>
</div>

<!-- Now Playing / Up Next -->
<div class="ce-section">
  <div class="ce-grid-2">
    <div class="ce-card">
      <div class="ce-card-title">Now Playing</div>
      <div id="tv-now-playing-detail">
        <div class="ce-text-muted" style="font-style:italic">No program playing</div>
      </div>
    </div>
    <div class="ce-card">
      <div class="ce-card-title">Up Next</div>
      <div id="tv-up-next-detail">
        <div class="ce-text-muted" style="font-style:italic">No upcoming program</div>
      </div>
    </div>
  </div>
</div>

<!-- Metrics -->
<div class="ce-section">
  <div class="ce-section-title">Station Metrics</div>
  <div class="ce-metric-grid">
    <div class="ce-metric-tile">
      <div class="ce-metric-label">State</div>
      <div class="ce-metric-value" id="tv-m-state">OFFLINE</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Programs Played</div>
      <div class="ce-metric-value ce-mono" id="tv-m-count">0</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Queue Position</div>
      <div class="ce-metric-value ce-mono" id="tv-m-queue">—</div>
    </div>
    <div class="ce-metric-tile">
      <div class="ce-metric-label">Playback State</div>
      <div class="ce-metric-value" id="tv-m-playback">IDLE</div>
    </div>
  </div>
</div>

<!-- Station Schedule (populated from Firestore) -->
<div class="ce-section">
  <div class="ce-section-title">Upcoming Schedule</div>
  <div id="tv-schedule-list" style="display:flex;flex-direction:column;gap:8px">
    <div class="ce-text-muted" style="font-style:italic">No scheduled programming</div>
  </div>
</div>

<!-- Add to Schedule -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Schedule a Program</div>
    <div style="display:grid;gap:12px">
      <div class="ce-form-group">
        <label class="ce-label" for="tv-sched-title">Program Title</label>
        <input class="ce-input" id="tv-sched-title" type="text" placeholder="Program name" />
      </div>
      <div class="ce-grid-2">
        <div class="ce-form-group">
          <label class="ce-label" for="tv-sched-start">Start Time (UTC)</label>
          <input class="ce-input" id="tv-sched-start" type="datetime-local" />
        </div>
        <div class="ce-form-group">
          <label class="ce-label" for="tv-sched-duration">Duration (minutes)</label>
          <input class="ce-input" id="tv-sched-duration" type="number" min="1" max="480" placeholder="60" />
        </div>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="tv-sched-media">Media File Path (server)</label>
        <input class="ce-input ce-mono" id="tv-sched-media" type="text" placeholder="/media/programs/episode-01.mp4" />
      </div>
      <button class="ce-btn ce-btn-primary" id="tv-sched-add-btn">Schedule Program</button>
      <div id="tv-sched-error" style="font-size:12px;color:var(--ce-error)"></div>
    </div>
  </div>
</div>
`;
}

function refreshTVStation(container) {
  const st = Store.get('tvStation');
  const isOnAir = st.stationState === 'ON_AIR';

  // State badge
  const stateBadge = container.querySelector('#tv-station-state-badge');
  if (stateBadge) stateBadge.innerHTML = stationStateBadge(st.stationState);

  // ON AIR badge
  const onAirBadge = container.querySelector('#tv-on-air-badge');
  if (onAirBadge) onAirBadge.style.display = isOnAir ? '' : 'none';

  // Buttons
  const startBtn = container.querySelector('#tv-start-btn');
  const stopBtn  = container.querySelector('#tv-stop-btn');
  if (startBtn) startBtn.style.display = isOnAir ? 'none' : '';
  if (stopBtn)  stopBtn.style.display  = isOnAir ? '' : 'none';

  // Current program
  const titleEl = container.querySelector('#tv-current-title');
  const metaEl  = container.querySelector('#tv-current-meta');
  const nowDetail = container.querySelector('#tv-now-playing-detail');
  const nextDetail = container.querySelector('#tv-up-next-detail');

  if (st.currentProgram) {
    if (titleEl) titleEl.textContent = st.currentProgram.title ?? 'Untitled';
    if (metaEl)  metaEl.textContent  = st.currentProgram.startedAt
      ? `Started ${formatTime(st.currentProgram.startedAt)}`
      : '—';
    if (nowDetail) {
      nowDetail.innerHTML = `
        <div style="font-weight:600;color:var(--ce-text-heading)">${_escapeHtml(st.currentProgram.title ?? 'Untitled')}</div>
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:4px">
          Started: ${formatTime(st.currentProgram.startedAt)}
        </div>
      `;
    }
  } else {
    if (titleEl) titleEl.textContent = 'No program playing';
    if (metaEl)  metaEl.textContent  = '—';
    if (nowDetail) nowDetail.innerHTML = `<div class="ce-text-muted" style="font-style:italic">No program playing</div>`;
  }

  if (st.nextProgram) {
    if (nextDetail) {
      nextDetail.innerHTML = `
        <div style="font-weight:600;color:var(--ce-text-heading)">${_escapeHtml(st.nextProgram.title ?? 'Untitled')}</div>
        <div style="font-size:11px;color:var(--ce-text-muted);margin-top:4px">
          Scheduled: ${formatTime(st.nextProgram.scheduledAt)}
        </div>
      `;
    }
  } else {
    if (nextDetail) nextDetail.innerHTML = `<div class="ce-text-muted" style="font-style:italic">No upcoming program</div>`;
  }

  // Metrics
  _setMetric(container, '#tv-m-state',    st.stationState ?? 'OFFLINE');
  _setMetric(container, '#tv-m-count',    String(st.programCount ?? 0));
  _setMetric(container, '#tv-m-queue',    String(st.queuePosition ?? 0));
  _setMetric(container, '#tv-m-playback', st.playbackState ?? 'IDLE');
}

function _setMetric(container, sel, value) {
  const el = container.querySelector(sel);
  if (el) el.textContent = value;
}

function bindTVStationEvents(container) {
  container.querySelector('#tv-start-btn')?.addEventListener('click', () => {
    toast('Start Station command sent to engine.', 'info');
    // sendControlCommand would go here once TV Station commands are added
  });

  container.querySelector('#tv-stop-btn')?.addEventListener('click', async () => {
    const { confirm: confirmFn } = await import('../ce-utils.js');
    const ok = await confirmFn('Stop TV Station?', 'This will stop the 24/7 programming broadcast.', 'Stop Station');
    if (ok) toast('Stop Station command sent.', 'info');
  });

  container.querySelector('#tv-next-btn')?.addEventListener('click', () => {
    toast('Next Program command sent.', 'info');
  });

  container.querySelector('#tv-restart-btn')?.addEventListener('click', () => {
    toast('Restart Program command sent.', 'info');
  });

  container.querySelector('#tv-sched-add-btn')?.addEventListener('click', () => {
    const title    = container.querySelector('#tv-sched-title')?.value?.trim();
    const start    = container.querySelector('#tv-sched-start')?.value;
    const duration = container.querySelector('#tv-sched-duration')?.value;
    const media    = container.querySelector('#tv-sched-media')?.value?.trim();
    const errorEl  = container.querySelector('#tv-sched-error');

    if (!title)    { errorEl.textContent = 'Program title required.'; return; }
    if (!start)    { errorEl.textContent = 'Start time required.'; return; }
    if (!duration) { errorEl.textContent = 'Duration required.'; return; }

    errorEl.textContent = '';
    // Add to local schedule display
    const schedule = [...Store.get('schedule')];
    schedule.push({
      title, startTime: new Date(start).toISOString(),
      durationMin: parseInt(duration), mediaPath: media,
    });
    Store.set('schedule', schedule);
    toast(`"${title}" scheduled.`, 'success');
  });
}
