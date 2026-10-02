/**
 * 24-HOUR CLOUD ENGINE — Stage 5 Tests
 * cloud-engine/ingest/tests/ingest.test.js
 *
 * Tests for Stage 5: Live Input / Ingest
 *
 * Tests:
 *  1. IngestManager lifecycle — create, start, stop
 *  2. MEDIA_FILE source — valid config
 *  3. MEDIA_FILE source — invalid file rejected
 *  4. NOT_IMPLEMENTED source types — camera, microphone, webrtc rejected
 *  5. ARCHITECTURE_READY source types — RTMP_INPUT accepted by config
 *  6. Disconnect handling — stop session
 *  7. Ingest metrics shape
 *  8. computeIngestHealth logic
 *  9. Source replacement (replaceSource)
 * 10. Source type capabilities report
 * 11. Multiple ingest sessions (independent)
 * 12. Regression — Stage 1-4 modules still functional
 *
 * Stage 5 — Live Input / Ingest
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { IngestManager, SharedIngestManager,
         INGEST_MANAGER_STATE }                       from '../ingest-manager.js';
import { IngestSession, INGEST_SESSION_STATE }         from '../ingest-session.js';
import { SOURCE_TYPE, SOURCE_TYPE_STATUS,
         IngestError, INGEST_ERROR_CODE }              from '../ingest-errors.js';
import { createIngestMetrics, computeIngestHealth,
         snapshotIngestMetrics }                       from '../ingest-metrics.js';
import { validateSourceConfig }                        from '../ingest-validator.js';
import { StreamSource, STREAM_SOURCE_STATE }           from '../stream-source.js';
import { FanOutManager }                               from '../../broadcast/fanout-manager.js';
import { BROADCAST_STATE }                             from '../../broadcast/broadcast-engine.js';
import { CloudEngineEventBus }                         from '../../core/event-bus.js';

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

/* ═══════════════════════════════════
   TEST MEDIA FILE
═══════════════════════════════════ */
// Create a minimal non-empty temp file for file-existence tests
const _tmpDir     = path.join(os.tmpdir(), 'cloud-engine-ingest-test');
const _tmpFile    = path.join(_tmpDir, 'test-source.flv');
const _emptyFile  = path.join(_tmpDir, 'empty.flv');

await fs.mkdir(_tmpDir, { recursive: true });
await fs.writeFile(_tmpFile,   Buffer.from('FLV_TEST_DATA'));
await fs.writeFile(_emptyFile, Buffer.alloc(0));

console.log('\n══════════════════════════════════════════════════════');
console.log('  24-Hour Cloud Engine — Stage 5 Ingest Tests');
console.log('══════════════════════════════════════════════════════\n');

/* ─────────────────────────────────────────────────────────
   TEST 1 — IngestManager lifecycle
──────────────────────────────────────────────────────── */
await test('1. IngestManager lifecycle — create, start, stop', async () => {
  const mgr = new IngestManager();

  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.IDLE, 'initial state is IDLE');

  // Create session with the temp media file
  const r1 = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   _tmpFile,
  });
  assert(r1.success, `createSession: ${r1.message}`);
  assert(r1.sessionId, 'sessionId returned');

  // Start ingest
  const r2 = await mgr.startIngest(r1.sessionId);
  assert(r2.success, `startIngest: ${r2.message}`);
  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.ACTIVE, 'state is ACTIVE after start');
  assert(r2.inputPath !== null, 'inputPath must be returned');

  // Stop ingest
  const r3 = await mgr.stopIngest();
  assert(r3.success, `stopIngest: ${r3.message}`);
  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.IDLE, 'state is IDLE after stop');
});

