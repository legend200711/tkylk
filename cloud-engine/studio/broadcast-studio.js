/**
 * 24-HOUR CLOUD ENGINE — Broadcast Studio Service
 * cloud-engine/studio/broadcast-studio.js
 *
 * Creator-facing control service that powers the Broadcast Studio UI.
 *
 * This is NOT merely cosmetic. It is a clean service/controller that:
 *   - Exposes safe engine capabilities
 *   - Requires authorization for every operation
 *   - Orchestrates the full pipeline
 *   - Provides monitoring data
 *   - Feeds the event stream
 *   - Never exposes stream keys to the frontend
 *
 * Architecture:
 *   Broadcast Studio (this file)
 *     ↓
 *   Firebase Control Layer (firebase-control.js)
 *     ↓
 *   Live Ingest / Media Source (ingest-manager.js)
 *     ↓
 *   Shadow Encoder (shadow-encoder.js)
 *     ↓
 *   Multi-Platform Fan-Out (fanout-manager.js)
 *     ├── Destination 1
 *     ├── Destination 2
 *     └── Destination N
 *
 * Stage 7 — Broadcast Studio
 */

import { FanOutManager, FANOUT_STATE }                from '../broadcast/fanout-manager.js';
import { IngestManager, SharedIngestManager }         from '../ingest/ingest-manager.js';
import { INGEST_MANAGER_STATE }                       from '../ingest/ingest-manager.js';
import { SOURCE_TYPE, SOURCE_TYPE_STATUS }            from '../ingest/ingest-errors.js';
import { FirebaseControl,
         validateCommandContext,
         processControlCommand,
         CONTROL_COMMAND,
         CONTROL_COMMAND_STATE }                      from '../firebase/firebase-control.js';
import { getFirebaseControlStatus }                   from '../firebase/firebase-control.js';
import { getEngineStatus, getEngineUptime,
         ENGINE_VERSION }                             from '../core/engine.js';
import { CloudEngineEventBus }                        from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }                        from '../core/events.js';
import { ROLE, PERMISSION, hasPermission }            from '../security/permissions.js';
import { ShadowEncoder }                              from '../encoder/shadow-encoder.js';
import { ShadowBroadcastEngine }                      from '../broadcast/broadcast-engine.js';
import { CloudEngineLogger }                          from '../logs/logger.js';
import { StudioEventFeed, STUDIO_EVENT_TYPE }         from './studio-events.js';

const MODULE = 'studio/broadcast-studio';

/* ═══════════════════════════════════
   BROADCAST MODES
═══════════════════════════════════ */
export const BROADCAST_MODE = Object.freeze({
  LIVE:         'LIVE',          // Creator live input → encode → fan-out
  PRERECORDED:  'PRERECORDED',   // Prerecorded media → encode → fan-out
  TV_STATION:   'TV_STATION',    // NOT_IMPLEMENTED — Stage 10
  HYBRID:       'HYBRID',        // NOT_IMPLEMENTED — Stage 11
});

export const BROADCAST_MODE_STATUS = Object.freeze({
  [BROADCAST_MODE.LIVE]:        'OPERATIONAL',
  [BROADCAST_MODE.PRERECORDED]: 'OPERATIONAL',
  [BROADCAST_MODE.TV_STATION]:  'NOT_IMPLEMENTED',
  [BROADCAST_MODE.HYBRID]:      'NOT_IMPLEMENTED',
});

/* ═══════════════════════════════════
   STUDIO CONFIG SCHEMA
═══════════════════════════════════ */

/**
 * @typedef {object} BroadcastConfig
 * @property {string}    title          Broadcast title / name
 * @property {string}    mode           BROADCAST_MODE.*
 * @property {object}    sourceConfig   IngestSourceConfig
 * @property {string[]}  destinationIds Which registered destinations to include
 */

/* ═══════════════════════════════════
   BROADCAST STUDIO CLASS
═══════════════════════════════════ */

export class BroadcastStudio {
  /**
   * @param {object} [opts]
   * @param {FanOutManager}  [opts.fanOutManager]   Fan-out manager instance
   * @param {IngestManager}  [opts.ingestManager]   Ingest manager instance
   */
  constructor({ fanOutManager, ingestManager } = {}) {
    this._fanOut    = fanOutManager ?? new FanOutManager();
    this._ingest    = ingestManager ?? SharedIngestManager;
    this._eventFeed = new StudioEventFeed();

    // Active session state
    this._broadcastTitle     = null;
    this._broadcastMode      = null;
    this._broadcastStartedAt = null;
    this._activeIngestId     = null;
    this._pendingActions     = new Set();  // Confirmation-required actions in progress

    this._wireEngineEvents();
  }

