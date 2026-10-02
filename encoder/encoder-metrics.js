/**
 * 24-HOUR CLOUD ENGINE — Encoder Metrics
 * cloud-engine/encoder/encoder-metrics.js
 *
 * Parses real-time metrics from FFmpeg's progress output (stderr)
 * and maintains a live metrics snapshot for Shadow Encoder.
 *
 * FFmpeg writes key=value pairs to stderr when invoked with:
 *   -progress pipe:2 -stats_period 1
 *
 * Metrics are real — never fabricated.
 * Fields that cannot be determined return null.
 *
 * Stage 2 — Shadow Encoder
 */

/* ═══════════════════════════════════
   METRICS SHAPE
═══════════════════════════════════ */

/**
 * Create an empty metrics object.
 * All fields that haven't been measured yet are null.
 *
 * @param {object} [initial] Optional preset values.
 * @returns {EncoderMetrics}
 */
export function createMetrics(initial = {}) {
  return {
    // Lifecycle
    state:              initial.state         ?? null,  // ENCODER_STATE.*
    currentMedia:       initial.currentMedia  ?? null,  // filename or path

    // Timing
    position:           null,   // seconds into the media (from FFmpeg out_time_us)
    duration:           initial.duration    ?? null,   // total media duration in seconds
    progress:           null,   // 0.0–1.0 (position / duration)

    // Frame metrics
    fps:                null,   // current encoding fps (from FFmpeg fps= field)
    targetFps:          initial.targetFps  ?? null,    // profile target fps
    encodedFrames:      null,   // total frames encoded (frame= field)
    droppedFrames:      null,   // duplicate_count / drop_frames fields when available
    speed:              null,   // processing speed ratio (speed= field, e.g. 1.23)

    // Bitrate / size
    videoBitrate:       null,   // kbps (video:bitrate from progress)
    audioBitrate:       null,   // kbps (audio:bitrate from progress)
    outputSize:         null,   // bytes (total_size field from ffmpeg progress)

    // Timing quality (for watchdog — Stage 3)
    timingStatus:       null,   // 'NORMAL' | 'BEHIND' | 'STALLED' | null

    // Error
    lastError:          null,   // last EncoderError object or null

    // Process
    processUptime:      null,   // seconds since ffmpeg started
    elapsedMs:          null,   // ms since encoding started

    // Start time (ISO)
    startedAt:          initial.startedAt ?? null,

    ...initial,
  };
}

/* ═══════════════════════════════════
   PROGRESS PARSER
═══════════════════════════════════ */

/**
 * Parse a key=value pair from FFmpeg's progress output.
 * FFmpeg writes groups of key=value lines, terminated by a "progress=…" marker.
 *
 * Returns null for unrecognised lines.
 *
 * @param {string} line  A single stderr line.
 * @returns {{ key: string, value: string }|null}
 */
export function parseProgressLine(line) {
  const eq = line.indexOf('=');
  if (eq === -1) return null;
  return {
    key:   line.slice(0, eq).trim(),
    value: line.slice(eq + 1).trim(),
  };
}

/**
 * Apply a single progress key=value to a metrics snapshot.
 * Returns the same object (mutated in place for efficiency — metrics are replaced per-read).
 *
 * FFmpeg progress keys used:
 *   frame          total frames encoded
 *   fps            current encoding FPS
 *   bitrate        overall bitrate (kbits/s)
 *   total_size     output bytes written
 *   out_time_us    output timestamp in microseconds
 *   speed          processing speed (e.g. "1.23x")
 *   dup_frames     duplicate frames inserted
 *   drop_frames    frames dropped
 *   progress       'continue' | 'end' — signals a complete metrics frame
 *
 * @param {object} metrics  Current metrics object (will be mutated).
 * @param {string} key
 * @param {string} value
 * @returns {boolean} true if this was the 'progress=end' terminator.
 */
export function applyProgressField(metrics, key, value) {
  switch (key) {
    case 'frame': {
      const n = parseInt(value, 10);
      if (!isNaN(n)) metrics.encodedFrames = n;
      break;
    }
    case 'fps': {
      const n = parseFloat(value);
      if (!isNaN(n) && n >= 0) metrics.fps = n;
      break;
    }
    case 'bitrate': {
      // Value is like "4563.2kbits/s" or "N/A"
      if (value !== 'N/A') {
        const match = value.match(/^([\d.]+)/);
        if (match) metrics.videoBitrate = parseFloat(match[1]);
      }
      break;
    }
    case 'total_size': {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n >= 0) metrics.outputSize = n;
      break;
    }
    case 'out_time_us': {
      // microseconds
      const us = parseInt(value, 10);
      if (!isNaN(us) && us >= 0) {
        metrics.position = us / 1_000_000;
        if (metrics.duration && metrics.duration > 0) {
          metrics.progress = Math.min(1, metrics.position / metrics.duration);
        }
      }
      break;
    }
    case 'speed': {
      // "1.23x" or "N/A"
      if (value !== 'N/A') {
        const n = parseFloat(value);
        if (!isNaN(n)) metrics.speed = n;
      }
      break;
    }
    case 'dup_frames': {
      const n = parseInt(value, 10);
      if (!isNaN(n)) metrics.droppedFrames = (metrics.droppedFrames ?? 0) + n;
      break;
    }
    case 'drop_frames': {
      const n = parseInt(value, 10);
      if (!isNaN(n)) metrics.droppedFrames = (metrics.droppedFrames ?? 0) + n;
      break;
    }
    case 'progress': {
      // 'end' means final progress report (file complete)
      return value === 'end';
    }
  }
  return false;
}

/* ═══════════════════════════════════
   TIMING STATUS ASSESSMENT
═══════════════════════════════════ */

/**
 * Assess the timing status based on encoding speed.
 *
 * speed ≥ 0.98  → NORMAL  (keeping up with real-time)
 * speed ≥ 0.5   → BEHIND  (falling behind)
 * speed < 0.5   → STALLED (severely behind or halted)
 * null          → unknown
 *
 * The Stage 3 watchdog will consume this field.
 *
 * @param {number|null} speed  Processing speed ratio from FFmpeg.
 * @returns {'NORMAL'|'BEHIND'|'STALLED'|null}
 */
export function assessTimingStatus(speed) {
  if (speed === null || speed === undefined) return null;
  if (speed >= 0.98)  return 'NORMAL';
  if (speed >= 0.50)  return 'BEHIND';
  return 'STALLED';
}
