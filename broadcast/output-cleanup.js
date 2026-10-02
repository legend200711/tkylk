/**
 * 24-HOUR CLOUD ENGINE — Output Cleanup Manager
 * cloud-engine/broadcast/output-cleanup.js
 *
 * Manages cleanup of temporary encoder output files.
 *
 * Policies:
 *   DELETE_AFTER_SUCCESS  — Delete the temp file after it has been successfully broadcast.
 *   DELETE_AFTER_FAILURE  — Delete the temp file even if the broadcast failed.
 *   KEEP                  — Never delete (manual cleanup required).
 *
 * Maximum age and maximum storage policies are also supported.
 *
 * SECURITY:
 *   - Only files inside approved output directories can be deleted.
 *   - Source media files are NEVER deleted.
 *   - Path traversal is prevented via the OutputManager's assertPathAllowed().
 *
 * Stage 3 — Shadow Broadcast Engine
 */

import fs   from 'fs/promises';
import path from 'path';
import os   from 'os';

import { CloudEngineLogger }   from '../logs/logger.js';

const MODULE = 'broadcast/output-cleanup';

/* ═══════════════════════════════════
   CLEANUP POLICIES
═══════════════════════════════════ */
export const CLEANUP_POLICY = Object.freeze({
  DELETE_AFTER_SUCCESS:  'DELETE_AFTER_SUCCESS',
  DELETE_AFTER_FAILURE:  'DELETE_AFTER_FAILURE',
  KEEP:                  'KEEP',
});

/* ═══════════════════════════════════
   APPROVED OUTPUT DIRECTORIES
   Only files in these directories may be deleted.
   Source media directories are NEVER included here.
═══════════════════════════════════ */
const _APPROVED_OUTPUT_ROOTS = new Set([
  path.resolve(path.join(os.tmpdir(), 'cloud-engine-output')),
]);

/**
 * Register an additional approved output root.
 * Must be called from OutputManager.init() when using custom output directories.
 *
 * @param {string} absolutePath  Resolved absolute path to the approved directory.
 */
export function registerApprovedOutputRoot(absolutePath) {
  _APPROVED_OUTPUT_ROOTS.add(path.resolve(absolutePath));
}

/* ═══════════════════════════════════
   PATH SAFETY CHECK
═══════════════════════════════════ */

/**
 * Check that a path is inside an approved output directory.
 * Returns false (does NOT throw) so callers can decide how to handle it.
 *
 * @param {string} filePath  Absolute file path to check.
 * @returns {boolean}
 */
function _isApprovedPath(filePath) {
  const resolved = path.resolve(filePath);
  for (const root of _APPROVED_OUTPUT_ROOTS) {
    if (resolved.startsWith(root + path.sep) || resolved === root) {
      return true;
    }
  }
  return false;
}

/* ═══════════════════════════════════
   OUTPUT CLEANUP
═══════════════════════════════════ */

/**
 * Delete a temporary output file if the cleanup policy permits it.
 *
 * @param {object}  opts
 * @param {string}  opts.filePath       Absolute path to the file to delete.
 * @param {string}  opts.policy         One of CLEANUP_POLICY.*
 * @param {boolean} opts.broadcastSucceeded  Whether the broadcast succeeded.
 * @returns {Promise<{ deleted: boolean, reason: string }>}
 */
export async function cleanupOutput({ filePath, policy, broadcastSucceeded }) {
  if (!filePath) {
    return { deleted: false, reason: 'No file path provided.' };
  }

  // ── 1. Safety check: only approved directories ───────────────
  if (!_isApprovedPath(filePath)) {
    CloudEngineLogger.warn(MODULE, 'CLEANUP_DENIED',
      `Cleanup refused: "${path.basename(filePath)}" is not in an approved output directory.`);
    return { deleted: false, reason: 'Path not in approved output directory.' };
  }

  // ── 2. Policy check ──────────────────────────────────────────
  if (policy === CLEANUP_POLICY.KEEP) {
    return { deleted: false, reason: 'KEEP policy — file retained.' };
  }

  if (policy === CLEANUP_POLICY.DELETE_AFTER_SUCCESS && !broadcastSucceeded) {
    return { deleted: false, reason: 'DELETE_AFTER_SUCCESS — broadcast did not succeed, file retained.' };
  }

  // DELETE_AFTER_FAILURE or DELETE_AFTER_SUCCESS with success=true → delete
  try {
    await fs.unlink(filePath);
    CloudEngineLogger.info(MODULE, 'CLEANUP_DELETED',
      `Deleted temp output: ${path.basename(filePath)} (policy: ${policy})`);
    return { deleted: true, reason: `Deleted per policy: ${policy}` };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { deleted: false, reason: 'File already deleted or not found.' };
    }
    CloudEngineLogger.warn(MODULE, 'CLEANUP_FAILED',
      `Failed to delete "${path.basename(filePath)}": ${err.message}`);
    return { deleted: false, reason: `Delete failed: ${err.message}` };
  }
}

/**
 * Scan an approved output directory and delete files older than maxAgeMs.
 *
 * @param {object}  opts
 * @param {string}  opts.outputRoot  Absolute path to the output directory.
 * @param {number}  opts.maxAgeMs    Maximum file age in milliseconds.
 * @returns {Promise<{ deleted: number, skipped: number, errors: number }>}
 */
export async function cleanupOldOutputs({ outputRoot, maxAgeMs }) {
  if (!_isApprovedPath(outputRoot + path.sep + '_')) {
    // Register the root if needed (after resolving)
    const resolved = path.resolve(outputRoot);
    if (![..._APPROVED_OUTPUT_ROOTS].some(r => resolved.startsWith(r))) {
      CloudEngineLogger.warn(MODULE, 'CLEANUP_SCAN_DENIED',
        `Cleanup scan refused: "${outputRoot}" is not an approved root.`);
      return { deleted: 0, skipped: 0, errors: 0 };
    }
  }

  let deleted = 0, skipped = 0, errors = 0;
  const cutoff = Date.now() - maxAgeMs;

  let entries;
  try {
    entries = await fs.readdir(path.resolve(outputRoot));
  } catch {
    return { deleted: 0, skipped: 0, errors: 0 };
  }

  for (const entry of entries) {
    const fullPath = path.join(path.resolve(outputRoot), entry);
    if (!_isApprovedPath(fullPath)) { skipped++; continue; }

    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath);
        deleted++;
        CloudEngineLogger.debug(MODULE, 'CLEANUP_AGE_DELETED',
          `Age cleanup: deleted "${entry}" (age: ${Math.floor((Date.now() - stat.mtimeMs) / 1000)}s)`);
      } else {
        skipped++;
      }
    } catch {
      errors++;
    }
  }

  if (deleted > 0) {
    CloudEngineLogger.info(MODULE, 'CLEANUP_AGE_COMPLETE',
      `Age cleanup: ${deleted} deleted, ${skipped} skipped, ${errors} errors.`);
  }

  return { deleted, skipped, errors };
}
