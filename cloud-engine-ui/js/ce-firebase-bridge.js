/**
 * 24-HOUR CLOUD ENGINE — Frontend Firebase Bridge
 * cloud-engine-ui/js/ce-firebase-bridge.js
 *
 * Connects the Cloud Engine frontend to the Firebase project:
 *   remix-studio-4bf8a  (AURENIX / Cloud Engine project)
 *
 * IMPORTANT:
 *   This MUST use Firebase project remix-studio-4bf8a ONLY.
 *   Shadow Reaper uses ffr3r3223. These projects are NOT interchangeable.
 *   See cloud-engine/firebase/shared-infrastructure.js for the full topology.
 *
 * Collections used (matching CE_COLLECTIONS in firebase-connector.js):
 *   cloud_engine_state      — live engine state
 *   cloud_engine_commands   — control commands from frontend → engine
 *   cloud_stream_destinations — destination configs (safe, no keys)
 *   cloud_stream_playlist   — queue/playlist data
 *   cloud_stream_schedules  — schedule data
 *   cloud_stream_logs       — event log
 *
 * SECURITY:
 *   - Stream keys are NEVER stored in or returned from Firestore.
 *   - Authentication is required for all write operations.
 *   - The engine validates commands server-side; this frontend does NOT
 *     bypass server-side authorization.
 *
 * Firebase Auth project: remix-studio-4bf8a
 * This frontend authenticates via the Cloud Engine Firebase project only.
 */

/* ═══════════════════════════════════
   FIREBASE SDK — loaded via importmap or CDN
   The actual import is done lazily to allow offline shell to load.
═══════════════════════════════════ */

const CE_FIREBASE_CONFIG = {
  // Cloud Engine Firebase project: remix-studio-4bf8a (AURENIX)
  // These are public client-side config values (safe to include in JS)
  // Actual secrets (stream keys, service account) remain server-side only.
  apiKey:            "AIzaSyB2M8sgU__2s0oVa5y4-s1S294aP5CBdeQ",
  authDomain:        "remix-studio-4bf8a.firebaseapp.com",
  databaseURL:       "https://remix-studio-4bf8a-default-rtdb.firebaseio.com",
  projectId:         "remix-studio-4bf8a",
  storageBucket:     "remix-studio-4bf8a.firebasestorage.app",
  messagingSenderId: "220851113113",
  appId:             "1:220851113113:web:bb3cd4e44f478d3925fc08",
  measurementId:     "G-GM0JCC3BGW",
};

// Firestore collection names (mirror of CE_COLLECTIONS in firebase-connector.js)
export const CE_COLLECTIONS = Object.freeze({
  ENGINE_STATE:   'cloud_engine_state',
  COMMANDS:       'cloud_engine_commands',
  PLAYLIST:       'cloud_stream_playlist',
  SESSIONS:       'cloud_stream_sessions',
  SCHEDULES:      'cloud_stream_schedules',
  LOGS:           'cloud_stream_logs',
  DESTINATIONS:   'cloud_stream_destinations',
  YOUTUBE_TOKENS: 'cloud_stream_youtube_tokens',
});

// Bridge status
export const BRIDGE_STATUS = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INITIALIZING:   'INITIALIZING',
  CONNECTED:      'CONNECTED',
  ERROR:          'ERROR',
  OFFLINE:        'OFFLINE',
});

let _app    = null;
let _auth   = null;
let _db     = null;
let _status = BRIDGE_STATUS.NOT_CONFIGURED;
let _user   = null;
const _listeners = new Set();

/**
 * Notify all status listeners.
 */
function _notify(event, data = {}) {
  for (const fn of _listeners) {
    try { fn(event, data); } catch {}
  }
}

/**
 * Subscribe to bridge events.
 * @param {Function} fn  (event: string, data: object) => void
 * @returns {Function} unsubscribe
 */
export function onBridgeEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Initialize the Firebase bridge.
 * Called once on app boot.
 * Returns false if Firebase SDK is not available (offline shell still works).
 */