  /* ════════════════════════════════
     DASHBOARD
  ════════════════════════════════ */

  /**
   * Get full dashboard state.
   * Safe — no stream keys, no secrets.
   *
   * @returns {object}
   */
  getDashboard() {
    const fanOutMetrics  = this._fanOut.getMultiBroadcastMetrics();
    const ingestStatus   = this._ingest.getStatus();
    const encoderStatus  = ShadowEncoder.getStatus();
    const broadcastLegacy = ShadowBroadcastEngine.getConnectionStatus();
    const engineSt       = getEngineStatus();

    return {
      // Engine
      engine: {
        status:       engineSt,
        version:      ENGINE_VERSION,
        uptime:       getEngineUptime(),
      },

      // Broadcast
      broadcast: {
        state:        fanOutMetrics.fanoutState,
        title:        this._broadcastTitle,
        mode:         this._broadcastMode,
        startedAt:    this._broadcastStartedAt,
        uptimeSec:    fanOutMetrics.uptimeSec,
        destinationCount:   fanOutMetrics.destinationCount,
        activeSessions:     fanOutMetrics.activeSessions,
        failedSessions:     fanOutMetrics.failedSessions,
        totalBytesSent:     fanOutMetrics.totalBytesSent,
      },

      // Ingest
      ingest: {
        state:           ingestStatus.state,
        activeSessionId: ingestStatus.activeSessionId,
        uptimeSec:       ingestStatus.uptimeSec,
        sourceType:      ingestStatus.activeSource?.sourceType ?? null,
      },

      // Destinations
      destinations: fanOutMetrics.destinations.map(d => ({
        destinationId:  d.destinationId,
        name:           d.name,
        state:          d.state,
        uptimeSec:      d.uptimeSec,
        bytesSent:      d.bytesSent,
        reconnectCount: d.reconnectCount,
        error:          d.lastError,
        // Stream key is NEVER included here
        streamKeyStatus: 'Configured',
      })),

      // Encoder (Stage 2 encoder status)
      encoder: {
        status: encoderStatus.state ?? 'UNINITIALIZED',
        metrics: null,   // Encoder metrics not polled here (available via getMonitoring())
      },

      // Firebase
      firebase: getFirebaseControlStatus(),
    };
  }

  /* ════════════════════════════════
     DESTINATION MANAGEMENT
  ════════════════════════════════ */

  /**
   * Add a destination to the studio.
   * Stream key is NEVER returned to the frontend after storage.
   *
   * @param {object} destination    BroadcastDestination config (with streamKeyEnvVar)
   * @param {object} authCtx        { userId, userRole, ownerId }
   * @returns {{ success: boolean, message: string, destinationId?: string }}
   */
  addDestination(destination, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.MANAGE_DESTINATIONS, 'addDestination');
    if (!check.ok) return check.result;

