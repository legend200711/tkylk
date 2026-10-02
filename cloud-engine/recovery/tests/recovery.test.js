/**
 * 24-HOUR CLOUD ENGINE — Stage 12 Recovery Test Suite
 * cloud-engine/recovery/tests/recovery.test.js
 *
 * 35 tests covering the complete Watchdog + Automatic Recovery implementation.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

// ── Recovery modules ────────────────────────────────────────────────
import { RECOVERY_ERROR_CODE, RECOVERY_ACTION, RecoveryError }
  from '../recovery-errors.js';
import {
  FAILURE_TYPE, DEFAULT_POLICIES, getPolicy,
  calculateBackoffDelay, checkPolicyAllows,
} from '../recovery-policy.js';
import {
  createRecoveryMetrics,
  recordRecoveryAttempt,
  recordRecoverySuccess,
  recordRecoveryFailure,
  recordComponentRestart,
  recordDestinationReconnect,
  recordWatchdogCheck,
  recordWatchdogWarning,
  snapshotRecoveryMetrics,
} from '../recovery-metrics.js';
import { HealthMonitor, HEALTH_STATUS } from '../health-monitor.js';
import {
  StateRecovery, ACTIVE_MODE,
} from '../state-recovery.js';
import { ProcessSupervisor }       from '../process-supervisor.js';
import { SourceRecovery }          from '../source-recovery.js';
import { DestinationRecovery }     from '../destination-recovery.js';
import { StationRecovery }         from '../station-recovery.js';
import { RecoveryEngineImpl }      from '../recovery-engine.js';
import { WatchdogImpl }            from '../../watchdog/watchdog.js';

/* ═══════════════════════════════════
   SIMPLE TEST RUNNER
═══════════════════════════════════ */

let _passed = 0;
let _failed = 0;
const _results = [];

