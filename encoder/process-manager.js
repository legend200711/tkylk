/**
 * 24-HOUR CLOUD ENGINE — Process Manager
 * cloud-engine/encoder/process-manager.js
 *
 * Manages the FFmpeg child process lifecycle for Shadow Encoder.
 *
 * Responsibilities:
 *   - Spawning the FFmpeg child process
 *   - Capturing stdout/stderr without buffering full media into RAM
 *   - Detecting normal completion vs crashes
 *   - Clean termination (SIGTERM → SIGKILL fallback)
 *   - Preventing orphan processes
 *   - Preventing duplicate encoder instances for the same output
 *   - Emitting process lifecycle events to callers
 *
 * SECURITY:
 *   - All FFmpeg invocations use spawn() with argument arrays, never shell: true
 *   - File paths are validated by OutputManager before reaching here
 *
 * Stage 2 — Shadow Encoder
 */

import { spawn }      from 'child_process';
import EventEmitter   from 'events';

import { EncoderError, ENCODER_ERROR_CODE } from './encoder-errors.js';

/* ═══════════════════════════════════
   PROCESS STATES
═══════════════════════════════════ */
export const PROCESS_STATE = Object.freeze({
  IDLE:        'IDLE',
  STARTING:    'STARTING',
  RUNNING:     'RUNNING',
  STOPPING:    'STOPPING',
  STOPPED:     'STOPPED',
  CRASHED:     'CRASHED',
  COMPLETED:   'COMPLETED',
});

/* ═══════════════════════════════════
   PROCESS EVENTS
═══════════════════════════════════ */
export const PROCESS_EVENT = Object.freeze({
  STARTED:       'process:started',
  STDERR_LINE:   'process:stderr_line',  // progress/stats lines
  COMPLETED:     'process:completed',    // normal exit code 0
  CRASHED:       'process:crashed',      // exit code ≠ 0 or unexpected signal
  STOPPED:       'process:stopped',      // clean stop requested by caller
  ERROR:         'process:error',        // spawn error (e.g. binary not found)
});

/* ═══════════════════════════════════
   PROCESS MANAGER CLASS
═══════════════════════════════════ */

/**
 * Manages a single FFmpeg encoding child process.
 *
 * Usage:
 *   const pm = new ProcessManager({ ffmpegPath, args });
 *   pm.on(PROCESS_EVENT.STDERR_LINE, (line) => parseProgress(line));
 *   pm.on(PROCESS_EVENT.COMPLETED, () => onComplete());
 *   pm.on(PROCESS_EVENT.CRASHED, ({ exitCode, signal }) => onCrash());
 *   await pm.start();
 *   …
 *   await pm.stop();
 */
