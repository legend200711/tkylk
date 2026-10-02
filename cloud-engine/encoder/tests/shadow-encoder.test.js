/**
 * 24-HOUR CLOUD ENGINE — Stage 2 Shadow Encoder Test Suite
 * cloud-engine/encoder/tests/shadow-encoder.test.js
 *
 * 20 tests covering the complete Shadow Encoder specification.
 * No external test framework required — pure Node.js async/await.
 *
 * Run with:
 *   node cloud-engine/encoder/tests/shadow-encoder.test.js
 *
 * Stage 2 — Shadow Encoder
 */

import path          from 'path';
import fs            from 'fs/promises';
import os            from 'os';

// ── Encoder components ────────────────────────────────────────────────
import { ShadowEncoderImpl, ENCODER_STATE } from '../shadow-encoder-impl.js';
import { EncoderError, ENCODER_ERROR_CODE } from '../encoder-errors.js';
import { detectCodecEngine }               from '../codec-adapter.js';
import { probeMedia }                      from '../media-probe.js';
import { generateTestMedia }               from '../test-utils/generate-test-media.js';
import { getProfile, DEFAULT_PROFILE_ID }  from '../encoder-profiles.js';
import { OutputManager }                   from '../output-manager.js';
import {
  createMetrics,
  parseProgressLine,
  applyProgressField,
  assessTimingStatus,
} from '../encoder-metrics.js';
import { TimingEngine }                    from '../timing-engine.js';

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
   SHARED TEST STATE
═══════════════════════════════════ */

let _codecInfo     = null;   // detectCodecEngine() result
let _testMediaPath = null;   // generated test media path
let _encoder       = null;   // ShadowEncoderImpl instance

/* ════════════════════════════════════════════════════════════════════════
   SETUP — detect codec engine + generate test media BEFORE all tests
════════════════════════════════════════════════════════════════════════ */

_codecInfo = await detectCodecEngine();
if (!_codecInfo.found) {
  console.error('FATAL: FFmpeg not found. Install FFmpeg to run Shadow Encoder tests.');
  process.exit(1);
}

// Generate a 5-second test media file (SMPTE bars + 1kHz tone)
const generated = await generateTestMedia(_codecInfo.ffmpegPath, {
  durationSec: 5,
  width:       640,
  height:      480,
});
_testMediaPath = generated.outputPath;
console.log(`\nTest setup: generated ${_testMediaPath} (${generated.size} bytes)\n`);
console.log('Running Shadow Encoder tests…\n');

/* ════════════════════════════════════════════════════════════════════════
   TESTS
════════════════════════════════════════════════════════════════════════ */

// ─── 1. Encoder initialization ───────────────────────────────────────
await test('1. Encoder initialization', async () => {
  _encoder = new ShadowEncoderImpl();
  assertEqual(_encoder._state, ENCODER_STATE.UNINITIALIZED, 'initial state');

  const res = await _encoder.initialize();
  assert(res.success === true, `initialize() returned success=false: ${res.message}`);
  assertEqual(_encoder._state, ENCODER_STATE.READY, 'state after init');
});

// ─── 2. Codec engine detection ───────────────────────────────────────
await test('2. Codec engine detection', async () => {
  assert(_codecInfo.found === true, 'FFmpeg not found');
  assert(typeof _codecInfo.ffmpegPath  === 'string', 'ffmpegPath must be a string');
  assert(typeof _codecInfo.ffprobePath === 'string', 'ffprobePath must be a string');
  assert(typeof _codecInfo.ffmpegVersion === 'string', 'ffmpegVersion must be a string');
  assert(_codecInfo.ffmpegVersion.length > 0, 'ffmpegVersion must be non-empty');
});

// ─── 3. Valid media probe ─────────────────────────────────────────────
await test('3. Valid media probe', async () => {
  const info = await probeMedia(_testMediaPath, _codecInfo.ffprobePath);
  assert(info.hasVideo === true, 'hasVideo must be true');
  assert(typeof info.duration === 'number' && info.duration > 0, 'duration must be > 0');
  assert(info.width > 0, 'width must be > 0');
  assert(info.height > 0, 'height must be > 0');
  assert(typeof info.videoCodec === 'string', 'videoCodec must be a string');
  assert(typeof info.fileSize === 'number' && info.fileSize > 0, 'fileSize must be > 0');
});