async function test(name, fn) {
  try {
    await fn();
    _passed++;
    _results.push({ name, status: 'PASS' });
    console.log(`  ✓  ${name}`);
  } catch (err) {
    _failed++;
    _results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/* ═══════════════════════════════════
   TESTS
═══════════════════════════════════ */

console.log('\n24-Hour Cloud Engine — Stage 12 Recovery Tests\n');

// ── 1. RecoveryError structure ──────────────────────────────────────
await test('1. RecoveryError structure and codes', async () => {
  const err = new RecoveryError(RECOVERY_ERROR_CODE.ENCODER_CRASH, 'Test crash');
  assertEqual(err.name, 'RecoveryError', 'name');
  assertEqual(err.code, RECOVERY_ERROR_CODE.ENCODER_CRASH, 'code');
  assert(typeof err.timestamp === 'string', 'timestamp');
  const json = err.toJSON();
  assertEqual(json.code, RECOVERY_ERROR_CODE.ENCODER_CRASH, 'toJSON.code');
  assert(Object.values(RECOVERY_ERROR_CODE).length > 0, 'error codes defined');
});

// ── 2. RECOVERY_ACTION all values defined ───────────────────────────
await test('2. RECOVERY_ACTION all values defined', async () => {
  const expected = ['RETRY','RECONNECT','RESTART_COMPONENT','RESTART_SOURCE',
                    'RETURN_TO_STATION','USE_FALLBACK','ESCALATE','FATAL','NONE'];
  for (const v of expected) {
    assert(RECOVERY_ACTION[v] === v, `RECOVERY_ACTION.${v} missing`);
  }
});

// ── 3. FAILURE_TYPE all values defined ─────────────────────────────
await test('3. FAILURE_TYPE all values defined', async () => {
  const expected = ['ENCODER_CRASH','ENCODER_STALLED','ENCODER_BEHIND',
                    'INGEST_DISCONNECTED','INGEST_STALLED','DESTINATION_DISCONNECTED',
                    'TRANSPORT_CRASH','RECONNECT_EXHAUSTED','MEDIA_PLAYBACK_FAILURE',
                    'STATION_PLAYBACK_FAILURE','HYBRID_LIVE_FAILURE','CONTROL_PLANE_FAILURE',
                    'PROCESS_CRASH'];
  for (const v of expected) {
    assert(FAILURE_TYPE[v] === v, `FAILURE_TYPE.${v} missing`);
  }
});

// ── 4. Policy retrieval ─────────────────────────────────────────────
await test('4. getPolicy returns correct policy for failure type', async () => {
  const p = getPolicy(FAILURE_TYPE.ENCODER_CRASH);
  assertEqual(p.action, RECOVERY_ACTION.RESTART_COMPONENT, 'action');
  assert(p.maxAttempts > 0, 'maxAttempts > 0');
  assert(p.cooldownMs > 0, 'cooldownMs > 0');
  assert(typeof p.jitter === 'boolean', 'jitter is boolean');
});

// ── 5. Policy fallback for unknown type ─────────────────────────────
await test('5. getPolicy returns ESCALATE fallback for unknown failure', async () => {
  const p = getPolicy('UNKNOWN_FAILURE_XYZ');
  assertEqual(p.action, RECOVERY_ACTION.ESCALATE, 'fallback action');
});

// ── 6. Policy overrides ─────────────────────────────────────────────
await test('6. getPolicy respects overrides', async () => {
  const p = getPolicy(FAILURE_TYPE.DESTINATION_DISCONNECTED, { maxAttempts: 99 });
  assertEqual(p.maxAttempts, 99, 'maxAttempts override');
});

// ── 7. Backoff delay calculation ────────────────────────────────────
await test('7. calculateBackoffDelay exponential with cap', async () => {
  const policy = { baseDelayMs: 1000, maxDelayMs: 10000, jitter: false };
  assertEqual(calculateBackoffDelay(policy, 1), 1000, 'attempt 1');
  assertEqual(calculateBackoffDelay(policy, 2), 2000, 'attempt 2');
  assertEqual(calculateBackoffDelay(policy, 4), 8000, 'attempt 4');
  // Capped at maxDelayMs
  assertEqual(calculateBackoffDelay(policy, 10), 10000, 'attempt 10 capped');
});

// ── 8. Backoff with jitter ──────────────────────────────────────────
await test('8. calculateBackoffDelay with jitter stays in range', async () => {
  const policy = { baseDelayMs: 2000, maxDelayMs: 30000, jitter: true };
  for (let i = 0; i < 10; i++) {
    const d = calculateBackoffDelay(policy, 2);
    assert(d >= 0, 'delay >= 0');
    assert(d <= 30000, 'delay <= maxDelayMs');
  }
});

// ── 9. Policy allowance — max attempts exceeded ─────────────────────
await test('9. checkPolicyAllows: rejects when max attempts exceeded', async () => {
  const policy = { maxAttempts: 3, cooldownMs: 0 };
  const result = checkPolicyAllows(policy, 3, null);
  assert(!result.allowed, 'blocked at max');
  assert(result.reason?.includes('3'), 'reason mentions limit');
});

// ── 10. Policy allowance — cooldown active ──────────────────────────
await test('10. checkPolicyAllows: rejects during cooldown period', async () => {
  const policy = { maxAttempts: 10, cooldownMs: 60000 };
  const recentAttempt = Date.now() - 5000;  // 5s ago
  const result = checkPolicyAllows(policy, 1, recentAttempt);
  assert(!result.allowed, 'blocked during cooldown');
  assert(result.reason?.includes('Cooldown'), 'reason mentions cooldown');
});

// ── 11. Policy allowance — within limits ────────────────────────────
await test('11. checkPolicyAllows: allows within limits', async () => {
  const policy = { maxAttempts: 5, cooldownMs: 5000 };
  const oldAttempt = Date.now() - 10000;  // 10s ago — cooldown passed
  const result = checkPolicyAllows(policy, 2, oldAttempt);
  assert(result.allowed, 'allowed within limits');
});

// ── 12. Recovery metrics creation ───────────────────────────────────
await test('12. createRecoveryMetrics returns correct initial state', async () => {
  const m = createRecoveryMetrics();
  assertEqual(m.totalRecoveryAttempts, 0, 'attempts');
  assertEqual(m.successfulRecoveries, 0, 'successes');
  assertEqual(m.failedRecoveries, 0, 'failures');
  assertEqual(m.currentRecoveryState, 'IDLE', 'state');
  assertEqual(m.watchdogActive, false, 'watchdog inactive initially');
});

// ── 13. Recovery metrics tracking ───────────────────────────────────
await test('13. Recovery metrics track attempts and successes', async () => {
  const m = createRecoveryMetrics();
  recordRecoveryAttempt(m, 'encoder');
  assertEqual(m.totalRecoveryAttempts, 1, 'attempts');
  assertEqual(m.activeRecoveries, 1, 'active');
  assertEqual(m.currentRecoveryState, 'RECOVERING', 'state');

  recordRecoverySuccess(m, 1500);
  assertEqual(m.successfulRecoveries, 1, 'successes');
  assertEqual(m.activeRecoveries, 0, 'active=0');
  assertEqual(m.currentRecoveryState, 'IDLE', 'state=IDLE');
  assertEqual(m.lastRecoveryDurationMs, 1500, 'duration');
});

// ── 14. Recovery metrics snapshot ───────────────────────────────────
await test('14. snapshotRecoveryMetrics returns safe copy', async () => {
  const m = createRecoveryMetrics();
  recordComponentRestart(m, 'encoder');
  const snap = snapshotRecoveryMetrics(m);
  assertEqual(snap.componentRestartCount, 1, 'restart count');
  assert(snap.watchdog, 'watchdog section present');
  assertEqual(snap.watchdog.active, false, 'watchdog.active');
});

// ── 15. HealthMonitor — no components ───────────────────────────────
await test('15. HealthMonitor returns HEALTHY with no components', async () => {
  const hm = new HealthMonitor();
  const report = hm.check({});
  assertEqual(report.overallStatus, HEALTH_STATUS.HEALTHY, 'healthy with no refs');
  assert(Array.isArray(report.checks), 'checks is array');
  assertEqual(report.checks.length, 0, 'no checks');
});

// ── 16. HealthMonitor — encoder error detection ─────────────────────
await test('16. HealthMonitor detects encoder in ERROR state', async () => {
  const hm = new HealthMonitor();
  const fakeEncoder = {
    getStatus: () => ({ state: 'ERROR', lastError: { message: 'crash' } }),
    getMetrics: () => null,
  };
  const report = hm.check({ encoder: fakeEncoder });
  assertEqual(report.overallStatus, HEALTH_STATUS.UNHEALTHY, 'unhealthy');
  const encoderCheck = report.checks.find(c => c.component === 'encoder');
  assertEqual(encoderCheck.status, HEALTH_STATUS.UNHEALTHY, 'encoder check unhealthy');
  assertEqual(encoderCheck.failureType, FAILURE_TYPE.ENCODER_CRASH, 'failure type');
});

// ── 17. HealthMonitor — encoder healthy ─────────────────────────────
await test('17. HealthMonitor reports encoder HEALTHY when encoding', async () => {
  const hm = new HealthMonitor();
  const fakeEncoder = {
    getStatus: () => ({ state: 'ENCODING' }),
    getMetrics: () => ({ position: 10.5, fps: 30 }),
  };
  const report = hm.check({ encoder: fakeEncoder });
  const check = report.checks.find(c => c.component === 'encoder');
  assertEqual(check.status, HEALTH_STATUS.HEALTHY, 'healthy');
});

// ── 18. HealthMonitor — uninitialized encoder is NOT_ACTIVE ─────────
await test('18. HealthMonitor: uninitialized encoder is NOT_ACTIVE (not failure)', async () => {
  const hm = new HealthMonitor();
  const fakeEncoder = {
    getStatus: () => ({ state: 'UNINITIALIZED' }),
    getMetrics: () => null,
  };
  const report = hm.check({ encoder: fakeEncoder });
  assertEqual(report.overallStatus, HEALTH_STATUS.HEALTHY, 'not unhealthy for uninitialized');
  const check = report.checks.find(c => c.component === 'encoder');
  assertEqual(check.status, HEALTH_STATUS.NOT_ACTIVE, 'not active');
});

// ── 19. HealthMonitor — destination exhausted ───────────────────────
await test('19. HealthMonitor detects EXHAUSTED destination', async () => {
  const hm = new HealthMonitor();
  const fakeFanOut = {
    getAllDestinationStatuses: () => [
      { destinationId: 'yt', state: 'EXHAUSTED' },
      { destinationId: 'tw', state: 'BROADCASTING' },
    ],
  };
  const report = hm.check({ fanOutManager: fakeFanOut });
  const failedChecks = report.checks.filter(c => c.status === HEALTH_STATUS.UNHEALTHY);
  assertEqual(failedChecks.length, 1, 'one failed destination');
  assertEqual(failedChecks[0].component, 'destination:yt', 'yt failed');
  // tw should still be healthy
  const ytCheck = report.checks.find(c => c.component === 'destination:tw');
  assertEqual(ytCheck.status, HEALTH_STATUS.HEALTHY, 'tw healthy');
});

// ── 20. StateRecovery — save and retrieve ───────────────────────────
await test('20. StateRecovery: save and retrieve state', async () => {
  const sr = new StateRecovery();
  const result = sr.saveState({
    ownerId:       'user-1',
    mode:          ACTIVE_MODE.BROADCAST,
    destinationIds:['yt','tw'],
    stationId:     null,
  });
  assert(result.success, 'save succeeds');
  assert(result.version > 0, 'version incremented');

  const persisted = sr.getPersistedState();
  assertEqual(persisted.ownerId, 'user-1', 'ownerId');
  assertEqual(persisted.mode, ACTIVE_MODE.BROADCAST, 'mode');
  assertEqual(persisted.destinationIds.length, 2, 'destination count');
});

// ── 21. StateRecovery — ownership check ─────────────────────────────
await test('21. StateRecovery: rejects restore for wrong owner', async () => {
  const sr = new StateRecovery();
  sr.saveState({ ownerId: 'user-1', mode: ACTIVE_MODE.BROADCAST });

  const result = sr.evaluateRestore('user-2');  // Different user!
  assert(!result.safe, 'not safe for wrong owner');
  assert(result.reason.includes('mismatch') || result.reason.includes('Ownership'), 'ownership reason');
  assertEqual(result.state, null, 'no state returned');
});

// ── 22. StateRecovery — owner can restore ───────────────────────────
await test('22. StateRecovery: allows restore for correct owner', async () => {
  const sr = new StateRecovery();
  sr.saveState({ ownerId: 'user-1', mode: ACTIVE_MODE.STATION, stationId: 'st-1' });

  const result = sr.evaluateRestore('user-1');
  assert(result.safe, 'safe for correct owner');
  assert(result.state !== null, 'state returned');
  assertEqual(result.state.stationId, 'st-1', 'stationId preserved');
});

// ── 23. StateRecovery — stale state rejected ────────────────────────
await test('23. StateRecovery: rejects stale state beyond maxAge', async () => {
  const sr = new StateRecovery();
  sr.saveState({ ownerId: 'user-1', mode: ACTIVE_MODE.IDLE });

  // Check with maxAge of 0 to simulate stale (state age will always be >= 0)
  await new Promise(r => setTimeout(r, 5));
  const result = sr.evaluateRestore('user-1', { maxAgeMs: 1 });
  assert(!result.safe, 'stale state rejected');
  assert(result.reason.includes('stale') || result.reason.includes('old'), 'stale reason');
});

// ── 24. StateRecovery — no credentials persisted ────────────────────
await test('24. StateRecovery: credentials never persisted', async () => {
  const sr = new StateRecovery();
  // Attempt to slip a credential into state
  sr.saveState({
    ownerId:   'user-1',
    mode:      ACTIVE_MODE.BROADCAST,
    streamKey: 'SUPER_SECRET_KEY',  // Should be ignored
    token:     'bearer-abc123',     // Should be ignored
  });

  const state = sr.getPersistedState();
  assert(!state.streamKey, 'streamKey not persisted');
  assert(!state.token, 'token not persisted');
  const json = JSON.stringify(state);
  assert(!json.includes('SUPER_SECRET_KEY'), 'key not in state JSON');
  assert(!json.includes('bearer-abc123'), 'token not in state JSON');
});

// ── 25. StateRecovery — build recovery plan ─────────────────────────
await test('25. StateRecovery: buildRecoveryPlan identifies needed actions', async () => {
  const sr = new StateRecovery();
  sr.saveState({
    ownerId:       'user-1',
    mode:          ACTIVE_MODE.BROADCAST,
    destinationIds:['yt', 'tw'],
  });

  const state = sr.getPersistedState();
  const plan = sr.buildRecoveryPlan(state, {
    destinationStates: { yt: 'STOPPED', tw: 'STOPPED' },
  });

  assert(plan.actions.length > 0, 'has recovery actions');
  const reconnects = plan.actions.filter(a => a.type === 'RECONNECT_DESTINATION');
  assertEqual(reconnects.length, 2, '2 destinations to reconnect');
});

// ── 26. ProcessSupervisor — register and track ──────────────────────
await test('26. ProcessSupervisor: register and mark exited', async () => {
  const ps = new ProcessSupervisor();
  ps.register(12345, 'encoder');
  ps.register(12346, 'destination:youtube');

  assertEqual(ps.getStats().total, 2, 'two processes');
  assertEqual(ps.getStats().active, 2, 'two active');

  ps.markExited(12345);
  assertEqual(ps.getStats().active, 1, 'one active after exit');
  assertEqual(ps.getStats().exited, 1, 'one exited');
});

// ── 27. ProcessSupervisor — prune exited ────────────────────────────
await test('27. ProcessSupervisor: pruneExited removes exited processes', async () => {
  const ps = new ProcessSupervisor();
  ps.register(99001, 'test1');
  ps.register(99002, 'test2');
  ps.markExited(99001);
  ps.pruneExited();
  assertEqual(ps.getStats().total, 1, 'one process after prune');
});

// ── 28. DestinationRecovery — recovery isolation ────────────────────
await test('28. DestinationRecovery: isolated per destination', async () => {
  const dr = new DestinationRecovery();

  let ytCalled = false, twCalled = false;
  const fakeManager = {
    restartDestination: async (id) => {
      if (id === 'yt') ytCalled = true;
      if (id === 'tw') twCalled = true;
      return { success: true, message: 'ok' };
    },
    getAllDestinationStatuses: () => [
      { destinationId: 'yt', state: 'BROADCASTING' },
      { destinationId: 'tw', state: 'BROADCASTING' },
    ],
  };

  const result = await dr.recoverDestination({
    destinationId: 'yt',
    failureType:   FAILURE_TYPE.DESTINATION_DISCONNECTED,
    fanOutManager: fakeManager,
    policyOverrides: { baseDelayMs: 0, maxAttempts: 5 },
  });

  assert(ytCalled, 'youtube recovery called');
  assert(!twCalled, 'twitch NOT affected by youtube recovery');
  assert(result.success, 'recovery succeeded');
});

// ── 29. DestinationRecovery — allDestinationsFailed ─────────────────
await test('29. DestinationRecovery: allDestinationsFailed detects total failure', async () => {
  const dr = new DestinationRecovery();
  const fakeManager = {
    getAllDestinationStatuses: () => [
      { destinationId: 'yt', state: 'EXHAUSTED' },
      { destinationId: 'tw', state: 'ERROR' },
      { destinationId: 'fb', state: 'STOPPED' },
    ],
  };
  assert(dr.allDestinationsFailed(fakeManager), 'all failed');

  const partialManager = {
    getAllDestinationStatuses: () => [
      { destinationId: 'yt', state: 'EXHAUSTED' },
      { destinationId: 'tw', state: 'BROADCASTING' },  // still alive
    ],
  };
  assert(!dr.allDestinationsFailed(partialManager), 'not all failed when one live');
});

// ── 30. RecoveryEngine — initialize ─────────────────────────────────
await test('30. RecoveryEngineImpl: initializes correctly', async () => {
  const engine = new RecoveryEngineImpl();
  const result = await engine.initialize();
  assert(result.success, 'initialized');
  assertEqual(engine.getStatus().initialized, true, 'initialized flag');
  await engine.shutdown();
});

// ── 31. RecoveryEngine — state save/restore cycle ───────────────────
await test('31. RecoveryEngine: save and evaluate recovery state', async () => {
  const engine = new RecoveryEngineImpl();
  await engine.initialize();

  const saveResult = engine.saveRecoveryState({
    ownerId: 'user-1',
    mode:    ACTIVE_MODE.STATION,
    stationId: 'st-1',
  });
  assert(saveResult.success, 'state saved');

  const evalResult = engine.evaluateRestore('user-1');
  assert(evalResult.safe, 'safe to restore');
  assertEqual(evalResult.state.stationId, 'st-1', 'station id preserved');

  // Wrong owner denied
  const badResult = engine.evaluateRestore('user-2');
  assert(!badResult.safe, 'wrong owner denied');

  engine.clearRecoveryState();
  await engine.shutdown();
});

// ── 32. RecoveryEngine — metrics tracking ───────────────────────────
await test('32. RecoveryEngine: metrics track attempts', async () => {
  const engine = new RecoveryEngineImpl();
  await engine.initialize();

  const metrics = engine.getMetrics();
  assert(typeof metrics.totalRecoveryAttempts === 'number', 'attempts tracked');
  assert(typeof metrics.watchdog === 'object', 'watchdog section');

  await engine.shutdown();
});

// ── 33. WatchdogImpl — initialize and status ────────────────────────
await test('33. WatchdogImpl: initializes and reports correct status', async () => {
  const wdog = new WatchdogImpl({ checkIntervalMs: 1000 });
  await wdog.initialize({});
  assert(!wdog.isActive(), 'not active before start');

  const status = wdog.getStatus();
  assert(!status.active, 'inactive initially');
  assert(status.status, 'status field present');
});

// ── 34. WatchdogImpl — runCheck with healthy components ─────────────
await test('34. WatchdogImpl: runCheck with all healthy components', async () => {
  const wdog = new WatchdogImpl({ checkIntervalMs: 60000 });
  await wdog.initialize({
    refs: {
      encoder: {
        getStatus:  () => ({ state: 'READY' }),
        getMetrics: () => null,
      },
    },
  });

  const report = await wdog.runCheck();
  assertEqual(report.overallStatus, HEALTH_STATUS.HEALTHY, 'healthy');
  assertEqual(report.failures.length, 0, 'no failures');
});

// ── 35. Regression — Stages 1-11 unaffected ─────────────────────────
await test('35. Regression: Stage 12 additions do not break core module imports', async () => {
  const { CLOUD_ENGINE_EVENTS }    = await import('../../core/events.js');
  const { CloudEngineEventBus }    = await import('../../core/event-bus.js');
  const { COMPONENT_STATUS }       = await import('../../core/state-manager.js');

  // Stage 12 recovery events present
  assert(CLOUD_ENGINE_EVENTS.WATCHDOG_WARNING,    'WATCHDOG_WARNING event');
  assert(CLOUD_ENGINE_EVENTS.WATCHDOG_FAILURE,    'WATCHDOG_FAILURE event');
  assert(CLOUD_ENGINE_EVENTS.RECOVERY_STARTED,    'RECOVERY_STARTED event');
  assert(CLOUD_ENGINE_EVENTS.RECOVERY_FAILED,     'RECOVERY_FAILED event');
  assert(CLOUD_ENGINE_EVENTS.DESTINATION_RECOVERED, 'DESTINATION_RECOVERED event');
  assert(CLOUD_ENGINE_EVENTS.STATION_RECOVERED,   'STATION_RECOVERED event');
  assert(CLOUD_ENGINE_EVENTS.FALLBACK_ACTIVATED,  'FALLBACK_ACTIVATED event');

  // Original events still present
  assert(CLOUD_ENGINE_EVENTS.ENGINE_READY,        'ENGINE_READY still present');
  assert(CLOUD_ENGINE_EVENTS.BROADCAST_STARTED,   'BROADCAST_STARTED still present');
  assert(CLOUD_ENGINE_EVENTS.DESTINATION_FAILED,  'DESTINATION_FAILED still present');
  assert(CLOUD_ENGINE_EVENTS.INGEST_STARTED,      'INGEST_STARTED still present');
  assert(COMPONENT_STATUS.NOT_IMPLEMENTED,         'COMPONENT_STATUS.NOT_IMPLEMENTED');
  assert(COMPONENT_STATUS.OK,                      'COMPONENT_STATUS.OK');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */

console.log(`\n  Stage 12 Recovery: ${_passed} PASSED, ${_failed} FAILED\n`);

if (_failed > 0) {
  console.error('FAILED TESTS:');
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.error(`  ✗ ${r.name}: ${r.error}`)
  );
  process.exit(1);
}
