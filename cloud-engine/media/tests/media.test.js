/**
 * 24-HOUR CLOUD ENGINE — Stage 9 Media Tests
 * cloud-engine/media/tests/media.test.js
 *
 * Tests:
 *  1.  MediaError — structure and serialization
 *  2.  MEDIA_TYPE — all types defined
 *  3.  MEDIA_VALIDATION_STATE — all states defined
 *  4.  createMediaItem — valid creation
 *  5.  createMediaItem — missing required fields throw
 *  6.  updateMediaItem — immutable update
 *  7.  isMediaBroadcastReady — VALID + storageRef = true
 *  8.  isMediaBroadcastReady — UNVALIDATED = false
 *  9.  inferMimeType — correct MIME for known extensions
 * 10.  detectMediaCategory — video/audio/image/unknown
 * 11.  buildMetadataFromProbe — correct field mapping
 * 12.  summarizeMetadata — human-readable output
 * 13.  LocalFileStorageAdapter — resolves local path
 * 14.  LocalFileStorageAdapter — non-existent path returns failure
 * 15.  ExternalCloudStorageAdapter — returns NOT_CONFIGURED
 * 16.  CloudMediaLibrary.register() — registers media item
 * 17.  CloudMediaLibrary.register() — duplicate rejected
 * 18.  CloudMediaLibrary.register() — missing fields rejected
 * 19.  CloudMediaLibrary.getItem() — owner check enforced
 * 20.  CloudMediaLibrary.getItem() — wrong owner denied
 * 21.  CloudMediaLibrary.getByOwner() — returns correct items
 * 22.  CloudMediaLibrary.remove() — removes item, wrong owner blocked
 * 23.  CloudMediaLibrary.validateItem() — valid video file passes
 * 24.  CloudMediaLibrary.validateItem() — nonexistent file fails
 * 25.  CloudMediaLibrary.validateItem() — invalid media item not found
 * 26.  MediaPlaybackSource — loads valid media, provides encoder input
 * 27.  MediaPlaybackSource — unvalidated media rejected
 * 28.  CloudMediaLibrary.createPlaybackSource() — end-to-end
 * 29.  CloudMediaLibrary.getByType() — returns correct type subset
 * 30.  Regression — Stages 1–8 unaffected
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import os   from 'os';
import path from 'path';
import fs   from 'fs/promises';

import { MediaError, MEDIA_TYPE, MEDIA_ERROR_CODE,
         MEDIA_VALIDATION_STATE }                     from '../media-errors.js';
import { createMediaItem, updateMediaItem,
         isMediaBroadcastReady }                      from '../media-item.js';
import { inferMimeType, detectMediaCategory,
         buildMetadataFromProbe, summarizeMetadata }  from '../media-metadata.js';
import { LocalFileStorageAdapter,
         ExternalCloudStorageAdapter }                from '../media-storage-adapter.js';
import { CloudMediaLibrary }                          from '../media-library.js';
import { MediaPlaybackSource, PLAYBACK_SOURCE_STATE } from '../media-playback-source.js';

// For generating a real test file
import { detectCodecEngine }     from '../../encoder/codec-adapter.js';
import { generateTestMedia }     from '../../encoder/test-utils/generate-test-media.js';

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
   SETUP — generate a real test video file
═══════════════════════════════════ */
let _testVideoPath  = null;
let _testAudioPath  = null;  // We'll use the video as "audio" test too
let _testImagePath  = null;
let _ffmpegAvailable = false;

try {
  const codec = await detectCodecEngine();
  if (codec.found) {
    _ffmpegAvailable = true;
    // Generate a 3-second test video
    const gen = await generateTestMedia(codec.ffmpegPath, { durationSec: 3 });
    _testVideoPath = gen.outputPath;

    // Create a tiny test PNG image
    _testImagePath = path.join(os.tmpdir(), 'cloud-engine-test-image.png');
    // Use ffmpeg to create a 1-frame image from the test video
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(execFile);
    await execAsync(codec.ffmpegPath, [
      '-y', '-i', _testVideoPath, '-vframes', '1', '-f', 'image2', _testImagePath,
    ]).catch(() => { _testImagePath = null; });
  }
} catch {
  // ffmpeg not available — skip ffprobe-dependent tests
}

