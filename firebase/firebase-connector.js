/**
 * 24-HOUR CLOUD ENGINE — Firebase Connector Boundary
 * cloud-engine/firebase/firebase-connector.js
 *
 * Clean boundary between the 24-Hour Cloud Engine and Firebase.
 *
 * ⚠️  IMPORTANT:
 *   This module does NOT replace or modify the existing AURENIX
 *   Firebase configuration in tv/firebase-client.js.
 *   It is an ADDENDUM that adds Cloud Engine–specific operations
 *   to the existing Firebase project (remix-studio-4bf8a).
 *
 * The Firestore collections used here already have security rules
 * defined in tv/firestore.rules (cloud_stream_* collections).
 *
 * Stage 1: Connector defined, safe initialization tested.
 * Stage 6: writeEngineState, readEngineState, subscribeCommands implemented
 *          when a real db instance is provided.
 *          Remains safely NOT_CONFIGURED when no db is provided.
 *
 * The tv/ project's firebase-client.js is the single source of the
 * Firebase SDK. When deploying, import from that path:
 *   import { db } from '../../tv/firebase-client.js';   // from within tv/
 *   import { db } from '../../../tv/firebase-client.js'; // from standalone
 *
 * For standalone use (no Firebase), the connector initializes in
 * NOT_CONFIGURED mode safely without crash.
 *
 * SECURITY:
 *   Stream keys and private credentials MUST NEVER be written to Firestore.
 *   This module enforces this by stripping known secret fields before writes.
 *
 * SHARED INFRASTRUCTURE:
 *   The Cloud Engine uses Firebase project remix-studio-4bf8a (AURENIX).
 *   Shadow Reaper uses a SEPARATE Firebase project: ffr3r3223.
 *   These projects MUST NOT be swapped. See firebase/shared-infrastructure.js.
 *   The assertCloudEngineFirebaseProject() check in initialize() enforces this.
 */

import { CloudEngineLogger }                from '../logs/logger.js';
import { COMPONENT_STATUS }                 from '../core/state-manager.js';
import { assertCloudEngineFirebaseProject } from './shared-infrastructure.js';

/* ═══════════════════════════════════
   FIREBASE COLLECTION NAMES
   These match the security rules already in tv/firestore.rules
═══════════════════════════════════ */
export const CE_COLLECTIONS = Object.freeze({
  ENGINE_STATE:  'cloud_engine_state',        // Stage 2: live engine status doc
  COMMANDS:      'cloud_engine_commands',     // Stage 2: remote command queue
  PLAYLIST:      'cloud_stream_playlist',     // defined in existing firestore.rules
  SESSIONS:      'cloud_stream_sessions',     // defined in existing firestore.rules
  SCHEDULES:     'cloud_stream_schedules',    // defined in existing firestore.rules
  LOGS:          'cloud_stream_logs',         // defined in existing firestore.rules
  DESTINATIONS:  'cloud_stream_destinations', // defined in existing firestore.rules
  YOUTUBE_TOKENS:'cloud_stream_youtube_tokens',// defined in existing firestore.rules
});

/* ═══════════════════════════════════
   CONNECTOR STATE
═══════════════════════════════════ */
let _db            = null;  // Firestore instance — injected via init()
let _projectId     = null;
let _initialized   = false;
let _status        = COMPONENT_STATUS.NOT_CONFIGURED;

/* ═══════════════════════════════════
   INTERNAL HELPERS
═══════════════════════════════════ */
const _notConfigured = (method) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_CONFIGURED,
  message: `FirebaseConnector.${method}(): Firebase not configured. ` +
           `Call FirebaseConnector.initialize({ db }) to enable.`,
});

// Fields that must NEVER be written to Firestore
const _SECRET_FIELDS = new Set([
  'streamKey', 'stream_key', 'publishUrl', 'password', 'token',
  'accessToken', 'refreshToken', 'idToken', 'apiKey', 'api_key',
  'secret', 'clientSecret', 'serviceAccountKey',
]);

/**
 * Recursively strip secret fields from an object before writing to Firestore.
 * @param {object} obj
 * @returns {object}
 */
function _stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(_stripSecrets);
  const safe = {};
  for (const [k, v] of Object.entries(obj)) {
    if (_SECRET_FIELDS.has(k)) {
      safe[k] = '[REDACTED]';
    } else {
      safe[k] = typeof v === 'object' ? _stripSecrets(v) : v;
    }
  }
  return safe;
}

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

/**
 * Initialize the Firebase Connector.
 *
 * In the AURENIX tv project, call this with the existing `db` instance:
 *   import { db } from './firebase-client.js';
 *   await FirebaseConnector.initialize({ db, projectId: 'remix-studio-4bf8a' });
 *
 * Stage 1 standalone: call without args to put connector into
 * NOT_CONFIGURED state (safe — no crash).
 *
 * @param {{ db?: object, projectId?: string }} [opts]
 */
