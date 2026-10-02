/**
 * 24-HOUR CLOUD ENGINE — Codec Adapter
 * cloud-engine/encoder/codec-adapter.js
 *
 * Abstracts all direct interaction with the underlying codec engine (FFmpeg).
 *
 * Responsibilities:
 *   - Locating ffmpeg and ffprobe binaries
 *   - Building safe argument arrays (NO shell command concatenation)
 *   - Translating EncoderProfile → FFmpeg argument lists
 *   - Building ffprobe probe arguments
 *
 * The rest of Shadow Encoder does NOT know about FFmpeg internals.
 * Replacing FFmpeg with a different codec engine only requires changing this file.
 *
 * SECURITY: All arguments are built as arrays passed to execFile / spawn.
 * Never concatenate user-supplied data into shell command strings.
 *
 * Stage 2 — Shadow Encoder
 */

import { execFile }  from 'child_process';
import { promisify } from 'util';
import path          from 'path';

import { EncoderError, ENCODER_ERROR_CODE } from './encoder-errors.js';

const execFileAsync = promisify(execFile);

/* ═══════════════════════════════════
   BINARY DISCOVERY
═══════════════════════════════════ */

/**
 * Locate an executable by name using `which`.
 * @param {string} name
 * @returns {Promise<string|null>} Absolute path or null if not found.
 */
