/**
 * 24-HOUR CLOUD ENGINE — Command System
 * cloud-engine/core/commands.js
 *
 * Defines all internal commands the engine supports.
 * Stage 1: Command names and NOT_IMPLEMENTED stubs only.
 * Stage 2+: Replace stubs with real implementations.
 *
 * All commands return a CommandResult:
 *   { success: boolean, status: string, message: string, data?: any }
 */

import { CloudEngineLogger } from '../logs/logger.js';
import { getEngineStatus, ENGINE_STATE } from './engine.js';

/* ═══════════════════════════════════
   COMMAND NAMES
═══════════════════════════════════ */
export const COMMAND = Object.freeze({
  // Engine lifecycle
  START_ENGINE:       'START_ENGINE',
  STOP_ENGINE:        'STOP_ENGINE',
  RESTART_ENGINE:     'RESTART_ENGINE',

  // Broadcast
  START_BROADCAST:    'START_BROADCAST',
  STOP_BROADCAST:     'STOP_BROADCAST',
  RESTART_BROADCAST:  'RESTART_BROADCAST',

  // Playback
  NEXT_MEDIA:         'NEXT_MEDIA',
  PREVIOUS_MEDIA:     'PREVIOUS_MEDIA',
  PAUSE:              'PAUSE',
  RESUME:             'RESUME',

  // Playlist
  LOAD_PLAYLIST:      'LOAD_PLAYLIST',

  // Diagnostics
  GET_STATUS:         'GET_STATUS',
});

/* ═══════════════════════════════════
   COMMAND RESULT SHAPES
═══════════════════════════════════ */
const STATUS = Object.freeze({
  OK:              'OK',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_CONFIGURED:  'NOT_CONFIGURED',
  ERROR:           'ERROR',
  REJECTED:        'REJECTED',
});

/**
 * Build a NOT_IMPLEMENTED result.
 * @param {string} command
 * @param {string} [note]   Optional note about which stage implements this.
 * @returns {{ success:boolean, status:string, message:string }}
 */
function _notImplemented(command, note) {
  return {
    success: false,
    status:  STATUS.NOT_IMPLEMENTED,
    message: `Command "${command}" is not implemented in Stage 1.${note ? ' ' + note : ''}`,
  };
}

/* ═══════════════════════════════════
   COMMAND DISPATCHER
═══════════════════════════════════ */

/**
 * Dispatch a command to the engine.
 * Unavailable commands return NOT_IMPLEMENTED rather than throwing.
 *
 * @param {string} command   One of COMMAND.*
 * @param {object} [params]  Optional command parameters.
 * @returns {Promise<{success:boolean, status:string, message:string, data?:any}>}
 */
export async function dispatchCommand(command, params = {}) {
  CloudEngineLogger.debug('core/commands', 'COMMAND_DISPATCH',
    `Dispatching command: ${command}`, { params });

  switch (command) {

    case COMMAND.GET_STATUS: {
      // GET_STATUS is the only fully implemented command in Stage 1.
      const { getEngineStatus, getEngineUptime, getLastError, listModules, ENGINE_VERSION } =
        await import('./engine.js');
      return {
        success: true,
        status:  STATUS.OK,
        message: 'Status retrieved.',
        data: {
          engine:   getEngineStatus(),
          uptime:   getEngineUptime(),
          lastError: getLastError(),
          modules:  listModules(),
          version:  ENGINE_VERSION,
        },
      };
    }

    case COMMAND.START_ENGINE:
      return _notImplemented(command, 'Engine init is handled by initCloudEngine() directly.');

    case COMMAND.STOP_ENGINE:
      return _notImplemented(command, 'Engine shutdown is handled by shutdownCloudEngine() directly.');

    case COMMAND.RESTART_ENGINE:
      return _notImplemented(command, 'Implemented in Stage 2.');

    case COMMAND.START_BROADCAST:
    case COMMAND.STOP_BROADCAST:
    case COMMAND.RESTART_BROADCAST:
      return _notImplemented(command, 'Broadcast Engine is implemented in Stage 2.');

    case COMMAND.NEXT_MEDIA:
    case COMMAND.PREVIOUS_MEDIA:
    case COMMAND.PAUSE:
    case COMMAND.RESUME:
      return _notImplemented(command, 'Playback Engine is implemented in Stage 2.');

    case COMMAND.LOAD_PLAYLIST:
      return _notImplemented(command, 'Playlist Engine is implemented in Stage 2.');

    default:
      CloudEngineLogger.warn('core/commands', 'UNKNOWN_COMMAND', `Unknown command: "${command}"`);
      return {
        success: false,
        status:  STATUS.REJECTED,
        message: `Unknown command: "${command}"`,
      };
  }
}

export { STATUS as COMMAND_STATUS };
