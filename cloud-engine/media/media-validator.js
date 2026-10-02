/**
 * 24-HOUR CLOUD ENGINE — Media Validator
 * cloud-engine/media/media-validator.js
 *
 * Validates media items before they are used in broadcast.
 *
 * Validation checks:
 *   1. Storage reference is present
 *   2. File path is accessible (if local file)
 *   3. File exists on disk
 *   4. Format is supported
 *   5. Media can be probed by ffprobe
 *   6. Video/audio streams are present (as required)
 *   7. Duration is > 0
 *   8. Media is not corrupted
 *
 * For IMAGE type: special handling — validates it is a readable image.
 * For AUDIO type: video stream is not required.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import fs   from 'fs/promises';
import path from 'path';

import { CloudEngineLogger }                              from '../logs/logger.js';
import { probeMedia }                                     from '../encoder/media-probe.js';
import { detectCodecEngine }                              from '../encoder/codec-adapter.js';
import { MEDIA_ERROR_CODE, MediaError,
         MEDIA_TYPE, MEDIA_VALIDATION_STATE }             from './media-errors.js';
import { SUPPORTED_VIDEO_CONTAINERS, SUPPORTED_AUDIO_CONTAINERS,
         SUPPORTED_IMAGE_EXTENSIONS,
         detectMediaCategory, buildMetadataFromProbe }    from './media-metadata.js';
import { updateMediaItem }                                from './media-item.js';

const MODULE = 'media/media-validator';

/* ═══════════════════════════════════
   VALIDATOR
═══════════════════════════════════ */

/**
 * Validate a MediaItem whose storageRef is a local file path.
 *
 * Returns an updated MediaItem with validationState set to VALID or INVALID,
 * and populated metadata if probing succeeded.
 *
 * @param {MediaItem}  item        The media item to validate
 * @param {string}     [ffprobePath]  Path to ffprobe binary (auto-detected if omitted)
 * @returns {Promise<{ item: MediaItem, valid: boolean, issues: string[] }>}
 */
export async function validateMediaItem(item, ffprobePath) {
  const issues = [];

  // ── 0. Basic shape ────────────────────────────────────────
  if (!item.storageRef) {
    issues.push('storageRef is missing');
    return _invalid(item, issues, MEDIA_ERROR_CODE.INVALID_MEDIA_ITEM);
  }

  // ── 1. Detect ffprobe if not provided ─────────────────────
  let probe = ffprobePath;
  if (!probe) {
    const codec = await detectCodecEngine().catch(() => null);
    probe = codec?.ffprobePath ?? null;
  }

  // ── 2. File existence (for local storage refs) ────────────
  const localPath = item.storageRef;
  try {
    const stat = await fs.stat(localPath);
    if (stat.size === 0) {
      issues.push('File is empty (0 bytes)');
      return _invalid(item, issues, MEDIA_ERROR_CODE.CORRUPTED_MEDIA);
    }
  } catch {
    issues.push(`File not found at storageRef: ${localPath}`);
    return _invalid(item, issues, MEDIA_ERROR_CODE.FILE_NOT_FOUND);
  }

  // ── 3. Format support check ───────────────────────────────
  const category = detectMediaCategory(localPath);
  const ext = localPath.toLowerCase().split('.').pop();

  if (category === 'unknown') {
    issues.push(`Unsupported file format: ".${ext}"`);
    return _invalid(item, issues, MEDIA_ERROR_CODE.FORMAT_UNSUPPORTED);
  }

  // ── 4. Image handling ──────────────────────────────────────
  if (category === 'image' || item.type === MEDIA_TYPE.IMAGE) {
    if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
      issues.push(`Unsupported image format: ".${ext}"`);
      return _invalid(item, issues, MEDIA_ERROR_CODE.FORMAT_UNSUPPORTED);
    }
    // Images are valid as static media items; conversion to timed video source
    // happens at playback time (MediaPlaybackSource).
    const stat = await fs.stat(localPath);
    const updated = updateMediaItem(item, {
      fileSize:        stat.size,
      hasVideo:        false,
      hasAudio:        false,
      validationState: MEDIA_VALIDATION_STATE.VALID,
      validatedAt:     new Date().toISOString(),
    });
    return { item: updated, valid: true, issues: [] };
  }

  // ── 5. Audio-only handling ────────────────────────────────
  if (category === 'audio' || item.type === MEDIA_TYPE.AUDIO) {
    if (!probe) {
      issues.push('ffprobe not available — cannot probe audio file');
      return _invalid(item, issues, MEDIA_ERROR_CODE.PROBE_FAILED);
    }
    const probeResult = await _probe(localPath, probe, issues);
    if (!probeResult) return _invalid(item, issues, MEDIA_ERROR_CODE.PROBE_FAILED);
    if (!probeResult.hasAudio) {
      issues.push('No audio stream found');
      return _invalid(item, issues, MEDIA_ERROR_CODE.NO_AUDIO_STREAM);
    }
    if (!probeResult.duration || probeResult.duration <= 0) {
      issues.push('Duration is zero or unavailable');
      return _invalid(item, issues, MEDIA_ERROR_CODE.ZERO_DURATION);
    }
    const metadata = buildMetadataFromProbe(probeResult);
    const updated  = updateMediaItem(item, {
      ...metadata,
      validationState: MEDIA_VALIDATION_STATE.VALID,
      validatedAt:     new Date().toISOString(),
    });
    return { item: updated, valid: true, issues: [] };
  }

  // ── 6. Video / Program / Clip / Bumper / etc. ─────────────
  if (!probe) {
    issues.push('ffprobe not available — cannot probe video file');
    return _invalid(item, issues, MEDIA_ERROR_CODE.PROBE_FAILED);
  }

  const probeResult = await _probe(localPath, probe, issues);
  if (!probeResult) return _invalid(item, issues, MEDIA_ERROR_CODE.PROBE_FAILED);

  if (!probeResult.hasVideo) {
    issues.push('No video stream found');
    return _invalid(item, issues, MEDIA_ERROR_CODE.NO_VIDEO_STREAM);
  }

  if (!probeResult.duration || probeResult.duration <= 0) {
    issues.push('Duration is zero or unavailable');
    return _invalid(item, issues, MEDIA_ERROR_CODE.ZERO_DURATION);
  }

  const metadata = buildMetadataFromProbe(probeResult);
  const updated  = updateMediaItem(item, {
    ...metadata,
    validationState: MEDIA_VALIDATION_STATE.VALID,
    validatedAt:     new Date().toISOString(),
  });

  CloudEngineLogger.info(MODULE, 'MEDIA_VALID',
    `[${item.mediaId}] Validation passed. ` +
    `${metadata.width}×${metadata.height} ${metadata.videoCodec} ` +
    `${metadata.duration?.toFixed(1)}s`);

  return { item: updated, valid: true, issues: [] };
}

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */

async function _probe(localPath, probePath, issues) {
  try {
    return await probeMedia(localPath, probePath);
  } catch (err) {
    issues.push(`Probe failed: ${err.message}`);
    CloudEngineLogger.warn(MODULE, 'PROBE_FAILED',
      `Failed to probe "${localPath}": ${err.message}`);
    return null;
  }
}

function _invalid(item, issues, code) {
  const updated = updateMediaItem(item, {
    validationState: MEDIA_VALIDATION_STATE.INVALID,
    validationError: { code, issues },
    validatedAt:     new Date().toISOString(),
  });
  CloudEngineLogger.warn(MODULE, 'MEDIA_INVALID',
    `[${item.mediaId}] Validation failed: ${issues.join('; ')}`);
  return { item: updated, valid: false, issues };
}