export async function initFirebaseBridge() {
  // Check if API key is configured
  if (CE_FIREBASE_CONFIG.apiKey === 'NOT_CONFIGURED') {
    _status = BRIDGE_STATUS.NOT_CONFIGURED;
    console.warn('[CE Firebase Bridge] Firebase API key not configured. ' +
      'Set CE_FIREBASE_CONFIG values from the remix-studio-4bf8a project. ' +
      'The frontend will run in offline/demo mode.');
    _notify('status', { status: _status });
    return false;
  }

  _status = BRIDGE_STATUS.INITIALIZING;
  _notify('status', { status: _status });

  try {
    // Dynamic import — allows offline shell to load even if Firebase unavailable
    const { initializeApp, getApps } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'
    );
    const { getFirestore, doc, setDoc, getDoc,
            collection, query, where, orderBy,
            onSnapshot, addDoc, serverTimestamp } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    const { getAuth, signInWithEmailAndPassword,
            signOut, onAuthStateChanged } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
    );

    // Initialize app (or reuse existing)
    const existingApps = getApps();
    // Use a named app "ce-app" to avoid collision if Shadow Reaper
    // were ever on the same page (it won't be, but defensive)
    _app = existingApps.find(a => a.name === 'ce-app')
      ?? initializeApp(CE_FIREBASE_CONFIG, 'ce-app');

    _auth = getAuth(_app);
    _db   = getFirestore(_app);

    // Stash Firestore helpers for later use
    _firestoreHelpers = {
      doc, setDoc, getDoc, collection, query,
      where, orderBy, onSnapshot, addDoc, serverTimestamp,
    };

    _status = BRIDGE_STATUS.CONNECTED;
    _notify('status', { status: _status });

    // Set up auth state listener
    onAuthStateChanged(_auth, (user) => {
      _user = user;
      _notify('auth', { user: user ? _safeUserInfo(user) : null });
    });

    console.log('[CE Firebase Bridge] Connected to remix-studio-4bf8a');
    return true;

  } catch (err) {
    _status = BRIDGE_STATUS.ERROR;
    console.error('[CE Firebase Bridge] Init failed:', err.message);
    _notify('status', { status: _status, error: err.message });
    return false;
  }
}

/** Firestore helper functions, populated after init */
let _firestoreHelpers = null;

/**
 * Return safe user info (no internal tokens).
 */
function _safeUserInfo(user) {
  return {
    uid:   user.uid,
    email: user.email,
    displayName: user.displayName ?? null,
  };
}

/**
 * Get current bridge status.
 */
export function getBridgeStatus() { return _status; }

/**
 * Get current authenticated user (safe info only), or null.
 */
export function getCurrentUser() {
  return _user ? _safeUserInfo(_user) : null;
}

/* ═══════════════════════════════════
   AUTHENTICATION
═══════════════════════════════════ */

/**
 * Sign in with email + password.
 * Uses the Cloud Engine Firebase project (remix-studio-4bf8a) only.
 */
export async function signIn(email, password) {
  if (!_auth) {
    return { success: false, message: 'Firebase not initialized. Check configuration.' };
  }
  try {
    const { signInWithEmailAndPassword } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
    );
    const cred = await signInWithEmailAndPassword(_auth, email, password);
    _user = cred.user;
    return { success: true, user: _safeUserInfo(cred.user) };
  } catch (err) {
    const msg = _authErrorMessage(err.code);
    return { success: false, message: msg, code: err.code };
  }
}

/**
 * Sign out.
 */
export async function signOutUser() {
  if (!_auth) return;
  try {
    const { signOut } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
    );
    await signOut(_auth);
    _user = null;
  } catch {}
}

function _authErrorMessage(code) {
  const map = {
    'auth/user-not-found':     'No account found with this email.',
    'auth/wrong-password':     'Incorrect password.',
    'auth/invalid-email':      'Invalid email address.',
    'auth/too-many-requests':  'Too many attempts. Please wait before trying again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential': 'Invalid credentials.',
  };
  return map[code] ?? `Authentication failed (${code}).`;
}

/* ═══════════════════════════════════
   ENGINE STATE — READ
═══════════════════════════════════ */

/**
 * Read the live engine state from Firestore.
 * Returns null if not configured or not available.
 */
export async function readEngineState() {
  if (!_db || !_firestoreHelpers) return null;
  try {
    const { doc, getDoc } = _firestoreHelpers;
    const ref  = doc(_db, CE_COLLECTIONS.ENGINE_STATE, 'current');
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('[CE Bridge] readEngineState failed:', err.message);
    return null;
  }
}

/**
 * Subscribe to live engine state updates.
 * @param {Function} onUpdate  (data: object|null) => void
 * @returns {Function} unsubscribe
 */
export function subscribeEngineState(onUpdate) {
  if (!_db || !_firestoreHelpers) {
    onUpdate(null);
    return () => {};
  }
  const { doc, onSnapshot } = _firestoreHelpers;
  const ref = doc(_db, CE_COLLECTIONS.ENGINE_STATE, 'current');
  const unsub = onSnapshot(ref, (snap) => {
    onUpdate(snap.exists() ? snap.data() : null);
  }, () => onUpdate(null));
  return unsub;
}

/* ═══════════════════════════════════
   CONTROL COMMANDS — WRITE
═══════════════════════════════════ */