    const result = this._fanOut.addDestination(destination);
    if (result.success) {
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_ADDED, {
        destinationId: destination.destinationId,
        name:          destination.name,
        protocol:      destination.protocol,
        serverUrl:     destination.serverUrl,
        // streamKeyEnvVar is the env variable NAME (not the value) — safe to include
        streamKeyEnvVar: destination.streamKeyEnvVar,
        streamKey:     'Configured',  // NEVER the actual key
      });
    }
    return result;
  }

  /**
   * Remove a destination from the studio.
   * @param {string} destinationId
   * @param {object} authCtx
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async removeDestination(destinationId, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.MANAGE_DESTINATIONS, 'removeDestination');
    if (!check.ok) return check.result;

    const result = await this._fanOut.removeDestination(destinationId);
    if (result.success) {
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_REMOVED, { destinationId });
    }
    return result;
  }

  /**
   * Reconnect a failed destination.
   * @param {string} destinationId
   * @param {object} authCtx
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async reconnectDestination(destinationId, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.MANAGE_DESTINATIONS, 'reconnectDestination');
    if (!check.ok) return check.result;

    return this._fanOut.restartDestination(destinationId);
  }

  /**
   * Get safe destination status (stream key is masked as 'Configured').
   * @param {string} destinationId
   * @returns {object|null}
   */
  getDestinationInfo(destinationId) {
    const status = this._fanOut.getDestinationStatus(destinationId);
    if (!status) return null;
    return {
      ...status,
      streamKey: 'Configured',   // NEVER expose the actual stream key
    };
  }

  /**
   * Get all destinations (safe).
   * @returns {object[]}
   */
  getAllDestinations() {
    return this._fanOut.getAllDestinationStatuses().map(s => ({
      ...s,
      streamKey: 'Configured',
    }));
  }

  /* ════════════════════════════════
     GO LIVE
  ════════════════════════════════ */

  /**
   * Configure and start a live broadcast.
   *
   * Orchestration:
   * 1. Validate config and authorization
   * 2. Create ingest session for the source
   * 3. Start ingest
   * 4. Start fan-out to all enabled destinations
   *
   * @param {BroadcastConfig} broadcastConfig
   * @param {object}          engineParams    { ffmpegPath }
   * @param {object}          authCtx         { userId, userRole, ownerId }
   * @returns {Promise<object>}
   */
  async goLive(broadcastConfig, engineParams = {}, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.START_BROADCAST, 'goLive');
    if (!check.ok) return check.result;

    const { title, mode, sourceConfig, destinationIds } = broadcastConfig;

    if (!title || typeof title !== 'string') {
      return { success: false, message: 'Broadcast title is required.' };
    }

    if (!mode || !BROADCAST_MODE[mode]) {
      return { success: false, message: `Invalid broadcast mode: "${mode}". Valid: ${Object.values(BROADCAST_MODE).join(', ')}` };
    }

    if (BROADCAST_MODE_STATUS[mode] === 'NOT_IMPLEMENTED') {
      return { success: false, message: `Broadcast mode "${mode}" is not yet implemented.` };
    }

    if (!sourceConfig) {
      return { success: false, message: 'sourceConfig is required.' };
    }

    if (!engineParams.ffmpegPath) {
      return { success: false, message: 'engineParams.ffmpegPath is required.' };
    }

    // 1. Create ingest session
    const ingestResult = await this._ingest.createSession(sourceConfig);
    if (!ingestResult.success) {
      return { success: false, message: `Ingest setup failed: ${ingestResult.message}` };
    }
    this._activeIngestId = ingestResult.sessionId;

    // 2. Start ingest
    const startIngestResult = await this._ingest.startIngest(ingestResult.sessionId);
    if (!startIngestResult.success) {
      return { success: false, message: `Ingest start failed: ${startIngestResult.message}` };
    }

    const inputPath = startIngestResult.inputPath;
    if (!inputPath) {
      return { success: false, message: 'Ingest source did not return an inputPath.' };
    }

    // 3. Store broadcast metadata
    this._broadcastTitle     = title;
    this._broadcastMode      = mode;
    this._broadcastStartedAt = new Date().toISOString();

    // 4. Start fan-out
    const fanOutResult = await this._fanOut.startMultiBroadcast({
      inputPath,
      ffmpegPath:     engineParams.ffmpegPath,
      destinationIds: destinationIds ?? undefined,
    });

    if (!fanOutResult.success) {
      // Stop ingest if fan-out failed
      await this._ingest.stopIngest().catch(() => {});
      this._broadcastTitle = null;
      this._broadcastMode  = null;
      return { success: false, message: `Fan-out failed: ${fanOutResult.message}` };
    }

    this._eventFeed.push(STUDIO_EVENT_TYPE.BROADCAST_STARTED, {
      title, mode,
      sourceType:  sourceConfig.sourceType,
      startedAt:   this._broadcastStartedAt,
    });

    CloudEngineLogger.info(MODULE, 'GO_LIVE',
      `Broadcast started: "${title}" (${mode}) from "${sourceConfig.sourceType}"`);

    return {
      success: true,
      message: 'Broadcast started.',
      title,
      mode,
      ingestSessionId: ingestResult.sessionId,
      inputPath,
      fanOut: fanOutResult,
    };
  }

  /* ════════════════════════════════
     STOP BROADCAST
  ════════════════════════════════ */

  /**
   * Stop the active broadcast.
   * Stops all fan-out sessions and the ingest source.
   * Requires confirmation: pass { confirmed: true } in params.
   *
   * @param {object} params       { confirmed: boolean }
   * @param {object} authCtx      { userId, userRole, ownerId }
   * @returns {Promise<object>}
   */
  async stopBroadcast(params = {}, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.STOP_BROADCAST, 'stopBroadcast');
    if (!check.ok) return check.result;

    if (!params.confirmed) {
      return {
        success:   false,
        message:   'Stopping the broadcast is a destructive action. Pass { confirmed: true } to confirm.',
        requiresConfirmation: true,
      };
    }

    // Stop fan-out
    const fanOutStop = await this._fanOut.stopMultiBroadcast();

    // Stop ingest
    const ingestStop = await this._ingest.stopIngest();

    const title = this._broadcastTitle;
    this._broadcastTitle     = null;
    this._broadcastMode      = null;
    this._broadcastStartedAt = null;
    this._activeIngestId     = null;

    this._eventFeed.push(STUDIO_EVENT_TYPE.BROADCAST_STOPPED, {
      title, stoppedAt: new Date().toISOString(),
    });

    CloudEngineLogger.info(MODULE, 'BROADCAST_STOPPED',
      `Broadcast "${title}" stopped.`);

    return {
      success: true,
      message: 'Broadcast stopped.',
      fanOut:  fanOutStop,
      ingest:  ingestStop,
    };
  }

  /* ════════════════════════════════
     INGEST CONTROLS
  ════════════════════════════════ */

  /**
   * Start ingest from a pre-created session.
   * @param {string} sessionId
   * @param {object} authCtx
   * @returns {Promise<object>}
   */
  async startIngest(sessionId, authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.START_BROADCAST, 'startIngest');
    if (!check.ok) return check.result;

    const result = await this._ingest.startIngest(sessionId);
    if (result.success) {
      this._activeIngestId = sessionId;
      this._eventFeed.push(STUDIO_EVENT_TYPE.INGEST_STARTED, { sessionId });
    }
    return result;
  }

  /**
   * Stop the active ingest.
   * @param {object} authCtx
   * @returns {Promise<object>}
   */
  async stopIngest(authCtx = {}) {
    const check = this._auth(authCtx, PERMISSION.STOP_BROADCAST, 'stopIngest');
    if (!check.ok) return check.result;

    const result = await this._ingest.stopIngest();
    if (result.success) {
      this._activeIngestId = null;
      this._eventFeed.push(STUDIO_EVENT_TYPE.INGEST_STOPPED, {});
    }
    return result;
  }

  /* ════════════════════════════════
     MONITORING
  ════════════════════════════════ */

  /**
   * Get comprehensive monitoring data for the broadcast studio.
   * Never fabricates unavailable metrics.
   *
   * @returns {object}
   */
  getMonitoring() {
    const fanOutMetrics  = this._fanOut.getMultiBroadcastMetrics();
    const ingestMetrics  = this._ingest.getActiveMetrics();
    const encoderStatus  = ShadowEncoder.getStatus();
    const encoderMetrics = ShadowEncoder.getMetrics();

    return {
      timestamp:  new Date().toISOString(),

      // Encoder health
      encoder: {
        state:          encoderStatus.state ?? 'UNINITIALIZED',
        speed:          encoderMetrics?.speed          ?? null,
        fps:            encoderMetrics?.fps            ?? null,
        bitrate:        encoderMetrics?.videoBitrate   ?? null,
        droppedFrames:  encoderMetrics?.droppedFrames  ?? null,
        timingStatus:   encoderMetrics?.timingStatus   ?? null,  // NORMAL | BEHIND | STALLED
        health:         _deriveEncoderHealth(encoderMetrics),
      },

      // Ingest health
      ingest: {
        state:          this._ingest.getStatus().state,
        connected:      ingestMetrics?.connected    ?? false,
        sourceType:     ingestMetrics?.sourceType   ?? null,
        health:         ingestMetrics?.health       ?? null,
        uptimeSec:      ingestMetrics?.uptimeSec    ?? null,
        videoPresent:   ingestMetrics?.videoPresent ?? null,
        audioPresent:   ingestMetrics?.audioPresent ?? null,
        inputFps:       ingestMetrics?.inputFps     ?? null,
        resolution:     ingestMetrics?.resolution   ?? null,
        lastError:      ingestMetrics?.lastError    ?? null,
      },

      // Per-destination health
      destinations: fanOutMetrics.destinations.map(d => ({
        destinationId:  d.destinationId,
        name:           d.name,
        state:          d.state,
        uptimeSec:      d.uptimeSec      ?? null,
        bytesSent:      d.bytesSent      ?? null,
        reconnectCount: d.reconnectCount ?? null,
        lastError:      d.lastError      ? { code: d.lastError.code, message: d.lastError.message } : null,
        // streamKey is NEVER included here
      })),

      // Aggregate broadcast
      broadcast: {
        fanoutState:      fanOutMetrics.fanoutState,
        activeSessions:   fanOutMetrics.activeSessions,
        failedSessions:   fanOutMetrics.failedSessions,
        totalBytesSent:   fanOutMetrics.totalBytesSent,
        uptimeSec:        fanOutMetrics.uptimeSec,
        reconnectTotal:   fanOutMetrics.reconnectTotal,
      },
    };
  }

  /* ════════════════════════════════
     EVENT FEED
  ════════════════════════════════ */

  /**
   * Get recent safe events from the event feed.
   * @param {number} [limit]
   * @returns {object[]}
   */
  getEventFeed(limit = 50) {
    return this._eventFeed.getRecent(limit);
  }

  /**
   * Subscribe to live studio events.
   * @param {Function} listener
   * @returns {Function} unsubscribe
   */
  subscribeToEvents(listener) {
    return this._eventFeed.subscribe(listener);
  }

  /* ════════════════════════════════
     FIREBASE CONTROL COMMANDS
     Process a control command through the Firebase control plane.
  ════════════════════════════════ */

  /**
   * Process a Firebase control command.
   * @param {object} ctx   Command context (see firebase-control.js)
   * @returns {Promise<object>}
   */
  async processCommand(ctx) {
    return processControlCommand(ctx, {
      fanOutManager:    this._fanOut,
      ingestManager:    this._ingest,
      getEngineStatus:  getEngineStatus,
    });
  }

  /* ════════════════════════════════
     PRIVATE
  ════════════════════════════════ */

  /**
   * Authorization check helper.
   * @param {object} authCtx     { userId, userRole, ownerId }
   * @param {string} permission  PERMISSION.*
   * @param {string} operation   For logging
   * @returns {{ ok: boolean, result?: object }}
   */
  _auth(authCtx, permission, operation) {
    if (!authCtx || !authCtx.userId || !authCtx.userRole) {
      return {
        ok: false,
        result: { success: false, message: `${operation}: Authentication required.` },
      };
    }
    if (!hasPermission(authCtx.userRole, permission)) {
      CloudEngineLogger.warn(MODULE, 'AUTH_DENIED',
        `"${operation}" denied for role ${authCtx.userRole}: missing permission ${permission}`);
      return {
        ok: false,
        result: { success: false, message: `Insufficient permissions for "${operation}".` },
      };
    }
    return { ok: true };
  }

  /** Wire engine event bus to the studio event feed. */
  _wireEngineEvents() {
    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.BROADCAST_STARTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.BROADCAST_STARTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.BROADCAST_STOPPED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.BROADCAST_STOPPED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.DESTINATION_CONNECTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_CONNECTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.DESTINATION_DISCONNECTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_DISCONNECTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.DESTINATION_RECONNECTING, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_RECONNECTING, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.DESTINATION_RECONNECTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.DESTINATION_RECONNECTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.INGEST_STARTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.INGEST_STARTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.INGEST_STOPPED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.INGEST_STOPPED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.INGEST_SOURCE_DISCONNECTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.INGEST_SOURCE_DISCONNECTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.ENCODER_STARTED, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.ENCODER_STARTED, d));

    CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.ENCODER_ERROR, (d) =>
      this._eventFeed.push(STUDIO_EVENT_TYPE.ENCODER_ERROR, d));
  }
}

/* ═══════════════════════════════════
   ENCODER HEALTH HELPER
═══════════════════════════════════ */

function _deriveEncoderHealth(metrics) {
  if (!metrics) return null;
  const timing = metrics.timingStatus;
  if (!timing) return null;
  if (timing === 'STALLED') return 'ERROR';
  if (timing === 'BEHIND')  return 'DEGRADED';
  if (timing === 'NORMAL')  return 'OK';
  return null;
}

/* ═══════════════════════════════════
   SHARED INSTANCE
═══════════════════════════════════ */
export const StudioService = new BroadcastStudio();
