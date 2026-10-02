/**
 * 24-HOUR CLOUD ENGINE — Test Media Generator
 * cloud-engine/encoder/test-utils/generate-test-media.js
 *
 * Generates a small synthetic video+audio test file using FFmpeg.
 * No copyrighted media required.
 *
 * Produces:
 *   - A 5-second SMPTE colour-bars test pattern with 1kHz sine tone
 *   - Stored as an MP4 (H.264 + AAC) in the OS temp directory
 *
 * Usage (script):
 *   node cloud-engine/encoder/test-utils/generate-test-media.js
 *
 * Usage (programmatic):
 *   import { generateTestMedia } from './test-utils/generate-test-media.js';
 *   const { outputPath } = await generateTestMedia(ffmpegPath);
 *
 * Stage 2 — Shadow Encoder
 */

import { execFile }  from 'child_process';
import { promisify } from 'util';
import os            from 'os';
import path          from 'path';
import fs            from 'fs/promises';

const execFileAsync = promisify(execFile);

/**
 * Generate a synthetic test video file.
 *
 * @param {string} ffmpegPath  Absolute path to ffmpeg binary.
 * @param {object} [opts]
 * @param {string}  [opts.outputPath]  Override output file path.
 * @param {number}  [opts.durationSec] Duration in seconds (default: 5).
 * @param {number}  [opts.width]       Width  (default: 640).
 * @param {number}  [opts.height]      Height (default: 480).
 * @param {number}  [opts.fps]         Frame rate (default: 30).
 * @returns {Promise<{ outputPath: string, size: number }>}
 */
export async function generateTestMedia(ffmpegPath, opts = {}) {
  const {
    durationSec = 5,
    width       = 640,
    height      = 480,
    fps         = 30,
    outputPath  = path.join(os.tmpdir(), 'cloud-engine-test-media.mp4'),
  } = opts;

  const args = [
    '-y',

    // ── Video source: SMPTE colour bars ──────────────────────
    '-f',         'lavfi',
    '-i',         `smptebars=duration=${durationSec}:size=${width}x${height}:rate=${fps}`,

    // ── Audio source: 1kHz sine tone ─────────────────────────
    '-f',         'lavfi',
    '-i',         `sine=frequency=1000:duration=${durationSec}:sample_rate=48000`,

    // ── Video encode ─────────────────────────────────────────
    '-c:v',       'libx264',
    '-preset',    'ultrafast',   // fastest for test generation
    '-pix_fmt',   'yuv420p',

    // ── Audio encode ─────────────────────────────────────────
    '-c:a',       'aac',
    '-ar',        '48000',
    '-ac',        '2',

    '-t',         String(durationSec),

    '--',
    outputPath,
  ];

  await execFileAsync(ffmpegPath, args, { timeout: 30_000 });

  const stat = await fs.stat(outputPath);
  return { outputPath, size: stat.size };
}

/* ── CLI entry point ───────────────────────────────────────────────── */
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { detectCodecEngine } = await import('../codec-adapter.js');
  const codec = await detectCodecEngine();
  if (!codec.found) {
    console.error('FFmpeg not found. Install FFmpeg to generate test media.');
    process.exit(1);
  }

  console.log(`Generating test media with FFmpeg ${codec.ffmpegVersion}…`);
  const result = await generateTestMedia(codec.ffmpegPath);
  console.log(`Generated: ${result.outputPath} (${result.size} bytes)`);
}
