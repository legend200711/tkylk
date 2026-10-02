/**
 * 24-HOUR CLOUD ENGINE — App State Store
 * cloud-engine-ui/js/ce-store.js
 *
 * Centralised reactive state for the frontend.
 * No business logic here — only state shape and reactive helpers.
 *
 * Maps directly to Cloud Engine backend state constants:
 *   ENGINE_STATE, FANOUT_STATE, HYBRID_STATE, STATION_STATE,
 *   BROADCAST_STATE, INGEST_MANAGER_STATE, RECOVERY_ACTION, etc.
 */

/* ═══════════════════════════════════
   STATE SHAPE
═══════════════════════════════════ */
const _state = {
  // Auth
  auth: {
    status:   'checking',  // checking | unauthenticated | authenticated
    user:     null,        // { uid, email, displayName }
    role:     null,        // OWNER | ADMIN | CREATOR | VIEWER (client hint only)
  },

  // Firebase bridge
  firebase: {
    status:   'NOT_CONFIGURED', // BRIDGE_STATUS.*
    project:  'remix-studio-4bf8a',
  },

  // Cloud Engine runtime (populated from cloud_engine_state Firestore doc)
  engine: {
    status:      'OFFLINE',  // ENGINE_STATE.* or 'OFFLINE' when not reachable
    version:     null,
    startedAt:   null,
    uptime:      0,
    lastError:   null,
    lastUpdated: null,       // when we last received a state update
  },

  // Broadcast (from BroadcastStudio.getDashboard())
  broadcast: {
    state:            'IDLE',  // FANOUT_STATE.*
    title:            null,
    mode:             null,
    startedAt:        null,
    uptimeSec:        0,
    destinationCount: 0,
    activeSessions:   0,
    failedSessions:   0,
    totalBytesSent:   null,
  },

  // Encoder
  encoder: {
    status:  'UNINITIALIZED',
    speed:   null,
    fps:     null,
    dropped: null,
    bitrate: null,
  },

  // Ingest
  ingest: {
    state:          'IDLE',  // INGEST_MANAGER_STATE.*
    activeSessionId: null,
    uptimeSec:       0,
    sourceType:      null,
  },

  // Destinations (from fan-out manager)
  destinations: [],  // Array of safe destination status objects

  // Platforms
  platforms: {
    youtube:     { status: 'NOT_CONFIGURED', connected: false },
    twitch:      { status: 'NOT_CONFIGURED', connected: false },
    facebook:    { status: 'NOT_CONFIGURED', connected: false },
    customRtmp:  { status: 'NOT_CONFIGURED', connected: false },
    customRtmps: { status: 'NOT_CONFIGURED', connected: false },
  },

  // Media library (from MediaLibrary)
  media: {
    items:   [],
    loading: false,
    error:   null,
  },

  // TV Station (from TVStationManager)
  tvStation: {
    stationState:   'OFFLINE',  // STATION_STATE.*
    playbackState:  'IDLE',
    currentProgram: null,
    nextProgram:    null,
    queuePosition:  0,
  },

  // Hybrid mode (from HybridManager)
  hybrid: {
    hybridState:    'OFFLINE',  // HYBRID_STATE.*
    isLive:         false,
    currentSource:  null,
    resumeStrategy: 'CURRENT_SCHEDULE',  // RESUME_STRATEGY.*
  },

  // Recovery / watchdog (from RecoveryEngine)
  recovery: {
    status:       'UNKNOWN',
    components:   {},
    lastAttempt:  null,
    metrics:      null,
  },

  // Watchdog
  watchdog: {
    active:   false,
    lastCheck: null,
  },

  // Recent events (from StudioEventFeed)
  events: [],  // Array of { id, type, timestamp, data }

  // Schedule
  schedule: [],

  // Queue / playlist
  queue: [],

  // Playlists (loaded)
  playlists: [],

  // Navigation
  nav: {
    currentScreen: 'dashboard',
    collapsed:     false,
  },
};

/* ═══════════════════════════════════
   LISTENERS
═══════════════════════════════════ */
const _listeners = new Map();  // key → Set<fn>

/**
 * Subscribe to state changes on a given key path.
 * @param {string}   key  Dot-separated path e.g. 'engine.status'
 * @param {Function} fn
 * @returns {Function} unsubscribe
 */
