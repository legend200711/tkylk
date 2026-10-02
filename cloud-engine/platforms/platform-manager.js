/**
 * 24-HOUR CLOUD ENGINE — Platform Manager
 * cloud-engine/platforms/platform-manager.js
 *
 * Central registry and coordinator for all platform connectors.
 *
 * Architecture:
 *   Creator / Config
 *     ↓
 *   Platform Manager
 *     ├── YouTubeConnector
 *     ├── TwitchConnector
 *     ├── FacebookConnector
 *     └── CustomRtmpConnector(s)
 *         ↓
 *   BroadcastDestination objects
 *         ↓
 *   FanOutManager → RTMP/RTMPS Transport
 *
 * Failure isolation:
 *   One platform failing does NOT crash other platforms or the engine.
 *   Each connector is independent. Errors are caught per-connector.
 *
 * Security invariants:
 *   - Credentials never stored in this manager
 *   - getAllStatuses() returns safe info only (no tokens, no stream keys)
 *   - buildDestinations() returns BroadcastDestination objects with
 *     streamKeyEnvVar references (not the key values)
 *
 * Stage 8 — Platform Connections
 */

import { CloudEngineLogger }                              from '../logs/logger.js';
import { CloudEngineEventBus }                            from '../core/event-bus.js';
import { PLATFORM_CONNECTION_STATUS }                     from './platform-status.js';
import { PLATFORM_ERROR_CODE, PlatformError }             from './platform-errors.js';

const MODULE = 'platforms/platform-manager';

/* ═══════════════════════════════════
   PLATFORM MANAGER
═══════════════════════════════════ */
export class PlatformManager {
  constructor() {
    this._connectors = new Map();   // connectorId → PlatformConnector
  }

  /* ── Connector Registration ────────────────────────────── */

  /**
   * Register a platform connector.
   * @param {PlatformConnector} connector
   * @throws {Error} if connectorId already registered
   */
  register(connector) {
    if (!connector || !connector.connectorId) {
      throw new Error('register() requires a PlatformConnector with a connectorId.');
    }
    if (this._connectors.has(connector.connectorId)) {
      throw new Error(`Connector "${connector.connectorId}" is already registered.`);
    }
    this._connectors.set(connector.connectorId, connector);
    CloudEngineLogger.info(MODULE, 'CONNECTOR_REGISTERED',
      `Platform connector registered: "${connector.connectorId}" (${connector.platformType})`);
  }

  /**
   * Unregister a connector. Disconnects first if active.
   * @param {string} connectorId
   */
  async unregister(connectorId) {
    const connector = this._connectors.get(connectorId);
    if (!connector) {
      CloudEngineLogger.warn(MODULE, 'CONNECTOR_NOT_FOUND',
        `unregister: connector "${connectorId}" not found.`);
      return;
    }
    try {
      await connector.disconnect();
    } catch {
      // Non-fatal — proceed with removal
    }
    this._connectors.delete(connectorId);
    CloudEngineLogger.info(MODULE, 'CONNECTOR_UNREGISTERED',
      `Platform connector unregistered: "${connectorId}"`);
  }

  /**
   * Get a connector by ID.
   * @param {string} connectorId
   * @returns {PlatformConnector|null}
   */
  get(connectorId) {
    return this._connectors.get(connectorId) ?? null;
  }

  /**
   * List all registered connector IDs.
   * @returns {string[]}
   */
  list() {
    return [...this._connectors.keys()];
  }

  /* ── Bulk Operations ───────────────────────────────────── */

