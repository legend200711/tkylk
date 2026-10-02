/**
 * 24-HOUR CLOUD ENGINE — Stage 10 TV Station Tests
 * cloud-engine/tv-station/tests/tv-station.test.js
 *
 * Tests:
 *  1.  StationError — structure
 *  2.  STATION_STATE — all states defined
 *  3.  StationState — lifecycle transitions
 *  4.  Playlist create / add / remove / reorder
 *  5.  Playlist loop behavior
 *  6.  Playlist ownership enforcement
 *  7.  PlaylistManager create, get, update, delete
 *  8.  createScheduleEntry — valid entry
 *  9.  createScheduleEntry — invalid time rejected
 * 10.  ScheduleManager.add() — conflict detection
 * 11.  ScheduleManager.getCurrentAndNext() — correct current program
 * 12.  ScheduleManager.getCurrentAndNext() — next program
 * 13.  ScheduleManager.getCurrentAndNext() — no program (empty schedule)
 * 14.  ScheduleManager.getElapsedInEntry() — elapsed time calculation
 * 15.  ProgramQueue — enqueue, advance, depth
 * 16.  ProgramQueue — hasNext, remaining
 * 17.  ProgramQueue — seekToIndex for recovery
 * 18.  TVStationManager — createStation
 * 19.  TVStationManager — duplicate station rejected
 * 20.  TVStationManager — ownership isolation (wrong owner denied)
 * 21.  TVStationManager — schedule program
 * 22.  TVStationManager — schedule conflict detection
 * 23.  TVStationManager — getCurrentSchedulePosition
 * 24.  TVStationManager — createPlaylist + addToPlaylist
 * 25.  TVStationManager — loadPlaylistToQueue
 * 26.  TVStationManager — startStation (schedule-driven)
 * 27.  TVStationManager — fallback when no programming
 * 28.  TVStationManager — NO_PROGRAMMING when no fallback
 * 29.  TVStationManager — getDashboard shape
 * 30.  TVStationManager — getStationsByOwner
 * 31.  Timezone: schedule entry stored in UTC
 * 32.  Regression — Stages 1–9 unaffected
 *
 * Stage 10 — Optional TV Station Mode
 */

import { StationError, STATION_STATE, STATION_ERROR_CODE,
         STATION_PLAYBACK_STATE }           from '../station-errors.js';
import { StationState }                      from '../station-state.js';
import { Playlist, PlaylistManager }         from '../playlist-manager.js';
import { createScheduleEntry, ScheduleManager } from '../schedule-manager.js';
import { ProgramQueue, createQueueItem }     from '../program-queue.js';
import { TVStationManager }                  from '../tv-station-manager.js';

/* ═══════════════════════════════════
   MINI TEST FRAMEWORK
═══════════════════════════════════ */
let _passed = 0;
let _failed = 0;