// ─── 4. Invalid media rejection ──────────────────────────────────────
await test('4. Invalid media rejection (non-media file)', async () => {
  // Write a text file and try to probe it
  const junkPath = path.join(os.tmpdir(), 'ce-test-junk.txt');
  await fs.writeFile(junkPath, 'not a video file\n');
  try {
    await probeMedia(junkPath, _codecInfo.ffprobePath);
    throw new Error('Expected EncoderError was not thrown');
  } catch (err) {
    assert(err instanceof EncoderError, 'Expected EncoderError');
    assert(
      err.code === ENCODER_ERROR_CODE.MEDIA_UNSUPPORTED ||
      err.code === ENCODER_ERROR_CODE.MEDIA_PROBE_FAILED,
      `Expected MEDIA_UNSUPPORTED or MEDIA_PROBE_FAILED, got ${err.code}`,
    );
  } finally {
    await fs.unlink(junkPath).catch(() => {});
  }
});

// ─── 5. Missing media rejection ──────────────────────────────────────
await test('5. Missing media rejection (non-existent file)', async () => {
  try {
    await probeMedia('/tmp/ce-this-file-does-not-exist-12345.mp4', _codecInfo.ffprobePath);
    throw new Error('Expected EncoderError was not thrown');
  } catch (err) {
    assert(err instanceof EncoderError, 'Expected EncoderError');
    assertEqual(err.code, ENCODER_ERROR_CODE.MEDIA_NOT_FOUND, 'error code');
  }
});

// ─── 6. Load media ───────────────────────────────────────────────────
await test('6. Load media', async () => {
  const res = await _encoder.loadMedia(_testMediaPath);
  assert(res.success === true, `loadMedia failed: ${res.message}`);
  assertEqual(_encoder._state, ENCODER_STATE.MEDIA_LOADED, 'state after loadMedia');
  assert(res.data?.mediaInfo !== undefined, 'mediaInfo must be in response data');
  assert(res.data.mediaInfo.hasVideo === true, 'loaded media must have video');
});

// ─── 7. Start encoding ───────────────────────────────────────────────
await test('7. Start encoding', async () => {
  const res = await _encoder.start();
  assert(res.success === true, `start() failed: ${res.message}`);
  assert(typeof res.data?.outputPath === 'string', 'outputPath must be returned');
  assert(typeof res.data?.pid === 'number' && res.data.pid > 0, 'pid must be a positive number');
});

// ─── 8. Status changes to ENCODING ───────────────────────────────────
await test('8. Status changes to ENCODING', async () => {
  const status = _encoder.getStatus();
  assertEqual(status.state, ENCODER_STATE.ENCODING, 'state must be ENCODING after start');
  assert(status.currentMedia !== null, 'currentMedia must be set');
  assert(status.profile === DEFAULT_PROFILE_ID, 'profile must match default profile');
});

// ─── 9. Real metrics become available ────────────────────────────────
await test('9. Real metrics become available', async () => {
  // Wait briefly for FFmpeg to start reporting
  await new Promise(r => setTimeout(r, 2000));
  const metrics = _encoder.getMetrics();
  assert(metrics.state === ENCODER_STATE.ENCODING, 'metrics.state must be ENCODING');
  assert(metrics.currentMedia !== null, 'currentMedia must be populated');
  assert(metrics.duration !== null && metrics.duration > 0, 'duration must be non-null');
  assert(metrics.targetFps !== null, 'targetFps must be set');
  // position and fps may still be null if FFmpeg just started
  // encodedFrames should be present at minimum
});

// ─── 10. Local output is produced ────────────────────────────────────
await test('10. Local output is produced', async () => {
  // Wait for encoding to complete (up to 60 seconds for a 5-second test file)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = _encoder.getStatus();
    if (['COMPLETED', 'STOPPED', 'ERROR'].includes(status.state)) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const outputPath = _encoder._outputPath;
  assert(typeof outputPath === 'string', 'outputPath must be a string');

  const stat = await fs.stat(outputPath).catch(() => null);
  assert(stat !== null, `Output file does not exist: ${outputPath}`);
  assert(stat.size > 0, `Output file is empty: ${outputPath}`);

  // Store for subsequent tests
  _encoder._lastOutputPath = outputPath;
});

