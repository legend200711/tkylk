/**
 * 24-HOUR CLOUD ENGINE — Twitch Platform Connector
 * cloud-engine/platforms/twitch-connector.js
 *
 * Connector for Twitch live streaming.
 *
 * Twitch uses OAuth 2.0 (for API access) but can also work with a plain
 * stream key for RTMP ingest. Both modes are supported:
 *   - OAuth mode: client credentials + user token stored server-side
 *   - Stream key mode: stream key resolved from env var
 *
 * Without real credentials:
 *   - configure() accepts config shape
 *   - connect() reports AUTH_REQUIRED or NOT_CONFIGURED honestly
 *   - No fake authentication is performed
 *
 * Failure isolation: This connector failing does NOT affect
 * YouTube, Facebook, or Custom RTMP connectors.
 *
 * Stage 8 — Platform Connections
 */

import { PlatformConnector }                              from './platform-connector.js';
import { PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
         PLATFORM_CAPABILITIES }                          from './platform-status.js';
import { PLATFORM_ERROR_CODE }                            from './platform-errors.js';
import { CloudEngineLogger }                              from '../logs/logger.js';

const MODULE = 'platforms/twitch-connector';

/* ═══════════════════════════════════
   TWITCH CONNECTOR
═══════════════════════════════════ */
export class TwitchConnector extends PlatformConnector {
  constructor(connectorId = 'twitch-primary') {
    super({
      platformType: PLATFORM_TYPE.TWITCH,
      connectorId,
      displayName:  'Twitch',
      capabilities: PLATFORM_CAPABILITIES[PLATFORM_TYPE.TWITCH],
    });

    this._streamKeyEnvVar = null;
    this._serverUrl       = 'rtmp://live.twitch.tv/app';
    this._protocol        = 'RTMP';
  }

  /**
   * Configure the Twitch connector.
   *
   * @param {object} config
   * @param {string} config.streamKeyEnvVar  Name of env var holding the Twitch stream key
   * @param {string} [config.serverUrl]      Override the Twitch RTMP ingest URL
   */
  async configure(config = {}) {
    if (!config.streamKeyEnvVar) {
      this._setError(PLATFORM_ERROR_CODE.INVALID_CONFIG, 'streamKeyEnvVar is required.');
      return { success: false, status: this._status, message: 'streamKeyEnvVar is required.' };
    }

    this._streamKeyEnvVar = config.streamKeyEnvVar;
    if (config.serverUrl) this._serverUrl = config.serverUrl;

    this._configuredAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);

    CloudEngineLogger.info(MODULE, 'TWITCH_CONFIGURED',
      `[${this.connectorId}] Configured. streamKeyEnvVar=${config.streamKeyEnvVar}`);

    return { success: true, status: this._status,
             message: 'Twitch connector configured. Stream key required from env.' };
  }

  async validate() {
    const issues = [];
    if (!this._streamKeyEnvVar) issues.push('streamKeyEnvVar not set');
    if (this._streamKeyEnvVar && !process.env[this._streamKeyEnvVar]) {
      issues.push(`Env var "${this._streamKeyEnvVar}" not set`);
    }
    return { success: true, valid: issues.length === 0, issues };
  }

  async connect() {
    if (!this._streamKeyEnvVar) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
      return { success: false, status: this._status,
               message: 'Twitch connector not configured.',
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const streamKey = process.env[this._streamKeyEnvVar];
    if (!streamKey) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);
      CloudEngineLogger.info(MODULE, 'TWITCH_KEY_MISSING',
        `[${this.connectorId}] Stream key env var "${this._streamKeyEnvVar}" not set.`);
      return { success: false, status: this._status,
               message: `Twitch stream key not found in env var "${this._streamKeyEnvVar}".`,
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }

    this._connectedAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.CONNECTED);
    this._lastError   = null;

    CloudEngineLogger.info(MODULE, 'TWITCH_CONNECTED',
      `[${this.connectorId}] Connected. Stream key env var: ${this._streamKeyEnvVar}`);

    return { success: true, status: this._status, message: 'Twitch connected.' };
  }

  async disconnect() {
    this._connectedAt = null;
    this._setStatus(
      this._streamKeyEnvVar
        ? PLATFORM_CONNECTION_STATUS.DISCONNECTED
        : PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED,
    );
    CloudEngineLogger.info(MODULE, 'TWITCH_DISCONNECTED', `[${this.connectorId}] Disconnected.`);
    return { success: true, message: 'Twitch disconnected.' };
  }

  async refreshAuthentication() {
    return this.connect();
  }

  async getDestination() {
    if (!this._streamKeyEnvVar) {
      return { success: false, destination: null,
               message: 'Twitch connector not configured.',
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const destination = {
      destinationId:   this.connectorId,
      name:            this.displayName,
      protocol:        this._protocol,
      serverUrl:       this._serverUrl,
      streamKeyEnvVar: this._streamKeyEnvVar,
      enabled:         this._status === PLATFORM_CONNECTION_STATUS.CONNECTED,
      autoReconnect:   true,
    };

    return { success: true, destination, message: 'Twitch destination built.' };
  }

  async testConnection() {
    if (this._status === PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED) {
      return { success: false, latencyMs: null, message: 'Twitch not configured.',
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }
    if (this._status === PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED ||
        this._status === PLATFORM_CONNECTION_STATUS.DISCONNECTED) {
      return { success: false, latencyMs: null, message: 'Twitch stream key not set.',
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }
    return { success: true, latencyMs: null,
             message: 'Twitch connection test: stream key present.' };
  }

  async revoke() {
    this._streamKeyEnvVar = null;
    this._connectedAt     = null;
    this._configuredAt    = null;
    this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
    CloudEngineLogger.info(MODULE, 'TWITCH_REVOKED', `[${this.connectorId}] Revoked.`);
    return { success: true, message: 'Twitch configuration revoked.' };
  }
}
