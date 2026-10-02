/**
 * 24-HOUR CLOUD ENGINE — Rate Limiter
 * cloud-engine/security/rate-limiter.js
 *
 * Configurable rate limiting for high-impact actions.
 *
 * Actions with configurable limits:
 *   - repeated start broadcast
 *   - repeated stop
 *   - destination reconnect spam
 *   - credential validation spam
 *   - command submission
 *   - station creation
 *   - media operations
 *
 * Limits are configurable to not make legitimate broadcasting unusable.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE } from './security-errors.js';
import { CloudEngineEventBus }  from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }  from '../core/events.js';

/* ═══════════════════════════════════
   RATE LIMIT ACTIONS
═══════════════════════════════════ */
export const RATE_LIMITED_ACTION = Object.freeze({
  START_BROADCAST:        'START_BROADCAST',
  STOP_BROADCAST:         'STOP_BROADCAST',
  DESTINATION_RECONNECT:  'DESTINATION_RECONNECT',
  CREDENTIAL_VALIDATE:    'CREDENTIAL_VALIDATE',
  COMMAND_SUBMIT:         'COMMAND_SUBMIT',
  STATION_CREATE:         'STATION_CREATE',
  MEDIA_UPLOAD:           'MEDIA_UPLOAD',
  MEDIA_DELETE:           'MEDIA_DELETE',
  PLATFORM_CONNECT:       'PLATFORM_CONNECT',
  PLATFORM_REVOKE:        'PLATFORM_REVOKE',
});

/* ═══════════════════════════════════
   DEFAULT RATE LIMIT CONFIG
   windowMs: sliding window duration
   maxRequests: max requests per window per user
═══════════════════════════════════ */
export const DEFAULT_RATE_LIMITS = Object.freeze({
  [RATE_LIMITED_ACTION.START_BROADCAST]: {
    windowMs:    60_000,
    maxRequests: 10,
    reason:      'Start broadcast spam protection',
  },
  [RATE_LIMITED_ACTION.STOP_BROADCAST]: {
    windowMs:    60_000,
    maxRequests: 20,
    reason:      'Stop broadcast spam protection',
  },
  [RATE_LIMITED_ACTION.DESTINATION_RECONNECT]: {
    windowMs:    60_000,
    maxRequests: 20,
    reason:      'Destination reconnect spam protection',
  },
  [RATE_LIMITED_ACTION.CREDENTIAL_VALIDATE]: {
    windowMs:    300_000,
    maxRequests: 10,
    reason:      'Credential validation spam protection',
  },
  [RATE_LIMITED_ACTION.COMMAND_SUBMIT]: {
    windowMs:    10_000,
    maxRequests: 30,
    reason:      'Command submission rate limit',
  },
  [RATE_LIMITED_ACTION.STATION_CREATE]: {
    windowMs:    3_600_000,
    maxRequests: 10,
    reason:      'Station creation limit',
  },
  [RATE_LIMITED_ACTION.MEDIA_UPLOAD]: {
    windowMs:    60_000,
    maxRequests: 20,
    reason:      'Media upload rate limit',
  },
  [RATE_LIMITED_ACTION.MEDIA_DELETE]: {
    windowMs:    60_000,
    maxRequests: 50,
    reason:      'Media delete rate limit',
  },
  [RATE_LIMITED_ACTION.PLATFORM_CONNECT]: {
    windowMs:    300_000,
    maxRequests: 10,
    reason:      'Platform connect rate limit',
  },
  [RATE_LIMITED_ACTION.PLATFORM_REVOKE]: {
    windowMs:    300_000,
    maxRequests: 10,
    reason:      'Platform revoke rate limit',
  },
});

/* ═══════════════════════════════════
   RATE LIMITER CLASS
═══════════════════════════════════ */
export class RateLimiter {
  /**
   * @param {object} [customLimits]  Override default limits per action
   */
  constructor(customLimits = {}) {
    this._limits  = { ...DEFAULT_RATE_LIMITS, ...customLimits };
    this._buckets = new Map();  // `${userId}:${action}` → [timestamps]
  }

