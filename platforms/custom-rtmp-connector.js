/**
 * 24-HOUR CLOUD ENGINE — Custom RTMP/RTMPS Connector
 * cloud-engine/platforms/custom-rtmp-connector.js
 *
 * Connector for custom RTMP and RTMPS destinations.
 * This does NOT require OAuth — uses a stream key from an env var.
 *
 * Custom destinations are always fully supported:
 *   - User supplies: destination name, RTMP/RTMPS server URL, stream key env var
 *   - The actual stream key remains in the environment, never exposed
 *   - Works with any RTMP-compatible streaming software / service
 *
 * Failure isolation: One custom destination failing does NOT affect others
 * or any platform connector.
 *
 * Stage 8 — Platform Connections
 */

import { PlatformConnector }                              from './platform-connector.js';
import { PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
         PLATFORM_CAPABILITIES }                          from './platform-status.js';
import { PLATFORM_ERROR_CODE }                            from './platform-errors.js';
import { CloudEngineLogger }                              from '../logs/logger.js';

const MODULE = 'platforms/custom-rtmp-connector';

/* ═══════════════════════════════════
   CUSTOM RTMP/RTMPS CONNECTOR
═══════════════════════════════════ */
export class CustomRtmpConnector extends PlatformConnector {
  /**
   * @param {object} opts
   * @param {string} opts.connectorId   Unique ID for this connector (e.g. 'custom-obs-relay')
   * @param {string} [opts.displayName] Human-readable name
   * @param {string} [opts.protocol]    'CUSTOM_RTMP' or 'CUSTOM_RTMPS' (default: CUSTOM_RTMP)
   */
  constructor({ connectorId, displayName, protocol = PLATFORM_TYPE.CUSTOM_RTMP } = {}) {
    if (!connectorId) throw new Error('CustomRtmpConnector requires a connectorId.');

    const platformType = protocol === PLATFORM_TYPE.CUSTOM_RTMPS
      ? PLATFORM_TYPE.CUSTOM_RTMPS
      : PLATFORM_TYPE.CUSTOM_RTMP;

    super({
      platformType,
      connectorId,
      displayName:  displayName ?? `Custom RTMP (${connectorId})`,
      capabilities: PLATFORM_CAPABILITIES[platformType] ??
                    PLATFORM_CAPABILITIES[PLATFORM_TYPE.CUSTOM_RTMP],
    });

    this._serverUrl       = null;
    this._streamKeyEnvVar = null;
    this._rtmpProtocol    = platformType === PLATFORM_TYPE.CUSTOM_RTMPS ? 'RTMPS' : 'RTMP';
  }

  /**
   * Configure the custom RTMP destination.
   *
   * @param {object} config
   * @param {string} config.serverUrl       Full RTMP/RTMPS server URL (no stream key)
   * @param {string} config.streamKeyEnvVar Name of env var holding the stream key
   * @param {string} [config.displayName]   Override display name
   */
  async configure(config = {}) {
    const issues = [];

    if (!config.serverUrl)       issues.push('serverUrl is required');
    if (!config.streamKeyEnvVar) issues.push('streamKeyEnvVar is required');

    if (config.serverUrl) {
      const expectedPrefix = this._rtmpProtocol === 'RTMPS' ? 'rtmps://' : 'rtmp://';
      if (!config.serverUrl.toLowerCase().startsWith(expectedPrefix)) {
        issues.push(`serverUrl must start with "${expectedPrefix}" for ${this._rtmpProtocol}`);
      }
    }

    if (issues.length > 0) {
      this._setError(PLATFORM_ERROR_CODE.INVALID_CONFIG, issues.join('; '));
      return { success: false, status: this._status, message: issues.join('; ') };
    }

    this._serverUrl       = config.serverUrl;
    this._streamKeyEnvVar = config.streamKeyEnvVar;
    if (config.displayName) this.displayName = config.displayName;

    this._configuredAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.DISCONNECTED);

    CloudEngineLogger.info(MODULE, 'CUSTOM_RTMP_CONFIGURED',
      `[${this.connectorId}] Configured. server=${this._serverUrl} keyVar=${this._streamKeyEnvVar}`);

