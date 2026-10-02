/**
 * 24-HOUR CLOUD ENGINE — Media Metadata
 * cloud-engine/media/media-metadata.js
 *
 * Utilities for building, parsing, and summarizing media metadata.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

/* ═══════════════════════════════════
   SUPPORTED FORMATS
═══════════════════════════════════ */
export const SUPPORTED_VIDEO_CONTAINERS = Object.freeze([
  'mp4', 'mov', 'mkv', 'flv', 'avi', 'webm', 'ts', 'm4v',
]);

export const SUPPORTED_VIDEO_CODECS = Object.freeze([
  'h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4',
]);

export const SUPPORTED_AUDIO_CODECS = Object.freeze([
  'aac', 'mp3', 'opus', 'vorbis', 'ac3', 'eac3', 'pcm_s16le',
]);

export const SUPPORTED_IMAGE_EXTENSIONS = Object.freeze([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
]);

export const SUPPORTED_AUDIO_CONTAINERS = Object.freeze([
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac',
]);

/* ═══════════════════════════════════
   MIME TYPE HELPERS
═══════════════════════════════════ */
const _MIME_MAP = {
  mp4:  'video/mp4',
  mov:  'video/quicktime',
  mkv:  'video/x-matroska',
  flv:  'video/x-flv',
  avi:  'video/avi',
  webm: 'video/webm',
  ts:   'video/mp2t',
  mp3:  'audio/mpeg',
  m4a:  'audio/mp4',
  aac:  'audio/aac',
  wav:  'audio/wav',
  ogg:  'audio/ogg',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
};

/**
 * Infer MIME type from file extension.
 * @param {string} filePath
 * @returns {string|null}
 */
export function inferMimeType(filePath) {
  if (!filePath) return null;
  const ext = filePath.toLowerCase().split('.').pop();
  return _MIME_MAP[ext] ?? null;
}

/**
 * Detect media category from extension.
 * @param {string} filePath
 * @returns {'video'|'audio'|'image'|'unknown'}
 */
export function detectMediaCategory(filePath) {
  if (!filePath) return 'unknown';
  const ext = filePath.toLowerCase().split('.').pop();
  if (SUPPORTED_VIDEO_CONTAINERS.includes(ext)) return 'video';
  if (SUPPORTED_AUDIO_CONTAINERS.includes(ext)) return 'audio';
  if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'unknown';
}

/**
 * Build metadata from a probe result (MediaInfo from media-probe.js).
 * @param {object} probeResult   MediaInfo object from probeMedia()
 * @param {object} [extra]       Extra fields to merge
 * @returns {object}
 */
export function buildMetadataFromProbe(probeResult, extra = {}) {
  return {
    duration:    probeResult.duration    ?? null,
    fileSize:    probeResult.fileSize    ?? null,
    mimeType:    probeResult.mimeType    ?? inferMimeType(probeResult.filePath),
    container:   probeResult.formatName  ?? probeResult.container ?? null,
    videoCodec:  probeResult.videoCodec  ?? null,
    audioCodec:  probeResult.audioCodec  ?? null,
    width:       probeResult.width       ?? null,
    height:      probeResult.height      ?? null,
    fps:         probeResult.frameRate   ?? null,
    sampleRate:  probeResult.sampleRate  ?? null,
    hasVideo:    probeResult.hasVideo    ?? false,
    hasAudio:    probeResult.hasAudio    ?? false,
    ...extra,
  };
}

/**
 * Build a human-readable summary of media metadata.
 * Safe for logs and UI (no secrets).
 *
 * @param {object} metadata
 * @returns {string}
 */
export function summarizeMetadata(metadata) {
  const parts = [];
  if (metadata.hasVideo) {
    const res = (metadata.width && metadata.height)
      ? `${metadata.width}×${metadata.height}` : 'unknown resolution';
    const fps = metadata.fps ? `@${metadata.fps.toFixed(1)}fps` : '';
    parts.push(`video:${metadata.videoCodec ?? 'unknown'} ${res}${fps}`);
  }
  if (metadata.hasAudio) {
    parts.push(`audio:${metadata.audioCodec ?? 'unknown'}`);
  }
  if (metadata.duration) {
    parts.push(`${metadata.duration.toFixed(1)}s`);
  }
  if (metadata.fileSize) {
    const mb = (metadata.fileSize / (1024 * 1024)).toFixed(1);
    parts.push(`${mb}MB`);
  }
  return parts.join(' | ') || 'no metadata';
}
