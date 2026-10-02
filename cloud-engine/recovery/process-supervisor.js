/**
 * 24-HOUR CLOUD ENGINE — Process Supervisor
 * cloud-engine/recovery/process-supervisor.js
 *
 * Tracks child processes (FFmpeg/encoder) to prevent orphaned processes.
 * Provides safe process cleanup after crash or recovery.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { CloudEngineLogger } from '../logs/logger.js';

const MODULE = 'recovery/process-supervisor';

/* ═══════════════════════════════════
   PROCESS SUPERVISOR
═══════════════════════════════════ */
export class ProcessSupervisor {
  constructor() {
    this._processes = new Map();  // pid → { pid, label, registeredAt, exited }
  }

  /**
   * Register a process with the supervisor.
   * @param {number} pid
   * @param {string} label  Human-readable label (e.g., 'encoder', 'destination:youtube')
   */
  register(pid, label) {
    if (!pid || pid <= 0) return;
    this._processes.set(pid, {
      pid,
      label,
      registeredAt: new Date().toISOString(),
      exited:       false,
      exitedAt:     null,
    });
    CloudEngineLogger.debug(MODULE, 'PROCESS_REGISTERED',
      `Process registered: pid=${pid} label="${label}"`);
  }

  /**
   * Mark a process as exited.
   * @param {number} pid
   */
  markExited(pid) {
    const entry = this._processes.get(pid);
    if (entry) {
      entry.exited   = true;
      entry.exitedAt = new Date().toISOString();
      CloudEngineLogger.debug(MODULE, 'PROCESS_EXITED',
        `Process exited: pid=${pid} label="${entry.label}"`);
    }
  }

  /**
   * Unregister a process.
   * @param {number} pid
   */
  unregister(pid) {
    this._processes.delete(pid);
  }

  /**
   * Attempt to kill orphaned processes (registered but not exited).
   * Only sends SIGTERM — does NOT forcibly kill. This avoids killing
   * a legitimately running process due to stale registration.
   *
   * @returns {number[]} PIDs of processes signalled
   */
  cleanupOrphans() {
    const signalled = [];
    for (const [pid, entry] of this._processes.entries()) {
      if (!entry.exited) {
        try {
          process.kill(pid, 0);  // Check if process still exists
          // If we get here, it's alive — send SIGTERM
          process.kill(pid, 'SIGTERM');
          CloudEngineLogger.warn(MODULE, 'ORPHAN_KILLED',
            `Orphaned process terminated: pid=${pid} label="${entry.label}"`);
          signalled.push(pid);
        } catch (err) {
          // Process no longer exists — mark as exited
          this.markExited(pid);
        }
      }
    }
    return signalled;
  }

  /**
   * Check if a process is still alive (by PID).
   * @param {number} pid
   * @returns {boolean}
   */
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all tracked processes (safe snapshot).
   * @returns {object[]}
   */
  listProcesses() {
    return [...this._processes.values()].map(p => ({ ...p }));
  }

  /**
   * Get count of tracked processes by status.
   */
  getStats() {
    const all    = [...this._processes.values()];
    const active = all.filter(p => !p.exited).length;
    const exited = all.filter(p => p.exited).length;
    return { total: all.length, active, exited };
  }

  /**
   * Clear all exited entries (housekeeping).
   */
  pruneExited() {
    for (const [pid, entry] of this._processes.entries()) {
      if (entry.exited) this._processes.delete(pid);
    }
  }
}
