/**
 * 24-HOUR CLOUD ENGINE — Facebook Platform Connector
 * cloud-engine/platforms/facebook-connector.js
 *
 * Connector for Facebook Live streaming.
 *
 * Facebook Live uses an RTMPS ingest endpoint with a stream key that
 * is generated server-side via the Facebook Graph API (OAuth 2.0 app token).
 *
 * Without real credentials:
 *   - configure() accepts config shape (env var references only)
 *   - connect() reports NOT_CONFIGURED / AUTH_REQUIRED honestly
 *   - No fake API call is made
 *
 * Failure isolation: This connector failing does NOT affect
 * YouTube, Twitch, or Custom RTMP connectors.
 *
 * Stage 8 — Platform Connections
 */

import { PlatformConnector }                              from './platform-connector.js';
import { PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
         PLATFORM_CAPABILITIES }                          from './platform-status.js';
import { PLATFORM_ERROR_CODE }                            from './platform-errors.js';
import { CloudEngineLogger }                              from '../logs/logger.js';

const MODULE = 'platforms/facebook-connector';

/* ═══════════════════════════════════
   FACEBOOK CONNECTOR
═══════════════════════════════════ */
export class FacebookConnector extends PlatformConnector {
  constructor(connectorId = 'facebook-primary') {
    super({
      platformType: PLATFORM_TYPE.FACEBOOK,
      connectorId,
      displayName:  'Facebook Live',
      capabilities: PLATFORM_CAPABILITIES[PLATFORM_TYPE.FACEBOOK],
    });

    this._appTokenEnvVar  = null;
    this._streamKeyEnvVar = null;
    this._serverUrl       = 'rtmps://live-api-s.facebook.com:443/rtmp/';
    this._protocol        = 'RTMPS';
  }

  /**
   * Configure the Facebook connector.
   *
   * @param {object} config
   * @param {string} config.streamKeyEnvVar  Name of env var holding the Facebook stream key
   * @param {string} [config.appTokenEnvVar] Name of env var holding the Facebook app token
   * @param {string} [config.serverUrl]      Override the Facebook RTMPS server URL
   */
  async configure(config = {}) {
    if (!config.streamKeyEnvVar) {
      this._setError(PLATFORM_ERROR_CODE.INVALID_CONFIG, 'streamKeyEnvVar is required.');
      return { success: false, status: this._status, message: 'streamKeyEnvVar is required.' };
    }

    this._streamKeyEnvVar = config.streamKeyEnvVar;
    if (config.appTokenEnvVar) this._appTokenEnvVar = config.appTokenEnvVar;
    if (config.serverUrl)      this._serverUrl      = config.serverUrl;

    this._configuredAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);

    CloudEngineLogger.info(MODULE, 'FACEBOOK_CONFIGURED',
      `[${this.connectorId}] Configured. streamKeyEnvVar=${config.streamKeyEnvVar}`);

    return { success: true, status: this._status,
             message: 'Facebook connector configured. Stream key required from env.' };
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
               message: 'Facebook connector not configured.',
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const streamKey = process.env[this._streamKeyEnvVar];
    if (!streamKey) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);
      CloudEngineLogger.info(MODULE, 'FACEBOOK_KEY_MISSING',
        `[${this.connectorId}] Stream key env var "${this._streamKeyEnvVar}" not set.`);
      return { success: false, status: this._status,
               message: `Facebook stream key not found in env var "${this._streamKeyEnvVar}".`,
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }

    this._connectedAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.CONNECTED);
    this._lastError   = null;

    CloudEngineLogger.info(MODULE, 'FACEBOOK_CONNECTED',
      `[${this.connectorId}] Connected. Stream key env var: ${this._streamKeyEnvVar}`);

    return { success: true, status: this._status, message: 'Facebook connected.' };
  }

  async disconnect() {
    this._connectedAt = null;
    this._setStatus(
      this._streamKeyEnvVar
        ? PLATFORM_CONNECTION_STATUS.DISCONNECTED
        : PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED,
    );
    CloudEngineLogger.info(MODULE, 'FACEBOOK_DISCONNECTED', `[${this.connectorId}] Disconnected.`);
    return { success: true, message: 'Facebook disconnected.' };
  }

  async refreshAuthentication() {
    return this.connect();
  }

  async getDestination() {
    if (!this._streamKeyEnvVar) {
      return { success: false, destination: null,
               message: 'Facebook connector not configured.',
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

    return { success: true, destination, message: 'Facebook destination built.' };
  }

  async testConnection() {
    if (this._status === PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED) {
      return { success: false, latencyMs: null, message: 'Facebook not configured.',
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }
    if (this._status === PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED ||
        this._status === PLATFORM_CONNECTION_STATUS.DISCONNECTED) {
      return { success: false, latencyMs: null, message: 'Facebook stream key not set.',
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }
    return { success: true, latencyMs: null,
             message: 'Facebook connection test: stream key present.' };
  }

  async revoke() {
    this._streamKeyEnvVar = null;
    this._appTokenEnvVar  = null;
    this._connectedAt     = null;
    this._configuredAt    = null;
    this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
    CloudEngineLogger.info(MODULE, 'FACEBOOK_REVOKED', `[${this.connectorId}] Revoked.`);
    return { success: true, message: 'Facebook configuration revoked.' };
  }
}
