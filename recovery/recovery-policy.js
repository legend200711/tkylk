/**
 * 24-HOUR CLOUD ENGINE — Recovery Policy
 * cloud-engine/recovery/recovery-policy.js
 *
 * Defines bounded recovery policies for each failure type.
 * All policies use configurable retry limits, exponential backoff, jitter,
 * and cooldown periods. No policy creates an infinite uncontrolled restart loop.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { RECOVERY_ACTION } from './recovery-errors.js';

/* ═══════════════════════════════════
   FAILURE TYPES
═══════════════════════════════════ */
export const FAILURE_TYPE = Object.freeze({
  ENCODER_CRASH:           'ENCODER_CRASH',
  ENCODER_STALLED:         'ENCODER_STALLED',
  ENCODER_BEHIND:          'ENCODER_BEHIND',
  INGEST_DISCONNECTED:     'INGEST_DISCONNECTED',
  INGEST_STALLED:          'INGEST_STALLED',
  DESTINATION_DISCONNECTED:'DESTINATION_DISCONNECTED',
  TRANSPORT_CRASH:         'TRANSPORT_CRASH',
  RECONNECT_EXHAUSTED:     'RECONNECT_EXHAUSTED',
  MEDIA_PLAYBACK_FAILURE:  'MEDIA_PLAYBACK_FAILURE',
  STATION_PLAYBACK_FAILURE:'STATION_PLAYBACK_FAILURE',
  HYBRID_LIVE_FAILURE:     'HYBRID_LIVE_FAILURE',
  CONTROL_PLANE_FAILURE:   'CONTROL_PLANE_FAILURE',
  PROCESS_CRASH:           'PROCESS_CRASH',
});

/* ═══════════════════════════════════
   DEFAULT POLICIES
   maxAttempts: 0 = no limit (not recommended except for cooldown-gated attempts)
   baseDelayMs: base delay before first retry
   maxDelayMs:  cap on exponential backoff delay
   cooldownMs:  minimum time between recovery cycles
   jitter:      whether to apply random jitter to delay
═══════════════════════════════════ */
export const DEFAULT_POLICIES = Object.freeze({

  [FAILURE_TYPE.ENCODER_CRASH]: {
    action:       RECOVERY_ACTION.RESTART_COMPONENT,
    maxAttempts:  3,
    baseDelayMs:  2_000,
    maxDelayMs:   30_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  'Restart encoder process on crash (max 3 within cooldown period)',
  },

  [FAILURE_TYPE.ENCODER_STALLED]: {
    action:       RECOVERY_ACTION.RESTART_COMPONENT,
    maxAttempts:  2,
    baseDelayMs:  5_000,
    maxDelayMs:   30_000,
    cooldownMs:   120_000,
    jitter:       true,
    description:  'Restart encoder on stall detection (max 2, higher cooldown)',
  },

  [FAILURE_TYPE.ENCODER_BEHIND]: {
    action:       RECOVERY_ACTION.RETRY,
    maxAttempts:  5,
    baseDelayMs:  1_000,
    maxDelayMs:   10_000,
    cooldownMs:   30_000,
    jitter:       false,
    description:  'Log and monitor encoder lag (not a crash — emit warning first)',
  },

  [FAILURE_TYPE.INGEST_DISCONNECTED]: {
    action:       RECOVERY_ACTION.RETURN_TO_STATION,
    maxAttempts:  3,
    baseDelayMs:  3_000,
    maxDelayMs:   30_000,
    cooldownMs:   30_000,
    jitter:       true,
    description:  'Mark ingest unhealthy; transition to station if hybrid available',
  },

  [FAILURE_TYPE.INGEST_STALLED]: {
    action:       RECOVERY_ACTION.RESTART_SOURCE,
    maxAttempts:  2,
    baseDelayMs:  5_000,
    maxDelayMs:   20_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  'Attempt ingest source restart on stall',
  },

  [FAILURE_TYPE.DESTINATION_DISCONNECTED]: {
    action:       RECOVERY_ACTION.RECONNECT,
    maxAttempts:  5,
    baseDelayMs:  2_000,
    maxDelayMs:   60_000,
    cooldownMs:   10_000,
    jitter:       true,
    description:  'Reconnect individual destination (other destinations unaffected)',
  },

  [FAILURE_TYPE.TRANSPORT_CRASH]: {
    action:       RECOVERY_ACTION.RECONNECT,
    maxAttempts:  4,
    baseDelayMs:  3_000,
    maxDelayMs:   60_000,
    cooldownMs:   15_000,
    jitter:       true,
    description:  'Restart transport process for crashed destination',
  },

  [FAILURE_TYPE.RECONNECT_EXHAUSTED]: {
    action:       RECOVERY_ACTION.ESCALATE,
    maxAttempts:  1,
    baseDelayMs:  0,
    maxDelayMs:   0,
    cooldownMs:   300_000,
    jitter:       false,
    description:  'Escalate to broadcast-level recovery when destination exhausts reconnects',
  },

  [FAILURE_TYPE.MEDIA_PLAYBACK_FAILURE]: {
    action:       RECOVERY_ACTION.USE_FALLBACK,
    maxAttempts:  2,
    baseDelayMs:  1_000,
    maxDelayMs:   10_000,
    cooldownMs:   30_000,
    jitter:       false,
    description:  'Skip failed media item; use fallback or next item',
  },

  [FAILURE_TYPE.STATION_PLAYBACK_FAILURE]: {
    action:       RECOVERY_ACTION.RESTART_COMPONENT,
    maxAttempts:  3,
    baseDelayMs:  3_000,
    maxDelayMs:   30_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  'Restart station playback; restore schedule position',
  },

  [FAILURE_TYPE.HYBRID_LIVE_FAILURE]: {
    action:       RECOVERY_ACTION.RETURN_TO_STATION,
    maxAttempts:  1,
    baseDelayMs:  1_000,
    maxDelayMs:   5_000,
    cooldownMs:   30_000,
    jitter:       false,
    description:  'On live ingest failure, return to station programming immediately',
  },

  [FAILURE_TYPE.CONTROL_PLANE_FAILURE]: {
    action:       RECOVERY_ACTION.RETRY,
    maxAttempts:  5,
    baseDelayMs:  5_000,
    maxDelayMs:   120_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  'Retry control plane reconnection with backoff',
  },

  [FAILURE_TYPE.PROCESS_CRASH]: {
    action:       RECOVERY_ACTION.RESTART_COMPONENT,
    maxAttempts:  3,
    baseDelayMs:  2_000,
    maxDelayMs:   30_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  'Generic process crash recovery',
  },
});

