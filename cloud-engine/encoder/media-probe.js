/**
 * 24-HOUR CLOUD ENGINE — Media Probe
 * cloud-engine/encoder/media-probe.js
 *
 * Inspects a local media file using ffprobe before encoding begins.
 * Populates a structured MediaInfo object with all available metadata.
 *
 * Invalid or unsupported media produces a controlled EncoderError.
 * One bad file must not crash the Cloud Engine.
 *
 * Stage 2 — Shadow Encoder
 */

import { execFile }  from 'child_process';
import { promisify } from 'util';
import fs            from 'fs/promises';
import path          from 'path';

import { EncoderError, ENCODER_ERROR_CODE } from './encoder-errors.js';
import { buildProbeArgs }                   from './codec-adapter.js';

const execFileAsync = promisify(execFile);

/* ═══════════════════════════════════
   MEDIA INFO SHAPE
═══════════════════════════════════ */

/**
 * Creates an empty MediaInfo object.
 * All fields that could not be determined are null.
 * @returns {MediaInfo}
 */
export function createMediaInfo() {
  return {
    // File
    filePath:      null,
    fileSize:      null,       // bytes

    // Container
    container:     null,       // e.g. 'mov,mp4,m4a,3gp,3g2,mj2'
    formatName:    null,       // e.g. 'mp4'
    duration:      null,       // seconds (float)
    bitrate:       null,       // bps (total container bitrate)

    // Video
    hasVideo:      false,
    videoCodec:    null,       // e.g. 'h264'
    videoCodecLong: null,      // e.g. 'H.264 / AVC / MPEG-4 AVC'
    width:         null,
    height:        null,
    frameRate:     null,       // float fps
    pixelFormat:   null,
    videoBitrate:  null,       // bps

    // Audio
    hasAudio:      false,
    audioCodec:    null,       // e.g. 'aac'
    audioCodecLong: null,
    sampleRate:    null,       // Hz
    channels:      null,       // count
    audioBitrate:  null,       // bps
    channelLayout: null,       // e.g. 'stereo'

    // Raw probe (for debugging; may be large, not included in state by default)
    _raw:          null,
  };
}

/* ═══════════════════════════════════
   INTERNAL HELPERS
═══════════════════════════════════ */

/**
 * Parse a fractional FPS string like "30000/1001" or "30" into a float.
 * @param {string|undefined} rateStr
 * @returns {number|null}
 */
function _parseFps(rateStr) {
  if (!rateStr) return null;
  if (rateStr.includes('/')) {
    const [num, den] = rateStr.split('/').map(Number);
    if (!den || den === 0) return null;
    const fps = num / den;
    // Round to 3 decimal places for readability
    return Math.round(fps * 1000) / 1000;
  }
  const n = parseFloat(rateStr);
  return isFinite(n) ? n : null;
}

/**
 * Extract and normalise fields from a raw ffprobe JSON result.
 * @param {object} raw
 * @param {string} filePath
 * @param {number} fileSize
 * @returns {MediaInfo}
 */
function _parseProbeResult(raw, filePath, fileSize) {
  const info  = createMediaInfo();
  info.filePath  = filePath;
  info.fileSize  = fileSize;
  info._raw      = raw;

  const fmt = raw.format ?? {};
  info.container  = fmt.format_name   ?? null;
  info.formatName = (fmt.format_name ?? '').split(',')[0] || null;
  info.duration   = fmt.duration  ? parseFloat(fmt.duration)  : null;
  info.bitrate    = fmt.bit_rate  ? parseInt(fmt.bit_rate, 10): null;

  for (const stream of (raw.streams ?? [])) {
    if (stream.codec_type === 'video' && !info.hasVideo) {
      info.hasVideo       = true;
      info.videoCodec     = stream.codec_name      ?? null;
      info.videoCodecLong = stream.codec_long_name  ?? null;
      info.width          = stream.width           ?? null;
      info.height         = stream.height          ?? null;
      info.frameRate      = _parseFps(stream.r_frame_rate) ??
                            _parseFps(stream.avg_frame_rate);
      info.pixelFormat    = stream.pix_fmt         ?? null;
      info.videoBitrate   = stream.bit_rate ? parseInt(stream.bit_rate, 10) : null;

      // Prefer stream duration if container doesn't have one
      if (!info.duration && stream.duration) {
        info.duration = parseFloat(stream.duration);
      }
    }

    if (stream.codec_type === 'audio' && !info.hasAudio) {
      info.hasAudio        = true;
      info.audioCodec      = stream.codec_name      ?? null;
      info.audioCodecLong  = stream.codec_long_name  ?? null;
      info.sampleRate      = stream.sample_rate ? parseInt(stream.sample_rate, 10) : null;
      info.channels        = stream.channels         ?? null;
      info.audioBitrate    = stream.bit_rate ? parseInt(stream.bit_rate, 10) : null;
      info.channelLayout   = stream.channel_layout   ?? null;
    }
  }

  return info;
}

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

/**
 * Probe a local media file and return a structured MediaInfo object.
 *
 * @param {string} filePath   Absolute path to the media file.
 * @param {string} probeBin   Path to the ffprobe binary.
 * @returns {Promise<MediaInfo>}
 * @throws {EncoderError} on file not found, unsupported media, or probe failure.
 */
export async function probeMedia(filePath, probeBin) {
  // ── 1. File existence ──────────────────────────────────
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new EncoderError(
        ENCODER_ERROR_CODE.MEDIA_NOT_FOUND,
        `Path is not a regular file: ${path.basename(filePath)}`,
      );
    }
    var fileSize = stat.size; // eslint-disable-line no-var
  } catch (err) {
    if (err instanceof EncoderError) throw err;
    throw new EncoderError(
      ENCODER_ERROR_CODE.MEDIA_NOT_FOUND,
      `Media file not found: ${path.basename(filePath)}`,
      { originalError: err.message },
    );
  }

  if (fileSize === 0) {
    throw new EncoderError(
      ENCODER_ERROR_CODE.MEDIA_UNSUPPORTED,
      'Media file is empty (0 bytes).',
    );
  }

  // ── 2. Run ffprobe ────────────────────────────────────
  const args = buildProbeArgs(filePath);
  let raw;
  try {
    const { stdout } = await execFileAsync(probeBin, args, {
      timeout:   30_000,
      maxBuffer: 4 * 1024 * 1024, // 4 MB — enough for any probe output
    });
    raw = JSON.parse(stdout);
  } catch (err) {
    throw new EncoderError(
      ENCODER_ERROR_CODE.MEDIA_PROBE_FAILED,
      `ffprobe failed on "${path.basename(filePath)}": ${err.message}`,
      { originalError: err.message },
    );
  }

  // ── 3. Validate probe result ──────────────────────────
  if (!raw || (!raw.streams?.length && !raw.format)) {
    throw new EncoderError(
      ENCODER_ERROR_CODE.MEDIA_UNSUPPORTED,
      `File does not appear to be a valid media file: ${path.basename(filePath)}`,
    );
  }

  const info = _parseProbeResult(raw, filePath, fileSize);

  // ── 4. Minimum requirements for Stage 2 ──────────────
  // Stage 2 requires at least a video stream.
  // Audio-only and image inputs are NOT_SUPPORTED in this stage.
  if (!info.hasVideo) {
    throw new EncoderError(
      ENCODER_ERROR_CODE.MEDIA_UNSUPPORTED,
      `No video stream found in "${path.basename(filePath)}". Stage 2 requires a video+audio input.`,
      { hasAudio: info.hasAudio },
    );
  }

  return info;
}