  /**
   * Check if an action is allowed for a user.
   *
   * @param {string} userId
   * @param {string} action  RATE_LIMITED_ACTION.*
   * @returns {{ allowed: boolean, remaining: number, resetIn: number, reason?: string }}
   */
  check(userId, action) {
    const limit = this._limits[action];
    if (!limit) {
      return { allowed: true, remaining: -1, resetIn: 0 };
    }

    const key    = `${userId}:${action}`;
    const now    = Date.now();
    const cutoff = now - limit.windowMs;

    let bucket = this._buckets.get(key) ?? [];
    bucket = bucket.filter(ts => ts > cutoff);

    const remaining = limit.maxRequests - bucket.length;

    if (bucket.length >= limit.maxRequests) {
      const oldest  = bucket[0];
      const resetIn = Math.ceil((oldest + limit.windowMs - now) / 1000);

      this._buckets.set(key, bucket);

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.RATE_LIMIT_TRIGGERED, {
        userId,
        action,
        resetInSec: resetIn,
      });

      return {
        allowed:   false,
        remaining: 0,
        resetIn,
        reason:    `Rate limit exceeded for ${action}. ${limit.reason}. Retry in ${resetIn}s.`,
        code:      SECURITY_ERROR_CODE.RATE_LIMITED,
      };
    }

    bucket.push(now);
    this._buckets.set(key, bucket);

    return {
      allowed:   true,
      remaining: remaining - 1,
      resetIn:   Math.ceil(limit.windowMs / 1000),
    };
  }

  /**
   * Assert rate limit — throws if exceeded.
   * @param {string} userId
   * @param {string} action
   */
  assertAllowed(userId, action) {
    const result = this.check(userId, action);
    if (!result.allowed) {
      const err = new Error(result.reason);
      err.code = SECURITY_ERROR_CODE.RATE_LIMITED;
      throw err;
    }
    return result;
  }

  /**
   * Reset rate limit for a specific user/action.
   * @param {string} userId
   * @param {string} [action]  If omitted, resets all actions for user
   */
  reset(userId, action) {
    if (action) {
      this._buckets.delete(`${userId}:${action}`);
    } else {
      for (const key of this._buckets.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this._buckets.delete(key);
        }
      }
    }
  }

  /**
   * Update rate limit configuration.
   * @param {string} action
   * @param {object} config
   */
  setLimit(action, config) {
    this._limits[action] = { ...this._limits[action], ...config };
  }

  /**
   * Get current usage for a user/action.
   */
  getUsage(userId, action) {
    const limit = this._limits[action];
    if (!limit) return null;

    const key    = `${userId}:${action}`;
    const now    = Date.now();
    const cutoff = now - limit.windowMs;
    const bucket = (this._buckets.get(key) ?? []).filter(ts => ts > cutoff);

    return {
      action,
      used:         bucket.length,
      maxRequests:  limit.maxRequests,
      windowMs:     limit.windowMs,
      remaining:    Math.max(0, limit.maxRequests - bucket.length),
    };
  }

  /** Prune all expired buckets (housekeeping). */
  prune() {
    const now = Date.now();
    for (const [key, bucket] of this._buckets.entries()) {
      const action = key.split(':').pop();
      const limit  = this._limits[action];
      if (!limit) {
        this._buckets.delete(key);
        continue;
      }
      const cutoff   = now - limit.windowMs;
      const filtered = bucket.filter(ts => ts > cutoff);
      if (filtered.length === 0) {
        this._buckets.delete(key);
      } else {
        this._buckets.set(key, filtered);
      }
    }
  }
}

/* ═══════════════════════════════════
   SHARED RATE LIMITER INSTANCE
═══════════════════════════════════ */
export const SharedRateLimiter = new RateLimiter();
