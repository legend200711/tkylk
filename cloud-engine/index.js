/**
 * 24-HOUR CLOUD ENGINE — Main Entry Point
 * cloud-engine/index.js
 *
 * Assembles all Stage 1 modules and exports a single initializer.
 *
 * Usage (from the AURENIX tv/ project):
 *
 *   import { initCloudEngine, CloudEngine } from './cloud-engine/index.js';
 *
 *   // (Optional) Inject the existing Firebase db instance so the
 *   // FirebaseConnector can connect:
 *   import { db } from './firebase-client.js';
 *   CloudEngine.setDb(db, 'remix-studio-4bf8a');
 *
 *   // Boot the engine:
 *   await initCloudEngine();
 *
 *   // Run Stage 1 diagnostics:
 *   const report = await CloudEngine.runDiagnostics();
 *   console.log(report);
 *
 * 24-Hour Cloud Engine  |  Stage 1  |  Engine Version 0.1.0
 */

// ── Core ──────────────────────────────────────────────────
export { ENGINE_VERSION, ENGINE_STATE,
         registerModule, getModule, listModules,
         initCloudEngine, shutdownCloudEngine,
         getEngineStatus, getEngineUptime, getLastError }  from './core/engine.js';

export { CloudEngineEventBus }                             from './core/event-bus.js';
export { CLOUD_ENGINE_EVENTS }                             from './core/events.js';
export { CloudEngineStateManager, COMPONENT_STATUS }       from './core/state-manager.js';
export { dispatchCommand, COMMAND, COMMAND_STATUS }        from './core/commands.js';
export { getHealthReport, heartbeat, HEALTH_STATUS }       from './core/health.js';

// ── Logger ────────────────────────────────────────────────
export { CloudEngineLogger, LOG_LEVEL }                    from './logs/logger.js';

// ── Configuration ─────────────────────────────────────────
export { CloudEngineConfig }                               from './config/config.js';

// ── Firebase Boundary ─────────────────────────────────────
export { FirebaseConnector, CE_COLLECTIONS }               from './firebase/firebase-connector.js';

// ── Security ──────────────────────────────────────────────
export { ROLE, PERMISSION, hasPermission, getPermissions } from './security/permissions.js';

// ── Component Placeholders ────────────────────────────────
export { ShadowEncoder, ENCODER_STATE }                    from './encoder/shadow-encoder.js';
export { BroadcastEngine, BROADCAST_CONNECTION_STATUS }    from './broadcast/broadcast-engine.js';
export { PlaybackEngine }                                  from './playback/playback-engine.js';
export { MediaLibrary }                                    from './media/media-library.js';
export { QueueEngine }                                     from './queue/queue-engine.js';
export { PlaylistEngine }                                  from './playlists/playlist-engine.js';
export { ProgrammingScheduler }                            from './scheduler/scheduler.js';
export { Destinations }                                    from './destinations/destinations.js';
export { YouTubeConnector }                                from './youtube/youtube-connector.js';
export { Watchdog }                                        from './watchdog/watchdog.js';
export { RecoveryEngine }                                  from './recovery/recovery-engine.js';
export { FallbackProgramming }                             from './fallback/fallback.js';

// ── Creator Studio (Stage 1 placeholder) ─────────────────
export { renderCreatorStudio, getCreatorStudioHTML }       from './studio/creator-studio.js';

// ── Stage 4 — Multi-Platform Fan-Out ──────────────────────
export { FanOutManager, FANOUT_STATE }                     from './broadcast/fanout-manager.js';
export { DestinationSession, SESSION_STATE, SESSION_EVENT } from './broadcast/destination-session.js';
export { computeMultiBroadcastMetrics,
         formatMultiBroadcastMetrics }                     from './broadcast/multi-broadcast-metrics.js';

// ── Stage 5 — Live Input / Ingest ─────────────────────────
export { IngestManager, SharedIngestManager,
         INGEST_MANAGER_STATE }                            from './ingest/ingest-manager.js';
export { IngestSession, INGEST_SESSION_STATE,
         INGEST_SESSION_EVENT }                            from './ingest/ingest-session.js';
export { SOURCE_TYPE, SOURCE_TYPE_STATUS,
         IngestError, INGEST_ERROR_CODE }                  from './ingest/ingest-errors.js';
export { StreamSource, STREAM_SOURCE_STATE }               from './ingest/stream-source.js';
export { createIngestMetrics, computeIngestHealth }        from './ingest/ingest-metrics.js';
export { validateSourceConfig }                            from './ingest/ingest-validator.js';

// ── Stage 6 — Firebase Control System ────────────────────
export { FirebaseControl, validateCommandContext,
         processControlCommand, getFirebaseControlStatus,
         CONTROL_COMMAND, CONTROL_COMMAND_STATE }          from './firebase/firebase-control.js';

// ── Stage 7 — Broadcast Studio ───────────────────────────
export { BroadcastStudio, StudioService,
         BROADCAST_MODE, BROADCAST_MODE_STATUS }           from './studio/broadcast-studio.js';
export { StudioEventFeed, STUDIO_EVENT_TYPE }              from './studio/studio-events.js';

// ── Diagnostics ───────────────────────────────────────────
export { runDiagnostics }                                  from './diagnostics.js';

/* ══════════════════════════════════════════════════════════
   CloudEngine convenience API — wraps common operations
══════════════════════════════════════════════════════════ */
import { FirebaseConnector }   from './firebase/firebase-connector.js';
import { registerModule }      from './core/engine.js';
import { ShadowEncoder }       from './encoder/shadow-encoder.js';
import { BroadcastEngine }     from './broadcast/broadcast-engine.js';
import { FirebaseConnector as _FC } from './firebase/firebase-connector.js';
import { runDiagnostics }      from './diagnostics.js';

export const CloudEngine = Object.freeze({

  /**
   * Inject an existing Firestore `db` instance from the host project.
   * Call this before initCloudEngine() if you have a Firebase project.
   *
   * @param {object} db         Firestore instance from firebase-client.js
   * @param {string} projectId  Firebase project ID, e.g. 'remix-studio-4bf8a'
   */
  async setDb(db, projectId) {
    await _FC.initialize({ db, projectId });
  },

  /**
   * Register all Stage 1 placeholder modules with the engine.
   * Called automatically when initCloudEngine() is used via this index.
   */
  registerPlaceholders() {
    registerModule('encoder',   ShadowEncoder);
    registerModule('broadcast', BroadcastEngine);
  },

  /** Run Stage 1 diagnostics and return the report. */
  async runDiagnostics() {
    return runDiagnostics();
  },
});
