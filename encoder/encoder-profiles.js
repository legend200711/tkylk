/**
 * 24-HOUR CLOUD ENGINE — Encoder Profiles
 * cloud-engine/encoder/encoder-profiles.js
 *
 * Named broadcast output profiles.
 * All codec parameters live here — never scattered through encoder logic.
 *
 * The "youtube_1080p30" profile name describes the output characteristics
 * only; it does NOT mean Stage 2 connects to YouTube.
 *
 * Stage 2 — Shadow Encoder
 */

/* ═══════════════════════════════════
   PROFILE SHAPE DOCUMENTATION
═══════════════════════════════════ */
/**
 * @typedef {object} EncoderProfile
 * @property {string}   id                  Unique profile identifier
 * @property {string}   description         Human-readable description
 *
 * @property {number}   video.width         Output width in pixels
 * @property {number}   video.height        Output height in pixels
 * @property {number}   video.frameRate     Target frames per second
 * @property {string}   video.codec         FFmpeg codec name (e.g. 'libx264')
 * @property {string}   video.codecLabel    Human-readable codec name (e.g. 'H.264')
 * @property {number}   video.bitrate       Target bitrate in kbps
 * @property {number}   video.maxBitrate    Maximum bitrate in kbps (VBV ceil)
 * @property {number}   video.bufsize       VBV buffer size in kbps
 * @property {string}   video.preset        libx264 encoding speed preset
 * @property {string}   video.profile       H.264 profile (high|main|baseline)
 * @property {number}   video.level         H.264 level (e.g. 4.2)
 * @property {number}   video.keyframeInterval  IDR keyframe interval in seconds
 * @property {string}   video.pixelFormat   FFmpeg pixel format (e.g. 'yuv420p')
 *
 * @property {string}   audio.codec         FFmpeg codec name (e.g. 'aac')
 * @property {string}   audio.codecLabel    Human-readable codec name
 * @property {number}   audio.bitrate       Target bitrate in kbps
 * @property {number}   audio.sampleRate    Sample rate in Hz
 * @property {number}   audio.channels      Channel count
 *
 * @property {string}   container           FFmpeg format/muxer (e.g. 'flv', 'mp4')
 * @property {string}   fileExtension       Output file extension (e.g. '.flv')
 */

/* ═══════════════════════════════════
   DEFINED PROFILES
═══════════════════════════════════ */

/**
 * Primary broadcast profile: 1080p30 H.264/AAC in FLV container.
 *
 * FLV is the natural container for the RTMP/RTMPS pipeline (Stage 3+).
 * The output produced here is broadcast-ready and can be piped to RTMP
 * without re-encoding when the Broadcast Engine is implemented.
 */
const YOUTUBE_1080P30 = Object.freeze({
  id:          'youtube_1080p30',
  description: 'HD 1080p 30fps H.264/AAC — broadcast-ready profile (FLV)',

  video: Object.freeze({
    width:             1920,
    height:            1080,
    frameRate:         30,
    codec:             'libx264',
    codecLabel:        'H.264',
    bitrate:           4500,          // kbps
    maxBitrate:        5000,          // kbps (YouTube limit for 1080p)
    bufsize:           9000,          // kbps (2× maxBitrate — VBV buffer)
    preset:            'medium',      // speed/quality tradeoff
    profile:           'high',        // H.264 high profile
    level:             '4.2',         // H.264 level 4.2 — compatible with most decoders
    keyframeInterval:  2,             // seconds — for broadcast seekability
    pixelFormat:       'yuv420p',     // universal decoder compatibility
  }),

  audio: Object.freeze({
    codec:       'aac',
    codecLabel:  'AAC',
    bitrate:     192,                 // kbps — stereo AAC at 192kbps
    sampleRate:  48000,               // Hz — broadcast standard
    channels:    2,                   // stereo
  }),

  container:     'flv',
  fileExtension: '.flv',
});

/**
 * Live broadcast profile: 1080p30 H.264/AAC — optimised for real-time encoding.
 *
 * Key differences from YOUTUBE_1080P30:
 *   - preset: 'veryfast' instead of 'medium' — significantly faster encoding,
 *     necessary to maintain ≥1.0× realtime speed for live broadcast.
 *   - Slightly lower video bufsize to reduce latency in the RTMP pipeline.
 *
 * DO NOT use this profile for archival encoding where quality is paramount.
 * Use YOUTUBE_1080P30 for offline test encoding, YOUTUBE_LIVE_1080P30 for live output.
 */
const YOUTUBE_LIVE_1080P30 = Object.freeze({
  id:          'youtube_live_1080p30',
  description: 'HD 1080p 30fps H.264/AAC — live broadcast profile (veryfast preset)',

  video: Object.freeze({
    width:             1920,
    height:            1080,
    frameRate:         30,
    codec:             'libx264',
    codecLabel:        'H.264',
    bitrate:           4500,          // kbps
    maxBitrate:        5000,          // kbps
    bufsize:           6000,          // kbps (reduced for live — lower latency)
    preset:            'veryfast',    // realtime-capable — maintains ≥1.0× speed
    profile:           'high',
    level:             '4.2',
    keyframeInterval:  2,             // seconds
    pixelFormat:       'yuv420p',
  }),

  audio: Object.freeze({
    codec:       'aac',
    codecLabel:  'AAC',
    bitrate:     192,                 // kbps
    sampleRate:  48000,               // Hz
    channels:    2,
  }),

  container:     'flv',
  fileExtension: '.flv',

  // Marker so callers can distinguish live profiles from archive profiles
  liveProfile: true,
});

/* ═══════════════════════════════════
   PROFILE REGISTRY
═══════════════════════════════════ */

const _profiles = new Map([
  [YOUTUBE_1080P30.id,      YOUTUBE_1080P30],
  [YOUTUBE_LIVE_1080P30.id, YOUTUBE_LIVE_1080P30],
]);

/**
 * Retrieve a profile by id.
 * @param {string} profileId
 * @returns {EncoderProfile}
 * @throws {Error} if not found
 */
export function getProfile(profileId) {
  const profile = _profiles.get(profileId);
  if (!profile) {
    throw new Error(
      `Unknown encoder profile: "${profileId}". Available: ${[..._profiles.keys()].join(', ')}`,
    );
  }
  return profile;
}

/**
 * Return all registered profiles.
 * @returns {EncoderProfile[]}
 */
export function listProfiles() {
  return [..._profiles.values()];
}

/**
 * The default profile used when none is specified.
 * Stage 2/3: uses medium preset for local test encoding.
 */
export const DEFAULT_PROFILE_ID = YOUTUBE_1080P30.id;

/**
 * The default live broadcast profile (veryfast preset for realtime).
 * Stage 3: use this profile when encoding for live RTMP output.
 */
export const LIVE_PROFILE_ID = YOUTUBE_LIVE_1080P30.id;

export { YOUTUBE_1080P30, YOUTUBE_LIVE_1080P30 };
