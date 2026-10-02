/**
 * 24-HOUR CLOUD ENGINE — Configuration System
 * cloud-engine/config/config.js
 *
 * Centralised configuration loader.
 * Stage 1: Shape defined; all values are placeholder defaults.
 * Secrets MUST come from environment variables or server-side mechanisms —
 * they must never be hardcoded here or committed to source control.
 *
 * In a browser/ES-module context, environment secrets are NOT accessible.
 * Sensitive values (stream keys, OAuth tokens) belong in the Cloudflare
 * Worker or a server-side process, never in client JS.
 */

import { CloudEngineLogger } from '../logs/logger.js';

/* ═══════════════════════════════════
   DEFAULT CONFIGURATION SHAPE
   Placeholders only — no real secrets.
═══════════════════════════════════ */
const _defaults = {
  channel: {
    id:          null,          // Set at runtime, e.g. 'ALTV'
    name:        '24-Hour Cloud Channel',
    description: '',
    language:    'en',
    timezone:    'UTC',
  },

  video: {
    width:        1920,
    height:       1080,
    frameRate:    30,
    bitrate:      4500,         // kbps — Stage 2 encoder placeholder
    codec:        'h264',       // Stage 2 encoder placeholder
    keyframeInterval: 2,        // seconds
  },

  audio: {
    sampleRate:   44100,
    channels:     2,
    bitrate:      128,          // kbps — Stage 2 encoder placeholder
    codec:        'aac',        // Stage 2 encoder placeholder
  },

  firebase: {
    // Public config is safe to store here.
    // SERVICE ACCOUNT KEY must never appear here — use env vars server-side.
    projectId:    null,         // Set from AURENIX firebase-client.js at integration time
    collections: {
      engineState:   'cloud_engine_state',
      commands:      'cloud_engine_commands',
      queue:         'cloud_stream_playlist',
      schedules:     'cloud_stream_schedules',
      streamStatus:  'cloud_stream_sessions',
      logs:          'cloud_stream_logs',
      destinations:  'cloud_stream_destinations',
      permissions:   'cloud_engine_permissions',
      recovery:      'cloud_engine_recovery',
    },
  },

  broadcast: {
    // Real stream keys must come from server-side env vars, never from here.
    destinations: [],           // Populated by Stage 2 destinations module
    reconnectDelayMs:  5000,
    maxReconnectAttempts: 10,
  },

  scheduler: {
    enabled:       false,       // Stage 2
    mode:          'random',    // 'random' | 'ordered' | 'scheduled'
    timezone:      'UTC',
    lookaheadSec:  60,
  },

  watchdog: {
    enabled:        false,      // Stage 2
    intervalMs:     10000,
    staleThresholdMs: 30000,
    maxRecoveryAttempts: 3,
  },

  recovery: {
    enabled:        false,      // Stage 2
    strategy:       'restart',  // 'restart' | 'fallback' | 'skip'
    fallbackMediaId: null,
  },

  logging: {
    level:         'INFO',      // 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
    maxEntries:    500,
    writeToFirestore: false,    // Stage 2 — requires server-side write access
  },
};

/* ═══════════════════════════════════
   RUNTIME CONFIG STORE
═══════════════════════════════════ */
let _config = null;
let _loaded = false;

/**
 * Load configuration.
 * Stage 1: merges defaults only.
 * Stage 2+: will merge environment-provided overrides.
 */
async function load() {
  if (_loaded) return;

  // Deep-merge defaults (no external source in Stage 1)
  _config = JSON.parse(JSON.stringify(_defaults));
  _loaded  = true;

  CloudEngineLogger.info('config', 'CONFIG_LOADED',
    'Configuration loaded (Stage 1 defaults only). No secrets in config.');
}

/**
 * Get a configuration value by dot-notation path.
 * @param {string} path   e.g. 'video.frameRate'
 * @param {*}     [fallback]
 * @returns {*}
 */
function get(path, fallback) {
  if (!_loaded) {
    CloudEngineLogger.warn('config', 'CONFIG_NOT_LOADED',
      `Config.get("${path}") called before load(). Returning fallback.`);
    return fallback;
  }
  const keys = path.split('.');
  let   node = _config;
  for (const k of keys) {
    if (node == null || !(k in node)) return fallback;
    node = node[k];
  }
  return node ?? fallback;
}

/**
 * Returns a deep-clone snapshot of the entire config.
 * Safe to inspect; secrets are never stored here.
 * @returns {object}
 */
function snapshot() {
  if (!_loaded) return null;
  return JSON.parse(JSON.stringify(_config));
}

/** Whether config has been loaded. */
function isLoaded() { return _loaded; }

export const CloudEngineConfig = Object.freeze({ load, get, snapshot, isLoaded });
