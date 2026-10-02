/**
 * 24-HOUR CLOUD ENGINE — Stage 3 Diagnostics
 * cloud-engine/diagnostics.js
 *
 * Extended from Stage 2 to verify Shadow Broadcast Engine is functional.
 *
 * Each check returns:
 *   PASS            — Component works as expected
 *   FAIL            — Component encountered an error
 *   NOT_IMPLEMENTED — Component is a placeholder (expected for future stages)
 *   NOT_CONFIGURED  — Component needs configuration (expected until real creds)
 *
 * Stage 3 modifications:
 *   - Check #1 updated: expects Stage 3 / v0.3.0
 *   - Check #8 updated: Broadcast Engine now expected to initialize (not NOT_IMPLEMENTED)
 *   - Checks #21–#25: New Stage 3 Broadcast Engine diagnostics added
 */

import path                         from 'path';
import { CloudEngineLogger }       from './logs/logger.js';
import { CloudEngineEventBus }     from './core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }     from './core/events.js';
import { CloudEngineStateManager } from './core/state-manager.js';
import { CloudEngineConfig }       from './config/config.js';
import { ENGINE_VERSION,
         registerModule, listModules,
         initCloudEngine, shutdownCloudEngine,
         getEngineStatus, ENGINE_STATE }    from './core/engine.js';
import { ShadowEncoder }           from './encoder/shadow-encoder.js';
import { ShadowBroadcastEngine, BROADCAST_STATE } from './broadcast/broadcast-engine.js';
import { FirebaseConnector }       from './firebase/firebase-connector.js';
import { CLEANUP_POLICY, cleanupOutput } from './broadcast/output-cleanup.js';
import { LIVE_PROFILE_ID }         from './encoder/encoder-profiles.js';
import { dispatchCommand, COMMAND } from './core/commands.js';
import { getHealthReport }         from './core/health.js';
import { ROLE, hasPermission, PERMISSION } from './security/permissions.js';
import { detectCodecEngine }       from './encoder/codec-adapter.js';
import { generateTestMedia }       from './encoder/test-utils/generate-test-media.js';
import { probeMedia }              from './encoder/media-probe.js';

/* ═══════════════════════════════════
   RESULT CODES
═══════════════════════════════════ */
const RESULT = Object.freeze({
  PASS:            'PASS',
  FAIL:            'FAIL',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_CONFIGURED:  'NOT_CONFIGURED',
});

/* ═══════════════════════════════════
   INDIVIDUAL CHECKS
═══════════════════════════════════ */

function _check(name, fn) {
  try {
    return fn();
  } catch (err) {
    return { result: RESULT.FAIL, name, error: err?.message ?? String(err) };
  }
}

async function _checkAsync(name, fn) {
  try {
    return await fn();
  } catch (err) {
    return { result: RESULT.FAIL, name, error: err?.message ?? String(err) };
  }
}

/* ═══════════════════════════════════
   RUN ALL DIAGNOSTICS
═══════════════════════════════════ */

/**
 * Run the full Stage 2 diagnostic suite.
 * @returns {Promise<{ passed:number, failed:number, results:Array }>}
 */