export function subscribe(key, fn) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(fn);
  return () => _listeners.get(key).delete(fn);
}

function _emit(key) {
  const fns = _listeners.get(key);
  if (fns) for (const fn of fns) { try { fn(get(key)); } catch {} }
  // Also emit '*' for catch-all listeners
  const wildcard = _listeners.get('*');
  if (wildcard) for (const fn of wildcard) { try { fn(key, get(key)); } catch {} }
}

/**
 * Get state at a dot-separated path.
 * @param {string} path
 * @returns {*}
 */
export function get(path) {
  const parts = path.split('.');
  let cur = _state;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Set state at a dot-separated path and notify listeners.
 * @param {string} path
 * @param {*}      value
 */
export function set(path, value) {
  const parts = path.split('.');
  let cur = _state;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  _emit(path);
  // Emit parent paths too
  let parent = parts.slice(0, -1).join('.');
  if (parent) _emit(parent);
}

/**
 * Merge an object into a state path.
 * @param {string} path
 * @param {object} partial
 */
export function merge(path, partial) {
  const current = get(path);
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    set(path, { ...current, ...partial });
  } else {
    set(path, partial);
  }
}

/**
 * Get full state snapshot (shallow copy of top-level keys).
 */
export function getState() {
  return { ..._state };
}

/* ═══════════════════════════════════
   ENGINE STATE HELPERS
═══════════════════════════════════ */

/**
 * Apply a Firestore engine state doc to the store.
 * @param {object|null} doc  cloud_engine_state/current Firestore doc
 */
export function applyEngineStateDoc(doc) {
  if (!doc) {
    merge('engine', { status: 'OFFLINE', lastUpdated: Date.now() });
    return;
  }
  merge('engine', {
    status:      doc.engine?.status    ?? 'UNKNOWN',
    version:     doc.engine?.version   ?? null,
    startedAt:   doc.engine?.startedAt ?? null,
    uptime:      doc.engine?.uptime    ?? 0,
    lastError:   doc.engine?.lastError ?? null,
    lastUpdated: Date.now(),
  });
  if (doc.broadcast) {
    merge('broadcast', {
      state:            doc.broadcast.state          ?? 'IDLE',
      title:            doc.broadcast.title          ?? null,
      mode:             doc.broadcast.mode           ?? null,
      startedAt:        doc.broadcast.startedAt      ?? null,
      uptimeSec:        doc.broadcast.uptimeSec      ?? 0,
      destinationCount: doc.broadcast.destinationCount ?? 0,
      activeSessions:   doc.broadcast.activeSessions  ?? 0,
      failedSessions:   doc.broadcast.failedSessions  ?? 0,
    });
  }
  if (doc.encoder) merge('encoder', doc.encoder);
  if (doc.ingest)  merge('ingest', doc.ingest);
  if (doc.destinations) set('destinations', doc.destinations);
}

/**
 * Add an event to the local event feed (ring buffer of 100).
 */
export function pushEvent(type, data = {}, timestamp = new Date().toISOString()) {
  const events = [...get('events')];
  events.unshift({ id: `evt-${Date.now()}`, type, data, timestamp });
  if (events.length > 100) events.length = 100;
  set('events', events);
}

/**
 * Derive a CSS class/status string for the engine status.
 */
export function engineStatusClass(status) {
  const map = {
    'RUNNING':    'live',
    'READY':      'ready',
    'STARTING':   'warn',
    'RECOVERING': 'recovering',
    'ERROR':      'error',
    'STOPPING':   'warn',
    'STOPPED':    'offline',
    'OFFLINE':    'offline',
    'UNKNOWN':    'offline',
  };
  return map[status] ?? 'offline';
}

/**
 * Derive a CSS badge class for FANOUT_STATE / broadcast state.
 */
export function broadcastStatusBadge(state) {
  const map = {
    'BROADCASTING': 'live',
    'PARTIAL':      'partial',
    'STOPPING':     'warn',
    'STOPPED':      'offline',
    'IDLE':         'offline',
  };
  return map[state] ?? 'offline';
}

/**
 * Format uptime seconds as HH:MM:SS.
 */
export function formatUptime(secs) {
  if (secs == null || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

/**
 * Format bytes as human-readable.
 */
export function formatBytes(bytes) {
  if (bytes == null) return 'Unavailable';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
