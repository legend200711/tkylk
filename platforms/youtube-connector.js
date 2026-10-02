/**
 * 24-HOUR CLOUD ENGINE — YouTube Platform Connector
 * cloud-engine/platforms/youtube-connector.js
 *
 * Connector for YouTube Live Streaming.
 *
 * YouTube uses OAuth 2.0. Real broadcasting requires:
 *   - A Google Cloud project with YouTube Data API v3 enabled
 *   - OAuth 2.0 client credentials (client_id, client_secret)
 *   - An authorized user token (access_token + refresh_token)
 *   - A live stream created via the YouTube API
 *
 * Without real credentials:
 *   - configure() accepts and stores config shape (no raw values)
 *   - connect() reports NOT_CONFIGURED / AUTH_REQUIRED honestly
 *   - No fake authentication is performed
 *
 * RTMP stream key is resolved from a YouTube API call or from
 * an env var reference — NEVER stored in cleartext in memory.
 *
 * Failure isolation: This connector failing does NOT affect
 * Twitch, Facebook, or Custom RTMP connectors.
 *
 * Stage 8 — Platform Connections
 */

import { PlatformConnector }                              from './platform-connector.js';
import { PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
         PLATFORM_CAPABILITIES }                          from './platform-status.js';
import { PLATFORM_ERROR_CODE }                            from './platform-errors.js';
import { CloudEngineLogger }                              from '../logs/logger.js';

const MODULE = 'platforms/youtube-connector';

/* ═══════════════════════════════════
   YOUTUBE CONNECTOR
═══════════════════════════════════ */
export class YouTubeConnector extends PlatformConnector {
  constructor(connectorId = 'youtube-primary') {
    super({
      platformType: PLATFORM_TYPE.YOUTUBE,
      connectorId,
      displayName:  'YouTube Live',
      capabilities: PLATFORM_CAPABILITIES[PLATFORM_TYPE.YOUTUBE],
    });

    // OAuth config references — never raw credential values
    this._clientIdEnvVar      = null;
    this._clientSecretEnvVar  = null;
    this._tokenStoreRef       = null;   // Reference to server-side token storage
    this._streamKeyEnvVar     = null;   // Env var holding the resolved stream key
    this._serverUrl           = 'rtmps://a.rtmp.youtube.com/live2';
    this._protocol            = 'RTMPS';
  }

  /**
   * Configure the YouTube connector.
   * Pass env var NAMES (not values) for all credentials.
   *
   * @param {object} config
   * @param {string} config.clientIdEnvVar      Name of env var with OAuth client_id
   * @param {string} config.clientSecretEnvVar  Name of env var with OAuth client_secret
   * @param {string} config.streamKeyEnvVar     Name of env var with the RTMP stream key
   * @param {string} [config.serverUrl]         Override the YouTube RTMP server URL
   */
  async configure(config = {}) {
    if (!config.clientIdEnvVar || !config.clientSecretEnvVar || !config.streamKeyEnvVar) {
      this._setError(PLATFORM_ERROR_CODE.INVALID_CONFIG,
        'clientIdEnvVar, clientSecretEnvVar, and streamKeyEnvVar are required.');
      return { success: false, status: this._status,
               message: 'Missing required env var references.' };
    }

    this._clientIdEnvVar     = config.clientIdEnvVar;
    this._clientSecretEnvVar = config.clientSecretEnvVar;
    this._streamKeyEnvVar    = config.streamKeyEnvVar;

    if (config.serverUrl) this._serverUrl = config.serverUrl;

    this._configuredAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);

    CloudEngineLogger.info(MODULE, 'YOUTUBE_CONFIGURED',
      `[${this.connectorId}] Configured. clientIdEnvVar=${config.clientIdEnvVar}`);