async function _which(name) {
  try {
    const { stdout } = await execFileAsync('which', [name], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Result of codec engine detection.
 * @typedef {{ found: boolean, ffmpegPath: string|null, ffprobePath: string|null,
 *             ffmpegVersion: string|null, error: string|null }} CodecEngineInfo
 */

/**
 * Detect the FFmpeg codec engine.
 * Checks common locations and falls back to PATH resolution.
 *
 * @returns {Promise<CodecEngineInfo>}
 */
export async function detectCodecEngine() {
  const ffmpegPath  = await _which('ffmpeg');
  const ffprobePath = await _which('ffprobe');

  if (!ffmpegPath || !ffprobePath) {
    return {
      found:        false,
      ffmpegPath:   ffmpegPath,
      ffprobePath:  ffprobePath,
      ffmpegVersion: null,
      error:        'ffmpeg and/or ffprobe not found. Install FFmpeg to use Shadow Encoder.',
    };
  }

  // Probe version — FFmpeg writes version info to stdout for -version
  let ffmpegVersion = null;
  try {
    const { stdout, stderr } = await execFileAsync(ffmpegPath, ['-version'], { timeout: 5000 });
    const combined = stdout + stderr;
    const match = combined.match(/ffmpeg version ([^\s]+)/);
    ffmpegVersion = match ? match[1] : 'unknown';
  } catch {
    // Version detection failure is non-fatal
  }

  return {
    found:        true,
    ffmpegPath,
    ffprobePath,
    ffmpegVersion,
    error:        null,
  };
}

/* ═══════════════════════════════════
   PROBE ARGUMENTS
═══════════════════════════════════ */

/**
 * Build the ffprobe argument array for media inspection.
 * Output: JSON to stdout.
 *
 * @param {string} filePath  Absolute file path (validated before this call).
 * @returns {string[]}
 */
export function buildProbeArgs(filePath) {
  return [
    '-v',           'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '--',
    filePath,       // '--' ensures filePath is treated as a filename, not a flag
  ];
}

/* ═══════════════════════════════════
   ENCODE ARGUMENTS
═══════════════════════════════════ */

/**
 * Build the ffmpeg argument array for encoding a local file to a local output.
 *
 * Video pipeline:
 *   Scale the input to fit within the target width×height while preserving
 *   aspect ratio, then pad to exactly width×height (letterbox/pillarbox).
 *   This handles landscape, portrait, and square inputs correctly.
 *
 * Audio pipeline:
 *   Resample to target sample rate, mix to target channel count, encode AAC.
 *
 * @param {object} opts
 * @param {string}         opts.inputPath    Absolute path to the input file.
 * @param {string}         opts.outputPath   Absolute path to the output file.
 * @param {EncoderProfile} opts.profile      The active encoder profile.
 * @param {boolean}        [opts.overwrite]  Whether to overwrite existing output (default: true).
 * @returns {string[]}
 */
export function buildEncodeArgs({ inputPath, outputPath, profile, overwrite = true }) {
  const v = profile.video;
  const a = profile.audio;

  // ── Video filter: scale-to-fit + pad ─────────────────────────────────────
  // scale=w=W:h=H:force_original_aspect_ratio=decrease
  //   → scales down the longest dimension to fit inside W×H, preserving AR
  // pad=W:H:(ow-iw)/2:(oh-ih)/2:black
  //   → centres the scaled image in a W×H black frame
  // fps=FPS
  //   → ensures exactly the target frame rate (duplicates/drops frames as needed)
  // format=yuv420p
  //   → convert pixel format after scaling/padding
  const vf = [
    `scale=w=${v.width}:h=${v.height}:force_original_aspect_ratio=decrease`,
    `pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2:black`,
    `fps=${v.frameRate}`,
    `format=${v.pixelFormat}`,
  ].join(',');

  // ── Audio filter ──────────────────────────────────────────────────────────
  const af = [
    `aresample=${a.sampleRate}`,
    `aformat=sample_fmts=fltp:channel_layouts=stereo`,
  ].join(',');

  // ── Keyframe interval in frames ──────────────────────────────────────────
  const gopFrames = v.keyframeInterval * v.frameRate;  // e.g. 2 × 30 = 60

  const args = [
    // ── Overwrite flag ─────────────────────────────────────────────
    ...(overwrite ? ['-y'] : ['-n']),

    // ── Input ──────────────────────────────────────────────────────
    '-i', inputPath,

    // ── Video codec ────────────────────────────────────────────────
    '-c:v', v.codec,
    '-preset', v.preset,
    '-profile:v', v.profile,
    '-level:v', v.level,
    '-b:v', `${v.bitrate}k`,
    '-maxrate', `${v.maxBitrate}k`,
    '-bufsize', `${v.bufsize}k`,
    '-g', String(gopFrames),          // GOP size (keyframe interval in frames)
    '-keyint_min', String(gopFrames), // minimum keyframe interval
    '-sc_threshold', '0',             // disable scene-change keyframes for broadcast regularity

    // ── Video filter ───────────────────────────────────────────────
    '-vf', vf,

    // ── Audio codec ────────────────────────────────────────────────
    '-c:a', a.codec,
    '-b:a', `${a.bitrate}k`,
    '-ar', String(a.sampleRate),
    '-ac', String(a.channels),

    // ── Audio filter ───────────────────────────────────────────────
    '-af', af,

    // ── Progress / stats reporting (to stderr, parseable) ──────────
    '-progress', 'pipe:2',  // write progress key=value pairs to stderr
    '-stats_period', '1',   // report every 1 second

    // ── Output format ──────────────────────────────────────────────
    '-f', profile.container,

    // ── Output path ────────────────────────────────────────────────
    '--',
    outputPath,
  ];

  return args;
}

/* ═══════════════════════════════════
   VERIFY CODEC AVAILABILITY
═══════════════════════════════════ */

/**
 * Check that a specific FFmpeg codec name is available in the installed build.
 *
 * @param {string} ffmpegPath  Absolute path to ffmpeg binary.
 * @param {string} codecName   e.g. 'libx264', 'aac'
 * @returns {Promise<boolean>}
 */
export async function isCodecAvailable(ffmpegPath, codecName) {
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-codecs'], { timeout: 10_000 });
    return stdout.includes(codecName);
  } catch {
    return false;
  }
}

/**
 * Verify the complete codec requirements for a profile.
 *
 * @param {string}         ffmpegPath
 * @param {EncoderProfile} profile
 * @returns {Promise<{ ok: boolean, missing: string[] }>}
 */
export async function verifyProfileCodecs(ffmpegPath, profile) {
  const required = [profile.video.codec, profile.audio.codec];
  const missing  = [];

  for (const codec of required) {
    const available = await isCodecAvailable(ffmpegPath, codec);
    if (!available) missing.push(codec);
  }

  return { ok: missing.length === 0, missing };
}