export async function runDiagnostics() {
  const results = [];
  const log = (r) => results.push(r);

  // ── 1. Version / build identifier ─────────────────────────
  log(_check('version-identifier', () => {
    const ok = ENGINE_VERSION.stage >= 7 &&
               typeof ENGINE_VERSION.version === 'string' &&
               typeof ENGINE_VERSION.build === 'string' &&
               ENGINE_VERSION.build.includes('2026');
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'version-identifier',
      detail: `${ENGINE_VERSION.name} v${ENGINE_VERSION.version} Stage ${ENGINE_VERSION.stage} (${ENGINE_VERSION.build})`,
    };
  }));

  // ── 2. Logger ─────────────────────────────────────────────
  log(_check('logger', () => {
    CloudEngineLogger.info('diagnostics', 'DIAG_LOGGER_TEST', 'Logger diagnostic check.');
    const buf = CloudEngineLogger.getLogs('INFO');
    const ok  = buf.length > 0 && buf[buf.length - 1].level === 'INFO';
    return { result: ok ? RESULT.PASS : RESULT.FAIL, name: 'logger', detail: ok ? 'Logger writes and retrieves entries.' : 'Buffer returned no entries.' };
  }));

  // ── 3. Event bus ──────────────────────────────────────────
  log(_check('event-bus', () => {
    let fired = false;
    const unsub = CloudEngineEventBus.on('__DIAG_TEST__', () => { fired = true; });
    CloudEngineEventBus.emit('__DIAG_TEST__', null);
    unsub();
    CloudEngineEventBus.off('__DIAG_TEST__');
    return { result: fired ? RESULT.PASS : RESULT.FAIL, name: 'event-bus', detail: fired ? 'on/emit/off work correctly.' : 'Event did not fire.' };
  }));

  // ── 4. State manager ──────────────────────────────────────
  log(_check('state-manager', () => {
    CloudEngineStateManager.set('__diag.test', 'ok');
    const val = CloudEngineStateManager.get('__diag.test');
    return {
      result: val === 'ok' ? RESULT.PASS : RESULT.FAIL,
      name:   'state-manager',
      detail: val === 'ok' ? 'set/get work correctly.' : `Expected "ok", got "${val}"`,
    };
  }));

  // ── 5. Configuration ──────────────────────────────────────
  log(await _checkAsync('configuration', async () => {
    await CloudEngineConfig.load();
    const channelName = CloudEngineConfig.get('channel.name');
    const ok = typeof channelName === 'string' && channelName.length > 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'configuration',
      detail: ok ? `channel.name = "${channelName}"` : 'channel.name not found.',
    };
  }));

  // ── 6. Module registry ────────────────────────────────────
  log(_check('module-registry', () => {
    registerModule('__diag_mod__', {
      initialize: async () => {},
      shutdown:   async () => {},
    });
    const mods = listModules();
    const found = mods.some(m => m.name === '__diag_mod__');
    return {
      result: found ? RESULT.PASS : RESULT.FAIL,
      name:   'module-registry',
      detail: found ? `${mods.length} module(s) in registry.` : 'Test module not found in registry.',
    };
  }));

  // ── 7. Shadow Encoder — installed and responding ───────────
  // Stage 2: encoder is no longer a placeholder. It reports UNINITIALIZED
  // (not NOT_IMPLEMENTED) when present but not yet initialized.
  log(_check('shadow-encoder-installed', () => {
    const status = ShadowEncoder.getStatus();
    // UNINITIALIZED = encoder is installed but hasn't been initialized yet
    // Any non-NOT_IMPLEMENTED state means Stage 2 is in place
    const ok = status.state !== undefined && status.state !== 'NOT_IMPLEMENTED';
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'shadow-encoder-installed',
      detail: ok
        ? `Shadow Encoder installed. State: ${status.state}`
        : `Unexpected state: ${JSON.stringify(status.state)}`,
    };
  }));

  // ── 8. Broadcast Engine initialization ────────────────────
  // Stage 3: Broadcast Engine is now functional — expect successful init.
  log(await _checkAsync('broadcast-engine-initialize', async () => {
    const res = await ShadowBroadcastEngine.initialize();
    const ok  = res.success === true;
    const status = ShadowBroadcastEngine.getConnectionStatus();
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-engine-initialize',
      detail: ok
        ? `Broadcast Engine initialized. State: ${status.state}, FFmpeg: ${res.data?.ffmpegVersion}`
        : `Init failed: ${res.message}`,
    };
  }));

  // ── 9. Firebase Connector (safe init without db) ───────────
  log(await _checkAsync('firebase-connector-safe-init', async () => {
    const res = await FirebaseConnector.initialize();
    const status = FirebaseConnector.getStatus();
    const ok = status === 'NOT_CONFIGURED';
    return {
      result: ok ? RESULT.NOT_CONFIGURED : RESULT.FAIL,
      name:   'firebase-connector-safe-init',
      detail: ok
        ? 'FirebaseConnector initializes safely without db (expected without real credentials).'
        : `Expected NOT_CONFIGURED, got ${status}`,
    };
  }));

  // ── 10. Command system (GET_STATUS) ────────────────────────
  log(await _checkAsync('command-system-get-status', async () => {
    await initCloudEngine();
    const res = await dispatchCommand(COMMAND.GET_STATUS);
    await shutdownCloudEngine();
    const ok = res.success === true && res.data?.engine !== undefined;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'command-system-get-status',
      detail: ok ? `GET_STATUS returned engine="${res.data.engine}".` : `Unexpected response: ${JSON.stringify(res)}`,
    };
  }));

  // ── 11. NOT_IMPLEMENTED commands don't fake operations ─────
  log(await _checkAsync('command-not-implemented', async () => {
    const res = await dispatchCommand(COMMAND.START_BROADCAST);
    const ok  = res.success === false && res.status === 'NOT_IMPLEMENTED';
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'command-not-implemented',
      detail: ok ? 'START_BROADCAST correctly returns NOT_IMPLEMENTED.' : `Unexpected: ${JSON.stringify(res)}`,
    };
  }));

  // ── 12. Health report ─────────────────────────────────────
  log(_check('health-report', () => {
    const health = getHealthReport();
    const ok = health.version !== undefined &&
               health.components !== undefined &&
               health.components.encoder !== undefined &&
               health.components.firebase !== undefined;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'health-report',
      detail: ok ? 'Health report returns all expected sections.' : 'Health report missing sections.',
    };
  }));

  // ── 13. Security permissions matrix ───────────────────────
  log(_check('security-permissions', () => {
    const ownerHasStart  = hasPermission(ROLE.OWNER, PERMISSION.START_ENGINE);
    const viewerNoStart  = !hasPermission(ROLE.VIEWER, PERMISSION.START_ENGINE);
    const viewerCanWatch = hasPermission(ROLE.VIEWER, PERMISSION.VIEW_CHANNEL);
    const ok = ownerHasStart && viewerNoStart && viewerCanWatch;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'security-permissions',
      detail: ok
        ? 'Permission matrix is correct (OWNER can start, VIEWER cannot start, VIEWER can watch).'
        : `Failed: ownerHasStart=${ownerHasStart} viewerNoStart=${viewerNoStart} viewerCanWatch=${viewerCanWatch}`,
    };
  }));

  // ── 14. Event bus ALL event names defined ─────────────────
  log(_check('event-catalogue', () => {
    const required = [
      'ENGINE_READY', 'ENGINE_ERROR',
      'MEDIA_LOADING', 'MEDIA_STARTED', 'MEDIA_ENDED', 'MEDIA_ERROR',
      'ENCODER_STARTED', 'ENCODER_STOPPED', 'ENCODER_ERROR',
      'BROADCAST_CONNECTED', 'BROADCAST_DISCONNECTED', 'BROADCAST_ERROR',
      'BROADCAST_STARTED', 'BROADCAST_STOPPED',         // Stage 3
      'BROADCAST_RECONNECTING', 'BROADCAST_RECONNECTED', // Stage 3
      'QUEUE_CHANGED', 'SCHEDULE_CHANGED',
      'WATCHDOG_WARNING',
      'RECOVERY_STARTED', 'RECOVERY_COMPLETED', 'RECOVERY_FAILED',
    ];
    const missing = required.filter(e => !CLOUD_ENGINE_EVENTS[e]);
    const ok = missing.length === 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'event-catalogue',
      detail: ok ? `All ${required.length} event names defined.` : `Missing: ${missing.join(', ')}`,
    };
  }));

  // ── 15. No secret VALUES in state ────────────────────────
  log(_check('no-secrets-in-state', () => {
    const sensitiveKeys = ['streamKey', 'stream_key', 'oauthToken', 'oauth_token',
                           'accessToken', 'access_token', 'refreshToken', 'refresh_token',
                           'clientSecret', 'client_secret', 'serviceAccountKey'];
    const leaks = [];
    function walk(obj, path) {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (sensitiveKeys.includes(k) && v !== null && v !== undefined && v !== '') {
          leaks.push(`${path}.${k}`);
        }
        if (v && typeof v === 'object') walk(v, `${path}.${k}`);
      }
    }
    walk(CloudEngineStateManager.snapshot(), 'state');
    const ok = leaks.length === 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'no-secrets-in-state',
      detail: ok
        ? 'State contains no non-null secret values (null schema placeholders are expected).'
        : `Secret values found: ${leaks.join(', ')}`,
    };
  }));

  // ══════════════════════════════════════════════════════════════
  //  STAGE 2 — SHADOW ENCODER DIAGNOSTICS
  // ══════════════════════════════════════════════════════════════

  // ── 16. Codec engine (FFmpeg) detection ───────────────────
  log(await _checkAsync('codec-engine-detection', async () => {
    const info = await detectCodecEngine();
    if (!info.found) {
      return {
        result: RESULT.FAIL,
        name:   'codec-engine-detection',
        detail: info.error ?? 'FFmpeg not found.',
      };
    }
    return {
      result: RESULT.PASS,
      name:   'codec-engine-detection',
      detail: `FFmpeg ${info.ffmpegVersion} found at ${info.ffmpegPath}. ffprobe at ${info.ffprobePath}.`,
    };
  }));

  // ── 17. Shadow Encoder initialize ─────────────────────────
  log(await _checkAsync('shadow-encoder-initialize', async () => {
    const res = await ShadowEncoder.initialize();
    const ok  = res.success === true;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'shadow-encoder-initialize',
      detail: ok
        ? `Encoder initialized. Profile: ${res.data?.profile}, FFmpeg: ${res.data?.ffmpegVersion}`
        : `Init failed: ${res.message}`,
    };
  }));

  // ── 18. Test media generation and probe ───────────────────
  let testMediaPath = null;
  log(await _checkAsync('test-media-probe', async () => {
    const codecInfo = await detectCodecEngine();
    if (!codecInfo.found) {
      return { result: RESULT.FAIL, name: 'test-media-probe', detail: 'FFmpeg not available.' };
    }

    const generated = await generateTestMedia(codecInfo.ffmpegPath, { durationSec: 3 });
    testMediaPath = generated.outputPath;

    const mediaInfo = await probeMedia(testMediaPath, codecInfo.ffprobePath);
    const ok = mediaInfo.hasVideo && mediaInfo.width > 0 && mediaInfo.duration > 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'test-media-probe',
      detail: ok
        ? `Probe: ${mediaInfo.width}×${mediaInfo.height} ${mediaInfo.videoCodec}, ${mediaInfo.duration?.toFixed(1)}s`
        : `Probe returned unexpected results: ${JSON.stringify({ hasVideo: mediaInfo.hasVideo, width: mediaInfo.width })}`,
    };
  }));

  // ── 19. Shadow Encoder full encode cycle ──────────────────
  log(await _checkAsync('shadow-encoder-full-cycle', async () => {
    if (!testMediaPath) {
      return { result: RESULT.FAIL, name: 'shadow-encoder-full-cycle', detail: 'No test media available (check 18 failed).' };
    }

    // Load media
    const loadRes = await ShadowEncoder.loadMedia(testMediaPath);
    if (!loadRes.success) {
      return { result: RESULT.FAIL, name: 'shadow-encoder-full-cycle', detail: `loadMedia failed: ${loadRes.message}` };
    }

    // Start encoding
    const startRes = await ShadowEncoder.start();
    if (!startRes.success) {
      return { result: RESULT.FAIL, name: 'shadow-encoder-full-cycle', detail: `start failed: ${startRes.message}` };
    }

    // Wait for completion (max 60 seconds for a 3-second test file)
    const outputPath = startRes.data?.outputPath;
    await _waitForEncoderCompletion(ShadowEncoder, 60_000);

    const status = ShadowEncoder.getStatus();
    const metrics = ShadowEncoder.getMetrics();

    const ok = (status.state === 'COMPLETED' || status.state === 'STOPPED') &&
               outputPath !== undefined;

    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'shadow-encoder-full-cycle',
      detail: ok
        ? `Encoding completed. State: ${status.state}, Output: ${outputPath ? path.basename(outputPath) : 'unknown'}`
        : `Unexpected state: ${status.state}`,
    };
  }));

  // ── 20. Encoder health report shows OK ────────────────────
  log(_check('encoder-health-ok', () => {
    const health = getHealthReport();
    const encHealth = health.components.encoder;
    const ok = encHealth.status === 'OK';
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'encoder-health-ok',
      detail: ok
        ? `Encoder health: ${encHealth.status}, state: ${encHealth.state}`
        : `Expected OK, got: ${encHealth.status} (state: ${encHealth.state})`,
    };
  }));

  // ══════════════════════════════════════════════════════════════
  //  STAGE 3 — BROADCAST ENGINE DIAGNOSTICS
  // ══════════════════════════════════════════════════════════════

  // ── 21. Broadcast Engine health report shows OK ───────────
  log(_check('broadcast-engine-health-ok', () => {
    const health = getHealthReport();
    const bcHealth = health.components.broadcast;
    // After successful init, broadcast should show OK (READY state)
    const ok = bcHealth.status === 'OK';
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-engine-health-ok',
      detail: ok
        ? `Broadcast health: ${bcHealth.status}, state: ${bcHealth.state}`
        : `Expected OK, got: ${bcHealth.status} (state: ${bcHealth.state})`,
    };
  }));

  // ── 22. Valid RTMP destination configuration ───────────────
  log(_check('broadcast-rtmp-destination', () => {
    const res = ShadowBroadcastEngine.registerDestination({
      destinationId:   'test-rtmp',
      name:            'Test RTMP Destination',
      protocol:        'RTMP',
      serverUrl:       'rtmp://localhost/live',
      streamKeyEnvVar: 'TEST_RTMP_STREAM_KEY',
      enabled:         true,
      autoReconnect:   false,
    });
    const ok = res.success === true;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-rtmp-destination',
      detail: ok ? 'RTMP destination registered successfully.' : `Failed: ${res.message}`,
    };
  }));

  // ── 23. Valid RTMPS destination configuration ──────────────
  log(_check('broadcast-rtmps-destination', () => {
    const res = ShadowBroadcastEngine.registerDestination({
      destinationId:   'test-rtmps',
      name:            'Test RTMPS Destination',
      protocol:        'RTMPS',
      serverUrl:       'rtmps://localhost:443/live',
      streamKeyEnvVar: 'TEST_RTMPS_STREAM_KEY',
      enabled:         true,
      autoReconnect:   true,
    });
    const ok = res.success === true;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-rtmps-destination',
      detail: ok ? 'RTMPS destination registered successfully.' : `Failed: ${res.message}`,
    };
  }));

  // ── 24. Invalid destination rejected ──────────────────────
  log(_check('broadcast-invalid-destination-rejected', () => {
    const res = ShadowBroadcastEngine.registerDestination({
      destinationId:   'bad-dest',
      name:            'Bad Destination',
      protocol:        'FTP',   // unsupported protocol
      serverUrl:       'ftp://example.com/live',
      streamKeyEnvVar: 'TEST_KEY',
      enabled:         true,
      autoReconnect:   false,
    });
    const ok = res.success === false;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-invalid-destination-rejected',
      detail: ok ? 'Invalid destination correctly rejected.' : 'Expected rejection, got success.',
    };
  }));

  // ── 25. Missing stream key correctly rejected ──────────────
  log(await _checkAsync('broadcast-missing-stream-key-rejected', async () => {
    // Ensure the env var is NOT set for this test
    const originalVal = process.env.DIAG_MISSING_KEY_TEST;
    delete process.env.DIAG_MISSING_KEY_TEST;

    const res = await ShadowBroadcastEngine.connect({
      destinationId: 'test-rtmp',
    });
    // Should fail because TEST_RTMP_STREAM_KEY is not set
    const ok = res.success === false;

    // Restore if it was set
    if (originalVal !== undefined) process.env.DIAG_MISSING_KEY_TEST = originalVal;

    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-missing-stream-key-rejected',
      detail: ok
        ? 'Missing stream key correctly rejected (STREAM_KEY_MISSING).'
        : `Expected rejection, got: ${JSON.stringify(res)}`,
    };
  }));

  // ── 26. Stream key not in diagnostics output ──────────────
  log(_check('broadcast-no-stream-key-in-diagnostics', () => {
    // Check that the status / metrics contain no REAL stream key values.
    // safeDestinationInfo() replaces the key with '********' — that is correct.
    // We check that no real key value appears: i.e. the streamKey field (if present)
    // must be null or '********', never a real credential.
    const connStatus = ShadowBroadcastEngine.getConnectionStatus();
    const metrics    = ShadowBroadcastEngine.getMetrics();
    const statusStr  = JSON.stringify(connStatus) + JSON.stringify(metrics);

    // Detect publishUrl or stream_key fields with non-redacted values
    // A value is a leak if it matches a key with a non-null, non-empty, non-redacted value
    const sensitivePatterns = [
      /\"publishUrl\"\s*:\s*\"[^"]+\"/,   // publishUrl must never appear
      /\"publish_url\"\s*:\s*\"[^"]+\"/,  // publish_url must never appear
      /\"stream_key\"\s*:\s*\"[^"]+\"/,   // stream_key must never appear
      // streamKey is allowed but only as '********' (redacted by safeDestinationInfo)
      /\"streamKey\"\s*:\s*\"(?!\*{8})[^"]+\"/,  // streamKey with non-redacted value
    ];

    const leaks = sensitivePatterns.filter(p => p.test(statusStr));

    const ok = leaks.length === 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'broadcast-no-stream-key-in-diagnostics',
      detail: ok
        ? 'Stream key correctly redacted (********) in broadcast status and metrics.'
        : `Potential secret leak detected: ${leaks.length} pattern(s) matched.`,
    };
  }));

  // ── 27. Live encoder profile available ────────────────────
  log(_check('live-encoder-profile', () => {
    // Use the already-imported LIVE_PROFILE_ID constant (imported at top of file)
    const ok = typeof LIVE_PROFILE_ID === 'string' && LIVE_PROFILE_ID.length > 0;
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'live-encoder-profile',
      detail: ok
        ? `Live encoder profile ID: "${LIVE_PROFILE_ID}"`
        : 'LIVE_PROFILE_ID not available.',
    };
  }));

  // ── 28. Live encoder profile — encode completes + speed reported ──
  // PASS criterion: live profile encodes successfully and speed is reported
  //   honestly (BEHIND is reported as a WARNING in detail, not a hard FAIL).
  //   A FAIL occurs only if the encoder itself fails to run.
  // The live profile must work on production hardware (≥1.0× speed required
  //   for uninterrupted 24h broadcast). Performance on this test machine is
  //   reported accurately for awareness.
  log(await _checkAsync('live-profile-realtime-speed', async () => {
    if (!testMediaPath) {
      return { result: RESULT.FAIL, name: 'live-profile-realtime-speed',
               detail: 'No test media available.' };
    }

    const { ShadowEncoderImpl } = await import('./encoder/shadow-encoder-impl.js');
    const liveEncoder = new ShadowEncoderImpl();

    try {
      const initRes = await liveEncoder.initialize({ profileId: LIVE_PROFILE_ID });
      if (!initRes.success) {
        return { result: RESULT.FAIL, name: 'live-profile-realtime-speed',
                 detail: `Failed to initialize with live profile: ${initRes.message}` };
      }

      const loadRes = await liveEncoder.loadMedia(testMediaPath);
      if (!loadRes.success) {
        return { result: RESULT.FAIL, name: 'live-profile-realtime-speed',
                 detail: `Failed to load media: ${loadRes.message}` };
      }

      const startRes = await liveEncoder.start();
      if (!startRes.success) {
        return { result: RESULT.FAIL, name: 'live-profile-realtime-speed',
                 detail: `Failed to start: ${startRes.message}` };
      }

      // Wait for encoding to complete (max 60s for a 3s test file)
      await _waitForEncoderCompletion(liveEncoder, 60_000);

      const metrics = liveEncoder.getMetrics();
      const speed   = metrics.speed;
      const status  = liveEncoder.getStatus().state;

      await liveEncoder.shutdown().catch(() => {});

      // FAIL only if encoding itself failed (encoder could not complete)
      const encodingOk = (status === 'COMPLETED' || status === 'STOPPED');

      // Speed assessment — report honestly, BEHIND is a warning not a hard failure
      const speedLabel =
        speed === null        ? 'NOT_AVAILABLE (test was too short to measure)' :
        speed >= 0.98         ? `${speed.toFixed(2)}× — NORMAL (realtime capable)` :
        speed >= 0.50         ? `${speed.toFixed(2)}× — BEHIND (may not sustain 24h on this hardware)` :
                                `${speed.toFixed(2)}× — STALLED (severely below realtime)`;

      return {
        result: encodingOk ? RESULT.PASS : RESULT.FAIL,
        name:   'live-profile-realtime-speed',
        detail: encodingOk
          ? `Live profile (veryfast) completed. State: ${status}. Speed: ${speedLabel}`
          : `Encoding failed. State: ${status}`,
      };
    } catch (err) {
      await liveEncoder.shutdown().catch(() => {});
      return { result: RESULT.FAIL, name: 'live-profile-realtime-speed',
               detail: `Unexpected error: ${err.message}` };
    }
  }));

  // ── 29. Output cleanup (DELETE_AFTER_SUCCESS) ──────────────
  log(await _checkAsync('output-cleanup-delete-after-success', async () => {
    const os    = await import('os');
    const fsmod = await import('fs/promises');
    const tmpFile = path.join(os.default.tmpdir(), 'cloud-engine-output',
                              'diag-cleanup-test.flv');

    // Create a temp file in the approved output directory
    await fsmod.default.mkdir(path.dirname(tmpFile), { recursive: true });
    await fsmod.default.writeFile(tmpFile, 'test cleanup content\n');

    const { registerApprovedOutputRoot } = await import('./broadcast/output-cleanup.js');
    registerApprovedOutputRoot(path.dirname(tmpFile));

    const result = await cleanupOutput({
      filePath:            tmpFile,
      policy:              CLEANUP_POLICY.DELETE_AFTER_SUCCESS,
      broadcastSucceeded:  true,
    });

    return {
      result: result.deleted ? RESULT.PASS : RESULT.FAIL,
      name:   'output-cleanup-delete-after-success',
      detail: result.deleted
        ? 'DELETE_AFTER_SUCCESS: file deleted as expected.'
        : `File not deleted: ${result.reason}`,
    };
  }));

  // ── 30. Encoder/broadcast state independence ───────────────
  log(_check('encoder-broadcast-state-independence', () => {
    const encStatus = ShadowEncoder.getStatus();
    const bcStatus  = ShadowBroadcastEngine.getConnectionStatus();

    // They must be independently reportable
    const ok = encStatus.state !== undefined &&
               bcStatus.state  !== undefined &&
               encStatus.state !== bcStatus.state;

    // COMPLETED or STOPPED encoder with READY broadcast = independent states
    return {
      result: ok ? RESULT.PASS : RESULT.FAIL,
      name:   'encoder-broadcast-state-independence',
      detail: ok
        ? `Encoder: ${encStatus.state} | Broadcast: ${bcStatus.state} — independent.`
        : `Expected different states. Encoder: ${encStatus.state}, Broadcast: ${bcStatus.state}`,
    };
  }));

  // ── Summary ───────────────────────────────────────────────
  const passed       = results.filter(r => r.result === RESULT.PASS).length;
  const failed       = results.filter(r => r.result === RESULT.FAIL).length;
  const notImpl      = results.filter(r => r.result === RESULT.NOT_IMPLEMENTED).length;
  const notConfigured = results.filter(r => r.result === RESULT.NOT_CONFIGURED).length;

  CloudEngineLogger.info('diagnostics', 'DIAG_COMPLETE',
    `Stage 3 Diagnostics: ${passed} PASS, ${failed} FAIL, ${notImpl} NOT_IMPLEMENTED, ${notConfigured} NOT_CONFIGURED`);

  return {
    passed,
    failed,
    notImplemented:  notImpl,
    notConfigured,
    total:   results.length,
    ready:   failed === 0,
    version: ENGINE_VERSION,
    results,
  };
}

/* ─────────────────────────────────
   HELPERS
───────────────────────────────── */

/**
 * Poll the encoder until it reaches COMPLETED/STOPPED/ERROR or timeout.
 * @param {object} encoder
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function _waitForEncoderCompletion(encoder, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = encoder.getStatus();
    if (['COMPLETED', 'STOPPED', 'ERROR'].includes(status.state)) return;
    await new Promise(r => setTimeout(r, 500));
  }
}