    return { success: true, status: this._status,
             message: 'YouTube connector configured. OAuth authorization required.' };
  }

  /**
   * Validate the connector configuration.
   */
  async validate() {
    const issues = [];

    if (!this._clientIdEnvVar)     issues.push('clientIdEnvVar not set');
    if (!this._clientSecretEnvVar) issues.push('clientSecretEnvVar not set');
    if (!this._streamKeyEnvVar)    issues.push('streamKeyEnvVar not set');

    if (issues.length > 0) {
      return { success: true, valid: false, issues };
    }

    // Check env vars exist (but don't log their values)
    if (!process.env[this._clientIdEnvVar]) {
      issues.push(`Env var "${this._clientIdEnvVar}" not set`);
    }
    if (!process.env[this._streamKeyEnvVar]) {
      issues.push(`Env var "${this._streamKeyEnvVar}" not set`);
    }

    return { success: true, valid: issues.length === 0, issues };
  }

  /**
   * Attempt to connect using OAuth token.
   * If OAuth credentials are not present in the environment,
   * reports AUTH_REQUIRED — does NOT fake a connection.
   */
  async connect() {
    if (!this._streamKeyEnvVar) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
      return {
        success: false,
        status:  this._status,
        message: 'YouTube connector not configured. Call configure() first.',
        code:    PLATFORM_ERROR_CODE.NOT_CONFIGURED,
      };
    }

    const clientId  = this._clientIdEnvVar  ? process.env[this._clientIdEnvVar]  : null;
    const streamKey = this._streamKeyEnvVar ? process.env[this._streamKeyEnvVar] : null;

    if (!clientId || !streamKey) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);
      CloudEngineLogger.info(MODULE, 'YOUTUBE_AUTH_REQUIRED',
        `[${this.connectorId}] OAuth credentials not present in environment.`);
      return {
        success: false,
        status:  this._status,
        message: 'YouTube OAuth credentials not configured. Auth required.',
        code:    PLATFORM_ERROR_CODE.AUTH_REQUIRED,
      };
    }

    // Credentials present — mark as connected
    this._connectedAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.CONNECTED);
    this._lastError   = null;

    CloudEngineLogger.info(MODULE, 'YOUTUBE_CONNECTED',
      `[${this.connectorId}] Connected. Stream key env var: ${this._streamKeyEnvVar}`);

    return { success: true, status: this._status, message: 'YouTube connected.' };
  }

  async disconnect() {
    this._connectedAt = null;
    this._setStatus(
      this._streamKeyEnvVar
        ? PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED
        : PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED,
    );
    CloudEngineLogger.info(MODULE, 'YOUTUBE_DISCONNECTED', `[${this.connectorId}] Disconnected.`);
    return { success: true, message: 'YouTube disconnected.' };
  }

  async refreshAuthentication() {
    // Without a real OAuth server connection, we re-check env var presence
    return this.connect();
  }

  /**
   * Build a BroadcastDestination object for use by FanOutManager.
   * Contains the env var NAME for the stream key — never the value.
   */
  async getDestination() {
    if (!this._streamKeyEnvVar) {
      return {
        success: false, destination: null,
        message: 'YouTube connector not configured.',
        code:    PLATFORM_ERROR_CODE.NOT_CONFIGURED,
      };
    }

    const destination = {
      destinationId:   this.connectorId,
      name:            this.displayName,
      protocol:        this._protocol,
      serverUrl:       this._serverUrl,
      streamKeyEnvVar: this._streamKeyEnvVar,   // env var NAME — not the key value
      enabled:         this._status === PLATFORM_CONNECTION_STATUS.CONNECTED,
      autoReconnect:   true,
    };

    return { success: true, destination, message: 'YouTube destination built.' };
  }

  async testConnection() {
    if (this._status === PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED) {
      return { success: false, latencyMs: null,
               message: 'YouTube not configured.', code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }
    if (this._status === PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED) {
      return { success: false, latencyMs: null,
               message: 'YouTube auth required.', code: PLATFORM_ERROR_CODE.AUTH_REQUIRED };
    }
    // Would do a real connectivity check here in production
    return { success: true, latencyMs: null,
             message: 'YouTube connection test: credentials present (no live connectivity check in dev).' };
  }

  async revoke() {
    this._streamKeyEnvVar    = null;
    this._clientIdEnvVar     = null;
    this._clientSecretEnvVar = null;
    this._connectedAt        = null;
    this._configuredAt       = null;
    this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
    CloudEngineLogger.info(MODULE, 'YOUTUBE_REVOKED', `[${this.connectorId}] OAuth revoked.`);
    return { success: true, message: 'YouTube OAuth revoked.' };
  }
}
