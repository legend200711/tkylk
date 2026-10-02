/**
 * 24-HOUR CLOUD ENGINE — RTMP/RTMPS Transport
 * cloud-engine/broadcast/rtmp-transport.js
 *
 * Low-level RTMP/RTMPS transmission using FFmpeg as the transport engine.
 *
 * Responsibilities:
 *   - Spawning an FFmpeg process that reads a local FLV file (or pipe) and
 *     pushes it to an RTMP/RTMPS endpoint.
 *   - Capturing FFmpeg stderr for progress/error reporting.
 *   - Clean termination (SIGTERM → SIGKILL fallback).
 *   - Detecting normal completion vs unexpected crash.
 *   - Exposing process lifecycle events to the Broadcast Engine.
 *
 * ARCHITECTURE SEPARATION:
 *   Shadow Encoder:   encodes media → local FLV output
 *   RTMP Transport:   reads encoded FLV → pushes to RTMP endpoint
 *
 *   For live broadcast the output of encoding can feed directly into
 *   the transport without a permanent intermediate file.
 *
 * SECURITY:
 *   - spawn() is used with shell:false — no shell injection possible.
 *   - The full publish URL (containing the stream key) is passed as an
 *     argument array element, NOT concatenated into a shell command.
 *   - The URL is NEVER logged — only a sanitised version is used in logs.
 *
 * Stage 3 — Shadow Broadcast Engine
 */

import { spawn }    from 'child_process';
import EventEmitter from 'events';

import { BroadcastError, BROADCAST_ERROR_CODE } from './broadcast-errors.js';
import { CloudEngineLogger }                    from '../logs/logger.js';

const MODULE = 'broadcast/rtmp-transport';

/* ═══════════════════════════════════
   TRANSPORT STATES
═══════════════════════════════════ */
export const TRANSPORT_STATE = Object.freeze({
  IDLE:        'IDLE',
  STARTING:    'STARTING',
  RUNNING:     'RUNNING',
  STOPPING:    'STOPPING',
  STOPPED:     'STOPPED',
  CRASHED:     'CRASHED',
  COMPLETED:   'COMPLETED',
});

/* ═══════════════════════════════════
   TRANSPORT EVENTS
═══════════════════════════════════ */
export const TRANSPORT_EVENT = Object.freeze({
  STARTED:       'transport:started',
  STDERR_LINE:   'transport:stderr_line',
  COMPLETED:     'transport:completed',    // clean exit (0)
  CRASHED:       'transport:crashed',      // unexpected exit
  STOPPED:       'transport:stopped',      // requested stop
  ERROR:         'transport:error',        // spawn failure
  CONNECTED:     'transport:connected',    // FFmpeg confirmed RTMP handshake
  BYTES_SENT:    'transport:bytes_sent',   // periodic byte count
});

/* ═══════════════════════════════════
   SAFE URL — STRIP STREAM KEY FOR LOGS
═══════════════════════════════════ */

/**
 * Return a log-safe version of an RTMP URL, masking the stream key portion.
 * Input:  rtmps://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx
 * Output: rtmps://a.rtmp.youtube.com/live2/********
 *
 * @param {string} url  Full RTMP publish URL (contains stream key).
 * @returns {string}    Redacted URL safe to log.
 */
export function redactRtmpUrl(url) {
  if (!url) return '[no url]';
  // Everything after the last '/' is treated as the stream key
  const lastSlash = url.lastIndexOf('/');
  if (lastSlash === -1) return '********';
  return url.slice(0, lastSlash + 1) + '********';
}

/* ═══════════════════════════════════
   BUILD BROADCAST ARGS
═══════════════════════════════════ */