export class ProcessManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.ffmpegPath  Absolute path to ffmpeg binary.
   * @param {string[]} opts.args        Argument array (pre-validated, safe).
   * @param {string}   [opts.jobId]     Optional identifier for logging.
   */
  constructor({ ffmpegPath, args, jobId = 'encoder' }) {
    super();
    this._ffmpegPath = ffmpegPath;
    this._args       = args;
    this._jobId      = jobId;

    this._process    = null;
    this._state      = PROCESS_STATE.IDLE;
    this._pid        = null;
    this._exitCode   = null;
    this._signal     = null;
    this._startedAt  = null;
    this._stoppedAt  = null;
    this._stderrBuf  = '';       // partial-line buffer for stderr
  }

  /* ── Getters ──────────────────────────────────────────────────────── */

  get state()     { return this._state; }
  get pid()       { return this._pid; }
  get exitCode()  { return this._exitCode; }
  get startedAt() { return this._startedAt; }

  /** Uptime in seconds since process was spawned, or null. */
  get uptimeSec() {
    if (!this._startedAt) return null;
    return (Date.now() - this._startedAt) / 1000;
  }

  /* ── Start ────────────────────────────────────────────────────────── */

  /**
   * Spawn the FFmpeg process.
   * @returns {Promise<void>} Resolves when the process has started.
   * @throws {EncoderError} if already running or spawn fails.
   */
  start() {
    if (this._state !== PROCESS_STATE.IDLE && this._state !== PROCESS_STATE.STOPPED &&
        this._state !== PROCESS_STATE.COMPLETED && this._state !== PROCESS_STATE.CRASHED) {
      throw new EncoderError(
        ENCODER_ERROR_CODE.INVALID_STATE,
        `ProcessManager: cannot start in state "${this._state}"`,
      );
    }

    return new Promise((resolve, reject) => {
      this._state = PROCESS_STATE.STARTING;

      // SECURITY: spawn with shell:false (default). Args are an array.
      let proc;
      try {
        proc = spawn(this._ffmpegPath, this._args, {
          stdio:       ['pipe', 'pipe', 'pipe'],
          shell:       false,
          windowsHide: true,
        });
      } catch (spawnErr) {
        this._state = PROCESS_STATE.CRASHED;
        const err = new EncoderError(
          ENCODER_ERROR_CODE.ENCODER_START_FAILED,
          `Failed to spawn ffmpeg: ${spawnErr.message}`,
        );
        this.emit(PROCESS_EVENT.ERROR, err);
        return reject(err);
      }

      this._process   = proc;
      this._pid       = proc.pid;
      this._startedAt = Date.now();
      this._state     = PROCESS_STATE.RUNNING;

      // ── Wire up event handlers ──────────────────────────────────
      proc.on('error', (err) => {
        this._state = PROCESS_STATE.CRASHED;
        const encoderErr = new EncoderError(
          ENCODER_ERROR_CODE.ENCODER_START_FAILED,
          `FFmpeg process error: ${err.message}`,
        );
        this.emit(PROCESS_EVENT.ERROR, encoderErr);
      });

      proc.on('close', (code, signal) => {
        this._exitCode  = code;
        this._signal    = signal;
        this._stoppedAt = Date.now();

        if (this._state === PROCESS_STATE.STOPPING) {
          // Requested stop
          this._state = PROCESS_STATE.STOPPED;
          this.emit(PROCESS_EVENT.STOPPED, { exitCode: code, signal });
        } else if (code === 0) {
          // Normal completion
          this._state = PROCESS_STATE.COMPLETED;
          this.emit(PROCESS_EVENT.COMPLETED, { exitCode: 0 });
        } else {
          // Unexpected exit
          this._state = PROCESS_STATE.CRASHED;
          this.emit(PROCESS_EVENT.CRASHED, {
            exitCode: code,
            signal,
            stderr: this._stderrBuf,
          });
        }
      });

      // ── Capture stderr (progress output) ───────────────────────
      // FFmpeg writes progress key=value pairs to stderr.
      // We parse lines without buffering the entire output in RAM.
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => {
        this._stderrBuf += chunk;
        // Emit complete lines only
        let nl;
        while ((nl = this._stderrBuf.indexOf('\n')) !== -1) {
          const line = this._stderrBuf.slice(0, nl).trim();
          this._stderrBuf = this._stderrBuf.slice(nl + 1);
          if (line) this.emit(PROCESS_EVENT.STDERR_LINE, line);
        }
      });

      // ── Ignore stdout (not used in encode mode) ─────────────────
      proc.stdout.resume();

      // ── Resolve as soon as PID is assigned ─────────────────────
      this.emit(PROCESS_EVENT.STARTED, { pid: proc.pid });
      resolve();
    });
  }

  /* ── Stop ─────────────────────────────────────────────────────────── */

  /**
   * Gracefully stop the FFmpeg process.
   * Sends 'q' to stdin (FFmpeg quit signal), then SIGTERM, then SIGKILL.
   *
   * @param {object} [opts]
   * @param {number} [opts.gracefulMs=5000]  Time to wait for graceful quit.
   * @param {number} [opts.termMs=3000]      Time to wait after SIGTERM before SIGKILL.
   * @returns {Promise<void>}
   */
  async stop({ gracefulMs = 5000, termMs = 3000 } = {}) {
    if (this._state !== PROCESS_STATE.RUNNING) {
      // Already stopped/completed/crashed — nothing to do
      return;
    }

    this._state = PROCESS_STATE.STOPPING;

    if (!this._process) return;

    // ── 1. Send 'q' to stdin (FFmpeg graceful quit) ─────────────
    try {
      this._process.stdin.write('q');
      this._process.stdin.end();
    } catch {
      // stdin may already be closed
    }

    // ── 2. Wait for graceful exit ────────────────────────────────
    const gracefulExited = await this._waitForClose(gracefulMs);
    if (gracefulExited) return;

    // ── 3. Send SIGTERM ──────────────────────────────────────────
    try { this._process.kill('SIGTERM'); } catch { /* already gone */ }
    const termExited = await this._waitForClose(termMs);
    if (termExited) return;

    // ── 4. SIGKILL — last resort ─────────────────────────────────
    try { this._process.kill('SIGKILL'); } catch { /* already gone */ }
  }

  /**
   * Wait up to `timeoutMs` milliseconds for the process to emit 'close'.
   * @param {number} timeoutMs
   * @returns {Promise<boolean>} true if closed within timeout
   */
  _waitForClose(timeoutMs) {
    if (!this._process) return Promise.resolve(true);
    if (this._state === PROCESS_STATE.STOPPED ||
        this._state === PROCESS_STATE.COMPLETED ||
        this._state === PROCESS_STATE.CRASHED) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      this._process.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