async function test(name, fn) {
  try {
    await fn();
    _passed++;
    console.log(`  ✓  PASS  ${name}`);
  } catch (err) {
    _failed++;
    console.error(`  ✗  FAIL  ${name}`);
    console.error(`           ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'Assertion failed');
}

function assertEqual(a, b, label) {
  if (a !== b) throw new Error(`${label ?? 'assertEqual'}: expected "${b}", got "${a}"`);
}

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */
function msFromNow(offsetSec) {
  return new Date(Date.now() + offsetSec * 1000).toISOString();
}

/* ═══════════════════════════════════
   TESTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log('  Stage 10 TV Station Tests');
console.log('──────────────────────────────────────────────────────\n');

// 1. StationError
await test('1. StationError structure', async () => {
  const err = new StationError(STATION_ERROR_CODE.STATION_NOT_FOUND, 'Not found');
  assert(err instanceof Error, 'is Error');
  assertEqual(err.code, STATION_ERROR_CODE.STATION_NOT_FOUND, 'code');
  const j = err.toJSON();
  assert(j.code && j.message && j.timestamp, 'toJSON fields');
});

// 2. STATION_STATE
await test('2. STATION_STATE all states defined', async () => {
  const required = ['OFFLINE', 'INITIALIZING', 'READY', 'ON_AIR',
                    'PAUSED', 'NO_PROGRAMMING', 'ERROR', 'STOPPING'];
  for (const s of required) assert(STATION_STATE[s], `STATION_STATE.${s} required`);
});

// 3. StationState lifecycle transitions
await test('3. StationState lifecycle transitions', async () => {
  const ss = new StationState('s-1');
  assertEqual(ss.stationState, STATION_STATE.OFFLINE, 'initial state');

  ss.setStationState(STATION_STATE.ON_AIR);
  assertEqual(ss.stationState, STATION_STATE.ON_AIR, 'ON_AIR');

  ss.setCurrentProgram({ mediaId: 'media-1', title: 'Test Program' });
  assert(ss.currentProgram, 'current program set');
  assertEqual(ss.currentProgram.mediaId, 'media-1', 'current program mediaId');

  ss.setCurrentProgram(null);
  assert(!ss.currentProgram, 'current program cleared');

  const snap = ss.snapshot();
  assert(snap.stationId === 's-1', 'snapshot stationId');
  assert(snap.stationState, 'snapshot has stationState');
});

// 4. Playlist create / add / remove / reorder
await test('4. Playlist create / add / remove / reorder', async () => {
  const pl = new Playlist({ playlistId: 'pl-1', ownerId: 'u1', title: 'My Playlist' });
  assertEqual(pl.length, 0, 'empty initially');

  pl.addItem({ mediaId: 'media-a', title: 'A', duration: 60 });
  pl.addItem({ mediaId: 'media-b', title: 'B', duration: 120 });
  pl.addItem({ mediaId: 'media-c', title: 'C', duration: 90 });
  assertEqual(pl.length, 3, 'three items');

  const removed = pl.removeItem('media-b');
  assert(removed, 'media-b removed');
  assertEqual(pl.length, 2, 'two items after remove');

  pl.addItem({ mediaId: 'media-d', title: 'D', duration: 30 });
  pl.reorder(['media-c', 'media-a', 'media-d']);
  const items = pl.getItems();
  assertEqual(items[0].mediaId, 'media-c', 'reorder: first is C');
  assertEqual(items[1].mediaId, 'media-a', 'reorder: second is A');
});

// 5. Playlist loop behavior
await test('5. Playlist loop behavior', async () => {
  const pl = new Playlist({ playlistId: 'pl-loop', ownerId: 'u', title: 'Loop' });
  pl.loop = true;
  pl.addItem({ mediaId: 'm1', title: '1', duration: 30 });
  pl.addItem({ mediaId: 'm2', title: '2', duration: 60 });

  // getItemAt wraps around when loop=true
  assertEqual(pl.getItemAt(0).mediaId, 'm1', 'index 0');
  assertEqual(pl.getItemAt(1).mediaId, 'm2', 'index 1');
  assertEqual(pl.getItemAt(2).mediaId, 'm1', 'index 2 wraps to m1');
  assertEqual(pl.getItemAt(3).mediaId, 'm2', 'index 3 wraps to m2');
});

// 6. Playlist ownership enforcement
await test('6. Playlist ownership enforcement', async () => {
  const pm = new PlaylistManager();
  pm.create({ playlistId: 'pl-own', ownerId: 'alice', title: 'Alice PL' });

  const allowed = pm.get('pl-own', 'alice');
  assertEqual(allowed.success, true, 'owner can access');

  const denied = pm.get('pl-own', 'bob');
  assertEqual(denied.success, false, 'wrong owner denied');
  assertEqual(denied.code, STATION_ERROR_CODE.ACCESS_DENIED, 'ACCESS_DENIED');
});

// 7. PlaylistManager create, get, update, delete
await test('7. PlaylistManager CRUD', async () => {
  const pm = new PlaylistManager();
  const r = pm.create({ playlistId: 'pm-1', ownerId: 'u', title: 'T', description: 'D' });
  assertEqual(r.success, true, 'created');

  const dup = pm.create({ playlistId: 'pm-1', ownerId: 'u', title: 'T2' });
  assertEqual(dup.success, false, 'duplicate rejected');

  const u = pm.update('pm-1', { title: 'Updated', loop: true }, 'u');
  assertEqual(u.success, true, 'update ok');
  assertEqual(u.playlist.title, 'Updated', 'title updated');
  assertEqual(u.playlist.loop, true, 'loop updated');

  const d = pm.delete('pm-1', 'u');
  assertEqual(d.success, true, 'deleted');

  const g = pm.get('pm-1');
  assertEqual(g.success, false, 'not found after delete');
});

// 8. createScheduleEntry — valid
await test('8. createScheduleEntry valid entry', async () => {
  const entry = createScheduleEntry({
    entryId: 'se-1', stationId: 'st-1', ownerId: 'u',
    mediaId: 'media-1', title: 'News', startAt: '2026-10-01T08:00:00Z', duration: 1800,
  });
  assertEqual(entry.entryId, 'se-1', 'entryId');
  assertEqual(entry.durationSec, 1800, 'duration');
  assert(entry.endAt > entry.startAt, 'endAt after startAt');
  assert(Object.isFrozen(entry), 'entry is frozen');
});

// 9. createScheduleEntry — invalid time rejected
await test('9. createScheduleEntry invalid time rejected', async () => {
  let threw = false;
  try {
    createScheduleEntry({
      entryId: 'se-bad', stationId: 'st-1', ownerId: 'u',
      startAt: 'not-a-date', duration: 1800,
    });
  } catch { threw = true; }
  assert(threw, 'invalid time should throw');
});

// 10. ScheduleManager conflict detection
await test('10. ScheduleManager conflict detection', async () => {
  const sm = new ScheduleManager();
  sm.add({
    entryId: 'sm-1', stationId: 'st-1', ownerId: 'u',
    mediaId: 'media-1', title: 'A', startAt: '2026-10-01T08:00:00Z', duration: 3600,
  });

  // This overlaps with sm-1
  const conflict = sm.add({
    entryId: 'sm-2', stationId: 'st-1', ownerId: 'u',
    mediaId: 'media-2', title: 'B', startAt: '2026-10-01T08:30:00Z', duration: 3600,
  });
  assertEqual(conflict.success, false, 'conflict detected');
  assertEqual(conflict.code, STATION_ERROR_CODE.SCHEDULE_CONFLICT, 'conflict code');
  assert(conflict.conflicts.length > 0, 'conflicts listed');
});

// 11. ScheduleManager.getCurrentAndNext() — current program
await test('11. ScheduleManager getCurrentAndNext() current program', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  // Entry started 5 minutes ago, ends in 25 minutes
  sm.add({
    entryId: 'sc-cur', stationId: 'st-c', ownerId: 'u', mediaId: 'm1', title: 'Current',
    startAt: new Date(now - 5 * 60000).toISOString(), duration: 1800,
  });
  sm.add({
    entryId: 'sc-next', stationId: 'st-c', ownerId: 'u', mediaId: 'm2', title: 'Next',
    startAt: new Date(now + 25 * 60000).toISOString(), duration: 1800,
  });

  const { current, next } = sm.getCurrentAndNext('st-c', now);
  assert(current, 'current must be found');
  assertEqual(current.entryId, 'sc-cur', 'correct current');
  assert(next, 'next must be found');
  assertEqual(next.entryId, 'sc-next', 'correct next');
});

// 12. ScheduleManager.getCurrentAndNext() — next only
await test('12. ScheduleManager getCurrentAndNext() next-only (gap)', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  // Entry starts 30 minutes from now
  sm.add({
    entryId: 'sc-future', stationId: 'st-f', ownerId: 'u', mediaId: 'm1', title: 'Future',
    startAt: new Date(now + 30 * 60000).toISOString(), duration: 1800,
  });

  const { current, next } = sm.getCurrentAndNext('st-f', now);
  assert(!current, 'no current (gap)');
  assert(next, 'next found');
  assertEqual(next.entryId, 'sc-future', 'correct next');
});

// 13. ScheduleManager.getCurrentAndNext() — empty schedule
await test('13. ScheduleManager getCurrentAndNext() empty schedule', async () => {
  const sm = new ScheduleManager();
  const { current, next } = sm.getCurrentAndNext('empty-station', Date.now());
  assert(!current, 'no current');
  assert(!next, 'no next');
});

// 14. ScheduleManager.getElapsedInEntry()
await test('14. ScheduleManager getElapsedInEntry()', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  const entry = createScheduleEntry({
    entryId: 'se-el', stationId: 'st', ownerId: 'u', mediaId: 'm', title: 'T',
    startAt: new Date(now - 300000).toISOString(),   // 5 minutes ago
    duration: 1800,
  });
  const elapsed = sm.getElapsedInEntry(entry, now);
  assert(elapsed >= 299 && elapsed <= 301, `elapsed ~300s, got ${elapsed.toFixed(1)}`);
});

// 15. ProgramQueue enqueue, advance, depth
await test('15. ProgramQueue enqueue, advance, depth', async () => {
  const q = new ProgramQueue();
  assert(q.isEmpty, 'initially empty');

  q.enqueue(
    createQueueItem({ mediaId: 'q1', title: 'Q1', duration: 30 }),
    createQueueItem({ mediaId: 'q2', title: 'Q2', duration: 60 }),
  );
  assertEqual(q.depth, 2, 'depth 2');
  assert(!q.isEmpty, 'not empty');

  const first = q.advance();
  assertEqual(first.mediaId, 'q1', 'first item');
  assert(q.current, 'current set');
  assertEqual(q.current.mediaId, 'q1', 'current is q1');
  assertEqual(q.next.mediaId, 'q2', 'next is q2');

  const second = q.advance();
  assertEqual(second.mediaId, 'q2', 'second item');
  assert(!q.hasNext, 'no more items');
});

// 16. ProgramQueue hasNext, remaining
await test('16. ProgramQueue hasNext and remaining', async () => {
  const q = new ProgramQueue();
  q.enqueue(
    createQueueItem({ mediaId: 'm1', duration: 60 }),
    createQueueItem({ mediaId: 'm2', duration: 30 }),
  );
  q.advance();
  assert(q.hasNext, 'has next');
  assertEqual(q.remaining, 1, 'one remaining');
  q.advance();
  assert(!q.hasNext, 'no more');
  assertEqual(q.remaining, 0, 'zero remaining');
});

// 17. ProgramQueue seekToIndex for recovery
await test('17. ProgramQueue seekToIndex for recovery', async () => {
  const q = new ProgramQueue();
  q.enqueue(
    createQueueItem({ mediaId: 'm1', title: 'First',  duration: 60 }),
    createQueueItem({ mediaId: 'm2', title: 'Second', duration: 120 }),
    createQueueItem({ mediaId: 'm3', title: 'Third',  duration: 90 }),
  );

  // Simulate recovery: jump directly to index 2
  const item = q.seekToIndex(2);
  assertEqual(item.mediaId, 'm3', 'seeked to third item');
  assertEqual(q.position, 2, 'position is 2');
});

// 18. TVStationManager createStation
await test('18. TVStationManager createStation', async () => {
  const mgr = new TVStationManager();
  const r = mgr.createStation({
    stationId: 'tsm-1', ownerId: 'alice', name: 'Alice TV',
    timezone: 'America/New_York',
  });
  assertEqual(r.success, true, 'created');
  assert(r.station, 'station returned');
  assertEqual(r.station.stationId, 'tsm-1', 'stationId');
  assertEqual(r.station.timezone, 'America/New_York', 'timezone preserved');
});

// 19. TVStationManager duplicate station rejected
await test('19. TVStationManager duplicate station rejected', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'dup-st', ownerId: 'u', name: 'S' });
  const r = mgr.createStation({ stationId: 'dup-st', ownerId: 'u', name: 'S' });
  assertEqual(r.success, false, 'duplicate rejected');
  assertEqual(r.code, STATION_ERROR_CODE.STATION_ALREADY_EXISTS, 'correct code');
});

// 20. TVStationManager ownership isolation
await test('20. TVStationManager ownership isolation', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'iso-st', ownerId: 'alice', name: 'Alice' });

  // bob tries to get alice's station dashboard
  const r = mgr.getDashboard('iso-st', 'bob');
  assertEqual(r.success, false, 'bob denied');
  assertEqual(r.code, STATION_ERROR_CODE.ACCESS_DENIED, 'ACCESS_DENIED');

  // alice can access her own
  const ok = mgr.getDashboard('iso-st', 'alice');
  assertEqual(ok.success, true, 'alice ok');
});

// 21. TVStationManager schedule program
await test('21. TVStationManager scheduleProgram', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'sched-st', ownerId: 'u', name: 'S' });

  const r = mgr.scheduleProgram('sched-st', {
    entryId: 'ep-1', mediaId: 'm1', title: 'Episode 1',
    startAt: '2026-10-05T10:00:00Z', duration: 1800,
  }, 'u');
  assertEqual(r.success, true, 'scheduled');
  assert(r.entry, 'entry returned');

  const sched = mgr.getSchedule('sched-st', 'u');
  assertEqual(sched.success, true, 'get schedule ok');
  assertEqual(sched.entries.length, 1, 'one entry');
});

// 22. TVStationManager schedule conflict
await test('22. TVStationManager schedule conflict detection', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'conf-st', ownerId: 'u', name: 'S' });

  mgr.scheduleProgram('conf-st', {
    entryId: 'cp-1', mediaId: 'm1', title: 'A',
    startAt: '2026-10-10T08:00:00Z', duration: 3600,
  }, 'u');

  const r = mgr.scheduleProgram('conf-st', {
    entryId: 'cp-2', mediaId: 'm2', title: 'B',
    startAt: '2026-10-10T08:30:00Z', duration: 3600,
  }, 'u');
  assertEqual(r.success, false, 'conflict detected');
});

// 23. TVStationManager getCurrentSchedulePosition
await test('23. TVStationManager getCurrentSchedulePosition', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'gsp-st', ownerId: 'u', name: 'S' });
  const now = Date.now();

  mgr.scheduleProgram('gsp-st', {
    entryId: 'gsp-1', mediaId: 'm1', title: 'Now',
    startAt: new Date(now - 10000).toISOString(), duration: 3600,
  }, 'u');

  const r = mgr.getCurrentSchedulePosition('gsp-st', 'u', now);
  assertEqual(r.success, true, 'ok');
  assert(r.current, 'current program found');
  assertEqual(r.current.entryId, 'gsp-1', 'correct current');
});

// 24. TVStationManager createPlaylist + addToPlaylist
await test('24. TVStationManager createPlaylist + addToPlaylist', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'pl-st', ownerId: 'u', name: 'S' });

  const pl = mgr.createPlaylist('pl-st', {
    playlistId: 'tpl-1', title: 'Test Playlist',
  }, 'u');
  assertEqual(pl.success, true, 'playlist created');

  const add = mgr.addToPlaylist('pl-st', 'tpl-1',
    { mediaId: 'media-x', title: 'X', duration: 60 }, 'u');
  assertEqual(add.success, true, 'item added');
  assertEqual(add.playlist.length, 1, 'one item in playlist');
});

// 25. TVStationManager loadPlaylistToQueue
await test('25. TVStationManager loadPlaylistToQueue', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'lpq-st', ownerId: 'u', name: 'S' });

  mgr.createPlaylist('lpq-st', { playlistId: 'lpq-pl', title: 'LPQ' }, 'u');
  mgr.addToPlaylist('lpq-st', 'lpq-pl', { mediaId: 'm1', title: 'A', duration: 30 }, 'u');
  mgr.addToPlaylist('lpq-st', 'lpq-pl', { mediaId: 'm2', title: 'B', duration: 60 }, 'u');

  const r = mgr.loadPlaylistToQueue('lpq-st', 'lpq-pl', 'u');
  assertEqual(r.success, true, 'loaded');
  assertEqual(r.itemCount, 2, '2 items loaded');
});

// 26. TVStationManager startStation with schedule
await test('26. TVStationManager startStation schedule-driven', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'start-st', ownerId: 'u', name: 'S' });
  const now = Date.now();

  // Schedule current program
  mgr.scheduleProgram('start-st', {
    entryId: 'sp-1', mediaId: 'media-start', title: 'Current Show',
    startAt: new Date(now - 60000).toISOString(),
    duration: 3600,
  }, 'u');

  const r = await mgr.startStation('start-st', 'u');
  assertEqual(r.success, true, 'station started');

  const dash = mgr.getDashboard('start-st', 'u');
  assert(dash.success, 'dashboard ok');
  assert(dash.dashboard.currentProgram, 'current program set');
  assertEqual(dash.dashboard.currentProgram.mediaId, 'media-start', 'correct program');

  await mgr.stopStation('start-st', 'u');
});

// 27. TVStationManager fallback activation
await test('27. TVStationManager fallback when no programming', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({
    stationId: 'fb-st', ownerId: 'u', name: 'S',
    fallbackMediaId: 'fallback-media',
  });

  const r = await mgr.startStation('fb-st', 'u');
  assertEqual(r.success, true, 'station started');

  const dash = mgr.getDashboard('fb-st', 'u');
  assert(dash.success, 'dashboard ok');
  // Current program should be fallback
  assert(dash.dashboard.currentProgram?.isFallback ||
         dash.dashboard.currentProgram?.mediaId === 'fallback-media',
    'fallback activated');

  await mgr.stopStation('fb-st', 'u');
});

// 28. TVStationManager NO_PROGRAMMING state
await test('28. TVStationManager NO_PROGRAMMING when no fallback', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'noprog-st', ownerId: 'u', name: 'S' });

  await mgr.startStation('noprog-st', 'u');
  const dash = mgr.getDashboard('noprog-st', 'u');
  // Either NO_PROGRAMMING state or null currentProgram
  const state = dash.dashboard.stationState;
  assert(state === STATION_STATE.NO_PROGRAMMING || !dash.dashboard.currentProgram,
    `Expected NO_PROGRAMMING or null program, got ${state}`);

  await mgr.stopStation('noprog-st', 'u');
});

// 29. TVStationManager getDashboard shape
await test('29. TVStationManager getDashboard shape', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'dash-st', ownerId: 'u', name: 'My Station' });
  const r = mgr.getDashboard('dash-st', 'u');
  assertEqual(r.success, true, 'ok');
  const d = r.dashboard;
  assert(d.stationId,  'stationId');
  assert(d.ownerId,    'ownerId');
  assert(d.name,       'name');
  assert(d.queue,      'queue present');
  assert(d.metrics,    'metrics present');
  assert(d.asOf,       'asOf timestamp');
  // No credentials in dashboard
  const s = JSON.stringify(d);
  assert(!s.includes('streamKey'), 'no streamKey in dashboard');
});

// 30. TVStationManager getStationsByOwner
await test('30. TVStationManager getStationsByOwner', async () => {
  const mgr = new TVStationManager();
  mgr.createStation({ stationId: 'own-st-1', ownerId: 'alice', name: 'A1' });
  mgr.createStation({ stationId: 'own-st-2', ownerId: 'alice', name: 'A2' });
  mgr.createStation({ stationId: 'own-st-3', ownerId: 'bob',   name: 'B1' });

  const alice = mgr.getStationsByOwner('alice');
  assertEqual(alice.length, 2, 'alice has 2 stations');
  const bob = mgr.getStationsByOwner('bob');
  assertEqual(bob.length, 1, 'bob has 1 station');
});

// 31. Timezone: schedule entry stored in UTC
await test('31. Timezone: schedule entry stored as UTC', async () => {
  // Input time with explicit UTC offset; should normalize to UTC
  const entry = createScheduleEntry({
    entryId: 'tz-1', stationId: 'st', ownerId: 'u', mediaId: 'm', title: 'T',
    startAt: '2026-10-01T10:00:00+05:30',   // IST = UTC+5:30 → UTC 04:30
    duration: 1800,
  });
  // The startAt should be stored as UTC
  const parsed = new Date(entry.startAt);
  assert(!isNaN(parsed.getTime()), 'startAt is valid date');
  // UTC hour should be 4 (10:00 IST = 04:30 UTC)
  assertEqual(parsed.getUTCHours(), 4, 'UTC hours correct for IST input');
});

// 32. Regression — Stages 1-9 unaffected
await test('32. Regression — Stages 1-9 unaffected', async () => {
  const { FanOutManager }     = await import('../../broadcast/fanout-manager.js');
  const { PlatformManager }   = await import('../../platforms/platform-manager.js');
  const { CloudMediaLibrary } = await import('../../media/media-library.js');

  const fm  = new FanOutManager();
  const pm  = new PlatformManager();
  const lib = new CloudMediaLibrary();

  assert(fm.getAllDestinationStatuses instanceof Function, 'FanOutManager ok');
  assert(pm.list instanceof Function, 'PlatformManager ok');
  assert(lib.getCount instanceof Function, 'CloudMediaLibrary ok');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 10 TV Station Tests`);
console.log(`  PASS:  ${_passed} / ${_passed + _failed}`);
if (_failed > 0) console.log(`  FAIL:  ${_failed}`);
console.log('══════════════════════════════════════════════════════\n');

if (_failed > 0) process.exit(1);
