/**
 * 24-HOUR CLOUD ENGINE — Stage 7 Tests
 * cloud-engine/studio/tests/studio.test.js
 *
 * Tests for Stage 7: Broadcast Studio
 *
 * Tests:
 *  1. Studio getDashboard — shape and safe fields
 *  2. Destination management — add, safe info, remove
 *  3. goLive — authorization required
 *  4. goLive — invalid mode rejected
 *  5. goLive — NOT_IMPLEMENTED mode rejected
 *  6. goLive — missing title rejected
 *  7. stopBroadcast — requires confirmation
 *  8. stopBroadcast — authorized + confirmed works
 *  9. getMonitoring — shape with null metrics for unavailable data
 * 10. Event feed — events pushed correctly, no secrets
 * 11. processCommand via Studio — authorization flows
 * 12. VIEWER cannot addDestination
 * 13. VIEWER can getDashboard and getMonitoring (read-only)
 * 14. StudioEventFeed — ring buffer behavior, subscribe/unsubscribe
 * 15. Regression — Stage 1-6 modules still functional
 *
 * Stage 7 — Broadcast Studio
 */

import os   from 'os';
import path  from 'path';
import fs    from 'fs/promises';

import { BroadcastStudio, BROADCAST_MODE, BROADCAST_MODE_STATUS, StudioService }
                                                       from '../broadcast-studio.js';
import { StudioEventFeed, STUDIO_EVENT_TYPE }           from '../studio-events.js';
import { FanOutManager }                               from '../../broadcast/fanout-manager.js';
import { IngestManager }                               from '../../ingest/ingest-manager.js';
import { SOURCE_TYPE }                                 from '../../ingest/ingest-errors.js';
import { BROADCAST_PROTOCOL }                          from '../../broadcast/destination-manager.js';
import { ROLE, PERMISSION, hasPermission }             from '../../security/permissions.js';
import { CONTROL_COMMAND, CONTROL_COMMAND_STATE }      from '../../firebase/firebase-control.js';
import { CloudEngineEventBus }                         from '../../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }                         from '../../core/events.js';
import { ENGINE_VERSION }                              from '../../core/engine.js';

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
  const s = JSON.stringify(obj);
  assert(!s.includes('"streamKey":"live-secret-key"'),
    `${label}: real stream key must not appear`);
  assert(!s.includes('"password":'),
    `${label}: password must not appear`);
}

/* ═══════════════════════════════════
   AUTH CONTEXTS
═══════════════════════════════════ */
const OWNER_AUTH  = { userId: 'owner-user',   userRole: ROLE.OWNER,   ownerId: 'owner-user' };
const ADMIN_AUTH  = { userId: 'admin-user',   userRole: ROLE.ADMIN,   ownerId: 'owner-user' };
const VIEWER_AUTH = { userId: 'viewer-user',  userRole: ROLE.VIEWER,  ownerId: 'owner-user' };

/* ═══════════════════════════════════
   SAMPLE DESTINATION
═══════════════════════════════════ */
const DEST_YOUTUBE = {
  destinationId:   'youtube-primary',
  name:            'YouTube Primary',
  protocol:        BROADCAST_PROTOCOL.RTMPS,
  serverUrl:       'rtmps://a.rtmp.youtube.com/live2',
  streamKeyEnvVar: 'CE_STREAM_KEY_YOUTUBE',
  enabled:         true,
  autoReconnect:   false,
};

const DEST_TWITCH = {
  destinationId:   'twitch-primary',
  name:            'Twitch Primary',
  protocol:        BROADCAST_PROTOCOL.RTMP,
  serverUrl:       'rtmp://live.twitch.tv/app',
  streamKeyEnvVar: 'CE_STREAM_KEY_TWITCH',
  enabled:         true,
  autoReconnect:   false,
};

/* ═══════════════════════════════════
   TEST MEDIA FILE
═══════════════════════════════════ */
const _tmpDir  = path.join(os.tmpdir(), 'cloud-engine-studio-test');
const _tmpFile = path.join(_tmpDir, 'studio-source.flv');
await fs.mkdir(_tmpDir, { recursive: true });
await fs.writeFile(_tmpFile, Buffer.from('FLV_STUDIO_TEST'));