/* ═══════════════════════════════════
   POLICY MANAGER
═══════════════════════════════════ */

/**
 * Get the recovery policy for a failure type.
 * Falls back to a safe ESCALATE policy if unknown.
 *
 * @param {string} failureType  FAILURE_TYPE.*
 * @param {object} [overrides]  Policy field overrides (for per-destination customization)
 * @returns {object}
 */
export function getPolicy(failureType, overrides = {}) {
  const base = DEFAULT_POLICIES[failureType] ?? {
    action:       RECOVERY_ACTION.ESCALATE,
    maxAttempts:  1,
    baseDelayMs:  5_000,
    maxDelayMs:   60_000,
    cooldownMs:   60_000,
    jitter:       true,
    description:  `No policy defined for: ${failureType}`,
  };

  return Object.freeze({ ...base, ...overrides });
}

/**
 * Calculate the backoff delay for a given attempt number.
 * Uses exponential backoff with optional jitter.
 *
 * @param {object} policy
 * @param {number} attempt  1-based attempt number
 * @returns {number}  Delay in milliseconds
 */
export function calculateBackoffDelay(policy, attempt) {
  const exp   = Math.pow(2, attempt - 1);
  const delay = Math.min(policy.baseDelayMs * exp, policy.maxDelayMs);
  if (!policy.jitter) return delay;

  // Add ±20% jitter
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(delay + jitter));
}

/**
 * Check if a recovery attempt is within policy limits.
 *
 * @param {object} policy
 * @param {number} attemptCount  Number of attempts already made
 * @param {number} [lastAttemptAt]  Timestamp of last attempt
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkPolicyAllows(policy, attemptCount, lastAttemptAt = null) {
  if (policy.maxAttempts > 0 && attemptCount >= policy.maxAttempts) {
    return {
      allowed: false,
      reason:  `Max attempts (${policy.maxAttempts}) exceeded for action: ${policy.action}`,
    };
  }

  if (lastAttemptAt && policy.cooldownMs > 0) {
    const elapsed = Date.now() - lastAttemptAt;
    if (elapsed < policy.cooldownMs) {
      const remaining = Math.ceil((policy.cooldownMs - elapsed) / 1000);
      return {
        allowed: false,
        reason:  `Cooldown active — ${remaining}s remaining.`,
      };
    }
  }

  return { allowed: true };
}