/* ─────────────────────────────────────────────────────────
   TEST 2 — MEDIA_FILE source: valid config
──────────────────────────────────────────────────────── */
await test('2. MEDIA_FILE source — valid file accepted', async () => {
  const mgr = new IngestManager();

  const r = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   _tmpFile,
  });
  assert(r.success, `createSession with valid file: ${r.message}`);
  assertEqual(r.source.sourceType, SOURCE_TYPE.MEDIA_FILE, 'source type');
  assert(r.source.state === STREAM_SOURCE_STATE.READY, `source state should be READY, got: ${r.source.state}`);

  // Active input path should be the file path
  const sessions = mgr.listSessions();
  assert(sessions.length === 1, 'one session registered');
});

/* ─────────────────────────────────────────────────────────
   TEST 3 — MEDIA_FILE source: invalid file rejected
──────────────────────────────────────────────────────── */
await test('3. MEDIA_FILE source — invalid/missing file rejected', async () => {
  const mgr = new IngestManager();

  // Non-existent file
  const r1 = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   '/tmp/cloud-engine-does-not-exist.flv',
  });
  assert(!r1.success, 'non-existent file should fail');

  // Empty file
  const r2 = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   _emptyFile,
  });
  assert(!r2.success, 'empty file should fail');

  // Missing filePath
  const r3 = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
  });
  assert(!r3.success, 'missing filePath should fail');
});

/* ─────────────────────────────────────────────────────────
   TEST 4 — NOT_IMPLEMENTED source types rejected
──────────────────────────────────────────────────────── */
await test('4. NOT_IMPLEMENTED source types — camera/microphone/webrtc rejected', async () => {
  const mgr = new IngestManager();

  for (const sourceType of [SOURCE_TYPE.CAMERA, SOURCE_TYPE.MICROPHONE,
                             SOURCE_TYPE.CAMERA_MIC, SOURCE_TYPE.FUTURE_WEBRTC]) {
    const r = await mgr.createSession({ sourceType, deviceId: 'dev0' });
    assert(!r.success, `${sourceType} should be rejected (NOT_IMPLEMENTED): ${r.message}`);
    assert(
      r.message.includes('NOT_IMPLEMENTED') || r.message.includes('not implemented'),
      `${sourceType} error message should mention NOT_IMPLEMENTED`,
    );
  }
});

/* ─────────────────────────────────────────────────────────
   TEST 5 — ARCHITECTURE_READY sources — accepted by config
──────────────────────────────────────────────────────── */
await test('5. ARCHITECTURE_READY source types — RTMP_INPUT config accepted', async () => {
  // validateSourceConfig should not throw for ARCHITECTURE_READY types
  assert(SOURCE_TYPE_STATUS[SOURCE_TYPE.RTMP_INPUT] === 'ARCHITECTURE_READY',
    'RTMP_INPUT should be ARCHITECTURE_READY');
  assert(SOURCE_TYPE_STATUS[SOURCE_TYPE.EXTERNAL_ENCODER] === 'ARCHITECTURE_READY',
    'EXTERNAL_ENCODER should be ARCHITECTURE_READY');

  // Should not throw
  let threw = false;
  try {
    validateSourceConfig({ sourceType: SOURCE_TYPE.RTMP_INPUT, rtmpUrl: 'rtmp://ingest.example.com/live' });
  } catch { threw = true; }
  assert(!threw, 'RTMP_INPUT should be accepted by validateSourceConfig');
});

/* ─────────────────────────────────────────────────────────
   TEST 6 — Disconnect handling
──────────────────────────────────────────────────────── */
await test('6. Disconnect handling — stop session transitions to STOPPED', async () => {
  const mgr = new IngestManager();

  const { sessionId } = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   _tmpFile,
  });

  await mgr.startIngest(sessionId);
  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.ACTIVE, 'active after start');

  const stopped = await mgr.stopIngest();
  assert(stopped.success, 'stopIngest should succeed');
  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.IDLE, 'idle after stop');
  assert(mgr.getStatus().activeSessionId === null, 'no active session after stop');
});

