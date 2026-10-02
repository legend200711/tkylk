/**
 * 24-HOUR CLOUD ENGINE — Screen: Schedule
 * cloud-engine-ui/js/screens/ce-screen-schedule.js
 *
 * Programming scheduler UI.
 * Maps to: ScheduleManager in cloud-engine/tv-station/schedule-manager.js
 * and ProgrammingScheduler in cloud-engine/scheduler/scheduler.js
 *
 * The backend uses deterministic UTC scheduling.
 * All times are stored and displayed in UTC with local display.
 */

import * as Store from '../ce-store.js';
import { _escapeHtml, toast, confirm, formatDateTime } from '../ce-utils.js';
import { subscribeSchedule } from '../ce-firebase-bridge.js';

export function renderSchedule(container) {
  container.innerHTML = buildScheduleHTML();
  bindScheduleEvents(container);
  refreshSchedule(container);

  const unsubs = [
    Store.subscribe('schedule', () => refreshSchedule(container)),
  ];

  // Subscribe to Firestore schedule if user is authenticated
  const user = Store.get('auth.user');
  let fbUnsub = () => {};
  if (user) {
    fbUnsub = subscribeSchedule(user.uid, (entries) => {
      Store.set('schedule', entries);
    });
  }

  return () => {
    unsubs.forEach(fn => fn());
    fbUnsub();
  };
}

function buildScheduleHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Schedule</h1>
  <p class="ce-screen-subtitle">Program time-based content for TV Station Mode (UTC scheduling)</p>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 2v4M13 2v4M3 9h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    <div>
      The Cloud Engine uses <strong>deterministic UTC scheduling</strong>.
      All times are stored in UTC. Your local timezone is shown for display only.
      The scheduler determines what should be airing NOW and at recovery time, providing
      broadcast continuity without manual intervention.
    </div>
  </div>
</div>

<!-- Add Schedule Entry -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Add Scheduled Entry</div>
    <div style="display:grid;gap:12px">
      <div class="ce-grid-2">
        <div class="ce-form-group">
          <label class="ce-label" for="sc-start">Start Time (UTC)</label>
          <input class="ce-input" id="sc-start" type="datetime-local" />
        </div>
        <div class="ce-form-group">
          <label class="ce-label" for="sc-end">End Time (UTC)</label>
          <input class="ce-input" id="sc-end" type="datetime-local" />
        </div>
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="sc-title">Program Title</label>
        <input class="ce-input" id="sc-title" type="text" placeholder="Episode title, show name, etc." />
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="sc-media">Media Path (server) or Playlist ID</label>
        <input class="ce-input ce-mono" id="sc-media" type="text" placeholder="/media/shows/episode-01.mp4 or playlist-123" />
      </div>
      <div class="ce-form-group">
        <label class="ce-label" for="sc-repeat">Repeat</label>
        <select class="ce-select" id="sc-repeat">
          <option value="none">No repeat (once)</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <button class="ce-btn ce-btn-primary" id="sc-add-btn">Add to Schedule</button>
      <div id="sc-error" style="font-size:12px;color:var(--ce-error)"></div>
    </div>
  </div>
</div>

<!-- Schedule list -->
<div class="ce-section">
  <div class="ce-section-title">Upcoming Programming</div>
  <div id="sc-list" style="display:flex;flex-direction:column;gap:8px">
    <div class="ce-text-muted" style="font-style:italic;padding:16px 0">No scheduled programming. Add entries above.</div>
  </div>
</div>
`;
}

function refreshSchedule(container) {
  const entries = Store.get('schedule') ?? [];
  const listEl  = container.querySelector('#sc-list');
  if (!listEl) return;

  if (entries.length === 0) {
    listEl.innerHTML = `<div class="ce-text-muted" style="font-style:italic;padding:16px 0">No scheduled programming.</div>`;
    return;
  }

  // Sort by start time
  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.startTime ?? a.start ?? 0).getTime();
    const tb = new Date(b.startTime ?? b.start ?? 0).getTime();
    return ta - tb;
  });

  const now = Date.now();
  listEl.innerHTML = sorted.map(entry => {
    const startMs = new Date(entry.startTime ?? entry.start ?? 0).getTime();
    const isPast  = startMs < now;
    return `
    <div class="ce-schedule-entry" style="${isPast ? 'opacity:0.5' : ''}">
      <div class="ce-schedule-time">
        ${formatDateTime(entry.startTime ?? entry.start)}
      </div>
      <div>
        <div class="ce-schedule-title">${_escapeHtml(entry.title ?? entry.name ?? '—')}</div>
        ${entry.mediaPath ? `<div style="font-size:10px;color:var(--ce-text-muted);font-family:var(--ce-font-mono)">${_escapeHtml(entry.mediaPath)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${isPast ? '<span style="font-size:10px;color:var(--ce-text-muted)">Past</span>' : ''}
        <button class="ce-btn ce-btn-ghost ce-btn-sm" style="color:var(--ce-error)" data-sc-remove="${_escapeHtml(entry.id ?? '')}">✕</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-sc-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-sc-remove');
      const ok = await confirm('Remove Entry?', 'Remove this scheduled entry?', 'Remove');
      if (!ok) return;
      const updated = Store.get('schedule').filter(e => e.id !== id);
      Store.set('schedule', updated);
      toast('Schedule entry removed.', 'success');
    });
  });
}

function bindScheduleEvents(container) {
  container.querySelector('#sc-add-btn')?.addEventListener('click', () => {
    const start   = container.querySelector('#sc-start')?.value;
    const end     = container.querySelector('#sc-end')?.value;
    const title   = container.querySelector('#sc-title')?.value?.trim();
    const media   = container.querySelector('#sc-media')?.value?.trim();
    const repeat  = container.querySelector('#sc-repeat')?.value;
    const errorEl = container.querySelector('#sc-error');

    if (!start) { errorEl.textContent = 'Start time required.'; return; }
    if (!title) { errorEl.textContent = 'Program title required.'; return; }

    const startUtc = new Date(start).toISOString();
    const endUtc   = end ? new Date(end).toISOString() : null;

    const entry = {
      id:        `sc-${Date.now()}`,
      title,
      startTime: startUtc,
      endTime:   endUtc,
      mediaPath: media ?? null,
      repeat,
    };

    errorEl.textContent = '';
    const schedule = [...(Store.get('schedule') ?? [])];
    schedule.push(entry);
    Store.set('schedule', schedule);
    toast(`"${title}" added to schedule.`, 'success');

    // Clear
    ['#sc-start','#sc-end','#sc-title','#sc-media'].forEach(sel => {
      const inp = container.querySelector(sel);
      if (inp) inp.value = '';
    });
  });
}
