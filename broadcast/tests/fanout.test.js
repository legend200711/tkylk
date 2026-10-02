/**
 * 24-HOUR CLOUD ENGINE — Stage 4 Tests
 * cloud-engine/broadcast/tests/fanout.test.js
 *
 * Tests for Stage 4: Multi-Platform Fan-Out
 *
 * Tests:
 *  1. FanOutManager — add / remove destinations
 *  2. Multiple simultaneous sessions (independent states)
 *  3. Destination failure isolation — one failure does not affect others
 *  4. Reconnect isolation — one destination reconnecting does not affect others
 *  5. Secret protection — stream keys never appear in status/metrics APIs
 *  6. startMultiBroadcast / stopMultiBroadcast lifecycle
 *  7. getMultiBroadcastMetrics shape validation
 *  8. computeMultiBroadcastMetrics aggregation logic
 *  9. getDestinationStatus / getAllDestinationStatuses
 * 10. addDestinationToBroadcast / removeDestinationFromBroadcast
 * 11. restartDestination
 * 12. Regression — Stage 1–3 modules still importable and functional
 *
 * Stage 4 — Multi-Platform Fan-Out
 */

import { FanOutManager, FANOUT_STATE }                  from '../fanout-manager.js';
import { DestinationSession, SESSION_STATE, SESSION_EVENT } from '../destination-session.js';
import { computeMultiBroadcastMetrics,
         formatMultiBroadcastMetrics }                  from '../multi-broadcast-metrics.js';
import { safeDestinationInfo, validateDestination,
         BROADCAST_PROTOCOL }                           from '../destination-manager.js';
import { BroadcastError, BROADCAST_ERROR_CODE }         from '../broadcast-errors.js';
import { ReconnectManager }                             from '../reconnect-manager.js';
import { ShadowBroadcastEngine, BROADCAST_STATE }       from '../broadcast-engine.js';
import { CLOUD_ENGINE_EVENTS }                          from '../../core/events.js';
import { CloudEngineEventBus }                          from '../../core/event-bus.js';

/* ═══════════════════════════════════
   TEST FRAMEWORK
═══════════════════════════════════ */
let _passed = 0;
let _failed = 0;
const _results = [];

