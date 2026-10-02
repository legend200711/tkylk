/**
 * 24-HOUR CLOUD ENGINE — Destination Manager
 * cloud-engine/broadcast/destination-manager.js
 *
 * Manages broadcast destination configuration.
 *
 * A destination describes WHERE to broadcast (server URL + protocol).
 * The stream key is a SECRET — it is loaded from environment variables
 * at validation time and NEVER stored in memory longer than needed,
 * NEVER logged, and NEVER included in any diagnostic output.
 *
 * Supported protocols:
 *   RTMP   — rtmp://
 *   RTMPS  — rtmps:// (preferred where supported)
 *
 * Stage 3 — Shadow Broadcast Engine
 */

import { BroadcastError, BROADCAST_ERROR_CODE } from './broadcast-errors.js';
import { CloudEngineLogger }                     from '../logs/logger.js';

const MODULE = 'broadcast/destination-manager';

/* ═══════════════════════════════════
   SUPPORTED PROTOCOLS
═══════════════════════════════════ */
export const BROADCAST_PROTOCOL = Object.freeze({
  RTMP:  'RTMP',
  RTMPS: 'RTMPS',
});

const _PROTOCOL_PREFIXES = {
  [BROADCAST_PROTOCOL.RTMP]:  'rtmp://',
  [BROADCAST_PROTOCOL.RTMPS]: 'rtmps://',
};

/* ═══════════════════════════════════
   DESTINATION SHAPE
═══════════════════════════════════ */

/**
 * @typedef {object} BroadcastDestination
 * @property {string}  destinationId   Unique identifier (e.g. 'youtube-primary')
 * @property {string}  name            Human-readable name (e.g. 'YouTube Primary')
 * @property {string}  protocol        BROADCAST_PROTOCOL.RTMP or .RTMPS
 * @property {string}  serverUrl       Full RTMP/RTMPS server URL (no stream key)
 * @property {string}  streamKeyEnvVar Name of the env variable holding the stream key
 * @property {boolean} enabled         Whether this destination is active
 * @property {boolean} autoReconnect   Whether to auto-reconnect on unexpected disconnect
 */

/* ═══════════════════════════════════
   SAFE LOG REPRESENTATION
   Never expose the stream key.
═══════════════════════════════════ */

/**
 * Build a safe representation of a destination for logging/diagnostics.
 * Stream key is ALWAYS masked as ********.
 * @param {BroadcastDestination} dest
 * @returns {object}
 */
export function safeDestinationInfo(dest) {
  if (!dest) return null;
  return {
    destinationId:   dest.destinationId,
    name:            dest.name,
    protocol:        dest.protocol,
    serverUrl:       dest.serverUrl,
    streamKeyEnvVar: dest.streamKeyEnvVar,
    streamKey:       '********',          // ALWAYS masked
    enabled:         dest.enabled,
    autoReconnect:   dest.autoReconnect,
  };
}

/* ═══════════════════════════════════
   DESTINATION VALIDATION
═══════════════════════════════════ */

/**
 * Validate a destination configuration object.
 * Does NOT validate the stream key value — only that the env var name is present.
 *
 * @param {BroadcastDestination} dest
 * @throws {BroadcastError} if invalid
 */
export function validateDestination(dest) {
  if (!dest || typeof dest !== 'object') {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.DESTINATION_INVALID,
      'Destination must be an object.',
    );
  }

  if (!dest.destinationId || typeof dest.destinationId !== 'string') {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.DESTINATION_INVALID,
      'Destination must have a non-empty destinationId string.',
    );
  }

  if (!dest.protocol || !BROADCAST_PROTOCOL[dest.protocol]) {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.PROTOCOL_UNSUPPORTED,
      `Unsupported protocol: "${dest.protocol}". Supported: ${Object.keys(BROADCAST_PROTOCOL).join(', ')}`,
      { protocol: dest.protocol },
    );
  }

  if (!dest.serverUrl || typeof dest.serverUrl !== 'string') {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.DESTINATION_INVALID,
      'Destination must have a non-empty serverUrl.',
    );
  }

  const expectedPrefix = _PROTOCOL_PREFIXES[dest.protocol];
  if (!dest.serverUrl.toLowerCase().startsWith(expectedPrefix)) {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.DESTINATION_INVALID,
      `serverUrl must start with "${expectedPrefix}" for protocol ${dest.protocol}. Got: "${dest.serverUrl}"`,
      { serverUrl: dest.serverUrl, expectedPrefix },
    );
  }

  if (!dest.streamKeyEnvVar || typeof dest.streamKeyEnvVar !== 'string') {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.STREAM_KEY_MISSING,
      'Destination must specify streamKeyEnvVar (name of the env variable containing the stream key).',
    );
  }
}