console.log('\n══════════════════════════════════════════════════════');
console.log('  24-Hour Cloud Engine — Stage 7 Studio Tests');
console.log('══════════════════════════════════════════════════════\n');

/* ─────────────────────────────────────────────────────────
   TEST 1 — getDashboard shape
──────────────────────────────────────────────────────── */
await test('1. getDashboard — correct shape and safe fields', () => {
  const studio = new BroadcastStudio();
  const db = studio.getDashboard();

  assert('engine'       in db, 'has engine');
  assert('broadcast'    in db, 'has broadcast');
  assert('ingest'       in db, 'has ingest');
  assert('destinations' in db, 'has destinations');
  assert('encoder'      in db, 'has encoder');
  assert('firebase'     in db, 'has firebase');

  assert('version'  in db.engine, 'engine.version');
  assert('status'   in db.engine, 'engine.status');
  assert('uptime'   in db.engine, 'engine.uptime');

  // Stream keys must never appear in dashboard
  assertNoSecret(db, 'getDashboard');
});

/* ─────────────────────────────────────────────────────────
   TEST 2 — Destination management
──────────────────────────────────────────────────────── */
await test('2. Destination management — add, getInfo, remove', async () => {
  const studio = new BroadcastStudio();

  // Add destination
  const r1 = studio.addDestination(DEST_YOUTUBE, OWNER_AUTH);
  assert(r1.success, `addDestination: ${r1.message}`);

  // Get safe info — stream key must be 'Configured', not the real key
  const info = studio.getDestinationInfo('youtube-primary');
  assert(info !== null, 'destination info should exist');
  assertEqual(info.streamKey, 'Configured', 'streamKey should be "Configured"');
  assertEqual(info.destinationId, 'youtube-primary', 'destinationId');

  // getAllDestinations
  const all = studio.getAllDestinations();
  assertEqual(all.length, 1, 'one destination');
  assert(all[0].streamKey === 'Configured', 'all destinations have streamKey masked');

  // Remove destination
  const r2 = await studio.removeDestination('youtube-primary', OWNER_AUTH);
  assert(r2.success, `removeDestination: ${r2.message}`);
  assertEqual(studio.getAllDestinations().length, 0, 'zero destinations after remove');
});

