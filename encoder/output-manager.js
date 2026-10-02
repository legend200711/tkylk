/**
 * 24-HOUR CLOUD ENGINE — Output Manager
 * cloud-engine/encoder/output-manager.js
 *
 * Manages output file paths for Shadow Encoder.
 *
 * Responsibilities:
 *   - Generating safe, unique output paths inside the approved output directory
 *   - Validating that paths do not escape the allowed directory (path traversal prevention)
 *   - Never overwriting source media
 *   - Cleaning up temporary output files on demand
 *
 * Default output root: <OS temp dir>/cloud-engine-output/
 * Can be overridden via CloudEngineConfig encoder.outputDir.
 *
 * SECURITY: Paths are canonicalised and checked against the allowed root.
 *
 * Stage 2 — Shadow Encoder
 */

import fs   from 'fs/promises';
import os   from 'os';
import path from 'path';

import { EncoderError, ENCODER_ERROR_CODE } from './encoder-errors.js';

/* ═══════════════════════════════════
   DEFAULTS
═══════════════════════════════════ */

const DEFAULT_OUTPUT_ROOT = path.join(os.tmpdir(), 'cloud-engine-output');

/* ═══════════════════════════════════
   OUTPUT MANAGER
═══════════════════════════════════ */

export class OutputManager {
  /**
   * @param {object} [opts]
   * @param {string} [opts.outputRoot]  Base directory for encoder output.
   */
  constructor({ outputRoot = DEFAULT_OUTPUT_ROOT } = {}) {
    // Resolve once at construction time
    this._outputRoot = path.resolve(outputRoot);
  }

  /**
   * Initialise: ensure the output directory exists.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      await fs.mkdir(this._outputRoot, { recursive: true });
    } catch (err) {
      throw new EncoderError(
        ENCODER_ERROR_CODE.OUTPUT_FAILED,
        `Failed to create output directory "${this._outputRoot}": ${err.message}`,
      );
    }
  }

  /**
   * Build a unique output file path for a job.
   *
   * @param {object} opts
   * @param {string}  opts.jobId          Unique job identifier.
   * @param {string}  opts.fileExtension  e.g. '.flv'
   * @returns {string} Absolute, safe output path.
   */
  buildOutputPath({ jobId, fileExtension }) {
    // Sanitise jobId: allow alphanumeric, hyphens, underscores only
    const safeJobId = jobId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename  = `${safeJobId}_${timestamp}${fileExtension}`;
    const outPath   = path.join(this._outputRoot, filename);

    // Canonicalize and verify the output stays inside the output root
    const resolved  = path.resolve(outPath);
    this._assertSafe(resolved);

    return resolved;
  }

  /**
   * Verify that a file path is inside the allowed output root.
   * Throws EncoderError if path traversal is detected.
   *
   * @param {string} filePath  Resolved absolute path.
   */
  assertPathAllowed(filePath) {
    this._assertSafe(path.resolve(filePath));
  }

  /**
   * Delete an output file if it exists.
   * Only files inside the output root can be deleted.
   *
   * @param {string} filePath
   * @returns {Promise<boolean>} true if deleted, false if did not exist.
   */
  async deleteOutput(filePath) {
    const resolved = path.resolve(filePath);
    this._assertSafe(resolved);
    try {
      await fs.unlink(resolved);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * Get stats for an output file.
   * Returns null if the file does not exist.
   *
   * @param {string} filePath
   * @returns {Promise<{ size: number }|null>}
   */
  async statOutput(filePath) {
    const resolved = path.resolve(filePath);
    this._assertSafe(resolved);
    try {
      const stat = await fs.stat(resolved);
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  /**
   * Return the configured output root directory.
   * @returns {string}
   */
  get outputRoot() { return this._outputRoot; }

  /* ── Private ─────────────────────────────────────────────────────── */

  _assertSafe(resolvedPath) {
    if (!resolvedPath.startsWith(this._outputRoot + path.sep) &&
        resolvedPath !== this._outputRoot) {
      throw new EncoderError(
        ENCODER_ERROR_CODE.PATH_TRAVERSAL_DENIED,
        `Path traversal denied: "${resolvedPath}" is outside allowed output directory.`,
        { allowed: this._outputRoot },
      );
    }
  }
}

/** Default singleton instance */
export const defaultOutputManager = new OutputManager();