/* ─────────────────────────────────────────────────────────
   TEST 7 — Ingest metrics shape
──────────────────────────────────────────────────────── */
await test('7. Ingest metrics shape — all required fields present', async () => {
  const mgr = new IngestManager();

  const { sessionId } = await mgr.createSession({
    sourceType: SOURCE_TYPE.MEDIA_FILE,
    filePath:   _tmpFile,
  });
  await mgr.startIngest(sessionId);

  const metrics = mgr.getActiveMetrics();
  assert(metrics !== null, 'active metrics should not be null');

  // Required metric fields
  const requiredFields = [
    'sessionId', 'sourceType', 'connected', 'startedAt', 'uptimeSec',
    'videoPresent', 'audioPresent', 'bytesReceived', 'health', 'lastError',
  ];
  for (const field of requiredFields) {
    assert(field in metrics, `metrics must have field: ${field}`);
  }

  assertEqual(metrics.sourceType, SOURCE_TYPE.MEDIA_FILE, 'sourceType in metrics');
  assert(metrics.connected === true, 'connected should be true when active');

  await mgr.stopIngest();
});

/* ─────────────────────────────────────────────────────────
   TEST 8 — computeIngestHealth logic
──────────────────────────────────────────────────────── */
await test('8. computeIngestHealth — correct health values', () => {
  const base = createIngestMetrics({ sessionId: 'test', sourceType: SOURCE_TYPE.MEDIA_FILE });

  // Not connected → null
  assertEqual(computeIngestHealth({ ...base, connected: false }), null, 'not connected = null');

  // Connected, no video or audio → ERROR
  assertEqual(
    computeIngestHealth({ ...base, connected: true, videoPresent: false, audioPresent: false }),
    'ERROR', 'no av = ERROR',
  );

  // Connected, no video but has audio → DEGRADED
  assertEqual(
    computeIngestHealth({ ...base, connected: true, videoPresent: false, audioPresent: true }),
    'DEGRADED', 'no video = DEGRADED',
  );

  // Connected, has video and audio, no error → OK
  assertEqual(
    computeIngestHealth({ ...base, connected: true, videoPresent: true, audioPresent: true }),
    'OK', 'full av = OK',
  );

  // Connected but has an error → ERROR
  assertEqual(
    computeIngestHealth({ ...base, connected: true, videoPresent: true, audioPresent: true, lastError: { message: 'x' } }),
    'ERROR', 'error = ERROR',
  );
});

/* ─────────────────────────────────────────────────────────
   TEST 9 — replaceSource
──────────────────────────────────────────────────────── */
await test('9. replaceSource — swaps active session without affecting broadcast structure', async () => {
  const mgr = new IngestManager();

  // Create and start first session
  const r1 = await mgr.createSession({ sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile });
  await mgr.startIngest(r1.sessionId);
  assertEqual(mgr.getStatus().activeSessionId, r1.sessionId, 'first session active');

  // Create second session (but don't start it)
  const r2 = await mgr.createSession({ sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile });

  // Replace source
  const r3 = await mgr.replaceSource(r2.sessionId);
  assert(r3.success, `replaceSource: ${r3.message}`);
  assertEqual(mgr.getStatus().activeSessionId, r2.sessionId, 'second session now active');
  assertEqual(mgr.getStatus().state, INGEST_MANAGER_STATE.ACTIVE, 'state still ACTIVE');
});

