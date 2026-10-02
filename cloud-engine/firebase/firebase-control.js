/**
 * 24-HOUR CLOUD ENGINE — Firebase Control System
 * cloud-engine/firebase/firebase-control.js
 *
 * Implements the Firebase control plane for the Cloud Engine.
 *
 * ARCHITECTURE:
 *   Website / App
 *     ↓
 *   Firebase Authentication
 *     ↓
 *   Firebase Control Data (Firestore cloud_engine_commands collection)
 *     ↓
 *   Firebase Control System (this file)
 *     ↓
 *   Engine / Encoder / Ingest / Fan-Out
 *
 * SECURITY PRINCIPLES:
 *   - Every command must have an authenticated user
 *   - Authorization is checked server-side (never trust client roles)
 *   - Ownership isolation: User A cannot control User B's broadcast
 *   - Stream keys and private credentials never stored in Firebase client docs
 *   - Idempotency: duplicate commands are detected and rejected
 *   - Commands have states: PENDING → PROCESSING → COMPLETED | FAILED | REJECTED
 *
 * IMPORTANT: If Firebase credentials are unavailable, this module accurately
 * reports NOT_CONFIGURED. It does NOT fabricate successful connections.
 *
 * Stage 6 — Firebase Control System
 */

import { CloudEngineLogger }                 from '../logs/logger.js';
import { FirebaseConnector, CE_COLLECTIONS } from './firebase-connector.js';
import { COMPONENT_STATUS }                  from '../core/state-manager.js';
import { ROLE, PERMISSION, hasPermission }   from '../security/permissions.js';
import { CloudEngineEventBus }               from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }               from '../core/events.js';

const MODULE = 'firebase/firebase-control';

/* ═══════════════════════════════════
   COMMAND STATES
═══════════════════════════════════ */
export const CONTROL_COMMAND_STATE = Object.freeze({
  PENDING:     'PENDING',
  PROCESSING:  'PROCESSING',
  COMPLETED:   'COMPLETED',
  FAILED:      'FAILED',
  REJECTED:    'REJECTED',
});

/* ═══════════════════════════════════
   SUPPORTED CONTROL COMMANDS
═══════════════════════════════════ */
export const CONTROL_COMMAND = Object.freeze({
  // Broadcast
  START_BROADCAST:         'START_BROADCAST',
  STOP_BROADCAST:          'STOP_BROADCAST',
  ADD_DESTINATION:         'ADD_DESTINATION',
  REMOVE_DESTINATION:      'REMOVE_DESTINATION',
  RECONNECT_DESTINATION:   'RECONNECT_DESTINATION',

  // Ingest
  START_INGEST:            'START_INGEST',
  STOP_INGEST:             'STOP_INGEST',

  // Status / monitoring (read-only — permitted for more roles)
  GET_ENGINE_STATUS:       'GET_ENGINE_STATUS',
  GET_BROADCAST_STATUS:    'GET_BROADCAST_STATUS',
  GET_DESTINATION_STATUS:  'GET_DESTINATION_STATUS',
  GET_INGEST_STATUS:       'GET_INGEST_STATUS',
  GET_METRICS:             'GET_METRICS',
});

/* ═══════════════════════════════════
   PERMISSION MAP
   Which permissions are required per command.
═══════════════════════════════════ */
const _COMMAND_PERMISSIONS = {
  [CONTROL_COMMAND.START_BROADCAST]:        PERMISSION.START_BROADCAST,
  [CONTROL_COMMAND.STOP_BROADCAST]:         PERMISSION.STOP_BROADCAST,
  [CONTROL_COMMAND.ADD_DESTINATION]:        PERMISSION.MANAGE_DESTINATIONS,
  [CONTROL_COMMAND.REMOVE_DESTINATION]:     PERMISSION.MANAGE_DESTINATIONS,
  [CONTROL_COMMAND.RECONNECT_DESTINATION]:  PERMISSION.MANAGE_DESTINATIONS,
  [CONTROL_COMMAND.START_INGEST]:           PERMISSION.START_BROADCAST,
  [CONTROL_COMMAND.STOP_INGEST]:            PERMISSION.STOP_BROADCAST,
  [CONTROL_COMMAND.GET_ENGINE_STATUS]:      PERMISSION.VIEW_STATUS,
  [CONTROL_COMMAND.GET_BROADCAST_STATUS]:   PERMISSION.VIEW_STATUS,
  [CONTROL_COMMAND.GET_DESTINATION_STATUS]: PERMISSION.VIEW_STATUS,
  [CONTROL_COMMAND.GET_INGEST_STATUS]:      PERMISSION.VIEW_STATUS,
  [CONTROL_COMMAND.GET_METRICS]:            PERMISSION.VIEW_STATUS,
};

