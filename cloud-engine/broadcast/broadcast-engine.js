/**
 * 24-HOUR CLOUD ENGINE — Broadcast Engine Public Interface
 * cloud-engine/broadcast/broadcast-engine.js
 *
 * Stage 3: Replaces the Stage 1/2 placeholder with the real Shadow Broadcast Engine.
 *
 * Exposes a single shared broadcast engine instance (ShadowBroadcastEngine)
 * and re-exports broadcast state types for consumers.
 *
 * Stage 1/2 compatibility:
 *   The ShadowBroadcastEngine object has the same shape used by health.js,
 *   diagnostics.js, and engine.js. Stage 1/2 callers continue to work.
 *
 * Modified from Stage 1/2 placeholder by: Stage 3 Shadow Broadcast Engine implementation.
 */

import {
  ShadowBroadcastEngineImpl,
  BROADCAST_STATE,
} from './shadow-broadcast-engine-impl.js';

/* ══════════════════════════════════════════════════════
   SHARED BROADCAST ENGINE INSTANCE
   One instance is shared across the Cloud Engine.
   Stage 3 enforces ONE active broadcast destination at a time.
   Multi-destination broadcasting belongs to a later stage.
══════════════════════════════════════════════════════ */
const _engineInstance = new ShadowBroadcastEngineImpl();

/**
 * Shadow Broadcast Engine — Stage 3 functional implementation.
 *
 * Lifecycle:
 *   1. initialize()                      — detect FFmpeg, prepare engine
 *   2. registerDestination(dest)         — register an RTMP/RTMPS destination
 *   3. connect({ destinationId })        — validate and connect to destination
 *   4. startBroadcast({ inputPath })     — start pushing FLV to RTMP endpoint
 *   5. getMetrics()                      — poll real-time broadcast metrics
 *   6. stopBroadcast()                   — stop cleanly
 *   7. disconnect()                      — disconnect from destination
 *   8. shutdown()                        — release all resources
 *
 *   Manual reconnect:  reconnect()
 *   Auto-reconnect:    configured per destination (autoReconnect: true)
 */
export const ShadowBroadcastEngine = Object.freeze({

  /**
   * Initialize the broadcast engine: detect FFmpeg, prepare reconnect manager.
   * @param {object}  [opts]
   * @param {object}  [opts.reconnectPolicy]  Override default reconnect policy.
   * @returns {Promise<CommandResult>}
   */
  async initialize(opts) {
    return _engineInstance.initialize(opts);
  },

  /**
   * Register a broadcast destination.
   * Stream key is NOT passed here — it is read from environment variables at connect() time.
   *
   * @param {BroadcastDestination} dest
   * @returns {{ success: boolean, message: string }}
   */
  registerDestination(dest) {
    return _engineInstance.registerDestination(dest);
  },

  /**
   * Connect to a streaming destination.
   * Validates configuration and resolves the stream key.
   * Does NOT start the FFmpeg process.
   *
   * @param {object} opts
   * @param {string} opts.destinationId  Registered destination ID.
   * @returns {Promise<CommandResult>}
   */
  async connect(opts) {
    return _engineInstance.connect(opts);
  },

  /**
   * Disconnect from the current destination.
   * @returns {Promise<CommandResult>}
   */
  async disconnect() {
    return _engineInstance.disconnect();
  },

  /**
   * Start broadcasting an encoded FLV to the connected RTMP destination.
   * @param {object} opts
   * @param {string} opts.inputPath  Absolute path to the source FLV file.
   * @returns {Promise<CommandResult>}
   */
  async startBroadcast(opts) {
    return _engineInstance.startBroadcast(opts);
  },

  /**
   * Stop the active broadcast cleanly.
   * @returns {Promise<CommandResult>}
   */
  async stopBroadcast() {
    return _engineInstance.stopBroadcast();
  },

  /**
   * Reconnect: tear down the broken connection and establish a fresh one.
   * @returns {Promise<CommandResult>}
   */
  async reconnect() {
    return _engineInstance.reconnect();
  },

  /**
   * Returns the current connection and broadcast status.
   * @returns {object}
   */
  getConnectionStatus() {
    return _engineInstance.getConnectionStatus();
  },

  /**
   * Returns the full broadcast status.
   * @returns {object}
   */
  getStatus() {
    return _engineInstance.getStatus();
  },

  /**
   * Returns real-time broadcast metrics.
   * @returns {BroadcastMetrics}
   */
  getMetrics() {
    return _engineInstance.getMetrics();
  },

  /**
   * Shut down the broadcast engine completely.
   * @returns {Promise<CommandResult>}
   */
  async shutdown() {
    return _engineInstance.shutdown();
  },
});

// Re-export state constants for consumers
export { BROADCAST_STATE };

// Re-export error types
export { BroadcastError, BROADCAST_ERROR_CODE } from './broadcast-errors.js';

// Re-export destination types
export {
  BROADCAST_PROTOCOL,
  safeDestinationInfo,
  validateDestination,
} from './destination-manager.js';

// Re-export reconnect policy
export { DEFAULT_RECONNECT_POLICY } from './reconnect-manager.js';
