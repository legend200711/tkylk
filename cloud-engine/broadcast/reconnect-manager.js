/**
 * 24-HOUR CLOUD ENGINE — Reconnect Manager
 * cloud-engine/broadcast/reconnect-manager.js
 *
 * Manages automatic reconnect logic for the Shadow Broadcast Engine.
 *
 * Reconnect policy:
 *   - Configurable initial delay, maximum delay, maximum attempts, backoff multiplier.
 *   - Exponential backoff with jitter to avoid thundering-herd reconnects.
 *   - Hard limit on attempts to prevent infinite reconnect loops.
 *   - Manual reset when a successful connection is established.
 *
 * Stage 3 — Shadow Broadcast Engine
 */

import { CloudEngineLogger } from '../logs/logger.js';

const MODULE = 'broadcast/reconnect-manager';

/* ═══════════════════════════════════
   DEFAULT POLICY
═══════════════════════════════════ */
export const DEFAULT_RECONNECT_POLICY = Object.freeze({
  initialDelayMs:   2_000,    // 2 seconds before first reconnect attempt
  maxDelayMs:       60_000,   // cap at 60 seconds
  maxAttempts:      10,       // give up after 10 attempts
  backoffMultiplier: 2.0,     // double the delay each time
  jitterMs:         500,      // ±500ms random jitter
});

/* ═══════════════════════════════════
   RECONNECT MANAGER CLASS
═══════════════════════════════════ */

export class ReconnectManager {
  /**
   * @param {object} [policy]  Override any default policy fields.
   */
  constructor(policy = {}) {
    this._policy = Object.freeze({
      ...DEFAULT_RECONNECT_POLICY,
      ...policy,
    });

    this._attempts     = 0;
    this._lastAttemptAt = null;
    this._timer        = null;
    this._active       = false;
  }

  /** Number of reconnect attempts made in the current failure run. */
  get attempts() { return this._attempts; }

  /** Whether the reconnect manager is currently active (waiting or attempting). */
  get isActive() { return this._active; }

  /** Policy copy. */
  get policy() { return { ...this._policy }; }

  /**
   * Whether maximum attempts have been exhausted.
   * @returns {boolean}
   */
  get isExhausted() {
    return this._attempts >= this._policy.maxAttempts;
  }

  /**
   * Schedule the next reconnect attempt.
   * If the maximum attempts have been reached, calls onExhausted instead of onAttempt.
   *
   * @param {Function} onAttempt    Called when the delay expires — should trigger reconnect.
   * @param {Function} onExhausted  Called when max attempts exceeded.
   * @returns {{ attemptNumber: number, delayMs: number } | null}
   *          Returns null if already exhausted.
   */
  scheduleNext(onAttempt, onExhausted) {
    if (this.isExhausted) {
      CloudEngineLogger.warn(MODULE, 'RECONNECT_EXHAUSTED',
        `Reconnect exhausted after ${this._attempts} attempt(s). ` +
        `Max: ${this._policy.maxAttempts}.`);
      this._active = false;
      onExhausted?.();
      return null;
    }

    this._attempts++;
    this._active = true;

    const delayMs = this._computeDelay();
    this._lastAttemptAt = new Date().toISOString();

    CloudEngineLogger.info(MODULE, 'RECONNECT_SCHEDULED',
      `Reconnect attempt ${this._attempts}/${this._policy.maxAttempts} ` +
      `scheduled in ${(delayMs / 1000).toFixed(1)}s.`);

    this._timer = setTimeout(() => {
      this._timer = null;
      onAttempt?.();
    }, delayMs);

    return { attemptNumber: this._attempts, delayMs };
  }

  /**
   * Cancel any pending reconnect timer.
   * Call this when the connection is successfully established or when shutting down.
   */
  cancel() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._active = false;
  }

  /**
   * Reset the attempt counter.
   * Call this when a successful connection is established.
   */
  reset() {
    this.cancel();
    this._attempts      = 0;
    this._lastAttemptAt = null;
    this._active        = false;
  }

  /**
   * Get a status snapshot.
   * @returns {{ attempts: number, maxAttempts: number, isExhausted: boolean,
   *             isActive: boolean, lastAttemptAt: string|null }}
   */
  getStatus() {
    return {
      attempts:       this._attempts,
      maxAttempts:    this._policy.maxAttempts,
      isExhausted:    this.isExhausted,
      isActive:       this._active,
      lastAttemptAt:  this._lastAttemptAt,
    };
  }

  /* ── Private ─────────────────────────────────────────────────────── */

  /**
   * Compute the delay for the current attempt using exponential backoff with jitter.
   * @returns {number} Delay in milliseconds.
   */
  _computeDelay() {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterMs } = this._policy;

    // Exponential backoff: initial * multiplier^(attempts-1)
    const exponential = initialDelayMs * Math.pow(backoffMultiplier, this._attempts - 1);
    const capped      = Math.min(exponential, maxDelayMs);

    // Add random jitter to avoid synchronised reconnects
    const jitter = (Math.random() * 2 - 1) * jitterMs;  // ±jitterMs

    return Math.max(0, Math.round(capped + jitter));
  }
}