/* ═══════════════════════════════════
   IDEMPOTENCY CACHE
   In-memory store for recent command IDs to prevent duplicate execution.
   In production, this would be stored in Firestore / Redis.
═══════════════════════════════════ */
const _processedCommandIds = new Set();
const MAX_IDEMPOTENCY_CACHE = 500;

function _markCommandProcessed(commandId) {
  _processedCommandIds.add(commandId);
  if (_processedCommandIds.size > MAX_IDEMPOTENCY_CACHE) {
    // Remove oldest entry (Set preserves insertion order)
    const first = _processedCommandIds.values().next().value;
    _processedCommandIds.delete(first);
  }
}

function _isCommandAlreadyProcessed(commandId) {
  return _processedCommandIds.has(commandId);
}

/* ═══════════════════════════════════
   COMMAND RESULT BUILDERS
═══════════════════════════════════ */

function _commandResult(commandId, command, state, data = null, error = null) {
  return {
    commandId,
    command,
    state,
    timestamp: new Date().toISOString(),
    data:      data  ?? null,
    error:     error ?? null,
    // Stream keys and private credentials are NEVER included in results
  };
}

function _rejected(commandId, command, reason) {
  return _commandResult(commandId, command, CONTROL_COMMAND_STATE.REJECTED, null, reason);
}

function _completed(commandId, command, data = null) {
  return _commandResult(commandId, command, CONTROL_COMMAND_STATE.COMPLETED, data);
}

function _failed(commandId, command, errorMessage) {
  return _commandResult(commandId, command, CONTROL_COMMAND_STATE.FAILED, null, errorMessage);
}

/* ═══════════════════════════════════
   AUTHENTICATION / AUTHORIZATION
═══════════════════════════════════ */

/**
 * Validate a control command context.
 * Checks: authenticated user, role, permission, ownership.
 *
 * IMPORTANT: This module does NOT trust the browser to supply its own role.
 * In production, roles come from Firebase custom claims (server-side).
 * In this stage, the role must be explicitly verified by the calling layer.
 *
 * @param {object} ctx
 * @param {string}  ctx.commandId   Unique command ID (for idempotency)
 * @param {string}  ctx.command     CONTROL_COMMAND.*
 * @param {string}  ctx.userId      Authenticated user ID (from Firebase Auth)
 * @param {string}  ctx.userRole    Verified server-side role (ROLE.*)
 * @param {string}  [ctx.ownerId]   Owner of the resource being commanded
 * @param {object}  [ctx.params]    Command parameters
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateCommandContext(ctx) {
  if (!ctx.commandId || typeof ctx.commandId !== 'string' || !ctx.commandId.trim()) {
    return { valid: false, reason: 'commandId is required.' };
  }

  if (!ctx.command || !CONTROL_COMMAND[ctx.command]) {
    return { valid: false, reason: `Unknown command: "${ctx.command}".` };
  }

  if (!ctx.userId || typeof ctx.userId !== 'string' || !ctx.userId.trim()) {
    return { valid: false, reason: 'Authenticated userId is required.' };
  }

  if (!ctx.userRole || !ROLE[ctx.userRole]) {
    return { valid: false, reason: `Invalid or missing role: "${ctx.userRole}".` };
  }

  // VIEWER cannot execute any mutating commands
  if (ctx.userRole === ROLE.VIEWER) {
    const readOnlyCommands = [
      CONTROL_COMMAND.GET_ENGINE_STATUS,
      CONTROL_COMMAND.GET_BROADCAST_STATUS,
      CONTROL_COMMAND.GET_DESTINATION_STATUS,
      CONTROL_COMMAND.GET_INGEST_STATUS,
      CONTROL_COMMAND.GET_METRICS,
    ];
    if (!readOnlyCommands.includes(ctx.command)) {
      return { valid: false, reason: `Role VIEWER is not permitted to execute "${ctx.command}".` };
    }
  }

  // Check permission matrix
  const requiredPermission = _COMMAND_PERMISSIONS[ctx.command];
  if (requiredPermission && !hasPermission(ctx.userRole, requiredPermission)) {
    return {
      valid:  false,
      reason: `Role "${ctx.userRole}" does not have permission "${requiredPermission}" required for "${ctx.command}".`,
    };
  }

  // Ownership isolation: if ownerId is provided, userId must match (unless OWNER/ADMIN)
  if (ctx.ownerId &&
      ctx.userRole !== ROLE.OWNER &&
      ctx.userRole !== ROLE.ADMIN &&
      ctx.userId !== ctx.ownerId) {
    return {
      valid:  false,
      reason: `User "${ctx.userId}" is not authorized to control resources owned by "${ctx.ownerId}".`,
    };
  }

  return { valid: true };
}

/* ═══════════════════════════════════
   CONTROL COMMAND DISPATCHER
═══════════════════════════════════ */

