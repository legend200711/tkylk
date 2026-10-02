/**
 * 24-HOUR CLOUD ENGINE — Stage 8 Platform Connections Tests
 * cloud-engine/platforms/tests/platforms.test.js
 *
 * Tests:
 *  1.  PlatformError — structure and JSON serialization
 *  2.  PLATFORM_TYPE — all types defined
 *  3.  PLATFORM_CONNECTION_STATUS — all statuses defined
 *  4.  buildSafePlatformStatus — no secrets in output
 *  5.  YouTubeConnector — not configured by default
 *  6.  YouTubeConnector — configure() validates required fields
 *  7.  YouTubeConnector — connect() without env vars → AUTH_REQUIRED
 *  8.  YouTubeConnector — connect() with env vars → CONNECTED
 *  9.  YouTubeConnector — disconnect() and revoke()
 * 10.  TwitchConnector — configure() + connect() without key → AUTH_REQUIRED
 * 11.  TwitchConnector — connect() with env var → CONNECTED
 * 12.  FacebookConnector — configure() + connect() lifecycle
 * 13.  CustomRtmpConnector — RTMP configure, connect, getDestination
 * 14.  CustomRtmpConnector — RTMPS configure and connect
 * 15.  CustomRtmpConnector — server URL protocol mismatch rejected
 * 16.  CustomRtmpConnector — missing stream key env var → NOT CONNECTED
 * 17.  PlatformManager — register and list connectors
 * 18.  PlatformManager — register duplicate throws
 * 19.  PlatformManager — connectAll isolates failures
 * 20.  PlatformManager — getAllStatuses contains no secrets
 * 21.  PlatformManager — buildConnectedDestinations skips non-CONNECTED
 * 22.  PlatformManager — getDestination for specific connector
 * 23.  Credential redaction — getStatus never reveals token/key values
 * 24.  Connector failure isolation — YouTube failure does not affect Twitch
 * 25.  refreshAuthentication / revoke not supported on custom RTMP
 * 26.  testConnection — NOT_CONFIGURED connector reports correctly
 * 27.  YouTubeConnector — getDestination shape matches BroadcastDestination
 * 28.  Regression — Stage 1–7 FanOutManager unaffected by platform module
 *
 * Stage 8 — Platform Connections
 */

import { PlatformError, PLATFORM_ERROR_CODE }       from '../platform-errors.js';
import { PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
         PLATFORM_CAPABILITIES, buildSafePlatformStatus } from '../platform-status.js';
import { PlatformConnector }                        from '../platform-connector.js';
import { YouTubeConnector }                         from '../youtube-connector.js';
import { TwitchConnector }                          from '../twitch-connector.js';
import { FacebookConnector }                        from '../facebook-connector.js';
import { CustomRtmpConnector }                      from '../custom-rtmp-connector.js';
import { PlatformManager }                          from '../platform-manager.js';
import { FanOutManager }                            from '../../broadcast/fanout-manager.js';

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

function assertNoSecrets(obj, label) {
  const s = JSON.stringify(obj);
  const bad = ['accessToken', 'refreshToken', 'clientSecret', 'publishUrl'];
  for (const k of bad) {
    assert(!s.includes(`"${k}":`), `${label}: "${k}" must not appear in output`);
  }
  // streamKey should not appear with a real value (only masked)
  const keyMatch = s.match(/"streamKey"\s*:\s*"(?!\*{8})([^"]+)"/);
  assert(!keyMatch, `${label}: streamKey with unmasked value must not appear`);
}

/* ═══════════════════════════════════
   HELPER: set / restore env var
═══════════════════════════════════ */
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { restore };
}