/**
 * Build FFmpeg argument array for broadcasting a local FLV file to RTMP/RTMPS.
 *
 * The input can be:
 *   - A local FLV file path     (mode: 'file')
 *   - A stdin pipe              (mode: 'pipe', inputPath: 'pipe:0')
 *
 * The output is the RTMP/RTMPS publish URL. This URL contains the stream key
 * and is treated as a SECRET — it must NEVER be logged by the caller.
 *
 * @param {object} opts
 * @param {string}  opts.inputPath     Path to local FLV file, or 'pipe:0' for stdin.
 * @param {string}  opts.publishUrl    Full RTMP/RTMPS publish URL (secret — do not log).
 * @param {string}  opts.protocol      'RTMP' | 'RTMPS'
 * @param {boolean} [opts.reEncode]    If true, re-encode (use when input is not broadcast-ready).
 *                                     Default false — copy streams without re-encoding.
 * @returns {string[]} FFmpeg argument array (safe to pass to spawn).
 */
export function buildBroadcastArgs({ inputPath, publishUrl, protocol, reEncode = false }) {
  const args = [
    '-re',          // Read input in realtime (important for live broadcast)
    '-i', inputPath,
  ];

  if (reEncode) {
    // Re-encode path — only used if the encoder output is not broadcast-compatible
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',  // fast for live
      '-c:a', 'aac',
    );
  } else {
    // Copy streams — encoder has already produced broadcast-ready H.264/AAC
    args.push(
      '-c', 'copy',
    );
  }

  args.push(
    // Do not display the banner (reduces noise in stderr)
    '-hide_banner',
    '-loglevel', 'warning',     // show warnings and errors only (suppress verbose info)

    // Progress reporting to stderr
    '-progress', 'pipe:2',
    '-stats_period', '2',       // every 2 seconds (reduced for transport mode)

    // Output format
    '-f', 'flv',

    // Output URL — THIS IS A SECRET — must be the last arg
    publishUrl,
  );

  return args;
}

/* ═══════════════════════════════════
   RTMP TRANSPORT CLASS
═══════════════════════════════════ */

/**
 * Manages a single FFmpeg broadcast process.
 *
 * The caller must pass the full publish URL (containing the stream key) at start time.
 * The transport treats it as an opaque secret and does not log it.
 *
 * Usage:
 *   const transport = new RtmpTransport({ ffmpegPath, inputPath, publishUrl, protocol });
 *   transport.on(TRANSPORT_EVENT.CONNECTED, () => console.log('Live!'));
 *   transport.on(TRANSPORT_EVENT.CRASHED,   ({ exitCode }) => handleCrash());
 *   await transport.start();
 *   …
 *   await transport.stop();
 */