  /**
   * Connect all registered connectors.
   * Failures are isolated per connector — others continue.
   * @param {string[]} [connectorIds]  Optional subset to connect
   * @returns {Promise<object>}  { connectorId: { success, status, message } }
   */
  async connectAll(connectorIds) {
    const targets = connectorIds
      ? connectorIds.map(id => this._connectors.get(id)).filter(Boolean)
      : [...this._connectors.values()];

    const results = {};
    for (const connector of targets) {
      try {
        const r = await connector.connect();
        results[connector.connectorId] = {
          success:  r.success,
          status:   r.status  ?? connector.getStatus().status,
          message:  r.message ?? '',
        };
      } catch (err) {
        results[connector.connectorId] = {
          success: false,
          status:  PLATFORM_CONNECTION_STATUS.ERROR,
          message: err.message ?? String(err),
        };
        CloudEngineLogger.warn(MODULE, 'CONNECTOR_CONNECT_ERROR',
          `Connector "${connector.connectorId}" connect error: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Disconnect all registered connectors.
   * @returns {Promise<object>}
   */
  async disconnectAll() {
    const results = {};
    for (const connector of this._connectors.values()) {
      try {
        const r = await connector.disconnect();
        results[connector.connectorId] = { success: r.success, message: r.message };
      } catch (err) {
        results[connector.connectorId] = { success: false, message: err.message };
      }
    }
    return results;
  }

  /**
   * Get safe status snapshots for all connectors.
   * NEVER includes credentials.
   * @returns {object[]}
   */
  getAllStatuses() {
    return [...this._connectors.values()].map(c => c.getStatus());
  }

  /**
   * Get safe status for one connector.
   * @param {string} connectorId
   * @returns {object|null}
   */
  getStatus(connectorId) {
    const c = this._connectors.get(connectorId);
    return c ? c.getStatus() : null;
  }

  /**
   * Build BroadcastDestination objects for all CONNECTED connectors.
   * Only connectors in CONNECTED status are included.
   *
   * @returns {Promise<{ destinations: object[], skipped: string[] }>}
   */
  async buildConnectedDestinations() {
    const destinations = [];
    const skipped      = [];

    for (const connector of this._connectors.values()) {
      const status = connector.getStatus().status;
      if (status !== PLATFORM_CONNECTION_STATUS.CONNECTED) {
        skipped.push(`${connector.connectorId} (${status})`);
        continue;
      }

      try {
        const r = await connector.getDestination();
        if (r.success && r.destination) {
          destinations.push(r.destination);
        } else {
          skipped.push(`${connector.connectorId} (${r.message})`);
        }
      } catch (err) {
        skipped.push(`${connector.connectorId} (error: ${err.message})`);
      }
    }

    return { destinations, skipped };
  }

  /**
   * Build BroadcastDestination for a single connector (regardless of status).
   * @param {string} connectorId
   * @returns {Promise<object>}
   */
  async getDestination(connectorId) {
    const connector = this._connectors.get(connectorId);
    if (!connector) {
      return {
        success: false, destination: null,
        message: `Connector "${connectorId}" not found.`,
        code:    PLATFORM_ERROR_CODE.NOT_CONFIGURED,
      };
    }
    return connector.getDestination();
  }

  /* ── Per-Connector Operations ──────────────────────────── */

  /**
   * Configure a specific connector.
   * @param {string} connectorId
   * @param {object} config
   */
  async configure(connectorId, config) {
    return this._invoke(connectorId, 'configure', config);
  }

  /**
   * Validate a specific connector.
   * @param {string} connectorId
   */
  async validate(connectorId) {
    return this._invoke(connectorId, 'validate');
  }

  /**
   * Connect a specific connector.
   * @param {string} connectorId
   */
  async connect(connectorId) {
    return this._invoke(connectorId, 'connect');
  }

  /**
   * Disconnect a specific connector.
   * @param {string} connectorId
   */
  async disconnect(connectorId) {
    return this._invoke(connectorId, 'disconnect');
  }

  /**
   * Refresh authentication for a specific connector.
   * @param {string} connectorId
   */
  async refreshAuthentication(connectorId) {
    return this._invoke(connectorId, 'refreshAuthentication');
  }

  /**
   * Test connection for a specific connector.
   * @param {string} connectorId
   */
  async testConnection(connectorId) {
    return this._invoke(connectorId, 'testConnection');
  }

  /**
   * Revoke credentials for a specific connector.
   * @param {string} connectorId
   */
  async revoke(connectorId) {
    return this._invoke(connectorId, 'revoke');
  }

  /* ── Private ───────────────────────────────────────────── */

  async _invoke(connectorId, method, ...args) {
    const connector = this._connectors.get(connectorId);
    if (!connector) {
      return {
        success: false,
        message: `Connector "${connectorId}" not found.`,
        code:    PLATFORM_ERROR_CODE.NOT_CONFIGURED,
      };
    }
    try {
      return await connector[method](...args);
    } catch (err) {
      CloudEngineLogger.warn(MODULE, 'CONNECTOR_INVOKE_ERROR',
        `Connector "${connectorId}".${method}() error: ${err.message}`);
      return {
        success: false,
        message: err.message,
        code:    err.code ?? PLATFORM_ERROR_CODE.CONNECTION_FAILED,
      };
    }
  }
}

/* ═══════════════════════════════════
   SHARED INSTANCE
═══════════════════════════════════ */
export const SharedPlatformManager = new PlatformManager();