// ─── 11. Output contains expected video codec ────────────────────────
await test('11. Output contains expected video codec (H.264)', async () => {
  const outPath = _encoder._outputPath ?? _encoder._lastOutputPath;
  assert(typeof outPath === 'string', 'No output path available');

  const probed = await probeMedia(outPath, _codecInfo.ffprobePath);
  assert(probed.hasVideo === true, 'Output must have a video stream');
  // libx264 encodes as h264
  assert(
    probed.videoCodec === 'h264' || probed.videoCodec === 'H264',
    `Expected h264 video codec, got: ${probed.videoCodec}`,
  );
});

// ─── 12. Output contains expected audio codec ────────────────────────
await test('12. Output contains expected audio codec (AAC)', async () => {
  const outPath = _encoder._outputPath ?? _encoder._lastOutputPath;
  assert(typeof outPath === 'string', 'No output path available');

  const probed = await probeMedia(outPath, _codecInfo.ffprobePath);
  assert(probed.hasAudio === true, 'Output must have an audio stream');
  assert(
    probed.audioCodec === 'aac',
    `Expected aac audio codec, got: ${probed.audioCodec}`,
  );
});

// ─── 13. Output dimensions match configured profile ──────────────────
await test('13. Output dimensions match profile (1920×1080)', async () => {
  const outPath = _encoder._outputPath ?? _encoder._lastOutputPath;
  assert(typeof outPath === 'string', 'No output path available');

  const profile = getProfile(DEFAULT_PROFILE_ID);
  const probed  = await probeMedia(outPath, _codecInfo.ffprobePath);

  assertEqual(probed.width,  profile.video.width,  'output width');
  assertEqual(probed.height, profile.video.height, 'output height');
});

// ─── 14. Output frame rate is correct ────────────────────────────────
await test('14. Output frame rate is correct (30 fps)', async () => {
  const outPath = _encoder._outputPath ?? _encoder._lastOutputPath;
  assert(typeof outPath === 'string', 'No output path available');

  const profile = getProfile(DEFAULT_PROFILE_ID);
  const probed  = await probeMedia(outPath, _codecInfo.ffprobePath);

  // Allow ±0.5 fps tolerance for fractional frame rates
  const diff = Math.abs((probed.frameRate ?? 0) - profile.video.frameRate);
  assert(diff < 0.5,
    `Expected ${profile.video.frameRate} fps, got ${probed.frameRate} (diff: ${diff})`);
});

// ─── 15. Audio sample rate is correct ────────────────────────────────
await test('15. Audio sample rate is correct (48000 Hz)', async () => {
  const outPath = _encoder._outputPath ?? _encoder._lastOutputPath;
  assert(typeof outPath === 'string', 'No output path available');

  const profile = getProfile(DEFAULT_PROFILE_ID);
  const probed  = await probeMedia(outPath, _codecInfo.ffprobePath);

  assert(probed.hasAudio, 'Output must have audio');
  assertEqual(probed.sampleRate, profile.audio.sampleRate, 'audio sample rate');
});

// ─── 16. Normal completion ───────────────────────────────────────────
await test('16. Normal completion (state = COMPLETED)', async () => {
  // Encoder should already be COMPLETED from test 10
  const state = _encoder.getStatus().state;
  assert(
    state === ENCODER_STATE.COMPLETED || state === ENCODER_STATE.STOPPED,
    `Expected COMPLETED or STOPPED, got ${state}`,
  );
});