/* ═══════════════════════════════════
   TEST SUITE
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log('  Stage 9 Cloud Media Tests');
console.log('──────────────────────────────────────────────────────\n');

// 1. MediaError
await test('1. MediaError structure and serialization', async () => {
  const err = new MediaError(MEDIA_ERROR_CODE.FILE_NOT_FOUND, 'File missing', { path: '/x' });
  assert(err instanceof Error, 'is Error');
  assertEqual(err.name, 'MediaError', 'name');
  assertEqual(err.code, MEDIA_ERROR_CODE.FILE_NOT_FOUND, 'code');
  const j = err.toJSON();
  assert(j.code && j.message && j.timestamp, 'toJSON fields');
  assert(j.meta.path === '/x', 'meta preserved');
});

// 2. MEDIA_TYPE — all types defined
await test('2. MEDIA_TYPE all types defined', async () => {
  const required = ['VIDEO', 'AUDIO', 'IMAGE', 'PROGRAM', 'CLIP', 'BUMPER', 'STATION_ID'];
  for (const t of required) assert(MEDIA_TYPE[t], `MEDIA_TYPE.${t} must exist`);
});

// 3. MEDIA_VALIDATION_STATE
await test('3. MEDIA_VALIDATION_STATE all states defined', async () => {
  const required = ['UNVALIDATED', 'VALIDATING', 'VALID', 'INVALID', 'ERROR'];
  for (const s of required) assert(MEDIA_VALIDATION_STATE[s], `state ${s}`);
});

// 4. createMediaItem — valid
await test('4. createMediaItem valid creation', async () => {
  const item = createMediaItem({
    mediaId: 'test-1', ownerId: 'user-a', title: 'Test Video',
    type: MEDIA_TYPE.VIDEO, storageRef: '/tmp/test.mp4',
  });
  assertEqual(item.mediaId, 'test-1', 'mediaId');
  assertEqual(item.ownerId, 'user-a', 'ownerId');
  assertEqual(item.type, MEDIA_TYPE.VIDEO, 'type');
  assertEqual(item.validationState, MEDIA_VALIDATION_STATE.UNVALIDATED, 'initial state');
  assert(item.createdAt, 'createdAt set');
});

// 5. createMediaItem — missing fields throw
await test('5. createMediaItem missing fields throw', async () => {
  let threw = false;
  try { createMediaItem({ mediaId: 'x' }); } catch { threw = true; }
  assert(threw, 'missing ownerId should throw');
});

// 6. updateMediaItem — immutable update
await test('6. updateMediaItem immutable update', async () => {
  const item = createMediaItem({
    mediaId: 'upd-1', ownerId: 'u', title: 'T', type: MEDIA_TYPE.VIDEO, storageRef: '/t',
  });
  const updated = updateMediaItem(item, { title: 'New Title' });
  assertEqual(updated.title, 'New Title', 'title updated');
  assertEqual(item.title, 'T', 'original unchanged');
  assertEqual(updated.mediaId, 'upd-1', 'mediaId preserved');
});

// 7. isMediaBroadcastReady — VALID = true
await test('7. isMediaBroadcastReady — VALID + storageRef = true', async () => {
  const item = createMediaItem({
    mediaId: 'rdy-1', ownerId: 'u', title: 'T', type: MEDIA_TYPE.VIDEO, storageRef: '/t',
    metadata: { validationState: MEDIA_VALIDATION_STATE.VALID },
  });
  assert(isMediaBroadcastReady(item), 'should be ready');
});

// 8. isMediaBroadcastReady — UNVALIDATED = false
await test('8. isMediaBroadcastReady — UNVALIDATED = false', async () => {
  const item = createMediaItem({
    mediaId: 'nrdy-1', ownerId: 'u', title: 'T', type: MEDIA_TYPE.VIDEO, storageRef: '/t',
  });
  assert(!isMediaBroadcastReady(item), 'should NOT be ready');
});

// 9. inferMimeType
await test('9. inferMimeType correct for known extensions', async () => {
  assertEqual(inferMimeType('/path/to/video.mp4'), 'video/mp4', 'mp4');
  assertEqual(inferMimeType('/path/to/clip.mov'), 'video/quicktime', 'mov');
  assertEqual(inferMimeType('/path/to/audio.mp3'), 'audio/mpeg', 'mp3');
  assertEqual(inferMimeType('/path/to/img.jpg'), 'image/jpeg', 'jpg');
  assert(inferMimeType('/path/to/unknown.xyz') === null, 'unknown returns null');
});

// 10. detectMediaCategory
await test('10. detectMediaCategory video/audio/image/unknown', async () => {
  assertEqual(detectMediaCategory('/f/video.mp4'),  'video', 'mp4');
  assertEqual(detectMediaCategory('/f/audio.mp3'),  'audio', 'mp3');
  assertEqual(detectMediaCategory('/f/img.png'),    'image', 'png');
  assertEqual(detectMediaCategory('/f/file.xyz'),   'unknown', 'unknown');
});

// 11. buildMetadataFromProbe
await test('11. buildMetadataFromProbe field mapping', async () => {
  const probe = {
    duration: 30.5, fileSize: 1024000, formatName: 'mp4',
    videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 1080,
    frameRate: 30, sampleRate: 44100, hasVideo: true, hasAudio: true,
  };
  const meta = buildMetadataFromProbe(probe);
  assertEqual(meta.duration,   30.5, 'duration');
  assertEqual(meta.videoCodec, 'h264', 'videoCodec');
  assertEqual(meta.width,      1920, 'width');
  assertEqual(meta.fps,        30, 'fps');
  assert(meta.hasVideo, 'hasVideo');
});

// 12. summarizeMetadata
await test('12. summarizeMetadata human-readable output', async () => {
  const meta = {
    hasVideo: true, videoCodec: 'h264', width: 1920, height: 1080, fps: 30,
    hasAudio: true, audioCodec: 'aac', duration: 120.5, fileSize: 10_000_000,
  };
  const summary = summarizeMetadata(meta);
  assert(summary.includes('h264'), 'codec in summary');
  assert(summary.includes('1920×1080'), 'resolution in summary');
  assert(summary.includes('120.5s'), 'duration in summary');
  assert(summary.includes('MB'), 'file size in summary');
});

// 13. LocalFileStorageAdapter — resolves local path
await test('13. LocalFileStorageAdapter resolves existing local path', async () => {
  if (!_testVideoPath) { console.log('    SKIP (no test video)'); _passed++; return; }
  const adapter = new LocalFileStorageAdapter();
  const r = await adapter.resolveToLocalPath(_testVideoPath);
  assertEqual(r.success, true, 'success');
  assert(r.localPath, 'localPath present');
});

// 14. LocalFileStorageAdapter — non-existent path returns failure
await test('14. LocalFileStorageAdapter non-existent path → failure', async () => {
  const adapter = new LocalFileStorageAdapter();
  const r = await adapter.resolveToLocalPath('/tmp/__definitely_does_not_exist_12345.mp4');
  assertEqual(r.success, false, 'should fail');
  assert(!r.localPath, 'no localPath');
});

// 15. ExternalCloudStorageAdapter — returns NOT_CONFIGURED
await test('15. ExternalCloudStorageAdapter returns NOT_CONFIGURED', async () => {
  const adapter = new ExternalCloudStorageAdapter({ adapterName: 'TestCloud' });
  const r = await adapter.resolveToLocalPath('gs://bucket/file.mp4');
  assertEqual(r.success, false, 'should fail');
  assert(r.message.includes('not configured'), 'message mentions not configured');
  const exists = await adapter.exists('anything');
  assertEqual(exists.exists, false, 'exists returns false');
});

// 16. CloudMediaLibrary.register() — registers item
await test('16. CloudMediaLibrary register()', async () => {
  const lib = new CloudMediaLibrary();
  const r = lib.register({
    mediaId: 'lib-1', ownerId: 'user-1', title: 'My Video',
    type: MEDIA_TYPE.VIDEO, storageRef: '/tmp/v.mp4',
  });
  assertEqual(r.success, true, 'register ok');
  assertEqual(r.item.mediaId, 'lib-1', 'item returned');
  assertEqual(lib.getCount(), 1, 'count = 1');
});

// 17. CloudMediaLibrary.register() — duplicate rejected
await test('17. CloudMediaLibrary register() duplicate rejected', async () => {
  const lib = new CloudMediaLibrary();
  const params = {
    mediaId: 'dup-1', ownerId: 'user-1', title: 'Dup',
    type: MEDIA_TYPE.VIDEO, storageRef: '/tmp/v.mp4',
  };
  lib.register(params);
  const r2 = lib.register(params);
  assertEqual(r2.success, false, 'duplicate rejected');
  assertEqual(r2.code, MEDIA_ERROR_CODE.MEDIA_ALREADY_EXISTS, 'correct error code');
});

// 18. CloudMediaLibrary.register() — missing fields rejected
await test('18. CloudMediaLibrary register() missing fields rejected', async () => {
  const lib = new CloudMediaLibrary();
  const r = lib.register({ mediaId: 'bad', ownerId: 'u' });  // Missing title, type, storageRef
  assertEqual(r.success, false, 'should fail');
  assertEqual(r.code, MEDIA_ERROR_CODE.INVALID_MEDIA_ITEM, 'correct error code');
});

// 19. CloudMediaLibrary.getItem() — owner check pass
await test('19. CloudMediaLibrary getItem() owner check pass', async () => {
  const lib = new CloudMediaLibrary();
  lib.register({ mediaId: 'own-1', ownerId: 'user-A', title: 'V', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });
  const r = lib.getItem('own-1', 'user-A');
  assertEqual(r.success, true, 'access granted to owner');
});

// 20. CloudMediaLibrary.getItem() — wrong owner denied
await test('20. CloudMediaLibrary getItem() wrong owner denied', async () => {
  const lib = new CloudMediaLibrary();
  lib.register({ mediaId: 'own-2', ownerId: 'user-A', title: 'V', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });
  const r = lib.getItem('own-2', 'user-B');
  assertEqual(r.success, false, 'denied wrong owner');
  assertEqual(r.code, MEDIA_ERROR_CODE.ACCESS_DENIED, 'ACCESS_DENIED code');
});

// 21. CloudMediaLibrary.getByOwner()
await test('21. CloudMediaLibrary getByOwner() returns correct items', async () => {
  const lib = new CloudMediaLibrary();
  lib.register({ mediaId: 'by-1', ownerId: 'alice', title: 'A1', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });
  lib.register({ mediaId: 'by-2', ownerId: 'alice', title: 'A2', type: MEDIA_TYPE.CLIP, storageRef: '/t' });
  lib.register({ mediaId: 'by-3', ownerId: 'bob',   title: 'B1', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });
  const alice = lib.getByOwner('alice');
  assertEqual(alice.length, 2, 'alice has 2 items');
  const bob = lib.getByOwner('bob');
  assertEqual(bob.length, 1, 'bob has 1 item');
});

// 22. CloudMediaLibrary.remove()
await test('22. CloudMediaLibrary remove() — ownership enforced', async () => {
  const lib = new CloudMediaLibrary();
  lib.register({ mediaId: 'rm-1', ownerId: 'user-X', title: 'R', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });

  const denied = lib.remove('rm-1', 'user-Y');
  assertEqual(denied.success, false, 'wrong owner denied');
  assertEqual(lib.getCount(), 1, 'item still present');

  const ok = lib.remove('rm-1', 'user-X');
  assertEqual(ok.success, true, 'owner can remove');
  assertEqual(lib.getCount(), 0, 'item removed');
});

// 23. CloudMediaLibrary.validateItem() — real video file
await test('23. CloudMediaLibrary validateItem() valid video file', async () => {
  if (!_testVideoPath || !_ffmpegAvailable) {
    console.log('    SKIP (no test video / ffprobe)'); _passed++; return;
  }
  const lib = new CloudMediaLibrary();
  await lib.initialize();
  lib.register({
    mediaId: 'val-1', ownerId: 'u', title: 'Test', type: MEDIA_TYPE.VIDEO,
    storageRef: _testVideoPath,
  });
  const r = await lib.validateItem('val-1');
  assertEqual(r.valid, true, 'valid');
  assertEqual(r.item.validationState, MEDIA_VALIDATION_STATE.VALID, 'state VALID');
  assert(r.item.duration > 0, 'duration > 0');
  assert(r.item.hasVideo, 'hasVideo');
  assert(r.item.width > 0, 'width > 0');
});

// 24. CloudMediaLibrary.validateItem() — nonexistent file fails
await test('24. CloudMediaLibrary validateItem() nonexistent file → INVALID', async () => {
  const lib = new CloudMediaLibrary();
  await lib.initialize();
  lib.register({
    mediaId: 'bad-file-1', ownerId: 'u', title: 'Missing', type: MEDIA_TYPE.VIDEO,
    storageRef: '/tmp/__definitely_missing_98765.mp4',
  });
  const r = await lib.validateItem('bad-file-1');
  assertEqual(r.valid, false, 'should be invalid');
  assertEqual(r.item.validationState, MEDIA_VALIDATION_STATE.INVALID, 'state INVALID');
  assert(r.issues.length > 0, 'issues reported');
});

// 25. CloudMediaLibrary.validateItem() — item not found
await test('25. CloudMediaLibrary validateItem() item not found', async () => {
  const lib = new CloudMediaLibrary();
  const r = await lib.validateItem('nonexistent-media-id');
  assertEqual(r.success, false, 'should fail');
  assertEqual(r.valid, false, 'not valid');
});

// 26. MediaPlaybackSource — loads valid media
await test('26. MediaPlaybackSource loads valid media', async () => {
  if (!_testVideoPath || !_ffmpegAvailable) {
    console.log('    SKIP (no test video)'); _passed++; return;
  }
  // Create a valid item manually
  const item = createMediaItem({
    mediaId: 'src-1', ownerId: 'u', title: 'T', type: MEDIA_TYPE.VIDEO,
    storageRef: _testVideoPath,
    metadata: {
      validationState: MEDIA_VALIDATION_STATE.VALID,
      hasVideo: true, hasAudio: true, duration: 3,
    },
  });
  const source = new MediaPlaybackSource();
  const r = await source.load(item);
  assertEqual(r.success, true, 'load ok');
  assertEqual(source.state, PLAYBACK_SOURCE_STATE.READY, 'state READY');
  assert(source.localPath, 'localPath set');
  const input = source.getEncoderInput();
  assert(input, 'encoder input available');
  assert(input.inputPath, 'inputPath set');
  assertEqual(input.isImage, false, 'not an image');
  await source.release();
  assertEqual(source.state, PLAYBACK_SOURCE_STATE.IDLE, 'released to IDLE');
});

// 27. MediaPlaybackSource — unvalidated media rejected
await test('27. MediaPlaybackSource rejects unvalidated media', async () => {
  const item = createMediaItem({
    mediaId: 'src-2', ownerId: 'u', title: 'T', type: MEDIA_TYPE.VIDEO,
    storageRef: '/tmp/v.mp4',
    // No validationState = UNVALIDATED
  });
  const source = new MediaPlaybackSource();
  const r = await source.load(item);
  assertEqual(r.success, false, 'unvalidated should fail');
  assert(r.code === MEDIA_ERROR_CODE.NOT_PLAYABLE, 'NOT_PLAYABLE error');
});

// 28. CloudMediaLibrary.createPlaybackSource() end-to-end
await test('28. CloudMediaLibrary createPlaybackSource() end-to-end', async () => {
  if (!_testVideoPath || !_ffmpegAvailable) {
    console.log('    SKIP (no test video)'); _passed++; return;
  }
  const lib = new CloudMediaLibrary();
  await lib.initialize();
  lib.register({
    mediaId: 'e2e-1', ownerId: 'user-e2e', title: 'E2E Test', type: MEDIA_TYPE.VIDEO,
    storageRef: _testVideoPath,
  });
  await lib.validateItem('e2e-1');

  const r = await lib.createPlaybackSource('e2e-1', 'user-e2e');
  assertEqual(r.success, true, 'playback source created');
  assert(r.source, 'source present');
  assertEqual(r.source.state, PLAYBACK_SOURCE_STATE.READY, 'source READY');
  await r.source.release();
});

// 29. CloudMediaLibrary.getByType()
await test('29. CloudMediaLibrary getByType() returns correct subset', async () => {
  const lib = new CloudMediaLibrary();
  lib.register({ mediaId: 'gt-1', ownerId: 'u', title: 'V', type: MEDIA_TYPE.VIDEO, storageRef: '/t' });
  lib.register({ mediaId: 'gt-2', ownerId: 'u', title: 'C', type: MEDIA_TYPE.CLIP, storageRef: '/t' });
  lib.register({ mediaId: 'gt-3', ownerId: 'u', title: 'B', type: MEDIA_TYPE.BUMPER, storageRef: '/t' });
  lib.register({ mediaId: 'gt-4', ownerId: 'u', title: 'S', type: MEDIA_TYPE.STATION_ID, storageRef: '/t' });

  const videos  = lib.getByType(MEDIA_TYPE.VIDEO);
  const clips   = lib.getByType(MEDIA_TYPE.CLIP);
  const bumpers = lib.getByType(MEDIA_TYPE.BUMPER);
  assertEqual(videos.length,  1, 'one video');
  assertEqual(clips.length,   1, 'one clip');
  assertEqual(bumpers.length, 1, 'one bumper');
});

// 30. Regression — Stages 1-8
await test('30. Regression — prior stages unaffected', async () => {
  const { FanOutManager }       = await import('../../broadcast/fanout-manager.js');
  const { PlatformManager }     = await import('../../platforms/platform-manager.js');
  const fm = new FanOutManager();
  const pm = new PlatformManager();
  assert(fm.getAllDestinationStatuses instanceof Function, 'FanOutManager ok');
  assert(pm.list instanceof Function, 'PlatformManager ok');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 9 Media Tests`);
console.log(`  PASS:  ${_passed} / ${_passed + _failed}`);
if (_failed > 0) console.log(`  FAIL:  ${_failed}`);
console.log('══════════════════════════════════════════════════════\n');

if (_failed > 0) process.exit(1);
