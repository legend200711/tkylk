/**
 * 24-HOUR CLOUD ENGINE — Core Engine
 * cloud-engine/core/engine.js
 *
 * Central lifecycle controller for the 24-Hour Cloud Engine.
 * Stage 1: Lifecycle management, module registry, boot/shutdown.
 *
 * Stage 1 does NOT implement encoding, broadcasting, or media playback.
 *
 * 24-Hour Cloud Engine  |  Stage 1  |  Engine Version 0.1.0
 */

import { CloudEngineLogger } from '../logs/logger.js';
import { CloudEngineEventBus } from './event-bus.js';
import { CLOUD_ENGINE_EVENTS } from './events.js';
import { CloudEngineStateManager } from './state-manager.js';
import { CloudEngineConfig } from '../config/config.js';

/* ═══════════════════════════════════
   ENGINE VERSION
═══════════════════════════════════ */
export const ENGINE_VERSION = Object.freeze({
  name:    '24-Hour Cloud Engine',
  stage:   13,
  version: '0.13.0',
  build:   'stage13-2026-10-01',
});

/* ═══════════════════════════════════
   LIFECYCLE STATES
═══════════════════════════════════ */
export const ENGINE_STATE = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  READY:        'READY',
  STARTING:     'STARTING',
  RUNNING:      'RUNNING',
  STOPPING:     'STOPPING',
  STOPPED:      'STOPPED',
  ERROR:        'ERROR',
  RECOVERING:   'RECOVERING',
});

/* ═══════════════════════════════════
   MODULE REGISTRY
═══════════════════════════════════ */
const _modules = new Map(); // name → { instance, initialized }

/**
 * Register a module with the engine.
 * @param {string} name   Unique module identifier.
 * @param {object} mod    Object with at minimum an optional `initialize()` method.
 */
export function registerModule(name, mod) {
  if (_modules.has(name)) {
    CloudEngineLogger.warn('core/engine', 'MODULE_ALREADY_REGISTERED',
      `Module "${name}" was registered twice — skipping.`);
    return;
  }
  _modules.set(name, { instance: mod, initialized: false });
  CloudEngineLogger.debug('core/engine', 'MODULE_REGISTERED', `Module "${name}" registered.`);
}

/**
 * Returns the registered module instance by name, or null.
 * @param {string} name
 * @returns {object|null}
 */
export function getModule(name) {
  return _modules.get(name)?.instance ?? null;
}

/**
 * Returns a snapshot of all registered modules and their initialization state.
 * @returns {Array<{name:string, initialized:boolean}>}
 */
export function listModules() {
  return Array.from(_modules.entries()).map(([name, entry]) => ({
    name,
    initialized: entry.initialized,
  }));
}

/* ═══════════════════════════════════
   ENGINE STATE
═══════════════════════════════════ */
let _engineStatus = ENGINE_STATE.STOPPED;
let _startedAt    = null;
let _lastError    = null;

/**
 * Initialize the 24-Hour Cloud Engine.
 * Loads configuration, prepares registered modules, emits ENGINE_READY.
 * Does NOT start broadcasting or encoding — those belong to Stage 2+.
 */
export async function initCloudEngine() {
  if (_engineStatus !== ENGINE_STATE.STOPPED && _engineStatus !== ENGINE_STATE.ERROR) {
    CloudEngineLogger.warn('core/engine', 'INIT_SKIPPED',
      `Engine already in state: ${_engineStatus}`);
    return;
  }

  _engineStatus = ENGINE_STATE.INITIALIZING;
  CloudEngineLogger.info('core/engine', 'ENGINE_INIT',
    `${ENGINE_VERSION.name} v${ENGINE_VERSION.version} (Stage ${ENGINE_VERSION.stage}) — initializing…`);

  try {
    // 1. Load configuration
    await CloudEngineConfig.load();

    // 2. Initialize registered modules
    for (const [name, entry] of _modules.entries()) {
      try {
        if (typeof entry.instance.initialize === 'function') {
          await entry.instance.initialize();
        }
        entry.initialized = true;
        CloudEngineLogger.debug('core/engine', 'MODULE_INIT_OK', `Module "${name}" initialized.`);
      } catch (modErr) {
        // Non-fatal in Stage 1 — log and continue so other modules still load.
        CloudEngineLogger.error('core/engine', 'MODULE_INIT_FAILED',
          `Module "${name}" failed to initialize.`, { error: modErr?.message });
      }
    }

    // 3. Transition to READY
    _engineStatus = ENGINE_STATE.READY;
    _startedAt    = new Date();
    CloudEngineStateManager.set('engine.status',    ENGINE_STATE.READY);
    CloudEngineStateManager.set('engine.startedAt', _startedAt.toISOString());
    CloudEngineStateManager.set('engine.version',   ENGINE_VERSION);

    // 4. Emit ready event
    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENGINE_READY, {
      version:   ENGINE_VERSION,
      startedAt: _startedAt.toISOString(),
    });

    CloudEngineLogger.info('core/engine', 'ENGINE_READY',
      `Engine ready. ${listModules().length} module(s) registered.`);

  } catch (err) {
    _engineStatus = ENGINE_STATE.ERROR;
    _lastError    = err?.message ?? String(err);
    CloudEngineStateManager.set('engine.status',    ENGINE_STATE.ERROR);
    CloudEngineStateManager.set('engine.lastError', _lastError);
    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENGINE_ERROR, { message: _lastError });
    CloudEngineLogger.error('core/engine', 'ENGINE_INIT_FAILED',
      'Engine failed to initialize.', { error: _lastError });
    throw err;
  }
}

/**
 * Shut the engine down gracefully.
 * Shuts down registered modules in reverse registration order.
 */
export async function shutdownCloudEngine() {
  if (_engineStatus === ENGINE_STATE.STOPPED) return;

  _engineStatus = ENGINE_STATE.STOPPING;
  CloudEngineStateManager.set('engine.status', ENGINE_STATE.STOPPING);
  CloudEngineLogger.info('core/engine', 'ENGINE_STOPPING', 'Engine shutting down…');

  const entries = Array.from(_modules.entries()).reverse();
  for (const [name, entry] of entries) {
    try {
      if (typeof entry.instance.shutdown === 'function') {
        await entry.instance.shutdown();
      }
      entry.initialized = false;
    } catch (err) {
      CloudEngineLogger.warn('core/engine', 'MODULE_SHUTDOWN_ERROR',
        `Module "${name}" shutdown error: ${err?.message}`);
    }
  }

  _engineStatus = ENGINE_STATE.STOPPED;
  _startedAt    = null;
  CloudEngineStateManager.set('engine.status', ENGINE_STATE.STOPPED);
  CloudEngineLogger.info('core/engine', 'ENGINE_STOPPED', 'Engine stopped.');
}

/** Returns the current engine lifecycle state string. */
export function getEngineStatus() {
  return _engineStatus;
}

/** Returns engine uptime in seconds, or 0 if not yet started. */
export function getEngineUptime() {
  if (!_startedAt) return 0;
  return Math.floor((Date.now() - _startedAt.getTime()) / 1000);
}

/** Returns the last engine error message, or null. */
export function getLastError() {
  return _lastError;
}