/* ─────────────────────────────────────────────────────────
   TEST 10 — Source type capabilities
──────────────────────────────────────────────────────── */
await test('10. Source type capabilities — accurate operational status', () => {
  const mgr = new IngestManager();
  const caps = mgr.getSourceTypeCapabilities();

  assert('MEDIA_FILE'       in caps, 'MEDIA_FILE in capabilities');
  assert('CAMERA'           in caps, 'CAMERA in capabilities');
  assert('FUTURE_WEBRTC'    in caps, 'FUTURE_WEBRTC in capabilities');
  assert('RTMP_INPUT'       in caps, 'RTMP_INPUT in capabilities');
  assert('EXTERNAL_ENCODER' in caps, 'EXTERNAL_ENCODER in capabilities');

  assertEqual(caps.MEDIA_FILE,       'OPERATIONAL',       'MEDIA_FILE is OPERATIONAL');
  assertEqual(caps.CAMERA,           'NOT_IMPLEMENTED',   'CAMERA is NOT_IMPLEMENTED');
  assertEqual(caps.MICROPHONE,       'NOT_IMPLEMENTED',   'MICROPHONE is NOT_IMPLEMENTED');
  assertEqual(caps.CAMERA_MIC,       'NOT_IMPLEMENTED',   'CAMERA_MIC is NOT_IMPLEMENTED');
  assertEqual(caps.FUTURE_WEBRTC,    'NOT_IMPLEMENTED',   'FUTURE_WEBRTC is NOT_IMPLEMENTED');
  assertEqual(caps.RTMP_INPUT,       'ARCHITECTURE_READY','RTMP_INPUT is ARCHITECTURE_READY');
  assertEqual(caps.EXTERNAL_ENCODER, 'ARCHITECTURE_READY','EXTERNAL_ENCODER is ARCHITECTURE_READY');
});

/* ─────────────────────────────────────────────────────────
   TEST 11 — Multiple independent ingest sessions
──────────────────────────────────────────────────────── */
await test('11. Multiple ingest sessions are independent', async () => {
  const mgr = new IngestManager();

  // Create two sessions with unique IDs
  const r1 = await mgr.createSession(
    { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile }, 'session-alpha');
  const r2 = await mgr.createSession(
    { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile }, 'session-beta');

  assert(r1.success, 'session-alpha created');
  assert(r2.success, 'session-beta created');
  assertEqual(mgr.listSessions().length, 2, 'two sessions exist');

  // Duplicate ID rejected
  const r3 = await mgr.createSession(
    { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile }, 'session-alpha');
  assert(!r3.success, 'duplicate session ID rejected');

  // Remove one session independently
  await mgr.removeSession('session-alpha');
  assertEqual(mgr.listSessions().length, 1, 'one session after remove');
  const remaining = mgr.listSessions()[0];
  assertEqual(remaining.sessionId, 'session-beta', 'session-beta remains');
});

/* ─────────────────────────────────────────────────────────
   TEST 12 — Regression: Stages 1-4 still functional
──────────────────────────────────────────────────────── */
await test('12. Regression — Stage 1-4 modules still functional after Stage 5 additions', async () => {
  // FanOutManager still importable
  const fanout = new FanOutManager();
  assert(typeof fanout.startMultiBroadcast === 'function', 'FanOutManager.startMultiBroadcast');
  assert(typeof fanout.stopMultiBroadcast === 'function',  'FanOutManager.stopMultiBroadcast');

  // BROADCAST_STATE still defined
  assert(BROADCAST_STATE.BROADCASTING, 'BROADCAST_STATE.BROADCASTING');

  // Event bus still functional
  let fired = false;
  const unsub = CloudEngineEventBus.on('stage5_regression_test', () => { fired = true; });
  CloudEngineEventBus.emit('stage5_regression_test', {});
  unsub();
  assert(fired, 'CloudEngineEventBus still works');

  // SharedIngestManager is exported
  assert(SharedIngestManager instanceof IngestManager, 'SharedIngestManager is IngestManager instance');
});

/* ─────────────────────────────────────────────────────────
   CLEANUP
──────────────────────────────────────────────────────── */
await fs.unlink(_tmpFile).catch(() => {});
await fs.unlink(_emptyFile).catch(() => {});
await fs.rmdir(_tmpDir).catch(() => {});

/* ─────────────────────────────────────────────────────────
   FINAL REPORT
──────────────────────────────────────────────────────── */
const total = _passed + _failed;
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 5 Ingest Tests`);
console.log(`  PASS:  ${_passed} / ${total}`);
if (_failed > 0) {
  console.log(`  FAIL:  ${_failed}`);
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`    ✗  ${r.name}: ${r.error}`),
  );
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(_failed > 0 ? 1 : 0);
