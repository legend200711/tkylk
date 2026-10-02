/**
 * 24-HOUR CLOUD ENGINE — Ingest Manager
 * cloud-engine/ingest/ingest-manager.js
 *
 * Central manager for all ingest sessions.
 *
 * The ingest subsystem is intentionally SEPARATE from the broadcast/encoder
 * subsystems. It provides stream sources but does not control encoding or transport.
 *
 * Architecture:
 *   LIVE SOURCE
 *     ↓
 *   INGEST MANAGER (this file)
 *     ↓  (provides inputPath / stream source)
 *   SHADOW ENCODER
 *     ↓
 *   FAN-OUT ENGINE
 *     ↓
 *   DESTINATIONS
 *
 * The source is replaceable without redesigning the broadcast engine.
 * Simply call replaceSource() to swap to a new ingest session.
 *
 * Stage 5 — Live Input / Ingest
 */

import EventEmitter from 'events';
import { randomUUID }          from 'crypto';
import { IngestSession,
         INGEST_SESSION_STATE,
         INGEST_SESSION_EVENT } from './ingest-session.js';
import { SOURCE_TYPE,
         SOURCE_TYPE_STATUS,
         IngestError,
         INGEST_ERROR_CODE }   from './ingest-errors.js';
import { CloudEngineLogger }   from '../logs/logger.js';
import { CloudEngineEventBus } from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS } from '../core/events.js';

const MODULE = 'ingest/ingest-manager';

/* ═══════════════════════════════════
   INGEST MANAGER STATE
═══════════════════════════════════ */
export const INGEST_MANAGER_STATE = Object.freeze({
  IDLE:          'IDLE',
  ACTIVE:        'ACTIVE',
  SWITCHING:     'SWITCHING',    // Replacing source mid-broadcast
  STOPPED:       'STOPPED',
});

/* ═══════════════════════════════════
   INGEST MANAGER CLASS
═══════════════════════════════════ */

export class IngestManager extends EventEmitter {
  constructor() {
    super();
    this._sessions       = new Map();   // sessionId → IngestSession
    this._activeSession  = null;        // Currently active session ID
    this._state          = INGEST_MANAGER_STATE.IDLE;
    this._startedAt      = null;
  }

  /* ── Ingest Session Lifecycle ──────────────────────────── */

  /**
   * Create a new ingest session, validate and probe the source.
   *
   * @param {object} sourceConfig   IngestSourceConfig
   * @param {string} [sessionId]    Optional: caller-assigned session ID.
   *                                Generated if not provided.
   * @returns {Promise<{ success: boolean, message: string, sessionId?: string, source?: object }>}
   */
  async createSession(sourceConfig, sessionId = null) {
    const id = sessionId ?? randomUUID();

    if (this._sessions.has(id)) {
      return { success: false, message: `Session ID "${id}" already exists.` };
    }

    const session = new IngestSession({ sessionId: id, config: sourceConfig });
    this._wireSession(session);
    this._sessions.set(id, session);

    const prepResult = await session.prepare();
    if (!prepResult.success) {
      this._sessions.delete(id);
      return { success: false, message: prepResult.message };
    }

    CloudEngineLogger.info(MODULE, 'INGEST_SESSION_CREATED',
      `Ingest session created: "${id}" (${sourceConfig.sourceType})`);

    return {
      success:   true,
      message:   'Ingest session created and ready.',
      sessionId: id,
      source:    prepResult.source,
    };
  }

  /**
   * Start ingesting: activate the specified session and mark it as the active source.
   *
   * @param {string} sessionId
   * @returns {{ success: boolean, message: string, inputPath?: string }}
   */
  async startIngest(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return { success: false, message: `Ingest session "${sessionId}" not found.` };
    }

    if (session.state !== INGEST_SESSION_STATE.READY) {
      return { success: false, message: `Session "${sessionId}" is not in READY state (current: ${session.state}).` };
    }

    const activateResult = session.activate();
    if (!activateResult.success) return activateResult;

    this._activeSession = sessionId;
    this._state         = INGEST_MANAGER_STATE.ACTIVE;
    this._startedAt     = Date.now();

