/**
 * 24-HOUR CLOUD ENGINE — Central State Manager
 * cloud-engine/core/state-manager.js
 *
 * Single source of truth for engine runtime state.
 * Separate from configuration — this is live operational data.
 *
 * Stage 1: State shape defined. Values populated as engine initializes.
 * Stage 2+: Encoder, broadcast, and scheduler modules will populate
 *           their sections of the state tree.
 */

import { CloudEngineEventBus } from './event-bus.js';

/* ═══════════════════════════════════════════════════════
   STAGE 1 COMPONENT STATUS SENTINELS
═══════════════════════════════════════════════════════ */
export const COMPONENT_STATUS = Object.freeze({
  NOT_CONFIGURED:   'NOT_CONFIGURED',
  NOT_IMPLEMENTED:  'NOT_IMPLEMENTED',
  INITIALIZING:     'INITIALIZING',
  OK:               'OK',
  ERROR:            'ERROR',
  STOPPED:          'STOPPED',
});

/* ═══════════════════════════════════════════════════════
   INITIAL STATE SHAPE
   All fields defined here so Stage 2+ modules know exactly
   what shape they must write into.
═══════════════════════════════════════════════════════ */
const _initialState = {
  engine: {
    status:       'STOPPED',
    version:      null,
    startedAt:    null,
    uptime:       0,
    lastHeartbeat: null,
    lastError:    null,
  },

  channel: {
    status:       COMPONENT_STATUS.NOT_CONFIGURED,
    name:         null,
    description:  null,
    language:     null,
  },

  currentMedia: {
    id:           null,
    title:        null,
    url:          null,
    type:         null,
    durationSec:  null,
    positionSec:  null,
  },

  nextMedia: {
    id:           null,
    title:        null,
    type:         null,
  },

  queue: {
    items:        [],
    totalItems:   0,
  },

  activePlaylist: {
    id:           null,
    name:         null,
    itemCount:    0,
  },

  activeSchedule: {
    id:           null,
    name:         null,
    currentSlot:  null,
  },

  encoder: {
    status:          COMPONENT_STATUS.NOT_IMPLEMENTED,
    state:           null,
    currentMedia:    null,
    position:        null,
    duration:        null,
    fps:             null,
    videoBitrate:    null,
    audioBitrate:    null,
    droppedFrames:   null,
    startedAt:       null,
    lastError:       null,
  },

  broadcast: {
    status:          COMPONENT_STATUS.NOT_IMPLEMENTED,
    connected:       false,
    destination:     null,
    uptime:          0,
    lastError:       null,
  },

  destinations: {
    youtube: {
      status:        COMPONENT_STATUS.NOT_CONFIGURED,
      connected:     false,
      streamKey:     null, // NEVER store real stream key here — placeholder only
    },
  },

  scheduler: {
    status:          COMPONENT_STATUS.NOT_IMPLEMENTED,
    running:         false,
    currentSlot:     null,
    nextSlot:        null,
  },

  watchdog: {
    status:          COMPONENT_STATUS.NOT_IMPLEMENTED,
    active:          false,
    lastCheck:       null,
  },

  firebase: {
    status:          COMPONENT_STATUS.NOT_CONFIGURED,
    connected:       false,
    projectId:       null,
  },

  errors: [],
};

/* ═══════════════════════════════════════════════════════
   STATE STORE
═══════════════════════════════════════════════════════ */
let _state = _deepClone(_initialState);

/**
 * Deep-clone a plain object (no functions / cycles).
 * @param {*} obj
 * @returns {*}
 */
function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Set a value at a dot-notation path in the state tree.
 * e.g. set('engine.status', 'READY')
 *      set('encoder.fps', 30)
 * @param {string} path
 * @param {*}      value
 */
function set(path, value) {
  const keys  = path.split('.');
  let   node  = _state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in node)) {
      node[keys[i]] = {};
    }
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

/**
 * Get a value at a dot-notation path from the state tree.
 * Returns undefined if the path does not exist.
 * @param {string} path
 * @returns {*}
 */
function get(path) {
  const keys = path.split('.');
  let   node = _state;
  for (const k of keys) {
    if (node == null || !(k in node)) return undefined;
    node = node[k];
  }
  return node;
}

/**
 * Returns a deep clone of the entire state tree.
 * Safe to inspect — mutating the return value does not affect engine state.
 * @returns {object}
 */
function snapshot() {
  return _deepClone(_state);
}

/**
 * Append an error to the error log (max 50 entries retained).
 * @param {string} module
 * @param {string} message
 * @param {*}      [meta]
 */
function pushError(module, message, meta) {
  _state.errors.push({
    timestamp: new Date().toISOString(),
    module,
    message,
    meta: meta ?? null,
  });
  if (_state.errors.length > 50) {
    _state.errors.shift();
  }
}

/**
 * Reset state to its initial shape (used by diagnostics / tests).
 */
function reset() {
  _state = _deepClone(_initialState);
}

export const CloudEngineStateManager = Object.freeze({
  set,
  get,
  snapshot,
  pushError,
  reset,
  COMPONENT_STATUS,
});