/* ═══════════════════════════════════
   TEST SUITE
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log('  Stage 8 Platform Connections Tests');
console.log('──────────────────────────────────────────────────────\n');

// 1. PlatformError — structure and JSON serialization
await test('1. PlatformError structure and JSON', async () => {
  const err = new PlatformError(PLATFORM_ERROR_CODE.NOT_CONFIGURED, 'Not configured', { id: 'x' });
  assert(err instanceof Error, 'Must be an Error');
  assertEqual(err.name, 'PlatformError', 'name');
  assertEqual(err.code, PLATFORM_ERROR_CODE.NOT_CONFIGURED, 'code');
  const j = err.toJSON();
  assert(j.code && j.message && j.timestamp, 'toJSON must have code, message, timestamp');
});

// 2. PLATFORM_TYPE — all types defined
await test('2. PLATFORM_TYPE all types defined', async () => {
  const expected = ['YOUTUBE', 'TWITCH', 'FACEBOOK', 'CUSTOM_RTMP', 'CUSTOM_RTMPS', 'OTHER'];
  for (const t of expected) {
    assert(PLATFORM_TYPE[t], `PLATFORM_TYPE.${t} must exist`);
  }
});

// 3. PLATFORM_CONNECTION_STATUS — all statuses defined
await test('3. PLATFORM_CONNECTION_STATUS all statuses defined', async () => {
  const required = ['CONNECTED', 'DISCONNECTED', 'AUTH_REQUIRED', 'TOKEN_EXPIRED',
                    'ERROR', 'NOT_CONFIGURED', 'CONNECTING', 'TESTING'];
  for (const s of required) {
    assert(PLATFORM_CONNECTION_STATUS[s], `PLATFORM_CONNECTION_STATUS.${s} must exist`);
  }
});

// 4. buildSafePlatformStatus — no secrets in output
await test('4. buildSafePlatformStatus strips secrets', async () => {
  const status = buildSafePlatformStatus(PLATFORM_TYPE.YOUTUBE,
    PLATFORM_CONNECTION_STATUS.CONNECTED, { displayName: 'YouTube' });
  assertNoSecrets(status, 'buildSafePlatformStatus');
  assertEqual(status.platformType, PLATFORM_TYPE.YOUTUBE, 'platformType');
  assertEqual(status.status, PLATFORM_CONNECTION_STATUS.CONNECTED, 'status');
  assert(!status.streamKey, 'streamKey must be stripped');
  assert(!status.token, 'token must be stripped');
  assert(!status.accessToken, 'accessToken must be stripped');
});

// 5. YouTubeConnector — NOT_CONFIGURED by default
await test('5. YouTubeConnector default NOT_CONFIGURED', async () => {
  const yt = new YouTubeConnector('yt-test-1');
  const s = yt.getStatus();
  assertEqual(s.status, PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED, 'initial status');
  assertNoSecrets(s, 'YouTubeConnector.getStatus()');
});

// 6. YouTubeConnector — configure() validates required fields
await test('6. YouTubeConnector configure() validates required fields', async () => {
  const yt = new YouTubeConnector('yt-test-2');
  const r = await yt.configure({});  // Missing required fields
  assertEqual(r.success, false, 'should reject empty config');

  const r2 = await yt.configure({
    clientIdEnvVar:     'YT_CLIENT_ID',
    clientSecretEnvVar: 'YT_CLIENT_SECRET',
    streamKeyEnvVar:    'YT_STREAM_KEY',
  });
  assertEqual(r2.success, true, 'valid config should succeed');
  assertEqual(r2.status, PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED, 'status after configure');
});

// 7. YouTubeConnector — connect() without env vars → AUTH_REQUIRED
await test('7. YouTubeConnector connect() without env vars → AUTH_REQUIRED', async () => {
  const yt = new YouTubeConnector('yt-test-3');
  await yt.configure({
    clientIdEnvVar:     'DIAG_YT_CLIENT_ID_MISSING',
    clientSecretEnvVar: 'DIAG_YT_SECRET_MISSING',
    streamKeyEnvVar:    'DIAG_YT_KEY_MISSING',
  });
  // Ensure the env vars are NOT set
  delete process.env.DIAG_YT_CLIENT_ID_MISSING;
  delete process.env.DIAG_YT_KEY_MISSING;

  const r = await yt.connect();
  assertEqual(r.success, false, 'should fail');
  assertEqual(r.status, PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED, 'status');
  assert(r.code === PLATFORM_ERROR_CODE.AUTH_REQUIRED ||
         r.code === PLATFORM_ERROR_CODE.STREAM_KEY_MISSING, 'correct error code');
});

// 8. YouTubeConnector — connect() with env vars → CONNECTED
await test('8. YouTubeConnector connect() with env vars → CONNECTED', async () => {
  const yt = new YouTubeConnector('yt-test-4');
  await yt.configure({
    clientIdEnvVar:     'DIAG_YT_CLIENT_ID',
    clientSecretEnvVar: 'DIAG_YT_SECRET',
    streamKeyEnvVar:    'DIAG_YT_KEY',
  });

  const { restore } = withEnv({
    DIAG_YT_CLIENT_ID: 'test-client-id-value',
    DIAG_YT_KEY:       'test-stream-key-value',
  });

  try {
    const r = await yt.connect();
    assertEqual(r.success, true, 'should succeed');
    assertEqual(r.status, PLATFORM_CONNECTION_STATUS.CONNECTED, 'status');
    // getStatus must not expose actual values
    assertNoSecrets(yt.getStatus(), 'getStatus after connect');
  } finally {
    restore();
  }
});

// 9. YouTubeConnector — disconnect() and revoke()
await test('9. YouTubeConnector disconnect() and revoke()', async () => {
  const yt = new YouTubeConnector('yt-test-5');
  await yt.configure({
    clientIdEnvVar: 'YT_CI', clientSecretEnvVar: 'YT_CS', streamKeyEnvVar: 'YT_SK',
  });
  const disconn = await yt.disconnect();
  assert(disconn.success, 'disconnect should succeed');

  const revoke = await yt.revoke();
  assert(revoke.success, 'revoke should succeed');
  assertEqual(yt.getStatus().status, PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED,
    'status after revoke');
});

// 10. TwitchConnector — configure() + connect() without key → AUTH_REQUIRED
await test('10. TwitchConnector configure() + missing key → AUTH_REQUIRED', async () => {
  const tw = new TwitchConnector('twitch-test-1');
  const r = await tw.configure({ streamKeyEnvVar: 'DIAG_TW_KEY_MISSING' });
  assertEqual(r.success, true, 'configure should succeed');
  delete process.env.DIAG_TW_KEY_MISSING;

  const conn = await tw.connect();
  assertEqual(conn.success, false, 'connect without key should fail');
  assert(
    conn.status === PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED ||
    conn.code   === PLATFORM_ERROR_CODE.STREAM_KEY_MISSING,
    'must report AUTH_REQUIRED or STREAM_KEY_MISSING',
  );
});

// 11. TwitchConnector — connect() with env var → CONNECTED
await test('11. TwitchConnector connect() with env var → CONNECTED', async () => {
  const tw = new TwitchConnector('twitch-test-2');
  await tw.configure({ streamKeyEnvVar: 'DIAG_TW_KEY' });
  const { restore } = withEnv({ DIAG_TW_KEY: 'twitch-live-key' });
  try {
    const r = await tw.connect();
    assertEqual(r.success, true, 'connect should succeed');
    assertEqual(r.status, PLATFORM_CONNECTION_STATUS.CONNECTED, 'status');
    assertNoSecrets(tw.getStatus(), 'TwitchConnector getStatus');
  } finally {
    restore();
  }
});

// 12. FacebookConnector — configure() + connect() lifecycle
await test('12. FacebookConnector configure() + connect() lifecycle', async () => {
  const fb = new FacebookConnector('fb-test-1');
  const cfg = await fb.configure({ streamKeyEnvVar: 'DIAG_FB_KEY' });
  assertEqual(cfg.success, true, 'configure ok');

  delete process.env.DIAG_FB_KEY;
  const conn = await fb.connect();
  assertEqual(conn.success, false, 'without key: fail');

  const { restore } = withEnv({ DIAG_FB_KEY: 'fb-stream-key' });
  try {
    const r = await fb.connect();
    assertEqual(r.success, true, 'with key: ok');
    assertEqual(r.status, PLATFORM_CONNECTION_STATUS.CONNECTED, 'status');
  } finally {
    restore();
  }
});

// 13. CustomRtmpConnector — RTMP configure, connect, getDestination
await test('13. CustomRtmpConnector RTMP configure + connect + getDestination', async () => {
  const c = new CustomRtmpConnector({ connectorId: 'custom-rtmp-1', displayName: 'My Server' });
  const cfg = await c.configure({
    serverUrl:       'rtmp://stream.example.com/live',
    streamKeyEnvVar: 'DIAG_CUSTOM_RTMP_KEY',
  });
  assertEqual(cfg.success, true, 'configure ok');

  const { restore } = withEnv({ DIAG_CUSTOM_RTMP_KEY: 'my-stream-key' });
  try {
    const conn = await c.connect();
    assertEqual(conn.success, true, 'connect ok');

    const dest = await c.getDestination();
    assertEqual(dest.success, true, 'getDestination ok');
    assert(dest.destination, 'destination object present');
    assertEqual(dest.destination.protocol, 'RTMP', 'protocol RTMP');
    assertEqual(dest.destination.streamKeyEnvVar, 'DIAG_CUSTOM_RTMP_KEY', 'env var name preserved');
    // Stream key value must NOT appear in the destination object
    assert(!JSON.stringify(dest.destination).includes('my-stream-key'),
      'stream key value must not be in destination object');
  } finally {
    restore();
  }
});

// 14. CustomRtmpConnector — RTMPS configure and connect
await test('14. CustomRtmpConnector RTMPS configure and connect', async () => {
  const c = new CustomRtmpConnector({
    connectorId: 'custom-rtmps-1',
    protocol:    PLATFORM_TYPE.CUSTOM_RTMPS,
  });
  const cfg = await c.configure({
    serverUrl:       'rtmps://secure.stream.example.com:443/live',
    streamKeyEnvVar: 'DIAG_CUSTOM_RTMPS_KEY',
  });
  assertEqual(cfg.success, true, 'configure ok');

  const dest = await c.getDestination();
  assertEqual(dest.success, true, 'getDestination ok');
  assertEqual(dest.destination.protocol, 'RTMPS', 'protocol RTMPS');
});

// 15. CustomRtmpConnector — server URL protocol mismatch rejected
await test('15. CustomRtmpConnector server URL mismatch rejected', async () => {
  const c = new CustomRtmpConnector({ connectorId: 'bad-protocol-1' });
  // RTMP connector but rtmps:// URL
  const r = await c.configure({
    serverUrl:       'rtmps://secure.example.com/live',
    streamKeyEnvVar: 'DIAG_KEY',
  });
  assertEqual(r.success, false, 'should reject RTMPS URL for RTMP connector');
});

// 16. CustomRtmpConnector — missing stream key env var
await test('16. CustomRtmpConnector missing stream key → not CONNECTED', async () => {
  const c = new CustomRtmpConnector({ connectorId: 'missing-key-1' });
  await c.configure({
    serverUrl:       'rtmp://stream.example.com/live',
    streamKeyEnvVar: 'DIAG_MISSING_RTMP_KEY',
  });
  delete process.env.DIAG_MISSING_RTMP_KEY;
  const conn = await c.connect();
  assertEqual(conn.success, false, 'should fail');
  assert(
    conn.status === PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED ||
    conn.code   === PLATFORM_ERROR_CODE.STREAM_KEY_MISSING,
    'must report key missing',
  );
});

// 17. PlatformManager — register and list connectors
await test('17. PlatformManager register and list', async () => {
  const pm = new PlatformManager();
  const yt = new YouTubeConnector('pm-yt-1');
  const tw = new TwitchConnector('pm-tw-1');
  pm.register(yt);
  pm.register(tw);
  const list = pm.list();
  assert(list.includes('pm-yt-1'), 'YouTube connector listed');
  assert(list.includes('pm-tw-1'), 'Twitch connector listed');
  assertEqual(list.length, 2, 'exactly 2 connectors');
});

// 18. PlatformManager — register duplicate throws
await test('18. PlatformManager duplicate registration throws', async () => {
  const pm = new PlatformManager();
  const yt = new YouTubeConnector('pm-yt-dup');
  pm.register(yt);
  let threw = false;
  try {
    pm.register(new YouTubeConnector('pm-yt-dup'));
  } catch {
    threw = true;
  }
  assert(threw, 'duplicate registration must throw');
});

// 19. PlatformManager — connectAll isolates failures
await test('19. PlatformManager connectAll isolates per-connector failures', async () => {
  const pm = new PlatformManager();

  // Connector A: will fail (not configured, no env var)
  const yt = new YouTubeConnector('pm-isolation-yt');
  await yt.configure({
    clientIdEnvVar: 'PM_MISSING_YT_ID', clientSecretEnvVar: 'PM_MISSING_YT_SEC',
    streamKeyEnvVar: 'PM_MISSING_YT_KEY',
  });
  pm.register(yt);

  // Connector B: will succeed (custom RTMP with key set)
  const c = new CustomRtmpConnector({ connectorId: 'pm-isolation-rtmp' });
  await c.configure({ serverUrl: 'rtmp://ok.example.com/live', streamKeyEnvVar: 'PM_RTMP_KEY_OK' });
  pm.register(c);

  const { restore } = withEnv({ PM_RTMP_KEY_OK: 'rtmp-key-value' });
  try {
    const results = await pm.connectAll();
    // YouTube should fail — Twitch/RTMP should succeed
    assertEqual(results['pm-isolation-yt'].success,   false, 'YouTube should fail');
    assertEqual(results['pm-isolation-rtmp'].success, true,  'RTMP should succeed');
  } finally {
    restore();
  }
});

// 20. PlatformManager — getAllStatuses contains no secrets
await test('20. PlatformManager getAllStatuses contains no secrets', async () => {
  const pm = new PlatformManager();
  const c = new CustomRtmpConnector({ connectorId: 'pm-safe-1' });
  await c.configure({ serverUrl: 'rtmp://s.example.com/live', streamKeyEnvVar: 'PM_SAFE_KEY' });
  pm.register(c);
  const { restore } = withEnv({ PM_SAFE_KEY: 'secret-key-value' });
  try {
    await pm.connect('pm-safe-1');
    const statuses = pm.getAllStatuses();
    const s = JSON.stringify(statuses);
    assert(!s.includes('secret-key-value'), 'stream key value must not appear');
    assertNoSecrets(statuses, 'getAllStatuses');
  } finally {
    restore();
  }
});

// 21. PlatformManager — buildConnectedDestinations skips non-CONNECTED
await test('21. PlatformManager buildConnectedDestinations skips non-CONNECTED', async () => {
  const pm = new PlatformManager();

  // Connected
  const c1 = new CustomRtmpConnector({ connectorId: 'pm-dest-1' });
  await c1.configure({ serverUrl: 'rtmp://a.example.com/live', streamKeyEnvVar: 'PM_DEST_KEY1' });
  pm.register(c1);

  // Not connected (no env var)
  const yt = new YouTubeConnector('pm-dest-yt');
  await yt.configure({
    clientIdEnvVar: 'PM_YT_NOCRED_ID', clientSecretEnvVar: 'PM_YT_NOCRED_SEC',
    streamKeyEnvVar: 'PM_YT_NOCRED_KEY',
  });
  pm.register(yt);

  const { restore } = withEnv({ PM_DEST_KEY1: 'rtmp-key' });
  try {
    await pm.connect('pm-dest-1');
    const { destinations, skipped } = await pm.buildConnectedDestinations();
    assert(destinations.some(d => d.destinationId === 'pm-dest-1'),
      'connected RTMP should be in destinations');
    assert(!destinations.some(d => d.destinationId === 'pm-dest-yt'),
      'non-connected YouTube should be skipped');
    assert(skipped.some(s => s.includes('pm-dest-yt')), 'YouTube should appear in skipped');
  } finally {
    restore();
  }
});

// 22. PlatformManager — getDestination for specific connector
await test('22. PlatformManager getDestination for specific connector', async () => {
  const pm = new PlatformManager();
  const c = new CustomRtmpConnector({ connectorId: 'pm-getdest-1' });
  await c.configure({ serverUrl: 'rtmp://b.example.com/live', streamKeyEnvVar: 'PM_GD_KEY' });
  pm.register(c);

  const r = await pm.getDestination('pm-getdest-1');
  assertEqual(r.success, true, 'getDestination ok');
  assertEqual(r.destination.streamKeyEnvVar, 'PM_GD_KEY', 'env var name correct');

  const missing = await pm.getDestination('nonexistent');
  assertEqual(missing.success, false, 'missing connector returns failure');
});

// 23. Credential redaction — getStatus never reveals token/key values
await test('23. Credential redaction — getStatus never reveals values', async () => {
  const yt = new YouTubeConnector('yt-cred-test');
  await yt.configure({
    clientIdEnvVar: 'YT_CR_ID', clientSecretEnvVar: 'YT_CR_SEC', streamKeyEnvVar: 'YT_CR_KEY',
  });
  const { restore } = withEnv({ YT_CR_ID: 'real-client-id', YT_CR_KEY: 'real-stream-key' });
  try {
    await yt.connect();
    const status = yt.getStatus();
    const s = JSON.stringify(status);
    assert(!s.includes('real-client-id'),  'clientId value must not appear');
    assert(!s.includes('real-stream-key'), 'stream key value must not appear');
    assert(!s.includes('YT_CR_SEC'),       'client secret env var name should not leak value context');
  } finally {
    restore();
  }
});

// 24. Connector failure isolation — YouTube failure does not affect Twitch
await test('24. Platform failure isolation — YouTube fail does not crash Twitch', async () => {
  const pm = new PlatformManager();

  const yt = new YouTubeConnector('isolation-yt');
  // Don't configure — will fail on connect
  pm.register(yt);

  const tw = new TwitchConnector('isolation-tw');
  await tw.configure({ streamKeyEnvVar: 'ISOLATION_TW_KEY' });
  pm.register(tw);

  const { restore } = withEnv({ ISOLATION_TW_KEY: 'twitch-key' });
  try {
    const results = await pm.connectAll();
    // YouTube: fails (NOT_CONFIGURED)
    assertEqual(results['isolation-yt'].success, false, 'YouTube should fail');
    // Twitch: succeeds
    assertEqual(results['isolation-tw'].success, true, 'Twitch should succeed independently');
  } finally {
    restore();
  }
});

// 25. refreshAuthentication / revoke not supported on custom RTMP
await test('25. refreshAuthentication / revoke not applicable on CustomRtmpConnector', async () => {
  const c = new CustomRtmpConnector({ connectorId: 'no-oauth-1' });
  const ra = await c.refreshAuthentication();
  assertEqual(ra.success, false, 'refreshAuthentication not supported');

  const rv = await c.revoke();
  assertEqual(rv.success, false, 'revoke not supported');
});

// 26. testConnection — NOT_CONFIGURED connector reports correctly
await test('26. testConnection on NOT_CONFIGURED connector', async () => {
  const yt = new YouTubeConnector('yt-noconfig-test');
  const r = await yt.testConnection();
  assertEqual(r.success, false, 'should fail');
  assertEqual(r.latencyMs, null, 'no latency available');
});

// 27. YouTubeConnector getDestination matches BroadcastDestination shape
await test('27. YouTubeConnector getDestination matches BroadcastDestination shape', async () => {
  const yt = new YouTubeConnector('yt-dest-shape');
  await yt.configure({
    clientIdEnvVar: 'YT_DS_ID', clientSecretEnvVar: 'YT_DS_SEC', streamKeyEnvVar: 'YT_DS_KEY',
  });

  const { restore } = withEnv({ YT_DS_ID: 'cid', YT_DS_KEY: 'sk' });
  try {
    await yt.connect();
    const r = await yt.getDestination();
    assertEqual(r.success, true, 'getDestination ok');
    const d = r.destination;
    // Must have all BroadcastDestination fields
    assert(d.destinationId,   'destinationId present');
    assert(d.name,            'name present');
    assert(d.protocol,        'protocol present');
    assert(d.serverUrl,       'serverUrl present');
    assert(d.streamKeyEnvVar, 'streamKeyEnvVar present (env var name)');
    assert(typeof d.enabled === 'boolean', 'enabled is boolean');
    assert(typeof d.autoReconnect === 'boolean', 'autoReconnect is boolean');
    // Stream key value must NOT be in the destination
    const s = JSON.stringify(d);
    assert(!s.includes('"streamKey"'), 'streamKey value must not appear in destination');
  } finally {
    restore();
  }
});

// 28. Regression — Stage 1-7 FanOutManager unaffected
await test('28. Regression — FanOutManager still works after Stage 8', async () => {
  const fm = new FanOutManager();
  const r = fm.addDestination({
    destinationId:   'regression-rtmp',
    name:            'Regression Test',
    protocol:        'RTMP',
    serverUrl:       'rtmp://localhost/live',
    streamKeyEnvVar: 'REGRESSION_KEY',
    enabled:         true,
    autoReconnect:   false,
  });
  assertEqual(r.success, true, 'FanOutManager.addDestination still works');
  const statuses = fm.getAllDestinationStatuses();
  assert(statuses.length === 1, 'One destination in FanOutManager');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 8 Platform Tests`);
console.log(`  PASS:  ${_passed} / ${_passed + _failed}`);
if (_failed > 0) console.log(`  FAIL:  ${_failed}`);
console.log('══════════════════════════════════════════════════════\n');

if (_failed > 0) process.exit(1);
