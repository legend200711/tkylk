/**
 * 24-HOUR CLOUD ENGINE — Platform Connector Base
 * cloud-engine/platforms/platform-connector.js
 *
 * Abstract base class for all platform connectors.
 * Every platform connector extends this class and implements
 * the operations that are genuinely supported for that platform.
 *
 * Connector Architecture:
 *   Platform Connector
 *     ↓
 *   Generic Destination (BroadcastDestination shape)
 *     ↓
 *   Fan-Out Manager
 *     ↓
 *   Existing RTMP/RTMPS Transport
 *
 * Security invariants enforced here:
 *   - getStatus() NEVER returns stream keys or tokens
 *   - getDestination() returns a BroadcastDestination with streamKeyEnvVar
 *     (the env var NAME, not the value)
 *   - Credentials are never stored in memory in cleartext beyond what is
 *     needed for a single operation
 *   - Errors are logged with codes but NEVER with credential values
 *
 * Stage 8 — Platform Connections
 */

import { CloudEngineLogger }                              from '../logs/logger.js';
import { PLATFORM_CONNECTION_STATUS, buildSafePlatformStatus } from './platform-status.js';
import { PlatformError, PLATFORM_ERROR_CODE }             from './platform-errors.js';

const MODULE = 'platforms/platform-connector';

/* ═══════════════════════════════════
   BASE PLATFORM CONNECTOR
═══════════════════════════════════ */

export class PlatformConnector {
  /**
   * @param {object} opts
   * @param {string} opts.platformType    PLATFORM_TYPE.*
   * @param {string} opts.connectorId     Unique ID for this connector instance
   * @param {string} opts.displayName     Human-readable name (safe to show in UI)
   * @param {object} opts.capabilities    Supported operations
   */
  constructor({ platformType, connectorId, displayName, capabilities }) {
    this.platformType  = platformType;
    this.connectorId   = connectorId;
    this.displayName   = displayName;
    this.capabilities  = Object.freeze({ ...capabilities });

    this._status       = PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED;
    this._config       = null;
    this._configuredAt = null;
    this._connectedAt  = null;
    this._lastError    = null;
  }

  /* ── Lifecycle operations ─────────────────────────────────── */

  /**
   * Configure the connector with platform-specific settings.
   * Subclasses validate config and set status accordingly.
   * NEVER pass raw credentials — use env var references.
   *
   * @param {object} config  Platform-specific config (no raw secrets)
   * @returns {{ success: boolean, status: string, message: string }}
   */
  async configure(config) {
    this._notImplemented('configure');
  }

  /**
   * Validate the connector configuration (without connecting).
   * @returns {{ success: boolean, valid: boolean, issues: string[] }}
   */
  async validate() {
    this._notImplemented('validate');
  }

  /**
   * Establish connection to the platform.
   * For OAuth platforms: checks token validity.
   * For stream-key platforms: resolves key from env.
   * @returns {{ success: boolean, status: string, message: string }}
   */
  async connect() {
    this._notImplemented('connect');
  }

  /**
   * Disconnect from the platform.
   * @returns {{ success: boolean, message: string }}
   */
  async disconnect() {
    this._notImplemented('disconnect');
  }

  /**
   * Refresh OAuth authentication.
   * Only relevant for OAuth-based platforms.
   * @returns {{ success: boolean, message: string }}
   */
  async refreshAuthentication() {
    if (!this.capabilities.refreshAuthentication) {
      return {
        success: false,
        message: `refreshAuthentication not supported by ${this.platformType}.`,
        code:    PLATFORM_ERROR_CODE.OPERATION_NOT_SUPPORTED,
      };
    }
    this._notImplemented('refreshAuthentication');
  }

  /**
   * Get the current safe status of this connector.
   * NEVER returns credentials.
   * @returns {object}
   */
  getStatus() {
    return buildSafePlatformStatus(this.platformType, this._status, {
      connectorId:   this.connectorId,
      displayName:   this.displayName,
      configuredAt:  this._configuredAt,
      connectedAt:   this._connectedAt,
      lastError:     this._lastError,
    });
  }

  /**
   * Build and return a BroadcastDestination-compatible object for use by FanOutManager.
   * The destination includes a streamKeyEnvVar reference — NOT the actual stream key.
   * @returns {{ success: boolean, destination: object|null, message: string }}
   */
  async getDestination() {
    this._notImplemented('getDestination');
  }

  /**
   * Test the platform connection (without starting a broadcast).
   * @returns {{ success: boolean, latencyMs: number|null, message: string }}
   */
  async testConnection() {
    this._notImplemented('testConnection');
  }

  /**
   * Revoke OAuth credentials.
   * Only relevant for OAuth-based platforms.
   * @returns {{ success: boolean, message: string }}
   */
  async revoke() {
    if (!this.capabilities.revoke) {
      return {
        success: false,
        message: `revoke not supported by ${this.platformType}.`,
        code:    PLATFORM_ERROR_CODE.OPERATION_NOT_SUPPORTED,
      };
    }
    this._notImplemented('revoke');
  }

  /* ── Protected helpers ────────────────────────────────────── */

  /** Call to record a connector error safely (no credential values). */
  _setError(code, message) {
    this._status    = PLATFORM_CONNECTION_STATUS.ERROR;
    this._lastError = { code, message, at: new Date().toISOString() };
    CloudEngineLogger.warn(MODULE, 'PLATFORM_ERROR',
      `[${this.connectorId}] ${code}: ${message}`);
  }

  /** Set status. */
  _setStatus(status) {
    this._status = status;
  }

  /** Throw a standard "not implemented" error. */
  _notImplemented(op) {
    throw new PlatformError(
      PLATFORM_ERROR_CODE.OPERATION_NOT_SUPPORTED,
      `${this.platformType}.${op}() is not implemented.`,
      { platformType: this.platformType, operation: op },
    );
  }
}