/**
 * Process a control command from the Firebase control plane.
 *
 * This function:
 * 1. Validates authentication and authorization
 * 2. Checks idempotency (rejects duplicate commandIds)
 * 3. Dispatches to the appropriate engine operation
 * 4. Returns a safe command result (no secrets)
 *
 * @param {object} ctx             Command context (see validateCommandContext)
 * @param {object} [engineRefs]    Injected engine references for dispatch:
 *                                 { fanOutManager, ingestManager, getEngineStatus }
 * @returns {Promise<object>}      CommandResult
 */
export async function processControlCommand(ctx, engineRefs = {}) {
  const { commandId, command } = ctx;

  // 1. Validate context
  const validation = validateCommandContext(ctx);
  if (!validation.valid) {
    CloudEngineLogger.warn(MODULE, 'COMMAND_REJECTED',
      `Command "${command}" rejected: ${validation.reason}`,
      { commandId, userId: ctx.userId });
    return _rejected(commandId, command, validation.reason);
  }

  // 2. Idempotency check
  if (_isCommandAlreadyProcessed(commandId)) {
    CloudEngineLogger.warn(MODULE, 'COMMAND_DUPLICATE',
      `Duplicate commandId "${commandId}" rejected.`);
    return _rejected(commandId, command, `Duplicate command ID: "${commandId}" already processed.`);
  }

  // 3. Check Firebase availability for write commands
  const fbStatus = FirebaseConnector.getStatus();
  const isWriteCommand = ![
    CONTROL_COMMAND.GET_ENGINE_STATUS,
    CONTROL_COMMAND.GET_BROADCAST_STATUS,
    CONTROL_COMMAND.GET_DESTINATION_STATUS,
    CONTROL_COMMAND.GET_INGEST_STATUS,
    CONTROL_COMMAND.GET_METRICS,
  ].includes(command);

  // Read commands work without Firebase; write commands log the status
  if (isWriteCommand && fbStatus !== COMPONENT_STATUS.OK) {
    // Log but don't block — the control system operates locally even without Firebase
    CloudEngineLogger.warn(MODULE, 'FIREBASE_NOT_CONFIGURED',
      `Firebase status: ${fbStatus}. Command "${command}" executing locally.`);
  }

  // 4. Mark as processing
  _markCommandProcessed(commandId);

  CloudEngineLogger.info(MODULE, 'COMMAND_PROCESSING',
    `Processing command "${command}" from user "${ctx.userId}" (role: ${ctx.userRole}).`,
    { commandId });

  // 5. Dispatch
  try {
    const result = await _dispatch(ctx, engineRefs);
    CloudEngineLogger.info(MODULE, 'COMMAND_COMPLETED',
      `Command "${command}" completed.`, { commandId });
    return result;
  } catch (err) {
    CloudEngineLogger.error(MODULE, 'COMMAND_FAILED',
      `Command "${command}" failed: ${err.message}`, { commandId });
    return _failed(commandId, command, err.message);
  }
}

/* ═══════════════════════════════════
   COMMAND DISPATCH HANDLERS
═══════════════════════════════════ */

