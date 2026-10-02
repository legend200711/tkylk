/**
 * 24-HOUR CLOUD ENGINE — Hybrid Manager
 * cloud-engine/hybrid/hybrid-manager.js
 *
 * Central orchestrator for Hybrid Mode.
 *
 * Hybrid Mode behavior:
 *   1. TV station runs 24/7
 *   2. Creator initiates GO LIVE → live takeover begins
 *   3. Live broadcast runs until END LIVE
 *   4. Resume controller determines correct schedule position
 *   5. Station resumes at that position
 *
 * Source continuity principle:
 *   When technically practical, destination fan-out remains active
 *   during source transitions. The source changes, not the destinations.
 *   This avoids stream interruptions for viewers.
 *
 * Live failure recovery:
 *   If live ingest dies unexpectedly, the manager attempts a controlled
 *   transition back to station programming. It does NOT leave the channel
 *   dead when valid station programming is available.
 *
 * Stage 11 — Hybrid Mode
 */

import EventEmitter                from 'events';
import { CloudEngineLogger }       from '../logs/logger.js';
import { CloudEngineEventBus }     from '../core/event-bus.js';
import { HYBRID_STATE, HYBRID_EVENT, HYBRID_ERROR_CODE,
         RESUME_STRATEGY, HybridError }  from './hybrid-errors.js';
import { HybridModeState }         from './hybrid-state.js';
import { TakeoverSession, TAKEOVER_STATE } from './takeover-session.js';
import { SourceSwitcher }          from './source-switcher.js';
import { ResumeController }        from './resume-controller.js';

const MODULE = 'hybrid/hybrid-manager';