    const inputPath = session.source?.inputPath ?? null;

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.INGEST_STARTED, {
      sessionId,
      sourceType: session.sourceType,
      inputPath,
    });

    CloudEngineLogger.info(MODULE, 'INGEST_STARTED',
      `Ingest started: session "${sessionId}", source type: ${session.sourceType}`);

    return { success: true, message: 'Ingest started.', sessionId, inputPath };
  }

  /**
   * Stop the active ingest session.
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async stopIngest() {
    if (!this._activeSession) {
      return { success: true, message: 'No active ingest session to stop.' };
    }

    const session = this._sessions.get(this._activeSession);
    if (session) {
      await session.stop();
    }

    const stoppedId      = this._activeSession;
    this._activeSession  = null;
    this._state          = INGEST_MANAGER_STATE.IDLE;

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.INGEST_STOPPED, {
      sessionId: stoppedId,
    });

    CloudEngineLogger.info(MODULE, 'INGEST_STOPPED',
      `Ingest stopped: session "${stoppedId}"`);

    return { success: true, message: 'Ingest stopped.' };
  }

  /**
   * Replace the active ingest source without stopping the broadcast.
   * The new session must already be prepared (createSession() must have been called).
   *
   * @param {string} newSessionId  ID of the prepared replacement session.
   * @returns {Promise<{ success: boolean, message: string, inputPath?: string }>}
   */
  async replaceSource(newSessionId) {
    const newSession = this._sessions.get(newSessionId);
    if (!newSession) {
      return { success: false, message: `Replacement session "${newSessionId}" not found.` };
    }

    if (newSession.state !== INGEST_SESSION_STATE.READY) {
      return { success: false, message: `Replacement session "${newSessionId}" is not READY.` };
    }

    this._state = INGEST_MANAGER_STATE.SWITCHING;

    // Stop old session
    if (this._activeSession && this._activeSession !== newSessionId) {
      const oldSession = this._sessions.get(this._activeSession);
      if (oldSession) await oldSession.stop();
    }

    // Activate new session
    const activateResult = newSession.activate();
    if (!activateResult.success) {
      this._state = INGEST_MANAGER_STATE.ACTIVE;
      return activateResult;
    }

    this._activeSession = newSessionId;
    this._state         = INGEST_MANAGER_STATE.ACTIVE;

    const inputPath = newSession.source?.inputPath ?? null;

    CloudEngineLogger.info(MODULE, 'INGEST_SOURCE_REPLACED',
      `Ingest source replaced: new session "${newSessionId}"`);

    return { success: true, message: 'Ingest source replaced.', sessionId: newSessionId, inputPath };
  }

  /**
   * Remove a session (must be stopped first).
   * @param {string} sessionId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async removeSession(sessionId) {
    if (this._activeSession === sessionId) {
      await this.stopIngest();
    }

    const session = this._sessions.get(sessionId);
    if (session && session.state !== INGEST_SESSION_STATE.STOPPED) {
      await session.stop();
    }

    this._sessions.delete(sessionId);
    return { success: true, message: `Session "${sessionId}" removed.` };
  }

  /* ── Status & Metrics ──────────────────────────────────── */

  /**
   * Get the manager state and active session info.
   * @returns {object}
   */
  getStatus() {
    const activeSess = this._activeSession
      ? this._sessions.get(this._activeSession)
      : null;

    return {
      state:           this._state,
      activeSessionId: this._activeSession,
      activeSource:    activeSess ? activeSess.getStatus() : null,
      sessionCount:    this._sessions.size,
      uptimeSec:       this._startedAt
        ? Math.floor((Date.now() - this._startedAt) / 1000)
        : null,
    };
  }

  /**
   * Get metrics for the active ingest session.
   * @returns {object|null}
   */
  getActiveMetrics() {
    if (!this._activeSession) return null;
    const session = this._sessions.get(this._activeSession);
    return session ? session.getMetrics() : null;
  }

  /**
   * Get metrics for a specific session.
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSessionMetrics(sessionId) {
    const session = this._sessions.get(sessionId);
    return session ? session.getMetrics() : null;
  }

  /**
   * List all sessions (safe status only).
   * @returns {object[]}
   */
  listSessions() {
    return [...this._sessions.values()].map(s => s.getStatus());
  }

  /**
   * Get the input path from the active session.
   * This is what the encoder / fan-out should consume.
   * @returns {string|null}
   */
  getActiveInputPath() {
    if (!this._activeSession) return null;
    const session = this._sessions.get(this._activeSession);
    return session?.source?.inputPath ?? null;
  }

  /**
   * Returns which source types are operational in this environment.
   * @returns {object}  sourceType → status
   */
  getSourceTypeCapabilities() {
    return { ...SOURCE_TYPE_STATUS };
  }

  /* ── Private ───────────────────────────────────────────── */

  _wireSession(session) {
    session.on(INGEST_SESSION_EVENT.ERROR, ({ sessionId, error }) => {
      CloudEngineLogger.warn(MODULE, 'SESSION_ERROR',
        `Ingest session "${sessionId}" error: ${error.message}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.INGEST_ERROR, {
        sessionId, error: error.toJSON?.() ?? { message: error.message },
      });
      if (this._activeSession === sessionId) {
        CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.INGEST_SOURCE_DISCONNECTED, { sessionId });
      }
    });

    session.on(INGEST_SESSION_EVENT.STOPPED, ({ sessionId }) => {
      if (this._activeSession === sessionId) {
        CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.INGEST_SOURCE_DISCONNECTED, { sessionId });
      }
    });
  }
}

/* ═══════════════════════════════════
   SHARED INGEST MANAGER INSTANCE
═══════════════════════════════════ */
export const SharedIngestManager = new IngestManager();