async function initialize(opts = {}) {
  const { db, projectId } = opts;

  if (!db) {
    _status      = COMPONENT_STATUS.NOT_CONFIGURED;
    _initialized = false;
    CloudEngineLogger.info('firebase/firebase-connector', 'FIREBASE_NOT_CONFIGURED',
      'FirebaseConnector initialized in NOT_CONFIGURED mode (no db instance provided). ' +
      'This is expected for Stage 1 standalone. ' +
      'Pass { db } from the AURENIX firebase-client.js when deploying to the tv/ project.');
    return { success: true, status: _status };
  }

  // ── Shared-infrastructure safety check ──────────────────────────────────
  // Verify the Cloud Engine is NOT accidentally pointed at the Shadow Reaper
  // Firebase project (ffr3r3223). The CE must use remix-studio-4bf8a only.
  const resolvedProjectId = projectId
    ?? (db.app && db.app.options && db.app.options.projectId)
    ?? null;
  const isolation = assertCloudEngineFirebaseProject(resolvedProjectId);
  if (!isolation.safe) {
    CloudEngineLogger.warn('firebase/firebase-connector', 'FIREBASE_PROJECT_ISOLATION_VIOLATION',
      isolation.reason);
    // Refuse to initialize rather than risk cross-system data access
    _status      = COMPONENT_STATUS.NOT_CONFIGURED;
    _initialized = false;
    return { success: false, status: _status, reason: isolation.reason };
  }

  _db          = db;
  _projectId   = resolvedProjectId;
  _initialized = true;
  _status      = COMPONENT_STATUS.OK;

  CloudEngineLogger.info('firebase/firebase-connector', 'FIREBASE_CONNECTED',
    `FirebaseConnector ready. Project: ${_projectId ?? 'unknown'}`);
  return { success: true, status: _status };
}

/**
 * Returns the current connector status.
 * @returns {string}  One of COMPONENT_STATUS.*
 */
function getStatus() {
  return _status;
}

/**
 * Returns the initialized Firestore db instance, or null.
 * @returns {object|null}
 */
function getDb() {
  return _db;
}

/**
 * Read the Cloud Engine's live state document from Firestore.
 * Stage 6: reads from cloud_engine_state collection.
 * Returns NOT_CONFIGURED when Firebase is not available.
 */
async function readEngineState() {
  if (!_initialized || !_db) return _notConfigured('readEngineState');
  try {
    // Firestore SDK call: doc(db, collection, docId).get()
    // Using duck-typed Firestore interface
    const ref = _db.collection
      ? _db.collection(CE_COLLECTIONS.ENGINE_STATE).doc('current')
      : null;
    if (!ref) return _notConfigured('readEngineState');

    const snap = await ref.get();
    return { success: true, status: 'OK', data: snap.exists ? snap.data() : null };
  } catch (err) {
    CloudEngineLogger.warn('firebase/firebase-connector', 'READ_ENGINE_STATE_FAILED',
      `readEngineState failed: ${err.message}`);
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Write the Cloud Engine's live state to Firestore.
 * Stage 6: persists engine state for Creator Studio dashboard.
 * SECURITY: Secrets are stripped before writing.
 *
 * @param {object} state  Safe state snapshot (stream keys stripped automatically)
 */
async function writeEngineState(state) {
  if (!_initialized || !_db) return _notConfigured('writeEngineState');
  try {
    const safeState = _stripSecrets(state);
    safeState.updatedAt = new Date().toISOString();

    const ref = _db.collection
      ? _db.collection(CE_COLLECTIONS.ENGINE_STATE).doc('current')
      : null;
    if (!ref) return _notConfigured('writeEngineState');

    await ref.set(safeState, { merge: true });
    return { success: true, status: 'OK' };
  } catch (err) {
    CloudEngineLogger.warn('firebase/firebase-connector', 'WRITE_ENGINE_STATE_FAILED',
      `writeEngineState failed: ${err.message}`);
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Subscribe to the remote command queue (cloud_engine_commands collection).
 * Stage 6: listens for PENDING commands, calls onCommand for each.
 *
 * Returns NOT_CONFIGURED noop if Firebase is unavailable.
 *
 * @param {(command: object) => void} onCommand
 * @returns {Function} unsubscribe
 */
function subscribeCommands(onCommand) {
  if (!_initialized || !_db) {
    CloudEngineLogger.warn('firebase/firebase-connector', 'SUBSCRIBE_NOT_CONFIGURED',
      'subscribeCommands() called but Firebase is not configured. ' +
      'Call initialize({ db }) first.');
    return function noop() {};
  }

  try {
    const query = _db.collection
      ? _db.collection(CE_COLLECTIONS.COMMANDS)
             .where('state', '==', 'PENDING')
             .orderBy('timestamp', 'asc')
      : null;

    if (!query || typeof query.onSnapshot !== 'function') {
      CloudEngineLogger.warn('firebase/firebase-connector', 'SUBSCRIBE_UNAVAILABLE',
        'Firestore onSnapshot not available on db instance.');
      return function noop() {};
    }

    const unsubscribe = query.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data && data.commandId) {
            // Mark as PROCESSING in Firestore
            change.doc.ref.update({ state: 'PROCESSING', processingAt: new Date().toISOString() })
              .catch(() => {});
            onCommand(data);
          }
        }
      });
    });

    CloudEngineLogger.info('firebase/firebase-connector', 'SUBSCRIBE_COMMANDS_ACTIVE',
      'Subscribed to Firebase command queue.');
    return unsubscribe;

  } catch (err) {
    CloudEngineLogger.warn('firebase/firebase-connector', 'SUBSCRIBE_COMMANDS_FAILED',
      `subscribeCommands setup failed: ${err.message}`);
    return function noop() {};
  }
}

