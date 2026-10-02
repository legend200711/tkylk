/**
 * 24-HOUR CLOUD ENGINE — Health Service
 * cloud-engine/core/health.js
 *
 * Reports the operational status of each engine component.
 * Stage 2 modifications:
 *   - Shadow Encoder now reports REAL status (not always NOT_IMPLEMENTED).
 * Stage 3 modifications:
 *   - Broadcast Engine now reports REAL status based on ShadowBroadcastEngine.
 *
 * Components must NEVER pretend to be operational when they are not.
 */

import { CloudEngineLogger } from '../logs/logger.js';
import { CloudEngineStateManager, COMPONENT_STATUS } from './state-manager.js';
import {
  getEngineStatus, getEngineUptime, getLastError, ENGINE_VERSION,
} from './engine.js';
import { FirebaseConnector }     from '../firebase/firebase-connector.js';
import { ShadowEncoder }         from '../encoder/shadow-encoder.js';
import { ShadowBroadcastEngine } from '../broadcast/broadcast-engine.js';

/* ═══════════════════════════════════
   HEALTH STATUS VALUES
═══════════════════════════════════ */
export const HEALTH_STATUS = Object.freeze({
  OK:              'OK',
  DEGRADED:        'DEGRADED',
  ERROR:           'ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_CONFIGURED:  'NOT_CONFIGURED',
});

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

/**
 * Map an encoder state string to a HEALTH_STATUS value.
 * @param {{ state: string }} encoderStatus
 * @returns {string}  HEALTH_STATUS.*
 */
function _encoderHealth(encoderStatus) {
  const state = encoderStatus?.state;
  if (!state || state === 'UNINITIALIZED') return HEALTH_STATUS.NOT_IMPLEMENTED;
  if (state === 'ERROR')                   return HEALTH_STATUS.ERROR;
  return HEALTH_STATUS.OK;
}

/**
 * Map a broadcast state string to a HEALTH_STATUS value.
 * Stage 3: Broadcast Engine is now functional.
 * @param {{ state: string, connectionStatus: string }} broadcastStatus
 * @returns {string}  HEALTH_STATUS.*
 */
function _broadcastHealth(broadcastStatus) {
  const state = broadcastStatus?.state;
  if (!state || state === 'UNINITIALIZED') return HEALTH_STATUS.NOT_IMPLEMENTED;
  if (state === 'ERROR')                   return HEALTH_STATUS.ERROR;
  if (state === 'BROADCASTING')            return HEALTH_STATUS.OK;
  if (state === 'CONNECTED')               return HEALTH_STATUS.OK;
  if (state === 'RECONNECTING')            return HEALTH_STATUS.DEGRADED;
  if (state === 'READY')                   return HEALTH_STATUS.OK;
  return HEALTH_STATUS.OK;
}

/**
 * Returns a full health report for all engine components.
 * @returns {object}
 */
export function getHealthReport() {
  const engineStatus = getEngineStatus();
  const uptime       = getEngineUptime();

  // Firebase: report real status (safe to detect without exposing secrets)
  const fbStatus = FirebaseConnector.getStatus();
  const firebaseHealth = fbStatus === COMPONENT_STATUS.OK
    ? HEALTH_STATUS.OK
    : fbStatus === COMPONENT_STATUS.NOT_CONFIGURED
      ? HEALTH_STATUS.NOT_CONFIGURED
      : HEALTH_STATUS.ERROR;

  // Encoder: Stage 2 — report real status
  const encoderStatus = ShadowEncoder.getStatus();

  // Broadcast: Stage 3 — report real status
  const broadcastStatus = ShadowBroadcastEngine.getConnectionStatus();

  return {
    timestamp:   new Date().toISOString(),
    version:     ENGINE_VERSION,

    engine: {
      status:    engineStatus,
      uptime,
      lastError: getLastError(),
    },

    components: {
      encoder: {
        status:  _encoderHealth(encoderStatus),
        state:   encoderStatus.state,
        note:    encoderStatus.state === 'UNINITIALIZED'
                   ? 'Shadow Encoder installed but not yet initialized. Call initialize().'
                   : null,
      },
      broadcast: {
        status:     _broadcastHealth(broadcastStatus),
        state:      broadcastStatus.state,
        connection: broadcastStatus.connectionStatus,
        note:       broadcastStatus.state === 'UNINITIALIZED'
                      ? 'Broadcast Engine installed but not yet initialized. Call initialize().'
                      : null,
      },
      scheduler: {
        status:  HEALTH_STATUS.NOT_IMPLEMENTED,
        note:    'Scheduler will be implemented in a later stage.',
      },
      watchdog: {
        status:  HEALTH_STATUS.NOT_IMPLEMENTED,
        note:    'Watchdog will be implemented in a later stage.',
      },
      recovery: {
        status:  HEALTH_STATUS.NOT_IMPLEMENTED,
        note:    'Recovery Engine will be implemented in a later stage.',
      },
      firebase: {
        status:       firebaseHealth,
        connected:    fbStatus === COMPONENT_STATUS.OK,
        projectId:    CloudEngineStateManager.get('firebase.projectId') ?? null,
      },
    },

    lastHeartbeat: new Date().toISOString(),
  };
}

/**
 * Emits a heartbeat log and updates the last heartbeat timestamp in state.
 */
export function heartbeat() {
  const ts = new Date().toISOString();
  CloudEngineStateManager.set('engine.lastHeartbeat', ts);
  CloudEngineLogger.debug('core/health', 'HEARTBEAT', `Heartbeat — engine: ${getEngineStatus()}`);
}