/**
 * Resolve the stream key from the environment.
 * The value is returned as a string and must be treated as a SECRET by the caller.
 * It must NEVER be logged, stored in state, or sent to the browser.
 *
 * @param {BroadcastDestination} dest
 * @returns {string} The stream key value.
 * @throws {BroadcastError} STREAM_KEY_MISSING if the env var is not set or empty.
 */
export function resolveStreamKey(dest) {
  const envVar = dest.streamKeyEnvVar;
  const key    = process.env[envVar];

  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new BroadcastError(
      BROADCAST_ERROR_CODE.STREAM_KEY_MISSING,
      `Stream key not found. Set the "${envVar}" environment variable with the stream key. ` +
      `Stream keys must NEVER be committed to source control.`,
      { envVar },  // Safe: only the variable NAME is logged, not the value.
    );
  }

  return key.trim();
}

/**
 * Build the full RTMP/RTMPS publish URL (server URL + stream key).
 * This value is a SECRET. It must NEVER be logged.
 *
 * @param {BroadcastDestination} dest
 * @param {string}               streamKey  The resolved stream key (secret).
 * @returns {string} Full publish URL.
 */
export function buildPublishUrl(dest, streamKey) {
  // Remove trailing slash from serverUrl, then append stream key
  const base = dest.serverUrl.replace(/\/+$/, '');
  return `${base}/${streamKey}`;
}

/* ═══════════════════════════════════
   DESTINATION MANAGER CLASS
═══════════════════════════════════ */

export class DestinationManager {
  constructor() {
    this._destinations = new Map();    // destinationId → BroadcastDestination
    this._active       = null;         // active destinationId
  }

  /**
   * Register a destination.
   * Validates the configuration (not the stream key).
   *
   * @param {BroadcastDestination} dest
   * @throws {BroadcastError} if invalid
   */
  register(dest) {
    validateDestination(dest);
    this._destinations.set(dest.destinationId, { ...dest });
    CloudEngineLogger.info(MODULE, 'DESTINATION_REGISTERED',
      `Destination registered: "${dest.destinationId}"`, safeDestinationInfo(dest));
  }

  /**
   * Get a registered destination by ID.
   * @param {string} destinationId
   * @returns {BroadcastDestination}
   * @throws {BroadcastError} if not found
   */
  get(destinationId) {
    const dest = this._destinations.get(destinationId);
    if (!dest) {
      throw new BroadcastError(
        BROADCAST_ERROR_CODE.DESTINATION_NOT_CONFIGURED,
        `Destination not found: "${destinationId}"`,
        { destinationId },
      );
    }
    return { ...dest };
  }

  /**
   * List all registered destinations (safe — no stream key values).
   * @returns {Array<object>}
   */
  list() {
    return [...this._destinations.values()].map(safeDestinationInfo);
  }

  /**
   * Set the active destination by ID.
   * @param {string} destinationId
   * @throws {BroadcastError} if not found
   */
  setActive(destinationId) {
    const dest = this.get(destinationId);  // throws if not found
    this._active = destinationId;
    CloudEngineLogger.info(MODULE, 'DESTINATION_ACTIVATED',
      `Active destination set: "${destinationId}"`, safeDestinationInfo(dest));
  }

  /**
   * Get the currently active destination.
   * @returns {BroadcastDestination|null}
   */
  getActive() {
    if (!this._active) return null;
    return this._destinations.get(this._active) ?? null;
  }

  /**
   * Remove a destination by ID.
   * @param {string} destinationId
   */
  remove(destinationId) {
    if (this._active === destinationId) {
      this._active = null;
    }
    this._destinations.delete(destinationId);
    CloudEngineLogger.info(MODULE, 'DESTINATION_REMOVED',
      `Destination removed: "${destinationId}"`);
  }

  /** Number of registered destinations. */
  get count() { return this._destinations.size; }

  /** Whether there is an active destination. */
  get hasActive() { return this._active !== null && this._destinations.has(this._active); }
}
