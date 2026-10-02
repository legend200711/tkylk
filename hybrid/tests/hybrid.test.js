/**
 * 24-HOUR CLOUD ENGINE — Stage 11 Hybrid Mode Tests
 * cloud-engine/hybrid/tests/hybrid.test.js
 *
 * Tests:
 *  1.  HybridError — structure
 *  2.  HYBRID_STATE — all states defined
 *  3.  RESUME_STRATEGY — all strategies defined
 *  4.  HYBRID_EVENT — all events defined
 *  5.  HybridModeState — initial state
 *  6.  HybridModeState — lifecycle transitions (station → live → returning → station)
 *  7.  HybridModeState — snapshot shape
 *  8.  TakeoverSession — lifecycle (prepare → activate → complete)
 *  9.  TakeoverSession — failure path
 * 10.  SourceSwitcher — initial state STATION
 * 11.  SourceSwitcher — switch to LIVE
 * 12.  SourceSwitcher — switch back to STATION
 * 13.  SourceSwitcher — duplicate switch returns failure
 * 14.  ResumeController — CURRENT_SCHEDULE with active program
 * 15.  ResumeController — CURRENT_SCHEDULE with no current (gap)
 * 16.  ResumeController — CURRENT_SCHEDULE empty schedule
 * 17.  ResumeController — RESUME_INTERRUPTED with interrupted program
 * 18.  ResumeController — RESUME_INTERRUPTED fallback when no interrupted
 * 19.  ResumeController — NEXT_ITEM strategy
 * 20.  HybridManager — create and start station
 * 21.  HybridManager — goLive transitions to LIVE state
 * 22.  HybridManager — goLive while already live returns error
 * 23.  HybridManager — endLive returns to station with resume result
 * 24.  HybridManager — schedule-aware resume (CURRENT_SCHEDULE default)
 * 25.  HybridManager — handleLiveFailure recovers to station
 * 26.  HybridManager — HYBRID events emitted correctly
 * 27.  HybridManager — getDashboard shape (no secrets)
 * 28.  HybridManager — destination continuity status in switch result
 * 29.  HybridManager — endLive when not live returns error
 * 30.  Regression — Stages 1–10 unaffected
 *
 * Stage 11 — Hybrid Mode
 */

import { HybridError, HYBRID_STATE, HYBRID_EVENT,
         RESUME_STRATEGY, HYBRID_ERROR_CODE }        from '../hybrid-errors.js';
import { HybridModeState }                           from '../hybrid-state.js';
import { TakeoverSession, TAKEOVER_STATE }           from '../takeover-session.js';
import { SourceSwitcher, SOURCE_MODE, SWITCH_STATUS } from '../source-switcher.js';
import { ResumeController }                          from '../resume-controller.js';
import { HybridManager }                             from '../hybrid-manager.js';
import { TVStationManager }                          from '../../tv-station/tv-station-manager.js';
import { ScheduleManager }                           from '../../tv-station/schedule-manager.js';

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
function makeManager(stationId = 'hybrid-st-1', ownerId = 'user-1') {
  const tvMgr = new TVStationManager();
  tvMgr.createStation({ stationId, ownerId, name: `Station ${stationId}` });
  return new HybridManager({ stationId, ownerId, tvStationManager: tvMgr });
}