// ─── 17. Stop during encoding ────────────────────────────────────────
await test('17. Stop during encoding', async () => {
  // Create a fresh encoder to test stop()
  const enc2 = new ShadowEncoderImpl();
  await enc2.initialize();

  // Generate a longer test file with a unique name so it doesn't clash with _testMediaPath
  const longMedia = await generateTestMedia(_codecInfo.ffmpegPath, {
    durationSec: 10,
    width: 320,
    height: 240,
    outputPath: path.join(os.tmpdir(), 'ce-test-stop-media.mp4'),
  });

  await enc2.loadMedia(longMedia.outputPath);
  const startRes = await enc2.start();
  assert(startRes.success === true, `start() failed: ${startRes.message}`);

  // Wait briefly to let FFmpeg start
  await new Promise(r => setTimeout(r, 1500));
  assertEqual(enc2._state, ENCODER_STATE.ENCODING, 'must be ENCODING before stop');

  const stopRes = await enc2.stop();
  assert(stopRes.success === true, `stop() failed: ${stopRes.message}`);

  const state = enc2.getStatus().state;
  assert(
    state === ENCODER_STATE.STOPPED || state === ENCODER_STATE.COMPLETED,
    `Expected STOPPED after stop(), got ${state}`,
  );

  // Clean up
  await fs.unlink(longMedia.outputPath).catch(() => {});
});

// ─── 18. Invalid lifecycle transition rejection ───────────────────────
await test('18. Invalid lifecycle transition rejection', async () => {
  const enc3 = new ShadowEncoderImpl();
  // UNINITIALIZED → start() should fail
  const res = await enc3.start();
  assert(res.success === false, 'start() in UNINITIALIZED must fail');
  assert(res.message.includes('invalid state') || res.message.includes('INVALID_STATE') ||
         res.message.toLowerCase().includes('state'),
    `Expected state error message, got: ${res.message}`);

  // READY → stop() should also fail
  await enc3.initialize();
  const stopRes = await enc3.stop();
  assert(stopRes.success === false, 'stop() in READY must fail');
  assert(stopRes.message.includes('state') || stopRes.message.includes('Cannot stop'),
    `Expected state error message, got: ${stopRes.message}`);
});

// ─── 19. Codec crash/error handling ──────────────────────────────────
await test('19. Error handling — loadMedia() bad file does not crash engine', async () => {
  // Use a re-initialized encoder
  const enc4 = new ShadowEncoderImpl();
  await enc4.initialize();

  const badPath = '/tmp/ce-nonexistent-99999.mp4';
  const res = await enc4.loadMedia(badPath);

  // Must fail gracefully
  assert(res.success === false, 'loadMedia() with bad path must fail');
  assert(res.message.length > 0, 'Error message must be provided');

  // Encoder must remain operational — not stuck in ERROR state from a bad file
  const state = enc4.getStatus().state;
  assert(
    state === ENCODER_STATE.READY || state === ENCODER_STATE.MEDIA_LOADED,
    `Encoder must remain in a usable state after failed loadMedia, got ${state}`,
  );
});

// ─── 20. Engine remains operational after media failure ───────────────
await test('20. Engine operational after media failure — can load valid file afterward', async () => {
  const enc5 = new ShadowEncoderImpl();
  await enc5.initialize();

  // Generate a fresh media file owned exclusively by this test
  const recoveryMedia = await generateTestMedia(_codecInfo.ffmpegPath, {
    durationSec: 3,
    width: 320,
    height: 240,
    outputPath: path.join(os.tmpdir(), 'ce-test-recovery-media.mp4'),
  });

  // First: try a bad file (text file)
  const junkPath = path.join(os.tmpdir(), 'ce-test-bad-media.txt');
  await fs.writeFile(junkPath, 'not media\n');
  const badRes = await enc5.loadMedia(junkPath);
  assert(badRes.success === false, 'First load (bad file) must fail');

  // Second: immediately load the valid test media (the fresh one we own)
  const goodRes = await enc5.loadMedia(recoveryMedia.outputPath);
  assert(goodRes.success === true, `Second load (valid file) must succeed: ${goodRes.message}`);
  assertEqual(enc5._state, ENCODER_STATE.MEDIA_LOADED, 'state after successful loadMedia');

  // Clean up
  await fs.unlink(junkPath).catch(() => {});
  await fs.unlink(recoveryMedia.outputPath).catch(() => {});
});

/* ════════════════════════════════════════════════════════════════════════
   ADDITIONAL UNIT TESTS — Metrics, Timing, Profiles
════════════════════════════════════════════════════════════════════════ */