    return { success: true, status: this._status,
             message: `Custom ${this._rtmpProtocol} connector configured.` };
  }

  async validate() {
    const issues = [];
    if (!this._serverUrl)       issues.push('serverUrl not set (call configure() first)');
    if (!this._streamKeyEnvVar) issues.push('streamKeyEnvVar not set');
    if (this._streamKeyEnvVar && !process.env[this._streamKeyEnvVar]) {
      issues.push(`Env var "${this._streamKeyEnvVar}" not set`);
    }
    return { success: true, valid: issues.length === 0, issues };
  }

  async connect() {
    if (!this._serverUrl || !this._streamKeyEnvVar) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED);
      return { success: false, status: this._status,
               message: `Custom ${this._rtmpProtocol} connector not configured.`,
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const streamKey = process.env[this._streamKeyEnvVar];
    if (!streamKey) {
      this._setStatus(PLATFORM_CONNECTION_STATUS.AUTH_REQUIRED);
      CloudEngineLogger.warn(MODULE, 'CUSTOM_RTMP_KEY_MISSING',
        `[${this.connectorId}] Stream key env var "${this._streamKeyEnvVar}" not set.`);
      return { success: false, status: this._status,
               message: `Stream key env var "${this._streamKeyEnvVar}" not found.`,
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }

    this._connectedAt = new Date().toISOString();
    this._setStatus(PLATFORM_CONNECTION_STATUS.CONNECTED);
    this._lastError   = null;

    CloudEngineLogger.info(MODULE, 'CUSTOM_RTMP_CONNECTED',
      `[${this.connectorId}] Connected. protocol=${this._rtmpProtocol} server=${this._serverUrl}`);

    return { success: true, status: this._status,
             message: `Custom ${this._rtmpProtocol} connected.` };
  }

  async disconnect() {
    this._connectedAt = null;
    this._setStatus(
      this._serverUrl ? PLATFORM_CONNECTION_STATUS.DISCONNECTED
                      : PLATFORM_CONNECTION_STATUS.NOT_CONFIGURED,
    );
    CloudEngineLogger.info(MODULE, 'CUSTOM_RTMP_DISCONNECTED',
      `[${this.connectorId}] Disconnected.`);
    return { success: true, message: `Custom ${this._rtmpProtocol} disconnected.` };
  }

  // refreshAuthentication and revoke: not applicable — stream key based
  async refreshAuthentication() {
    return {
      success: false,
      message: `refreshAuthentication not supported for custom ${this._rtmpProtocol}.`,
      code:    PLATFORM_ERROR_CODE.OPERATION_NOT_SUPPORTED,
    };
  }

  async getDestination() {
    if (!this._serverUrl || !this._streamKeyEnvVar) {
      return { success: false, destination: null,
               message: `Custom ${this._rtmpProtocol} not configured.`,
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const destination = {
      destinationId:   this.connectorId,
      name:            this.displayName,
      protocol:        this._rtmpProtocol,
      serverUrl:       this._serverUrl,
      streamKeyEnvVar: this._streamKeyEnvVar,
      enabled:         this._status === PLATFORM_CONNECTION_STATUS.CONNECTED,
      autoReconnect:   true,
    };

    return { success: true, destination, message: `Custom ${this._rtmpProtocol} destination built.` };
  }

  async testConnection() {
    if (!this._serverUrl || !this._streamKeyEnvVar) {
      return { success: false, latencyMs: null,
               message: `Custom ${this._rtmpProtocol} not configured.`,
               code: PLATFORM_ERROR_CODE.NOT_CONFIGURED };
    }

    const streamKey = process.env[this._streamKeyEnvVar];
    if (!streamKey) {
      return { success: false, latencyMs: null,
               message: `Stream key env var "${this._streamKeyEnvVar}" not set.`,
               code: PLATFORM_ERROR_CODE.STREAM_KEY_MISSING };
    }

    return { success: true, latencyMs: null,
             message: `Custom ${this._rtmpProtocol}: config and stream key present.` };
  }

  async revoke() {
    return {
      success: false,
      message: `revoke not applicable for custom ${this._rtmpProtocol}.`,
      code:    PLATFORM_ERROR_CODE.OPERATION_NOT_SUPPORTED,
    };
  }
}