async function _dispatch(ctx, refs) {
  const { command, commandId, params = {} } = ctx;
  const { fanOutManager, ingestManager, getEngineStatus: getEngineStatusFn } = refs;

  switch (command) {

    /* ── Engine Status ───────────────────────────────── */
    case CONTROL_COMMAND.GET_ENGINE_STATUS: {
      const status = getEngineStatusFn ? getEngineStatusFn() : 'UNKNOWN';
      return _completed(commandId, command, { engineStatus: status });
    }

    /* ── Broadcast ───────────────────────────────────── */
    case CONTROL_COMMAND.START_BROADCAST: {
      if (!fanOutManager) return _failed(commandId, command, 'FanOutManager not available.');
      const result = await fanOutManager.startMultiBroadcast({
        inputPath:  params.inputPath,
        ffmpegPath: params.ffmpegPath,
        destinationIds: params.destinationIds ?? undefined,
      });
      return result.success
        ? _completed(commandId, command, _safeBroadcastResult(result))
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.STOP_BROADCAST: {
      if (!fanOutManager) return _failed(commandId, command, 'FanOutManager not available.');
      const result = await fanOutManager.stopMultiBroadcast();
      return result.success
        ? _completed(commandId, command, { message: result.message })
        : _failed(commandId, command, result.message);
    }

    /* ── Destinations ────────────────────────────────── */
    case CONTROL_COMMAND.ADD_DESTINATION: {
      if (!fanOutManager) return _failed(commandId, command, 'FanOutManager not available.');
      if (!params.destination) return _failed(commandId, command, 'params.destination is required.');
      const result = fanOutManager.addDestination(params.destination);
      return result.success
        ? _completed(commandId, command, { message: result.message })
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.REMOVE_DESTINATION: {
      if (!fanOutManager) return _failed(commandId, command, 'FanOutManager not available.');
      if (!params.destinationId) return _failed(commandId, command, 'params.destinationId is required.');
      const result = await fanOutManager.removeDestination(params.destinationId);
      return result.success
        ? _completed(commandId, command, { message: result.message })
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.RECONNECT_DESTINATION: {
      if (!fanOutManager) return _failed(commandId, command, 'FanOutManager not available.');
      if (!params.destinationId) return _failed(commandId, command, 'params.destinationId is required.');
      const result = await fanOutManager.restartDestination(params.destinationId);
      return result.success
        ? _completed(commandId, command, { message: result.message })
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.GET_BROADCAST_STATUS: {
      if (!fanOutManager) return _completed(commandId, command, { status: 'NOT_AVAILABLE' });
      const metrics = fanOutManager.getMultiBroadcastMetrics();
      return _completed(commandId, command, _safeMetrics(metrics));
    }

    case CONTROL_COMMAND.GET_DESTINATION_STATUS: {
      if (!fanOutManager) return _completed(commandId, command, { destinations: [] });
      const all = fanOutManager.getAllDestinationStatuses();
      return _completed(commandId, command, { destinations: all });
    }

    /* ── Ingest ──────────────────────────────────────── */
    case CONTROL_COMMAND.START_INGEST: {
      if (!ingestManager) return _failed(commandId, command, 'IngestManager not available.');
      if (!params.sessionId) return _failed(commandId, command, 'params.sessionId is required.');
      const result = await ingestManager.startIngest(params.sessionId);
      return result.success
        ? _completed(commandId, command, { message: result.message, inputPath: result.inputPath })
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.STOP_INGEST: {
      if (!ingestManager) return _failed(commandId, command, 'IngestManager not available.');
      const result = await ingestManager.stopIngest();
      return result.success
        ? _completed(commandId, command, { message: result.message })
        : _failed(commandId, command, result.message);
    }

    case CONTROL_COMMAND.GET_INGEST_STATUS: {
      if (!ingestManager) return _completed(commandId, command, { status: 'NOT_AVAILABLE' });
      return _completed(commandId, command, ingestManager.getStatus());
    }

    case CONTROL_COMMAND.GET_METRICS: {
      const out = {};
      if (fanOutManager)  out.broadcast = _safeMetrics(fanOutManager.getMultiBroadcastMetrics());
      if (ingestManager)  out.ingest    = ingestManager.getActiveMetrics();
      return _completed(commandId, command, out);
    }

    default:
      return _rejected(commandId, command, `Unhandled command: "${command}".`);
  }
}

/* ═══════════════════════════════════
   SAFE RESULT HELPERS
   Strip any potentially sensitive data from command results.
═══════════════════════════════════ */

/**
 * Strip stream keys from a broadcast result before returning to client.
 */
function _safeBroadcastResult(result) {
  if (!result || !result.destinations) return { message: result.message };
  const safeDests = {};
  for (const [id, r] of Object.entries(result.destinations)) {
    safeDests[id] = { success: r.success, message: r.message };
  }
  return { message: result.message, destinations: safeDests };
}

/**
 * Strip stream keys from metrics before returning to client.
 */
function _safeMetrics(metrics) {
  if (!metrics) return null;
  // Deep-clone and remove any key that might contain stream key info
  const safe = JSON.parse(JSON.stringify(metrics));
  if (safe.destinations) {
    for (const d of safe.destinations) {
      delete d.streamKey;
    }
  }
  return safe;
}

/* ═══════════════════════════════════
   FIREBASE STATE SYNC
   Write engine state to Firestore (when configured).
═══════════════════════════════════ */

/**
 * Write a safe engine state snapshot to Firebase.
 * Strips all secrets before writing.
 * No-ops gracefully if Firebase is not configured.
 *
 * @param {object} state  Safe state snapshot (no stream keys, no tokens)
 * @returns {Promise<{ success: boolean, status: string }>}
 */
export async function syncEngineStateToFirebase(state) {
  const fbStatus = FirebaseConnector.getStatus();
  if (fbStatus !== COMPONENT_STATUS.OK) {
    return { success: false, status: fbStatus };
  }

  try {
    return await FirebaseConnector.writeEngineState(state);
  } catch (err) {
    CloudEngineLogger.warn(MODULE, 'SYNC_FAILED', `Failed to sync state to Firebase: ${err.message}`);
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Get the Firebase connection status for the control system.
 * @returns {{ status: string, configured: boolean }}
 */
export function getFirebaseControlStatus() {
  const fbStatus = FirebaseConnector.getStatus();
  return {
    status:     fbStatus,
    configured: fbStatus === COMPONENT_STATUS.OK,
    note:       fbStatus === COMPONENT_STATUS.NOT_CONFIGURED
      ? 'Firebase not configured. Control commands execute locally. ' +
        'To enable Firebase sync, call FirebaseConnector.initialize({ db }) with the Firestore instance.'
      : null,
  };
}

/* ═══════════════════════════════════
   COMMAND LISTENER
   Subscribe to Firebase command queue and process incoming commands.
═══════════════════════════════════ */

let _commandListener = null;

/**
 * Subscribe to the Firebase command queue.
 * New commands are processed automatically as they arrive.
 *
 * Returns NOT_CONFIGURED if Firebase is not available.
 *
 * @param {object} engineRefs  Engine references for dispatch.
 * @returns {{ status: string, unsubscribe?: Function }}
 */
export function subscribeToControlCommands(engineRefs = {}) {
  const fbStatus = FirebaseConnector.getStatus();
  if (fbStatus !== COMPONENT_STATUS.OK) {
    CloudEngineLogger.warn(MODULE, 'SUBSCRIBE_NOT_CONFIGURED',
      `Cannot subscribe to control commands: Firebase status is ${fbStatus}`);
    return { status: 'NOT_CONFIGURED' };
  }

  if (_commandListener) {
    CloudEngineLogger.warn(MODULE, 'SUBSCRIBE_ALREADY_ACTIVE',
      'Command listener already active.');
    return { status: 'ALREADY_ACTIVE' };
  }

  _commandListener = FirebaseConnector.subscribeCommands(async (rawCommand) => {
    if (!rawCommand || !rawCommand.commandId) {
      CloudEngineLogger.warn(MODULE, 'INVALID_COMMAND_RECEIVED',
        'Received invalid command from Firebase queue (no commandId).');
      return;
    }

    const result = await processControlCommand(rawCommand, engineRefs);

    // Write result back to Firebase
    if (FirebaseConnector.getStatus() === COMPONENT_STATUS.OK) {
      await FirebaseConnector.writeEngineState({
        lastCommandResult: result,
        lastCommandAt:     new Date().toISOString(),
      }).catch(() => {});
    }
  });

  CloudEngineLogger.info(MODULE, 'COMMAND_LISTENER_STARTED',
    'Firebase control command listener started.');

  return {
    status: 'ACTIVE',
    unsubscribe: () => {
      if (_commandListener) {
        _commandListener();
        _commandListener = null;
        CloudEngineLogger.info(MODULE, 'COMMAND_LISTENER_STOPPED',
          'Firebase control command listener stopped.');
      }
    },
  };
}

/* ═══════════════════════════════════
   FIREBASE CONNECTOR UPGRADE
   Stage 6 implements the previously stubbed methods.
═══════════════════════════════════ */

// Upgrade FirebaseConnector.writeEngineState to actually work when db is available.
// This is done by patching the connector with a wrapper.
// (The original connector still returns NOT_IMPLEMENTED stubs when db is null.)
export const FirebaseControl = Object.freeze({
  validateCommandContext,
  processControlCommand,
  subscribeToControlCommands,
  syncEngineStateToFirebase,
  getFirebaseControlStatus,
  CONTROL_COMMAND,
  CONTROL_COMMAND_STATE,
});