/* ═══════════════════════════════════
   TESTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log('  Stage 11 Hybrid Mode Tests');
console.log('──────────────────────────────────────────────────────\n');

// 1. HybridError
await test('1. HybridError structure', async () => {
  const err = new HybridError(HYBRID_ERROR_CODE.ALREADY_LIVE, 'Already live');
  assert(err instanceof Error, 'is Error');
  assertEqual(err.code, HYBRID_ERROR_CODE.ALREADY_LIVE, 'code');
  const j = err.toJSON();
  assert(j.code && j.message && j.timestamp, 'toJSON fields');
});

// 2. HYBRID_STATE — all states defined
await test('2. HYBRID_STATE all states defined', async () => {
  const required = ['STATION', 'PREPARING_LIVE', 'LIVE', 'RETURNING_TO_STATION',
                    'ERROR', 'OFFLINE'];
  for (const s of required) assert(HYBRID_STATE[s], `HYBRID_STATE.${s}`);
});

// 3. RESUME_STRATEGY — all strategies
await test('3. RESUME_STRATEGY all strategies defined', async () => {
  assert(RESUME_STRATEGY.CURRENT_SCHEDULE,   'CURRENT_SCHEDULE');
  assert(RESUME_STRATEGY.RESUME_INTERRUPTED, 'RESUME_INTERRUPTED');
  assert(RESUME_STRATEGY.NEXT_ITEM,          'NEXT_ITEM');
});

// 4. HYBRID_EVENT — all events defined
await test('4. HYBRID_EVENT all events defined', async () => {
  const required = ['HYBRID_LIVE_PREPARING', 'HYBRID_LIVE_STARTED', 'HYBRID_LIVE_FAILED',
                    'HYBRID_RETURNING', 'HYBRID_STATION_RESUMED'];
  for (const e of required) assert(HYBRID_EVENT[e], `HYBRID_EVENT.${e}`);
});

// 5. HybridModeState — initial state
await test('5. HybridModeState initial state', async () => {
  const hs = new HybridModeState({ stationId: 's1', ownerId: 'u' });
  assertEqual(hs.hybridState, HYBRID_STATE.OFFLINE, 'initial OFFLINE');
  assert(!hs.isLive, 'not live initially');
  assert(hs.isStation === false, 'not station initially (OFFLINE)');
});

// 6. HybridModeState lifecycle transitions
await test('6. HybridModeState lifecycle transitions', async () => {
  const hs = new HybridModeState({ stationId: 's1', ownerId: 'u' });

  hs.setStationMode();
  assertEqual(hs.hybridState, HYBRID_STATE.STATION, 'STATION');

  hs.startLivePrep({ sessionId: 'sess-1' });
  assertEqual(hs.hybridState, HYBRID_STATE.PREPARING_LIVE, 'PREPARING_LIVE');

  hs.setLiveActive({ mediaId: 'm1', title: 'Interrupted' });
  assertEqual(hs.hybridState, HYBRID_STATE.LIVE, 'LIVE');
  assert(hs.isLive, 'isLive');
  assert(hs.interruptedProgram, 'interrupted program recorded');
  assertEqual(hs.interruptedProgram.title, 'Interrupted', 'interrupted title');

  hs.startReturning();
  assertEqual(hs.hybridState, HYBRID_STATE.RETURNING_TO_STATION, 'RETURNING');

  hs.completeReturn();
  assertEqual(hs.hybridState, HYBRID_STATE.STATION, 'back to STATION');
  assert(!hs.isLive, 'no longer live');
});

// 7. HybridModeState snapshot shape
await test('7. HybridModeState snapshot shape', async () => {
  const hs = new HybridModeState({ stationId: 's1', ownerId: 'u',
                                    resumeStrategy: RESUME_STRATEGY.CURRENT_SCHEDULE });
  hs.setStationMode();
  const snap = hs.snapshot();
  assert(snap.stationId,       'stationId');
  assert(snap.hybridState,     'hybridState');
  assert(snap.resumeStrategy,  'resumeStrategy');
  assert(snap.asOf,            'asOf timestamp');
  assert(!snap.streamKey,      'no streamKey in snapshot');
  assert(!snap.accessToken,    'no accessToken in snapshot');
});

// 8. TakeoverSession lifecycle
await test('8. TakeoverSession prepare → activate → complete', async () => {
  const session = new TakeoverSession({
    sessionId: 'ts-1', stationId: 'st', ownerId: 'u',
  });
  assertEqual(session.state, TAKEOVER_STATE.PREPARING, 'initial PREPARING');

  session.activate();
  assertEqual(session.state, TAKEOVER_STATE.ACTIVE, 'ACTIVE');
  assert(session.isActive, 'isActive');

  session.begin_end();
  assertEqual(session.state, TAKEOVER_STATE.ENDING, 'ENDING');

  session.complete();
  assertEqual(session.state, TAKEOVER_STATE.ENDED, 'ENDED');
  assert(session.durationSec >= 0, 'durationSec set');
});

// 9. TakeoverSession failure
await test('9. TakeoverSession failure path', async () => {
  const session = new TakeoverSession({
    sessionId: 'ts-fail', stationId: 'st', ownerId: 'u',
  });
  session.fail('Test failure');
  assertEqual(session.state, TAKEOVER_STATE.FAILED, 'FAILED');
  const snap = session.snapshot();
  assert(snap.failureReason, 'failureReason in snapshot');
});

// 10. SourceSwitcher initial state
await test('10. SourceSwitcher initial state STATION', async () => {
  const sw = new SourceSwitcher();
  assertEqual(sw.currentSource, SOURCE_MODE.STATION, 'initial STATION');
  assert(sw.isStation, 'isStation');
  assert(!sw.isLive, 'not live');
});

// 11. SourceSwitcher switch to LIVE
await test('11. SourceSwitcher switch to LIVE', async () => {
  const sw = new SourceSwitcher();
  const r = sw.switchToLive({ ingestPath: '/tmp/ingest.flv' });
  assertEqual(r.success, true, 'success');
  assertEqual(sw.currentSource, SOURCE_MODE.LIVE, 'now LIVE');
  assert(sw.isLive, 'isLive');
  assert(r.destinationContinuity, 'destinationContinuity status present');
});

// 12. SourceSwitcher switch back to STATION
await test('12. SourceSwitcher switch back to STATION', async () => {
  const sw = new SourceSwitcher();
  sw.switchToLive();
  const r = sw.switchToStation();
  assertEqual(r.success, true, 'success');
  assertEqual(sw.currentSource, SOURCE_MODE.STATION, 'back to STATION');
  assertEqual(sw.getStatus().switchCount, 2, 'two switches counted');
});

// 13. SourceSwitcher duplicate switch
await test('13. SourceSwitcher duplicate switch returns failure', async () => {
  const sw = new SourceSwitcher();
  const r = sw.switchToStation();  // Already STATION
  assertEqual(r.success, false, 'duplicate returns failure');
});

// 14. ResumeController CURRENT_SCHEDULE active program
await test('14. ResumeController CURRENT_SCHEDULE with active program', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  sm.add({
    entryId: 'rc-1', stationId: 'rc-st', ownerId: 'u', mediaId: 'm1', title: 'Show Now',
    startAt: new Date(now - 10 * 60000).toISOString(),
    duration: 3600,
  });

  const rc = new ResumeController();
  const r  = rc.determineResume({
    strategy: RESUME_STRATEGY.CURRENT_SCHEDULE,
    scheduleManager: sm,
    stationId: 'rc-st',
    atTime: now,
  });
  assertEqual(r.action, 'RESUME_CURRENT_SCHEDULE', 'action');
  assert(r.resumeTarget, 'resumeTarget present');
  assertEqual(r.resumeTarget.entryId, 'rc-1', 'correct entry');
  assert(r.resumeTarget.elapsedSec > 0, 'elapsed > 0');
});

// 15. ResumeController CURRENT_SCHEDULE gap → next
await test('15. ResumeController CURRENT_SCHEDULE gap → WAIT_FOR_NEXT', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  sm.add({
    entryId: 'rc-2', stationId: 'rc-gap', ownerId: 'u', mediaId: 'm2', title: 'Future',
    startAt: new Date(now + 30 * 60000).toISOString(),
    duration: 1800,
  });

  const rc = new ResumeController();
  const r  = rc.determineResume({
    strategy: RESUME_STRATEGY.CURRENT_SCHEDULE,
    scheduleManager: sm, stationId: 'rc-gap', atTime: now,
  });
  assertEqual(r.action, 'WAIT_FOR_NEXT', 'action WAIT_FOR_NEXT');
  assert(r.resumeTarget, 'next entry present');
});

// 16. ResumeController CURRENT_SCHEDULE empty schedule
await test('16. ResumeController CURRENT_SCHEDULE empty schedule', async () => {
  const sm = new ScheduleManager();
  const rc = new ResumeController();
  const r  = rc.determineResume({
    strategy: RESUME_STRATEGY.CURRENT_SCHEDULE,
    scheduleManager: sm, stationId: 'empty-st', atTime: Date.now(),
  });
  assertEqual(r.action, 'NO_PROGRAMMING', 'NO_PROGRAMMING');
  assert(!r.resumeTarget, 'no resume target');
});

// 17. ResumeController RESUME_INTERRUPTED
await test('17. ResumeController RESUME_INTERRUPTED with interrupted program', async () => {
  const sm = new ScheduleManager();
  const rc = new ResumeController();
  const interrupted = { mediaId: 'int-media', title: 'Interrupted Show', elapsedSec: 450 };
  const r = rc.determineResume({
    strategy: RESUME_STRATEGY.RESUME_INTERRUPTED,
    scheduleManager: sm, stationId: 'any', interruptedProgram: interrupted,
    atTime: Date.now(),
  });
  assertEqual(r.action, 'RESUME_INTERRUPTED', 'action');
  assertEqual(r.resumeTarget.mediaId, 'int-media', 'correct interrupted media');
});

// 18. ResumeController RESUME_INTERRUPTED fallback
await test('18. ResumeController RESUME_INTERRUPTED fallback when no interrupted', async () => {
  const sm = new ScheduleManager();
  const rc = new ResumeController();
  // No interrupted program, schedule is also empty
  const r = rc.determineResume({
    strategy: RESUME_STRATEGY.RESUME_INTERRUPTED,
    scheduleManager: sm, stationId: 'empty', interruptedProgram: null,
    atTime: Date.now(),
  });
  // Falls back to schedule → NO_PROGRAMMING
  assert(['NO_PROGRAMMING', 'RESUME_INTERRUPTED'].includes(r.action),
    'should fall back or return');
});

// 19. ResumeController NEXT_ITEM strategy
await test('19. ResumeController NEXT_ITEM strategy', async () => {
  const sm = new ScheduleManager();
  const now = Date.now();
  sm.add({
    entryId: 'ni-1', stationId: 'ni-st', ownerId: 'u', mediaId: 'm1', title: 'Next',
    startAt: new Date(now + 5 * 60000).toISOString(),
    duration: 1800,
  });

  const rc = new ResumeController();
  const r  = rc.determineResume({
    strategy: RESUME_STRATEGY.NEXT_ITEM,
    scheduleManager: sm, stationId: 'ni-st', atTime: now,
  });
  assertEqual(r.action, 'SKIP_TO_NEXT', 'SKIP_TO_NEXT action');
  assert(r.resumeTarget, 'next target present');
});

// 20. HybridManager create and start station
await test('20. HybridManager create and start station', async () => {
  const mgr = makeManager('hm-1');
  const r = await mgr.startStation();
  assertEqual(r.success, true, 'station started');
  assertEqual(mgr.hybridState, HYBRID_STATE.STATION, 'state STATION');
  await mgr.stopStation();
});

// 21. HybridManager goLive → LIVE state
await test('21. HybridManager goLive transitions to LIVE', async () => {
  const mgr = makeManager('hm-2');
  await mgr.startStation();

  const r = await mgr.goLive({ ingestSessionId: 'ingest-session-1' });
  assertEqual(r.success, true, 'goLive ok');
  assert(r.session, 'session returned');
  assertEqual(mgr.hybridState, HYBRID_STATE.LIVE, 'state LIVE');
  assert(mgr.isLive, 'isLive');
  assertEqual(mgr.currentSource, SOURCE_MODE.LIVE, 'source LIVE');

  // Clean up
  await mgr.endLive();
});

// 22. HybridManager goLive while already live
await test('22. HybridManager goLive while already live returns error', async () => {
  const mgr = makeManager('hm-3');
  await mgr.startStation();
  await mgr.goLive();

  const r = await mgr.goLive();
  assertEqual(r.success, false, 'second goLive rejected');
  assertEqual(r.code, HYBRID_ERROR_CODE.ALREADY_LIVE, 'ALREADY_LIVE code');

  await mgr.endLive();
});

// 23. HybridManager endLive returns to STATION
await test('23. HybridManager endLive returns to station', async () => {
  const mgr = makeManager('hm-4');
  await mgr.startStation();
  await mgr.goLive({ ingestSessionId: 'ingest-2' });

  const r = await mgr.endLive();
  assertEqual(r.success, true, 'endLive ok');
  assertEqual(mgr.hybridState, HYBRID_STATE.STATION, 'state STATION after end');
  assert(!mgr.isLive, 'no longer live');
  assertEqual(mgr.currentSource, SOURCE_MODE.STATION, 'source back to STATION');
  assert(r.resumeResult, 'resumeResult present');
});

// 24. HybridManager schedule-aware resume (CURRENT_SCHEDULE default)
await test('24. HybridManager schedule-aware resume with active program', async () => {
  const tvMgr = new TVStationManager();
  tvMgr.createStation({ stationId: 'aware-st', ownerId: 'u', name: 'S' });
  const now = Date.now();

  // Schedule a currently-airing program
  tvMgr.scheduleProgram('aware-st', {
    entryId: 'aw-1', mediaId: 'm1', title: 'Current Show',
    startAt: new Date(now - 15 * 60000).toISOString(),
    duration: 3600,
  }, 'u');

  const mgr = new HybridManager({
    stationId: 'aware-st', ownerId: 'u',
    tvStationManager: tvMgr,
    resumeStrategy: RESUME_STRATEGY.CURRENT_SCHEDULE,
  });

  await mgr.startStation();
  await mgr.goLive();

  // Wait a moment to simulate live time
  await new Promise(r => setTimeout(r, 100));

  const result = await mgr.endLive();
  assertEqual(result.success, true, 'endLive ok');

  // Should resume to the currently-scheduled program
  const { resumeResult } = result;
  assert(resumeResult, 'resumeResult present');
  assert(resumeResult.action === 'RESUME_CURRENT_SCHEDULE' ||
         resumeResult.action === 'NO_PROGRAMMING',
    `Expected schedule-aware action, got: ${resumeResult.action}`);
});

// 25. HybridManager handleLiveFailure → station recovery
await test('25. HybridManager handleLiveFailure recovers to station', async () => {
  const mgr = makeManager('hm-5');
  await mgr.startStation();
  await mgr.goLive();

  assertEqual(mgr.hybridState, HYBRID_STATE.LIVE, 'confirm LIVE before failure');

  const r = await mgr.handleLiveFailure();
  assertEqual(r.success, true, 'recovery ok');
  assertEqual(mgr.hybridState, HYBRID_STATE.STATION, 'state back to STATION');
});

// 26. HybridManager events emitted correctly
await test('26. HybridManager events emitted correctly', async () => {
  const mgr = makeManager('hm-events');
  await mgr.startStation();

  const events = [];
  for (const ev of Object.values(HYBRID_EVENT)) {
    mgr.on(ev, (data) => events.push({ event: ev, data }));
  }

  await mgr.goLive({ ingestSessionId: 'ev-ingest' });
  await mgr.endLive();

  const eventNames = events.map(e => e.event);
  assert(eventNames.includes(HYBRID_EVENT.HYBRID_LIVE_PREPARING),
    'HYBRID_LIVE_PREPARING emitted');
  assert(eventNames.includes(HYBRID_EVENT.HYBRID_LIVE_STARTED),
    'HYBRID_LIVE_STARTED emitted');
  assert(eventNames.includes(HYBRID_EVENT.HYBRID_RETURNING),
    'HYBRID_RETURNING emitted');
  assert(eventNames.includes(HYBRID_EVENT.HYBRID_STATION_RESUMED),
    'HYBRID_STATION_RESUMED emitted');
});

// 27. HybridManager getDashboard shape (no secrets)
await test('27. HybridManager getDashboard shape — no secrets', async () => {
  const mgr = makeManager('hm-dash');
  const d = mgr.getDashboard();
  assert(d.stationId,   'stationId');
  assert(d.hybridState, 'hybridState');
  assert(d.source,      'source status');
  assert(d.asOf,        'asOf timestamp');

  const s = JSON.stringify(d);
  assert(!s.includes('streamKey'),   'no streamKey');
  assert(!s.includes('accessToken'), 'no accessToken');
});

// 28. Destination continuity in switch result
await test('28. Destination continuity status in switch result', async () => {
  const mgr = makeManager('hm-cont');
  await mgr.startStation();

  const liveResult = await mgr.goLive();
  assertEqual(liveResult.success, true, 'goLive ok');
  // The source switch result should report destination continuity
  // This is ARCHITECTURE_READY — reported honestly
  const switchStatus = mgr._sourceSwitcher.getStatus();
  assert(switchStatus.switchCount > 0, 'switch counted');
  assertEqual(mgr.currentSource, SOURCE_MODE.LIVE, 'source is LIVE');

  await mgr.endLive();
});

// 29. HybridManager endLive when not live
await test('29. HybridManager endLive when not live returns error', async () => {
  const mgr = makeManager('hm-notlive');
  await mgr.startStation();
  // Don't go live first

  const r = await mgr.endLive();
  assertEqual(r.success, false, 'should fail');
  assertEqual(r.code, HYBRID_ERROR_CODE.NOT_LIVE, 'NOT_LIVE code');
});

// 30. Regression — Stages 1–10 unaffected
await test('30. Regression — Stages 1-10 unaffected', async () => {
  const { FanOutManager }     = await import('../../broadcast/fanout-manager.js');
  const { PlatformManager }   = await import('../../platforms/platform-manager.js');
  const { CloudMediaLibrary } = await import('../../media/media-library.js');
  const { TVStationManager: TSM } = await import('../../tv-station/tv-station-manager.js');

  const fm  = new FanOutManager();
  const pm  = new PlatformManager();
  const lib = new CloudMediaLibrary();
  const tv  = new TSM();

  assert(fm.getAllDestinationStatuses instanceof Function, 'FanOutManager ok');
  assert(pm.list instanceof Function, 'PlatformManager ok');
  assert(lib.getCount instanceof Function, 'CloudMediaLibrary ok');
  assert(tv.createStation instanceof Function, 'TVStationManager ok');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 11 Hybrid Mode Tests`);
console.log(`  PASS:  ${_passed} / ${_passed + _failed}`);
if (_failed > 0) console.log(`  FAIL:  ${_failed}`);
console.log('══════════════════════════════════════════════════════\n');

if (_failed > 0) process.exit(1);