/**
 * Read the current queue from Firestore.
 * @param {string} channelId
 */
async function readQueue(channelId) {
  if (!_initialized || !_db) return _notConfigured('readQueue');
  try {
    const ref = _db.collection
      ? _db.collection(CE_COLLECTIONS.PLAYLIST)
      : null;
    if (!ref) return _notConfigured('readQueue');
    const snap = await ref.where('channelId', '==', channelId).get();
    const items = snap.docs ? snap.docs.map(d => d.data()) : [];
    return { success: true, status: 'OK', data: items };
  } catch (err) {
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Read the active schedule from Firestore.
 * @param {string} channelId
 */
async function readSchedule(channelId) {
  if (!_initialized || !_db) return _notConfigured('readSchedule');
  try {
    const ref = _db.collection
      ? _db.collection(CE_COLLECTIONS.SCHEDULES)
      : null;
    if (!ref) return _notConfigured('readSchedule');
    const snap = await ref.where('channelId', '==', channelId).get();
    const items = snap.docs ? snap.docs.map(d => d.data()) : [];
    return { success: true, status: 'OK', data: items };
  } catch (err) {
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Write a structured log entry to Firestore cloud_stream_logs.
 * SECURITY: Secrets are stripped before writing.
 * @param {object} logEntry
 */
async function writeLog(logEntry) {
  if (!_initialized || !_db) return _notConfigured('writeLog');
  try {
    const safe = _stripSecrets(logEntry);
    const ref  = _db.collection
      ? _db.collection(CE_COLLECTIONS.LOGS)
      : null;
    if (!ref) return _notConfigured('writeLog');
    await ref.add({ ...safe, timestamp: new Date().toISOString() });
    return { success: true, status: 'OK' };
  } catch (err) {
    return { success: false, status: 'ERROR', message: err.message };
  }
}

/**
 * Fetch stream destination config (WITHOUT stream key).
 * Stream keys are NEVER returned — server-side env vars only.
 * @param {string} destinationId
 */
async function readDestinationSafe(destinationId) {
  if (!_initialized || !_db) return _notConfigured('readDestinationSafe');
  try {
    const ref = _db.collection
      ? _db.collection(CE_COLLECTIONS.DESTINATIONS).doc(destinationId)
      : null;
    if (!ref) return _notConfigured('readDestinationSafe');
    const snap = await ref.get();
    if (!snap.exists) return { success: false, status: 'NOT_FOUND', message: `Destination "${destinationId}" not found.` };

    const data = snap.data();
    // Strip stream key before returning
    const safe = { ...data };
    delete safe.streamKey;
    delete safe.stream_key;
    delete safe.publishUrl;
    return { success: true, status: 'OK', data: safe };
  } catch (err) {
    return { success: false, status: 'ERROR', message: err.message };
  }
}

async function shutdown() {
  _db          = null;
  _initialized = false;
  _status      = COMPONENT_STATUS.NOT_CONFIGURED;
  CloudEngineLogger.info('firebase/firebase-connector', 'FIREBASE_SHUTDOWN',
    'FirebaseConnector shut down.');
}

export const FirebaseConnector = Object.freeze({
  initialize,
  getStatus,
  getDb,
  readEngineState,
  writeEngineState,
  subscribeCommands,
  readQueue,
  readSchedule,
  writeLog,
  readDestinationSafe,
  shutdown,
  CE_COLLECTIONS,
});