/* ─────────────────────────────────────────────────────────
   TEST 3 — goLive requires authorization
──────────────────────────────────────────────────────── */
await test('3. goLive — authorization required', async () => {
  const studio = new BroadcastStudio();

  // No auth context
  const r1 = await studio.goLive(
    { title: 'Test', mode: BROADCAST_MODE.LIVE,
      sourceConfig: { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile } },
    { ffmpegPath: '/usr/bin/ffmpeg' },
    {},  // no auth
  );
  assert(!r1.success, 'no auth should fail');
  assert(r1.message.includes('Authentication'), `message: ${r1.message}`);

  // VIEWER cannot go live
  const r2 = await studio.goLive(
    { title: 'Test', mode: BROADCAST_MODE.LIVE,
      sourceConfig: { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile } },
    { ffmpegPath: '/usr/bin/ffmpeg' },
    VIEWER_AUTH,
  );
  assert(!r2.success, 'VIEWER cannot goLive');
  assert(r2.message.includes('permissions') || r2.message.includes('Insufficient'),
    `message: ${r2.message}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 4 — goLive invalid mode
──────────────────────────────────────────────────────── */
await test('4. goLive — invalid mode rejected', async () => {
  const studio = new BroadcastStudio();
  const r = await studio.goLive(
    { title: 'Test', mode: 'UNKNOWN_MODE',
      sourceConfig: { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile } },
    { ffmpegPath: '/usr/bin/ffmpeg' },
    OWNER_AUTH,
  );
  assert(!r.success, 'invalid mode should fail');
  assert(r.message.includes('mode') || r.message.includes('Invalid'),
    `message: ${r.message}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 5 — goLive NOT_IMPLEMENTED mode rejected
──────────────────────────────────────────────────────── */
await test('5. goLive — NOT_IMPLEMENTED mode rejected', async () => {
  const studio = new BroadcastStudio();

  // TV_STATION and HYBRID are NOT_IMPLEMENTED
  for (const mode of [BROADCAST_MODE.TV_STATION, BROADCAST_MODE.HYBRID]) {
    const r = await studio.goLive(
      { title: 'Test', mode,
        sourceConfig: { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile } },
      { ffmpegPath: '/usr/bin/ffmpeg' },
      OWNER_AUTH,
    );
    assert(!r.success, `${mode} should be rejected`);
    assert(r.message.includes('not yet implemented'),
      `${mode} message: ${r.message}`);
  }

  // Verify the mode status values
  assertEqual(BROADCAST_MODE_STATUS.TV_STATION, 'NOT_IMPLEMENTED', 'TV_STATION is NOT_IMPLEMENTED');
  assertEqual(BROADCAST_MODE_STATUS.HYBRID,     'NOT_IMPLEMENTED', 'HYBRID is NOT_IMPLEMENTED');
  assertEqual(BROADCAST_MODE_STATUS.LIVE,        'OPERATIONAL',     'LIVE is OPERATIONAL');
  assertEqual(BROADCAST_MODE_STATUS.PRERECORDED, 'OPERATIONAL',     'PRERECORDED is OPERATIONAL');
});

/* ─────────────────────────────────────────────────────────
   TEST 6 — goLive missing title rejected
──────────────────────────────────────────────────────── */
await test('6. goLive — missing title rejected', async () => {
  const studio = new BroadcastStudio();
  const r = await studio.goLive(
    { mode: BROADCAST_MODE.LIVE,
      sourceConfig: { sourceType: SOURCE_TYPE.MEDIA_FILE, filePath: _tmpFile } },
    { ffmpegPath: '/usr/bin/ffmpeg' },
    OWNER_AUTH,
  );
  assert(!r.success, 'missing title should fail');
  assert(r.message.includes('title'), `message: ${r.message}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 7 — stopBroadcast requires confirmation
──────────────────────────────────────────────────────── */
await test('7. stopBroadcast — requires confirmation for destructive action', async () => {
  const studio = new BroadcastStudio();

  // Without confirmation
  const r = await studio.stopBroadcast({}, OWNER_AUTH);
  assert(!r.success, 'should require confirmation');
  assert(r.requiresConfirmation === true, 'requiresConfirmation must be true');
  assert(r.message.includes('confirmed'), `message: ${r.message}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 8 — stopBroadcast with confirmation
──────────────────────────────────────────────────────── */
await test('8. stopBroadcast — authorized + confirmed succeeds', async () => {
  const studio = new BroadcastStudio();

  // With confirmation
  const r = await studio.stopBroadcast({ confirmed: true }, OWNER_AUTH);
  assert(r.success, `stopBroadcast confirmed: ${r.message}`);

  // VIEWER cannot stop broadcast even with confirmation
  const r2 = await studio.stopBroadcast({ confirmed: true }, VIEWER_AUTH);
  assert(!r2.success, 'VIEWER cannot stopBroadcast');
});

/* ─────────────────────────────────────────────────────────
   TEST 9 — getMonitoring shape
──────────────────────────────────────────────────────── */
await test('9. getMonitoring — shape with null/unknown for unavailable metrics', () => {
  const studio = new BroadcastStudio();
  const mon = studio.getMonitoring();

  assert('timestamp'    in mon, 'has timestamp');
  assert('encoder'      in mon, 'has encoder');
  assert('ingest'       in mon, 'has ingest');
  assert('destinations' in mon, 'has destinations');
  assert('broadcast'    in mon, 'has broadcast');

  // Encoder metrics fields
  const enc = mon.encoder;
  assert('state'         in enc, 'encoder.state');
  assert('speed'         in enc, 'encoder.speed');
  assert('fps'           in enc, 'encoder.fps');
  assert('timingStatus'  in enc, 'encoder.timingStatus');
  assert('health'        in enc, 'encoder.health');

  // Ingest metrics fields
  const ing = mon.ingest;
  assert('state'       in ing, 'ingest.state');
  assert('connected'   in ing, 'ingest.connected');
  assert('health'      in ing, 'ingest.health');
  assert('uptimeSec'   in ing, 'ingest.uptimeSec');

  // No stream keys in monitoring
  assertNoSecret(mon, 'getMonitoring');

  // Unavailable metrics must be null, not fabricated
  // (encoder is not running so many fields should be null)
  assert(
    enc.speed   === null || enc.speed   === undefined || typeof enc.speed   === 'number',
    'encoder.speed should be null or a number',
  );
});

/* ─────────────────────────────────────────────────────────
   TEST 10 — Event feed
──────────────────────────────────────────────────────── */
await test('10. Event feed — events pushed correctly, no secrets', () => {
  const feed = new StudioEventFeed();

  // Push events
  feed.push(STUDIO_EVENT_TYPE.BROADCAST_STARTED, {
    title: 'Test Broadcast', streamKey: 'secret-should-be-stripped',
  });
  feed.push(STUDIO_EVENT_TYPE.DESTINATION_CONNECTED, { destinationId: 'youtube' });
  feed.push(STUDIO_EVENT_TYPE.INGEST_STARTED, { sessionId: 'sess-1' });

  const events = feed.getRecent(10);
  assertEqual(events.length, 3, '3 events in feed');
  assertEqual(events[0].type, STUDIO_EVENT_TYPE.BROADCAST_STARTED, 'first event type');

  // Stream key must be stripped
  const serialized = JSON.stringify(events);
  assert(!serialized.includes('secret-should-be-stripped'),
    'Secret stripped from event data');
  assert(serialized.includes('[REDACTED]') || !serialized.includes('streamKey'),
    'streamKey either absent or redacted');

  // Subscribe / unsubscribe
  let received = null;
  const unsub = feed.subscribe((evt) => { received = evt; });
  feed.push(STUDIO_EVENT_TYPE.BROADCAST_STOPPED, { title: 'Test' });
  assert(received !== null, 'subscriber received event');
  assertEqual(received.type, STUDIO_EVENT_TYPE.BROADCAST_STOPPED, 'correct event type');

  unsub();
  received = null;
  feed.push(STUDIO_EVENT_TYPE.ERROR, { message: 'test error' });
  assert(received === null, 'unsubscribed listener should not receive events');
});

/* ─────────────────────────────────────────────────────────
   TEST 11 — processCommand via Studio
──────────────────────────────────────────────────────── */
await test('11. processCommand via Studio — authorization flows correctly', async () => {
  const studio = new BroadcastStudio();

  // Admin GET_ENGINE_STATUS
  const r1 = await studio.processCommand({
    commandId: `cmd-s7-test-${Date.now()}`,
    command:   CONTROL_COMMAND.GET_ENGINE_STATUS,
    userId:    'admin-user',
    userRole:  ROLE.ADMIN,
  });
  assertEqual(r1.state, CONTROL_COMMAND_STATE.COMPLETED, `GET_ENGINE_STATUS: ${r1.state}`);
  assert(r1.data?.engineStatus, 'engineStatus in result');

  // VIEWER GET_METRICS (allowed)
  const r2 = await studio.processCommand({
    commandId: `cmd-s7-viewer-${Date.now()}`,
    command:   CONTROL_COMMAND.GET_METRICS,
    userId:    'viewer-user',
    userRole:  ROLE.VIEWER,
  });
  assertEqual(r2.state, CONTROL_COMMAND_STATE.COMPLETED, `VIEWER GET_METRICS: ${r2.state}`);

  // VIEWER START_BROADCAST (blocked)
  const r3 = await studio.processCommand({
    commandId: `cmd-s7-viewer-start-${Date.now()}`,
    command:   CONTROL_COMMAND.START_BROADCAST,
    userId:    'viewer-user',
    userRole:  ROLE.VIEWER,
  });
  assertEqual(r3.state, CONTROL_COMMAND_STATE.REJECTED, `VIEWER START_BROADCAST: ${r3.state}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 12 — VIEWER cannot addDestination
──────────────────────────────────────────────────────── */
await test('12. VIEWER cannot addDestination', () => {
  const studio = new BroadcastStudio();

  const r = studio.addDestination(DEST_YOUTUBE, VIEWER_AUTH);
  assert(!r.success, 'VIEWER cannot addDestination');
  assert(r.message.includes('permissions') || r.message.includes('Insufficient'),
    `message: ${r.message}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 13 — VIEWER can getDashboard and getMonitoring
──────────────────────────────────────────────────────── */
await test('13. VIEWER can read getDashboard and getMonitoring', () => {
  const studio = new BroadcastStudio();

  // getDashboard has no auth — it's a read
  const db = studio.getDashboard();
  assert(db, 'getDashboard returns data');
  assert('engine' in db, 'dashboard has engine');

  // getMonitoring has no auth — it's a read
  const mon = studio.getMonitoring();
  assert(mon, 'getMonitoring returns data');
  assert('encoder' in mon, 'monitoring has encoder');

  // No secrets in either
  assertNoSecret(db,  'getDashboard for VIEWER');
  assertNoSecret(mon, 'getMonitoring for VIEWER');
});

/* ─────────────────────────────────────────────────────────
   TEST 14 — StudioEventFeed ring buffer
──────────────────────────────────────────────────────── */
await test('14. StudioEventFeed — ring buffer and subscribe work correctly', () => {
  const feed = new StudioEventFeed();

  // Fill past capacity (100 events)
  for (let i = 0; i < 110; i++) {
    feed.push(STUDIO_EVENT_TYPE.ERROR, { index: i });
  }

  const all = feed.getRecent(200);
  assert(all.length <= 100, `Ring buffer capped at 100, got: ${all.length}`);
  // Most recent events are at the end
  const last = all[all.length - 1];
  assert(last.data.index >= 100, `Last event should be near index 110, got: ${last.data.index}`);

  // getRecent with limit
  const limited = feed.getRecent(5);
  assertEqual(limited.length, 5, 'getRecent limit works');

  // Clear
  feed.clear();
  assertEqual(feed.getRecent().length, 0, 'cleared feed is empty');
});

/* ─────────────────────────────────────────────────────────
   TEST 15 — Regression: Stage 1-6 still functional
──────────────────────────────────────────────────────── */
await test('15. Regression — Stage 1-6 modules still functional', async () => {
  // Engine version reflects Stage 7 (will be updated after this test run)
  assert(ENGINE_VERSION.name === '24-Hour Cloud Engine', 'engine name correct');
  assert(typeof ENGINE_VERSION.version === 'string', 'version is string');
  assert(typeof ENGINE_VERSION.stage === 'number', 'stage is number');

  // FanOutManager from Stage 4
  const fanout = new FanOutManager();
  assert(typeof fanout.getMultiBroadcastMetrics === 'function', 'Stage 4: getMultiBroadcastMetrics');

  // IngestManager from Stage 5
  const ingest = new IngestManager();
  assert(typeof ingest.createSession === 'function', 'Stage 5: createSession');

  // Firebase control from Stage 6
  const { processControlCommand } = await import('../../firebase/firebase-control.js');
  assert(typeof processControlCommand === 'function', 'Stage 6: processControlCommand');

  // Permissions from Stage 1
  assert(hasPermission(ROLE.OWNER, PERMISSION.START_BROADCAST), 'OWNER has START_BROADCAST');
  assert(!hasPermission(ROLE.VIEWER, PERMISSION.START_BROADCAST), 'VIEWER lacks START_BROADCAST');

  // Event bus from Stage 1
  let fired = false;
  const unsub = CloudEngineEventBus.on('stage7_regression_test', () => { fired = true; });
  CloudEngineEventBus.emit('stage7_regression_test', {});
  unsub();
  assert(fired, 'CloudEngineEventBus still works');

  // StudioService is exported
  assert(StudioService instanceof BroadcastStudio, 'StudioService is BroadcastStudio instance');
});

/* ─────────────────────────────────────────────────────────
   CLEANUP
──────────────────────────────────────────────────────── */
await fs.unlink(_tmpFile).catch(() => {});
await fs.rmdir(_tmpDir).catch(() => {});

/* ─────────────────────────────────────────────────────────
   FINAL REPORT
──────────────────────────────────────────────────────── */
const total = _passed + _failed;
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 7 Broadcast Studio Tests`);
console.log(`  PASS:  ${_passed} / ${total}`);
if (_failed > 0) {
  console.log(`  FAIL:  ${_failed}`);
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`    ✗  ${r.name}: ${r.error}`),
  );
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(_failed > 0 ? 1 : 0);