async function test(name, fn) {
  try {
    await fn();
    _passed++;
    _results.push({ name, status: 'PASS' });
    console.log(`  ✓  PASS  ${name}`);
  } catch (err) {
    _failed++;
    _results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  ✗  FAIL  ${name}`);
    console.error(`           ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label ?? 'assertEqual'}: expected "${expected}", got "${actual}"`);
  }
}

function assertNoSecret(obj, label) {
  const serialized = JSON.stringify(obj);
  // Check that no real stream key value appears
  // (env vars are not set in test, so keys resolve to errors — but we verify
  //  the status representation is always masked)
  assert(!serialized.includes('REAL_KEY_VALUE'), `${label}: stream key leaked in output`);
  // streamKey field, if present, must be masked
  if (serialized.includes('"streamKey"')) {
    assert(serialized.includes('"streamKey":"********"'),
      `${label}: streamKey field must be ******** in output`);
  }
}

/* ═══════════════════════════════════
   SAMPLE DESTINATIONS (no real keys needed for state tests)
═══════════════════════════════════ */
const DEST_YOUTUBE = {
  destinationId:   'youtube',
  name:            'YouTube',
  protocol:        BROADCAST_PROTOCOL.RTMPS,
  serverUrl:       'rtmps://a.rtmp.youtube.com/live2',
  streamKeyEnvVar: 'CE_STREAM_KEY_YOUTUBE',
  enabled:         true,
  autoReconnect:   false,
};

const DEST_TWITCH = {
  destinationId:   'twitch',
  name:            'Twitch',
  protocol:        BROADCAST_PROTOCOL.RTMP,
  serverUrl:       'rtmp://live.twitch.tv/app',
  streamKeyEnvVar: 'CE_STREAM_KEY_TWITCH',
  enabled:         true,
  autoReconnect:   false,
};

const DEST_FACEBOOK = {
  destinationId:   'facebook',
  name:            'Facebook',
  protocol:        BROADCAST_PROTOCOL.RTMPS,
  serverUrl:       'rtmps://live-api-s.facebook.com:443/rtmp',
  streamKeyEnvVar: 'CE_STREAM_KEY_FACEBOOK',
  enabled:         true,
  autoReconnect:   true,
};

const DEST_CUSTOM = {
  destinationId:   'custom-rtmp',
  name:            'Custom RTMP',
  protocol:        BROADCAST_PROTOCOL.RTMP,
  serverUrl:       'rtmp://custom.example.com/live',
  streamKeyEnvVar: 'CE_STREAM_KEY_CUSTOM',
  enabled:         true,
  autoReconnect:   false,
};

console.log('\n══════════════════════════════════════════════════════');
console.log('  24-Hour Cloud Engine — Stage 4 Fan-Out Tests');
console.log('══════════════════════════════════════════════════════\n');

/* ─────────────────────────────────────────────────────────
   TEST 1 — FanOutManager: add / remove destinations
──────────────────────────────────────────────────────── */
await test('1. FanOutManager: add and remove destinations', () => {
  const mgr = new FanOutManager();

  const r1 = mgr.addDestination(DEST_YOUTUBE);
  assert(r1.success, `addDestination YouTube: ${r1.message}`);

  const r2 = mgr.addDestination(DEST_TWITCH);
  assert(r2.success, `addDestination Twitch: ${r2.message}`);

  const statuses = mgr.getAllDestinationStatuses();
  assertEqual(statuses.length, 2, 'destination count');
  assertEqual(statuses[0].destinationId, 'youtube', 'first destination id');
  assertEqual(statuses[1].destinationId, 'twitch',  'second destination id');

  // Duplicate registration rejected
  const r3 = mgr.addDestination(DEST_YOUTUBE);
  assert(!r3.success, 'duplicate registration must be rejected');
});

/* ─────────────────────────────────────────────────────────
   TEST 2 — Multiple sessions: independent states
──────────────────────────────────────────────────────── */
await test('2. Multiple sessions have independent states', () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);
  mgr.addDestination(DEST_FACEBOOK);

  const statuses = mgr.getAllDestinationStatuses();
  assertEqual(statuses.length, 3, 'destination count');

  // All should be in IDLE state independently
  for (const s of statuses) {
    assertEqual(s.state, SESSION_STATE.IDLE, `${s.destinationId} initial state`);
  }

  // Each has its own destinationId
  const ids = statuses.map(s => s.destinationId);
  assert(new Set(ids).size === 3, 'all destinationIds must be unique');
});

/* ─────────────────────────────────────────────────────────
   TEST 3 — Destination failure isolation
──────────────────────────────────────────────────────── */
await test('3. Destination failure isolation — failure in one session does not affect others', () => {
  // We test this at the DestinationSession level since we can't spawn real FFmpeg
  // processes in unit tests without a real FLV source. We simulate by directly
  // triggering the crash handler.

  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);
  mgr.addDestination(DEST_FACEBOOK);

  // Simulate: manually set YouTube to ERROR state, others remain IDLE
  const sessions = [...mgr._sessions.values()];
  // Directly set state for simulation
  sessions[0]._state = SESSION_STATE.ERROR;

  const s = mgr.getAllDestinationStatuses();
  assertEqual(s[0].state, SESSION_STATE.ERROR, 'youtube should be ERROR');
  assertEqual(s[1].state, SESSION_STATE.IDLE,  'twitch should remain IDLE');
  assertEqual(s[2].state, SESSION_STATE.IDLE,  'facebook should remain IDLE');

  // Fan-out state should NOT be STOPPED as long as some sessions are not ALL stopped/error
  // We simulate broadcasting states manually
  sessions[1]._state = SESSION_STATE.BROADCASTING;
  sessions[2]._state = SESSION_STATE.BROADCASTING;
  mgr._updateFanoutState();
  // Should be PARTIAL since some are good, one is errored
  // (startedAt was not set so fan-out was IDLE, now PARTIAL after update)
  mgr._state = FANOUT_STATE.BROADCASTING; // set explicitly then update
  mgr._updateFanoutState();
  assertEqual(mgr._state, FANOUT_STATE.PARTIAL, 'fan-out should be PARTIAL, not STOPPED');
});

/* ─────────────────────────────────────────────────────────
   TEST 4 — Reconnect isolation
──────────────────────────────────────────────────────── */
await test('4. Reconnect isolation — one destination reconnecting does not affect others', () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);

  // Simulate one reconnecting, one broadcasting
  const [ytSession, twSession] = [...mgr._sessions.values()];
  ytSession._state = SESSION_STATE.RECONNECTING;
  ytSession._reconnectCount = 2;
  twSession._state = SESSION_STATE.BROADCASTING;

  const s = mgr.getAllDestinationStatuses();
  assertEqual(s[0].state, SESSION_STATE.RECONNECTING, 'youtube is reconnecting');
  assertEqual(s[0].reconnectCount, 2, 'youtube reconnect count');
  assertEqual(s[1].state, SESSION_STATE.BROADCASTING, 'twitch is still broadcasting');

  // Metrics reflect real state
  const metrics = mgr.getMultiBroadcastMetrics();
  assertEqual(metrics.stateCounts.reconnecting, 1, 'one reconnecting');
  assertEqual(metrics.stateCounts.broadcasting, 1, 'one broadcasting');
  assertEqual(metrics.activeSessions,           2, 'both are active (broadcasting + reconnecting)');
});

/* ─────────────────────────────────────────────────────────
   TEST 5 — Secret protection
──────────────────────────────────────────────────────── */
await test('5. Stream keys never appear in status or metrics output', () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);

  const statuses = mgr.getAllDestinationStatuses();
  for (const s of statuses) {
    assertNoSecret(s, `status for ${s.destinationId}`);
  }

  const metrics = mgr.getMultiBroadcastMetrics();
  assertNoSecret(metrics, 'getMultiBroadcastMetrics');

  const single = mgr.getDestinationStatus('youtube');
  assertNoSecret(single, 'getDestinationStatus');

  // The streamKey field must always be ******** when present
  const serialized = JSON.stringify(statuses);
  assert(
    !serialized.includes('"streamKey":"') ||
     serialized.includes('"streamKey":"********"'),
    'streamKey field must be masked in all status objects',
  );
});

/* ─────────────────────────────────────────────────────────
   TEST 6 — startMultiBroadcast lifecycle (no real FFmpeg)
──────────────────────────────────────────────────────── */
await test('6. startMultiBroadcast requires inputPath and ffmpegPath', async () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);

  const r1 = await mgr.startMultiBroadcast({});
  assert(!r1.success, 'should fail without inputPath');

  const r2 = await mgr.startMultiBroadcast({ inputPath: '/tmp/test.flv' });
  assert(!r2.success, 'should fail without ffmpegPath');
});

/* ─────────────────────────────────────────────────────────
   TEST 7 — getMultiBroadcastMetrics shape validation
──────────────────────────────────────────────────────── */
await test('7. getMultiBroadcastMetrics returns correct shape', () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);

  const metrics = mgr.getMultiBroadcastMetrics();

  assert('fanoutState'        in metrics, 'has fanoutState');
  assert('destinationCount'   in metrics, 'has destinationCount');
  assert('activeSessions'     in metrics, 'has activeSessions');
  assert('failedSessions'     in metrics, 'has failedSessions');
  assert('totalBytesSent'     in metrics, 'has totalBytesSent');
  assert('stateCounts'        in metrics, 'has stateCounts');
  assert('destinations'       in metrics, 'has destinations');
  assertEqual(metrics.destinationCount, 2, 'destinationCount');
  assertEqual(typeof metrics.totalBytesSent, 'number', 'totalBytesSent is number');
});

/* ─────────────────────────────────────────────────────────
   TEST 8 — computeMultiBroadcastMetrics aggregation
──────────────────────────────────────────────────────── */
await test('8. computeMultiBroadcastMetrics aggregates correctly', () => {
  const mockStatuses = [
    { destinationId: 'youtube',  name: 'YouTube',  state: SESSION_STATE.BROADCASTING,  bytesSent: 5000,  uptimeSec: 120, reconnectCount: 0,  lastError: null },
    { destinationId: 'twitch',   name: 'Twitch',   state: SESSION_STATE.BROADCASTING,  bytesSent: 4800,  uptimeSec: 115, reconnectCount: 1,  lastError: null },
    { destinationId: 'facebook', name: 'Facebook', state: SESSION_STATE.RECONNECTING,  bytesSent: 2000,  uptimeSec: 30,  reconnectCount: 2,  lastError: null },
    { destinationId: 'custom',   name: 'Custom',   state: SESSION_STATE.ERROR,          bytesSent: 0,     uptimeSec: null, reconnectCount: 0, lastError: { code: 'STREAM_KEY_MISSING', message: 'No key' } },
  ];

  const metrics = computeMultiBroadcastMetrics(mockStatuses, {
    fanoutState: FANOUT_STATE.PARTIAL,
    startedAt: new Date(Date.now() - 130_000).toISOString(),
  });

  assertEqual(metrics.destinationCount, 4, 'total destinations');
  assertEqual(metrics.stateCounts.broadcasting, 2, 'broadcasting count');
  assertEqual(metrics.stateCounts.reconnecting,  1, 'reconnecting count');
  assertEqual(metrics.stateCounts.error,         1, 'error count');
  assertEqual(metrics.activeSessions, 3, 'active sessions (broadcasting + reconnecting)');
  assertEqual(metrics.failedSessions, 1, 'failed sessions');
  assertEqual(metrics.totalBytesSent, 11800, 'total bytes sent');
  assertEqual(metrics.reconnectTotal, 3, 'total reconnects');
  assert(metrics.uptimeSec >= 130, 'uptime should be at least 130s');

  // Format should not throw
  const fmt = formatMultiBroadcastMetrics(metrics);
  assert(typeof fmt === 'string', 'formatMultiBroadcastMetrics returns string');
  assert(fmt.includes('youtube'), 'format includes destination ids');
});

/* ─────────────────────────────────────────────────────────
   TEST 9 — getDestinationStatus / getAllDestinationStatuses
──────────────────────────────────────────────────────── */
await test('9. getDestinationStatus and getAllDestinationStatuses work correctly', () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);
  mgr.addDestination(DEST_FACEBOOK);
  mgr.addDestination(DEST_CUSTOM);

  const yt = mgr.getDestinationStatus('youtube');
  assert(yt !== null, 'youtube status should exist');
  assertEqual(yt.destinationId, 'youtube', 'destinationId matches');
  assertEqual(yt.state, SESSION_STATE.IDLE, 'initial state is IDLE');

  const none = mgr.getDestinationStatus('nonexistent');
  assert(none === null, 'nonexistent destination returns null');

  const all = mgr.getAllDestinationStatuses();
  assertEqual(all.length, 4, 'all 4 destinations returned');
  assert(all.every(s => s.destinationId), 'all have destinationId');
});

/* ─────────────────────────────────────────────────────────
   TEST 10 — addDestinationToBroadcast / removeDestinationFromBroadcast
──────────────────────────────────────────────────────── */
await test('10. addDestinationToBroadcast and removeDestinationFromBroadcast', async () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);

  // Add while not broadcasting
  const addResult = await mgr.addDestinationToBroadcast(DEST_TWITCH);
  assert(addResult.success, `addDestinationToBroadcast: ${addResult.message}`);

  const statuses = mgr.getAllDestinationStatuses();
  assertEqual(statuses.length, 2, 'two destinations after add');

  // Remove
  const removeResult = await mgr.removeDestinationFromBroadcast('twitch');
  assert(removeResult.success, `removeDestinationFromBroadcast: ${removeResult.message}`);

  const statusesAfter = mgr.getAllDestinationStatuses();
  assertEqual(statusesAfter.length, 1, 'one destination after remove');
});

/* ─────────────────────────────────────────────────────────
   TEST 11 — restartDestination
──────────────────────────────────────────────────────── */
await test('11. restartDestination targets only the specified destination', async () => {
  const mgr = new FanOutManager();
  mgr.addDestination(DEST_YOUTUBE);
  mgr.addDestination(DEST_TWITCH);

  // Simulate youtube in ERROR state
  const [ytSession, twSession] = [...mgr._sessions.values()];
  ytSession._state = SESSION_STATE.ERROR;
  twSession._state = SESSION_STATE.BROADCASTING;

  // restartDestination for nonexistent should fail
  const r0 = await mgr.restartDestination('nonexistent');
  assert(!r0.success, 'nonexistent destination should fail');

  // restartDestination for youtube — it will fail because no real FFmpeg,
  // but it must NOT change Twitch state
  await mgr.restartDestination('youtube').catch(() => {});
  const twStatus = mgr.getDestinationStatus('twitch');
  // Twitch was BROADCASTING before restart, should still be BROADCASTING or not STOPPED
  assert(
    twStatus.state === SESSION_STATE.BROADCASTING,
    `Twitch must not be affected by YouTube restart, got: ${twStatus.state}`,
  );
});

/* ─────────────────────────────────────────────────────────
   TEST 12 — Regression: Stage 1-3 modules still functional
──────────────────────────────────────────────────────── */
await test('12. Regression — Stage 1-3 broadcast modules still importable and functional', async () => {
  // ShadowBroadcastEngine (Stage 3) should still be importable
  assert(typeof ShadowBroadcastEngine.initialize === 'function', 'ShadowBroadcastEngine.initialize');
  assert(typeof ShadowBroadcastEngine.registerDestination === 'function', 'ShadowBroadcastEngine.registerDestination');
  assert(typeof ShadowBroadcastEngine.getStatus === 'function', 'ShadowBroadcastEngine.getStatus');
  assert(typeof ShadowBroadcastEngine.getMetrics === 'function', 'ShadowBroadcastEngine.getMetrics');

  // BROADCAST_STATE constants (Stage 3 states — no IDLE; uses UNINITIALIZED/READY)
  assert(BROADCAST_STATE.BROADCASTING,  'BROADCAST_STATE.BROADCASTING defined');
  assert(BROADCAST_STATE.UNINITIALIZED, 'BROADCAST_STATE.UNINITIALIZED defined');
  assert(BROADCAST_STATE.RECONNECTING,  'BROADCAST_STATE.RECONNECTING defined');

  // Stage 3 status API still works
  const status = ShadowBroadcastEngine.getConnectionStatus();
  assert(typeof status === 'object', 'getConnectionStatus returns object');
  assert('state' in status, 'status has state field');

  // Event bus still functional
  let fired = false;
  const unsub = CloudEngineEventBus.on('stage4_regression_test', () => { fired = true; });
  CloudEngineEventBus.emit('stage4_regression_test', {});
  unsub();
  assert(fired, 'CloudEngineEventBus still works');

  // Destination manager validation still works
  let threw = false;
  try {
    validateDestination({ destinationId: '', protocol: 'RTMP', serverUrl: 'rtmp://x.com/live', streamKeyEnvVar: 'KEY' });
  } catch { threw = true; }
  assert(threw, 'validateDestination still rejects empty destinationId');
});

/* ─────────────────────────────────────────────────────────
   FINAL REPORT
──────────────────────────────────────────────────────── */
const total = _passed + _failed;
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 4 Fan-Out Tests`);
console.log(`  PASS:  ${_passed} / ${total}`);
if (_failed > 0) {
  console.log(`  FAIL:  ${_failed}`);
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`    ✗  ${r.name}: ${r.error}`),
  );
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(_failed > 0 ? 1 : 0);