/* ═══════════════════════════════════
   HYBRID MANAGER
═══════════════════════════════════ */
export class HybridManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}           opts.stationId
   * @param {string}           opts.ownerId
   * @param {TVStationManager} opts.tvStationManager
   * @param {string}           [opts.resumeStrategy]  RESUME_STRATEGY.* default CURRENT_SCHEDULE
   */
  constructor({ stationId, ownerId, tvStationManager, resumeStrategy }) {
    super();

    if (!stationId)        throw new HybridError(HYBRID_ERROR_CODE.NOT_CONFIGURED, 'stationId required');
    if (!ownerId)          throw new HybridError(HYBRID_ERROR_CODE.NOT_CONFIGURED, 'ownerId required');
    if (!tvStationManager) throw new HybridError(HYBRID_ERROR_CODE.NOT_CONFIGURED, 'tvStationManager required');

    this._stationId         = stationId;
    this._ownerId           = ownerId;
    this._tvMgr             = tvStationManager;
    this._state             = new HybridModeState({
      stationId,
      ownerId,
      resumeStrategy: resumeStrategy ?? RESUME_STRATEGY.CURRENT_SCHEDULE,
    });
    this._sourceSwitcher    = new SourceSwitcher();
    this._resumeController  = new ResumeController();
    this._currentSession    = null;
    this._sessionCounter    = 0;
  }

  /* ── Accessors ──────────────────────────────────────────── */
  get hybridState()   { return this._state.hybridState; }
  get isLive()        { return this._state.isLive; }
  get currentSource() { return this._sourceSwitcher.currentSource; }

  /* ── Station Mode ───────────────────────────────────────── */

  /**
   * Start the station in Hybrid Mode (station playback active, ready for live).
   */
  async startStation() {
    if (this._state.hybridState === HYBRID_STATE.LIVE) {
      return { success: false, message: 'Cannot start station while live is active.' };
    }

    const result = await this._tvMgr.startStation(this._stationId, this._ownerId);
    if (result.success) {
      this._state.setStationMode();
      CloudEngineLogger.info(MODULE, 'HYBRID_STATION_STARTED',
        `[${this._stationId}] Hybrid Mode: station started.`);
    }
    return result;
  }

  /**
   * Stop station playback entirely.
   */
  async stopStation() {
    this._currentSession = null;
    return this._tvMgr.stopStation(this._stationId, this._ownerId);
  }

  /* ── Live Takeover ──────────────────────────────────────── */

  /**
   * Go Live — creator initiates live broadcast takeover.
   *
   * Flow:
   *   1. Capture current station program (for possible resume)
   *   2. Create a TakeoverSession
   *   3. Switch source to LIVE
   *   4. Emit HYBRID_LIVE_PREPARING → HYBRID_LIVE_STARTED
   *
   * @param {object} [opts]
   * @param {string} [opts.ingestSessionId]  Ingest session ID (from IngestManager)
   * @returns {Promise<{ success: boolean, session: TakeoverSession|null, message: string }>}
   */
  async goLive({ ingestSessionId } = {}) {
    if (this._state.isLive) {
      return { success: false, session: null,
               message: 'Already live.',
               code: HYBRID_ERROR_CODE.ALREADY_LIVE };
    }

    // Capture current state before transition
    const dashResult = this._tvMgr.getDashboard(this._stationId, this._ownerId);
    const currentProgram = dashResult.success
      ? dashResult.dashboard.currentProgram
      : null;

    // Create takeover session
    this._sessionCounter++;
    const session = new TakeoverSession({
      sessionId:       `hybrid-take-${this._stationId}-${this._sessionCounter}`,
      stationId:       this._stationId,
      ownerId:         this._ownerId,
      ingestSessionId: ingestSessionId ?? null,
    });
    this._currentSession = session;

    // Prepare
    this._state.startLivePrep(session);
    this._emitEvent(HYBRID_EVENT.HYBRID_LIVE_PREPARING, {
      stationId: this._stationId,
      sessionId: session.sessionId,
    });

    CloudEngineLogger.info(MODULE, 'HYBRID_LIVE_PREPARING',
      `[${this._stationId}] Going live. sessionId=${session.sessionId}`);

    // Switch source
    const switchResult = this._sourceSwitcher.switchToLive({
      ingestPath: ingestSessionId,
    });

    if (!switchResult.success) {
      session.fail('Source switch failed.');
      this._state.setError(HYBRID_ERROR_CODE.LIVE_TAKEOVER_FAILED, 'Source switch failed.');
      this._emitEvent(HYBRID_EVENT.HYBRID_LIVE_FAILED, { stationId: this._stationId });
      return { success: false, session, message: 'Live takeover failed: source switch error.' };
    }

    // Activate
    session.activate();
    this._state.setLiveActive(currentProgram);

    this._emitEvent(HYBRID_EVENT.HYBRID_LIVE_STARTED, {
      stationId: this._stationId,
      sessionId: session.sessionId,
      interruptedProgram: currentProgram,
    });

    CloudEngineLogger.info(MODULE, 'HYBRID_LIVE_STARTED',
      `[${this._stationId}] LIVE STARTED. Interrupted: "${currentProgram?.title ?? 'none'}"`);

    return {
      success: true,
      session,
      message: 'Live broadcast started.',
      interruptedProgram: currentProgram,
    };
  }

  /**
   * End Live — creator ends live broadcast; station resumes.
   *
   * Flow:
   *   1. End takeover session
   *   2. Emit HYBRID_RETURNING
   *   3. Determine resume position (schedule-aware)
   *   4. Trigger station resume
   *   5. Emit HYBRID_STATION_RESUMED
   *
   * @returns {Promise<{ success: boolean, resumeResult: object, message: string }>}
   */
  async endLive() {
    if (!this._state.isLive && this._state.hybridState !== HYBRID_STATE.PREPARING_LIVE) {
      return { success: false, message: 'Not currently live.',
               code: HYBRID_ERROR_CODE.NOT_LIVE };
    }

    const session = this._currentSession;
    if (session && session.state === TAKEOVER_STATE.ACTIVE) {
      session.begin_end();
    }

    this._state.startReturning();
    this._emitEvent(HYBRID_EVENT.HYBRID_RETURNING, {
      stationId: this._stationId,
      sessionId: session?.sessionId,
    });

    CloudEngineLogger.info(MODULE, 'HYBRID_RETURNING',
      `[${this._stationId}] Live ended. Returning to station.`);

    // Switch source back to station
    this._sourceSwitcher.switchToStation();

    // Determine resume position
    const stationEntry = this._tvMgr._stations?.get(this._stationId);
    const resumeResult = stationEntry
      ? this._resumeController.determineResume({
          strategy:           this._state.resumeStrategy,
          scheduleManager:    stationEntry.station.schedule,
          stationId:          this._stationId,
          interruptedProgram: this._state.interruptedProgram,
          atTime:             Date.now(),
        })
      : { action: 'NO_STATION', resumeTarget: null, rationale: 'Station not found.' };

    // Resume station playback
    try {
      await this._tvMgr.nextProgram(this._stationId, this._ownerId);
    } catch {
      // nextProgram may fail if station isn't running — not fatal
    }

    if (session) session.complete();
    this._state.completeReturn();

    this._emitEvent(HYBRID_EVENT.HYBRID_STATION_RESUMED, {
      stationId:    this._stationId,
      resumeResult,
      sessionId:    session?.sessionId,
      durationSec:  session?.durationSec,
    });

    CloudEngineLogger.info(MODULE, 'HYBRID_STATION_RESUMED',
      `[${this._stationId}] Station resumed. Action: ${resumeResult.action}. ` +
      resumeResult.rationale);

    return {
      success:      true,
      resumeResult,
      message:      `Live ended. Station resumed (${resumeResult.action}).`,
    };
  }

  /**
   * Handle unexpected live ingest failure.
   * Attempts a controlled return to station programming.
   * Called by the watchdog or ingest monitor.
   *
   * @returns {Promise<object>}
   */
  async handleLiveFailure() {
    if (!this._state.isLive) {
      return { success: true, message: 'Not currently live — nothing to recover.' };
    }

    CloudEngineLogger.warn(MODULE, 'HYBRID_LIVE_FAILURE',
      `[${this._stationId}] Live ingest failure detected. Attempting station recovery.`);

    if (this._currentSession) {
      this._currentSession.fail('Ingest unexpectedly terminated.');
    }

    this._emitEvent(HYBRID_EVENT.HYBRID_LIVE_FAILED, {
      stationId: this._stationId,
      reason:    'Ingest unexpectedly terminated.',
    });

    // Attempt controlled return to station
    return this.endLive();
  }

  /* ── Status / Dashboard ─────────────────────────────────── */

  /**
   * Get hybrid mode dashboard. Safe — no credentials.
   */
  getDashboard() {
    const stationDash = this._tvMgr.getDashboard(this._stationId, this._ownerId);
    return {
      stationId:      this._stationId,
      ownerId:        this._ownerId,
      hybridState:    this._state.hybridState,
      resumeStrategy: this._state.resumeStrategy,
      source:         this._sourceSwitcher.getStatus(),
      session:        this._currentSession?.snapshot() ?? null,
      station:        stationDash.success ? stationDash.dashboard : null,
      asOf:           new Date().toISOString(),
    };
  }

  /**
   * Get full state snapshot.
   */
  getStateSnapshot() {
    return {
      ...this._state.snapshot(),
      sourceStatus:  this._sourceSwitcher.getStatus(),
      currentSession: this._currentSession?.snapshot() ?? null,
    };
  }

  /* ── Private ────────────────────────────────────────────── */

  _emitEvent(eventName, data) {
    // Emit locally
    this.emit(eventName, data);
    // Emit to global event bus
    CloudEngineEventBus.emit(eventName, data);
  }
}