export class RtmpTransport extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.ffmpegPath  Absolute path to ffmpeg binary.
   * @param {string}  opts.inputPath   Path to the FLV source file, or 'pipe:0'.
   * @param {string}  opts.publishUrl  Full RTMP/RTMPS publish URL (SECRET — never log this).
   * @param {string}  opts.protocol    'RTMP' | 'RTMPS'
   * @param {string}  [opts.jobId]     Optional identifier for logs.
   * @param {boolean} [opts.reEncode]  If true, re-encode instead of stream copy.
   */
  constructor({ ffmpegPath, inputPath, publishUrl, protocol, jobId = 'broadcast', reEncode = false }) {
    super();
    this._ffmpegPath  = ffmpegPath;
    this._inputPath   = inputPath;
    this._publishUrl  = publishUrl;   // SECRET — stored only in memory, never logged
    this._protocol    = protocol;
    this._jobId       = jobId;
    this._reEncode    = reEncode;

    this._process     = null;
    this._state       = TRANSPORT_STATE.IDLE;
    this._pid         = null;
    this._exitCode    = null;
    this._signal      = null;
    this._startedAt   = null;
    this._stoppedAt   = null;
    this._stderrBuf   = '';
    this._bytesSent   = 0;
    this._connectedAt = null;
  }

  /* ── Getters ──────────────────────────────────────────────────────── */

  get state()       { return this._state; }
  get pid()         { return this._pid; }
  get exitCode()    { return this._exitCode; }
  get startedAt()   { return this._startedAt; }
  get connectedAt() { return this._connectedAt; }
  get bytesSent()   { return this._bytesSent; }

  /** Uptime in seconds, or null. */
  get uptimeSec() {
    if (!this._startedAt) return null;
    return (Date.now() - this._startedAt) / 1000;
  }

  /** Safe log representation of the destination (stream key masked). */
  get safeDestinationUrl() {
    return redactRtmpUrl(this._publishUrl);
  }

  /* ── Start ────────────────────────────────────────────────────────── */

  /**
   * Spawn the FFmpeg broadcast process.
   * @returns {Promise<void>} Resolves when the process has started.
   * @throws {BroadcastError}
   */
  start() {
    if (this._state !== TRANSPORT_STATE.IDLE    &&
        this._state !== TRANSPORT_STATE.STOPPED  &&
        this._state !== TRANSPORT_STATE.COMPLETED &&
        this._state !== TRANSPORT_STATE.CRASHED) {
      throw new BroadcastError(
        BROADCAST_ERROR_CODE.INVALID_STATE,
        `RtmpTransport: cannot start in state "${this._state}"`,
      );
    }

    return new Promise((resolve, reject) => {
      this._state = TRANSPORT_STATE.STARTING;

      const args = buildBroadcastArgs({
        inputPath:  this._inputPath,
        publishUrl: this._publishUrl,  // SECRET — passed as argument, never in a shell string
        protocol:   this._protocol,
        reEncode:   this._reEncode,
      });

      // SECURITY: spawn with shell:false — no shell injection possible.
      // The publishUrl (stream key) is an array element, NOT concatenated.
      let proc;
      try {
        proc = spawn(this._ffmpegPath, args, {
          stdio:       ['ignore', 'ignore', 'pipe'],  // ignore stdin/stdout, capture stderr
          shell:       false,
          windowsHide: true,
        });
      } catch (spawnErr) {
        this._state = TRANSPORT_STATE.CRASHED;
        const err = new BroadcastError(
          BROADCAST_ERROR_CODE.BROADCAST_START_FAILED,
          `Failed to spawn ffmpeg for broadcast: ${spawnErr.message}`,
        );
        this.emit(TRANSPORT_EVENT.ERROR, err);
        return reject(err);
      }

      this._process   = proc;
      this._pid       = proc.pid;
      this._startedAt = Date.now();
      this._state     = TRANSPORT_STATE.RUNNING;

      // ── Wire up event handlers ──────────────────────────────────
      proc.on('error', (err) => {
        this._state = TRANSPORT_STATE.CRASHED;
        const broadcastErr = new BroadcastError(
          BROADCAST_ERROR_CODE.BROADCAST_START_FAILED,
          `FFmpeg broadcast process error: ${err.message}`,
        );
        this.emit(TRANSPORT_EVENT.ERROR, broadcastErr);
      });

      proc.on('close', (code, signal) => {
        this._exitCode  = code;
        this._signal    = signal;
        this._stoppedAt = Date.now();

        if (this._state === TRANSPORT_STATE.STOPPING) {
          this._state = TRANSPORT_STATE.STOPPED;
          this.emit(TRANSPORT_EVENT.STOPPED, { exitCode: code, signal });
        } else if (code === 0) {
          this._state = TRANSPORT_STATE.COMPLETED;
          this.emit(TRANSPORT_EVENT.COMPLETED, { exitCode: 0 });
        } else {
          this._state = TRANSPORT_STATE.CRASHED;
          this.emit(TRANSPORT_EVENT.CRASHED, {
            exitCode: code,
            signal,
            // Include last stderr line for diagnostics — but NOT the stream key
            stderr: this._lastSafeLine,
          });
        }
      });

      // ── Capture stderr ──────────────────────────────────────────
      // FFmpeg writes warnings, errors, and progress to stderr.
      // SECURITY: We scan each line for the stream key before emitting.
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => {
        this._stderrBuf += chunk;
        let nl;
        while ((nl = this._stderrBuf.indexOf('\n')) !== -1) {
          const line = this._stderrBuf.slice(0, nl).trim();
          this._stderrBuf = this._stderrBuf.slice(nl + 1);
          if (line) {
            this._processStderrLine(line);
          }
        }
      });

      // ── Detect connection ───────────────────────────────────────
      // FFmpeg prints something like "Output #0, flv, to 'rtmps://…'"
      // or "application connect" when the RTMP handshake succeeds.
      // We detect this to emit CONNECTED.
      proc.on('spawn', () => {
        // After spawn, set a brief timer — if still running, presume connected
        // (FFmpeg doesn't have a single clean "connected" message for RTMP)
        setTimeout(() => {
          if (this._state === TRANSPORT_STATE.RUNNING && !this._connectedAt) {
            this._connectedAt = Date.now();
            this.emit(TRANSPORT_EVENT.CONNECTED, {
              connectedAt: new Date(this._connectedAt).toISOString(),
            });
          }
        }, 2000);
      });

      // Emit started with PID
      this.emit(TRANSPORT_EVENT.STARTED, { pid: proc.pid });
      resolve();
    });
  }

  /* ── Stop ─────────────────────────────────────────────────────────── */

  /**
   * Gracefully stop the broadcast FFmpeg process.
   * Sends SIGTERM, then SIGKILL if necessary.
   *
   * @param {object}  [opts]
   * @param {number}  [opts.termMs=5000]    Time to wait after SIGTERM before SIGKILL.
   * @returns {Promise<void>}
   */
  async stop({ termMs = 5000 } = {}) {
    if (this._state !== TRANSPORT_STATE.RUNNING) {
      return;
    }

    this._state = TRANSPORT_STATE.STOPPING;

    if (!this._process) return;

    // ── 1. Send SIGTERM ─────────────────────────────────────────
    try { this._process.kill('SIGTERM'); } catch { /* already gone */ }

    const terminated = await this._waitForClose(termMs);
    if (terminated) return;

    // ── 2. SIGKILL fallback ─────────────────────────────────────
    try { this._process.kill('SIGKILL'); } catch { /* already gone */ }
  }

  /* ── Helpers ──────────────────────────────────────────────────────── */

  /**
   * Process a single stderr line from FFmpeg.
   * SECURITY: Replaces any occurrence of the stream key with ********.
   * The stream key may appear in error messages that include the URL.
   *
   * @param {string} line
   */
  _processStderrLine(line) {
    // Redact the stream key before any further processing
    const safeLine = this._redactLine(line);
    this._lastSafeLine = safeLine;

    // Parse byte count from progress output
    if (line.startsWith('total_size=')) {
      const n = parseInt(line.slice('total_size='.length), 10);
      if (!isNaN(n) && n > 0) {
        this._bytesSent = n;
        this.emit(TRANSPORT_EVENT.BYTES_SENT, { bytesSent: n });
      }
    }

    this.emit(TRANSPORT_EVENT.STDERR_LINE, safeLine);
  }

  /**
   * Replace the stream key in a log line with ********.
   * Extracts the key from the publish URL and replaces occurrences in the line.
   *
   * @param {string} line
   * @returns {string} Line with stream key replaced by ********.
   */
  _redactLine(line) {
    if (!this._publishUrl || !line) return line;
    const lastSlash = this._publishUrl.lastIndexOf('/');
    if (lastSlash === -1) return line;
    const streamKey = this._publishUrl.slice(lastSlash + 1);
    if (!streamKey) return line;
    // Replace all occurrences of the stream key
    return line.split(streamKey).join('********');
  }

  /**
   * Wait up to timeoutMs for the process to close.
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  _waitForClose(timeoutMs) {
    if (!this._process) return Promise.resolve(true);
    if (this._state === TRANSPORT_STATE.STOPPED  ||
        this._state === TRANSPORT_STATE.COMPLETED ||
        this._state === TRANSPORT_STATE.CRASHED) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this._process.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