/**
 * Send a control command to the Cloud Engine via Firestore.
 *
 * The Cloud Engine backend (firebase-control.js) subscribes to
 * cloud_engine_commands and processes PENDING commands.
 *
 * This frontend NEVER bypasses server-side authorization —
 * the engine validates userId, userRole, and ownership.
 *
 * @param {string} command   CONTROL_COMMAND.* from firebase-control.js
 * @param {object} [params]  Command parameters (safe — no secrets)
 * @returns {Promise<{success: boolean, commandId?: string, message?: string}>}
 */
export async function sendControlCommand(command, params = {}) {
  if (!_db || !_firestoreHelpers || !_user) {
    return { success: false, message: 'Not connected or not authenticated.' };
  }
  try {
    const { collection, addDoc, serverTimestamp } = _firestoreHelpers;
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const payload = {
      commandId,
      command,
      params,
      userId:    _user.uid,
      userEmail: _user.email,
      state:     'PENDING',
      timestamp: serverTimestamp(),
      // userRole is NOT trusted from the browser — the engine resolves it
      // from Firebase Auth custom claims server-side.
    };
    const ref = collection(_db, CE_COLLECTIONS.COMMANDS);
    await addDoc(ref, payload);
    return { success: true, commandId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/* ═══════════════════════════════════
   DESTINATIONS — READ
═══════════════════════════════════ */

/**
 * Read all destination configs for current user.
 * Stream keys are NEVER returned — they live server-side.
 */
export async function readDestinations() {
  if (!_db || !_firestoreHelpers || !_user) return [];
  try {
    const { collection, query, where, getDocs } = _firestoreHelpers;
    // getDocs may not be pre-imported — use onSnapshot once
    const { getDocs: _getDocs } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
    );
    const q = query(
      collection(_db, CE_COLLECTIONS.DESTINATIONS),
      where('ownerId', '==', _user.uid)
    );
    const snap = await _getDocs(q);
    return snap.docs.map(d => {
      const data = { ...d.data(), id: d.id };
      // Strip stream key before returning to UI
      delete data.streamKey;
      delete data.stream_key;
      delete data.publishUrl;
      return data;
    });
  } catch (err) {
    console.warn('[CE Bridge] readDestinations failed:', err.message);
    return [];
  }
}

/**
 * Subscribe to destinations for current user.
 */
export function subscribeDestinations(onUpdate) {
  if (!_db || !_firestoreHelpers || !_user) { onUpdate([]); return () => {}; }
  const { collection, query, where, onSnapshot } = _firestoreHelpers;
  const q = query(
    collection(_db, CE_COLLECTIONS.DESTINATIONS),
    where('ownerId', '==', _user.uid)
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => {
      const data = { ...d.data(), id: d.id };
      delete data.streamKey;
      delete data.stream_key;
      delete data.publishUrl;
      return data;
    });
    onUpdate(items);
  }, () => onUpdate([]));
}

/* ═══════════════════════════════════
   LOGS — READ
═══════════════════════════════════ */

/**
 * Subscribe to recent log entries (last 50).
 */
export function subscribeLogs(onUpdate, limitCount = 50) {
  if (!_db || !_firestoreHelpers) { onUpdate([]); return () => {}; }
  const { collection, query, orderBy, onSnapshot } = _firestoreHelpers;
  // Only import limit on demand to keep the bundle clean
  let unsub;
  import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')
    .then(({ limit }) => {
      const q = query(
        collection(_db, CE_COLLECTIONS.LOGS),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      unsub = onSnapshot(q, (snap) => {
        onUpdate(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      }, () => onUpdate([]));
    });
  return () => { if (unsub) unsub(); };
}

/* ═══════════════════════════════════
   SCHEDULE — READ
═══════════════════════════════════ */

export function subscribeSchedule(channelId, onUpdate) {
  if (!_db || !_firestoreHelpers || !channelId) { onUpdate([]); return () => {}; }
  const { collection, query, where, orderBy, onSnapshot } = _firestoreHelpers;
  const q = query(
    collection(_db, CE_COLLECTIONS.SCHEDULES),
    where('channelId', '==', channelId),
    orderBy('startTime', 'asc')
  );
  return onSnapshot(q,
    (snap) => onUpdate(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    () => onUpdate([])
  );
}

/* ═══════════════════════════════════
   QUEUE / PLAYLIST — READ
═══════════════════════════════════ */

export function subscribeQueue(channelId, onUpdate) {
  if (!_db || !_firestoreHelpers || !channelId) { onUpdate([]); return () => {}; }
  const { collection, query, where, orderBy, onSnapshot } = _firestoreHelpers;
  const q = query(
    collection(_db, CE_COLLECTIONS.PLAYLIST),
    where('channelId', '==', channelId),
    orderBy('order', 'asc')
  );
  return onSnapshot(q,
    (snap) => onUpdate(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    () => onUpdate([])
  );
}