await test('U1. Encoder profile registry', async () => {
  const profile = getProfile('youtube_1080p30');
  assertEqual(profile.id, 'youtube_1080p30', 'profile id');
  assertEqual(profile.video.width,    1920,    'profile width');
  assertEqual(profile.video.height,   1080,    'profile height');
  assertEqual(profile.video.frameRate, 30,     'profile fps');
  assertEqual(profile.audio.sampleRate, 48000, 'profile audio sampleRate');
  assertEqual(profile.audio.channels, 2,       'profile audio channels');
  assertEqual(profile.container, 'flv',        'profile container');
});

await test('U2. Metrics progress parser', async () => {
  const metrics = createMetrics();
  applyProgressField(metrics, 'frame', '90');
  applyProgressField(metrics, 'fps', '29.97');
  applyProgressField(metrics, 'out_time_us', '3000000');
  applyProgressField(metrics, 'speed', '1.05');
  applyProgressField(metrics, 'total_size', '512000');

  assertEqual(metrics.encodedFrames, 90,     'encodedFrames');
  assertEqual(metrics.fps,           29.97,  'fps');
  assertEqual(metrics.position,      3.0,    'position (3s from 3000000us)');
  assertEqual(metrics.speed,         1.05,   'speed');
  assertEqual(metrics.outputSize,    512000, 'outputSize');
});

await test('U3. Timing status assessment', async () => {
  assertEqual(assessTimingStatus(1.05), 'NORMAL',  'speed 1.05 = NORMAL');
  assertEqual(assessTimingStatus(0.98), 'NORMAL',  'speed 0.98 = NORMAL');
  assertEqual(assessTimingStatus(0.75), 'BEHIND',  'speed 0.75 = BEHIND');
  assertEqual(assessTimingStatus(0.3),  'STALLED', 'speed 0.3 = STALLED');
  assertEqual(assessTimingStatus(null), null,      'speed null = null');
});

await test('U4. OutputManager path safety', async () => {
  const om = new OutputManager({ outputRoot: path.join(os.tmpdir(), 'ce-test-output') });
  await om.init();

  // Valid path
  const safe = om.buildOutputPath({ jobId: 'test-job', fileExtension: '.flv' });
  assert(safe.startsWith(om.outputRoot), 'safe path must be inside output root');

  // Path traversal attempt
  try {
    om.assertPathAllowed('/etc/passwd');
    throw new Error('Expected path traversal error');
  } catch (err) {
    assert(err instanceof EncoderError, 'Expected EncoderError for path traversal');
    assertEqual(err.code, ENCODER_ERROR_CODE.PATH_TRAVERSAL_DENIED, 'error code');
  }
});

await test('U5. Timing engine snapshot', async () => {
  const te = new TimingEngine();
  te.start({ duration: 120, targetFps: 30 });

  await new Promise(r => setTimeout(r, 100));
  te.update({ position: 2.5, fps: 30.1, speed: 1.02, encodedFrames: 75 });

  const snap = te.snapshot();
  assert(snap.elapsedSec !== null && snap.elapsedSec > 0, 'elapsedSec must be > 0');
  assertEqual(snap.position, 2.5,   'position');
  assertEqual(snap.duration, 120,   'duration');
  assertEqual(snap.fps,      30.1,  'fps');
  assertEqual(snap.speed,    1.02,  'speed');
  assertEqual(snap.timingStatus, 'NORMAL', 'timingStatus');
  assert(snap.expectedFrames !== null, 'expectedFrames must not be null');
});

/* ════════════════════════════════════════════════════════════════════════
   CLEANUP
════════════════════════════════════════════════════════════════════════ */

// Shutdown the main encoder instance cleanly
if (_encoder) {
  await _encoder.shutdown().catch(() => {});
}

/* ════════════════════════════════════════════════════════════════════════
   SUMMARY
════════════════════════════════════════════════════════════════════════ */

const total = _passed + _failed;
console.log('\n─────────────────────────────────────────');
console.log(`Shadow Encoder Test Results`);
console.log(`  PASS: ${_passed}/${total}`);
console.log(`  FAIL: ${_failed}/${total}`);
console.log('─────────────────────────────────────────\n');

if (_failed > 0) {
  console.log('Failed tests:');
  _results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ✗ ${r.name}: ${r.error}`);
  });
  console.log('');
}

process.exit(_failed > 0 ? 1 : 0);
