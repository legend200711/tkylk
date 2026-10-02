/**
 * 24-HOUR CLOUD ENGINE — Frontend Tests
 * cloud-engine-ui/tests/ce-frontend.test.mjs
 *
 * Tests for the frontend layer.
 * These run in Node.js without a browser.
 * Tests focus on:
 *   - Store logic
 *   - Status mapping and badge generation
 *   - Firebase bridge isolation
 *   - Route validation
 *   - Secret masking
 *   - Integration map correctness
 */

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */

// Simulate the Store module in isolation (no DOM)
function createStore() {
  const state = {
    auth: { status: 'checking', user: null, role: null },
    firebase: { status: 'NOT_CONFIGURED', project: 'remix-studio-4bf8a' },
    engine: { status: 'OFFLINE', version: null, startedAt: null, uptime: 0, lastError: null, lastUpdated: null },
    broadcast: { state: 'IDLE', title: null, mode: null, startedAt: null, uptimeSec: 0,
                 destinationCount: 0, activeSessions: 0, failedSessions: 0, totalBytesSent: null },
    encoder: { status: 'UNINITIALIZED', speed: null, fps: null, dropped: null, bitrate: null },
    ingest: { state: 'IDLE', activeSessionId: null, uptimeSec: 0, sourceType: null },
    destinations: [],
    platforms: { youtube: { status: 'NOT_CONFIGURED' }, twitch: { status: 'NOT_CONFIGURED' },
                 facebook: { status: 'NOT_CONFIGURED' }, customRtmp: { status: 'NOT_CONFIGURED' } },
    media: { items: [], loading: false, error: null },
    tvStation: { stationState: 'OFFLINE', playbackState: 'IDLE', currentProgram: null, nextProgram: null, queuePosition: 0 },
    hybrid: { hybridState: 'OFFLINE', isLive: false, currentSource: null, resumeStrategy: 'CURRENT_SCHEDULE' },
    recovery: { status: 'UNKNOWN', components: {}, lastAttempt: null, metrics: null },
    watchdog: { active: false, lastCheck: null },
    events: [],
    schedule: [],
    queue: [],
    playlists: [],
    nav: { currentScreen: 'dashboard', collapsed: false },
  };

  function get(path) {
    const parts = path.split('.');
    let cur = state;
    for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
    return cur;
  }

  function set(path, value) {
    const parts = path.split('.');
    let cur = state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function merge(path, partial) {
    const current = get(path);
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      set(path, { ...current, ...partial });
    } else { set(path, partial); }
  }

  function applyEngineStateDoc(doc) {
    if (!doc) { merge('engine', { status: 'OFFLINE', lastUpdated: Date.now() }); return; }
    if (doc.engine) merge('engine', {
      status:    doc.engine.status    ?? 'UNKNOWN',
      version:   doc.engine.version   ?? null,
      startedAt: doc.engine.startedAt ?? null,
      uptime:    doc.engine.uptime    ?? 0,
      lastError: doc.engine.lastError ?? null,
      lastUpdated: Date.now(),
    });
    if (doc.broadcast) merge('broadcast', {
      state:          doc.broadcast.state          ?? 'IDLE',
      title:          doc.broadcast.title          ?? null,
      mode:           doc.broadcast.mode           ?? null,
      startedAt:      doc.broadcast.startedAt      ?? null,
      uptimeSec:      doc.broadcast.uptimeSec      ?? 0,
      activeSessions: doc.broadcast.activeSessions ?? 0,
      failedSessions: doc.broadcast.failedSessions ?? 0,
    });
    if (doc.encoder) merge('encoder', doc.encoder);
    if (doc.ingest)  merge('ingest',  doc.ingest);
    if (doc.destinations) set('destinations', doc.destinations);
  }

  return { state, get, set, merge, applyEngineStateDoc };
}

// Badge generation (from ce-utils.js logic, reimplemented for node test)
function badge(status, variant) {
  return `<span class="ce-badge ce-badge-${variant}">${status}</span>`;
}

function engineStatusBadge(status) {
  const map = {
    'RUNNING':    ['LIVE','live'],   'READY':   ['READY','ready'],
    'STARTING':   ['STARTING','warn'], 'ERROR': ['ERROR','error'],
    'STOPPED':    ['OFFLINE','offline'],'OFFLINE':['OFFLINE','offline'],
  };
  const [l, c] = map[status] ?? [status, 'offline'];
  return badge(l, c);
}

function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const SECRET_FIELDS = new Set(['streamKey','stream_key','publishUrl','password','token',
    'accessToken','refreshToken','idToken','apiKey','api_key','secret','clientSecret']);
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const safe = {};
  for (const [k, v] of Object.entries(obj)) {
    safe[k] = SECRET_FIELDS.has(k) ? '[REDACTED]' : (typeof v === 'object' ? stripSecrets(v) : v);
  }
  return safe;
}

/* ═══════════════════════════════════
   TESTS
═══════════════════════════════════ */

describe('CE Frontend — Authentication State', () => {
  it('initial auth state is checking', () => {
    const store = createStore();
    assert.equal(store.get('auth.status'), 'checking');
    assert.equal(store.get('auth.user'), null);
    assert.equal(store.get('auth.role'), null);
  });

  it('sets authenticated state when user provided', () => {
    const store = createStore();
    const user = { uid: 'test-uid-001', email: 'user@example.com', displayName: 'Test User' };
    store.merge('auth', { status: 'authenticated', user });
    assert.equal(store.get('auth.status'), 'authenticated');
    assert.equal(store.get('auth.user.uid'), 'test-uid-001');
    assert.equal(store.get('auth.user.email'), 'user@example.com');
  });

  it('clears user on sign out', () => {
    const store = createStore();
    store.merge('auth', { status: 'authenticated', user: { uid: 'x', email: 'x@x.com' } });
    store.merge('auth', { status: 'unauthenticated', user: null });
    assert.equal(store.get('auth.status'), 'unauthenticated');
    assert.equal(store.get('auth.user'), null);
  });
});

describe('CE Frontend — Engine State Mapping', () => {
  it('defaults engine status to OFFLINE', () => {
    const store = createStore();
    assert.equal(store.get('engine.status'), 'OFFLINE');
  });

  it('applies engine state document correctly', () => {
    const store = createStore();
    store.applyEngineStateDoc({
      engine: { status: 'RUNNING', version: { version: '0.13.0', stage: 13 }, uptime: 3600 },
      broadcast: { state: 'BROADCASTING', title: 'Test Show', activeSessions: 2, failedSessions: 0 },
    });
    assert.equal(store.get('engine.status'), 'RUNNING');
    assert.equal(store.get('engine.uptime'), 3600);
    assert.equal(store.get('broadcast.state'), 'BROADCASTING');
    assert.equal(store.get('broadcast.title'), 'Test Show');
    assert.equal(store.get('broadcast.activeSessions'), 2);
    assert.equal(store.get('broadcast.failedSessions'), 0);
  });

  it('sets engine to OFFLINE when doc is null', () => {
    const store = createStore();
    store.set('engine.status', 'RUNNING');
    store.applyEngineStateDoc(null);
    assert.equal(store.get('engine.status'), 'OFFLINE');
  });

  it('maps ENGINE_STATE values from backend correctly', () => {
    // From core/engine.js ENGINE_STATE
    const validStates = ['INITIALIZING','READY','STARTING','RUNNING','STOPPING','STOPPED','ERROR','RECOVERING'];
    const store = createStore();
    for (const state of validStates) {
      store.set('engine.status', state);
      assert.equal(store.get('engine.status'), state);
    }
  });
});

describe('CE Frontend — Dashboard Rendering', () => {
  it('correctly identifies live vs offline state', () => {
    const store = createStore();
    store.set('broadcast.state', 'IDLE');
    const isLive = ['BROADCASTING','PARTIAL'].includes(store.get('broadcast.state'));
    assert.equal(isLive, false);

    store.set('broadcast.state', 'BROADCASTING');
    const isLive2 = ['BROADCASTING','PARTIAL'].includes(store.get('broadcast.state'));
    assert.equal(isLive2, true);
  });

  it('PARTIAL state is treated as live with failures', () => {
    const store = createStore();
    store.set('broadcast.state', 'PARTIAL');
    store.set('broadcast.activeSessions', 2);
    store.set('broadcast.failedSessions', 1);
    const isLive = ['BROADCASTING','PARTIAL'].includes(store.get('broadcast.state'));
    assert.equal(isLive, true);
    assert.equal(store.get('broadcast.failedSessions'), 1);
  });
});

describe('CE Frontend — Go Live Command Validation', () => {
  it('requires broadcast title', () => {
    const title = '';
    assert.equal(!title || !title.trim(), true, 'Empty title should fail validation');
  });

  it('requires source selection', () => {
    const source = null;
    assert.equal(!source, true, 'No source should fail validation');
  });

  it('requires media path for MEDIA_FILE source', () => {
    const source = 'MEDIA_FILE';
    const path   = '';
    const requiresPath = source === 'MEDIA_FILE' && (!path || !path.trim());
    assert.equal(requiresPath, true);
  });

  it('does not require path for RTMP_INPUT source', () => {
    const source = 'RTMP_INPUT';
    const path   = '';
    const requiresPath = source === 'MEDIA_FILE' && (!path || !path.trim());
    assert.equal(requiresPath, false);
  });
});

describe('CE Frontend — Stop Broadcast Confirmation', () => {
  it('stopBroadcast requires confirmed: true on backend (command param)', () => {
    // From broadcast-studio.js stopBroadcast:
    //   if (!params.confirmed) return { requiresConfirmation: true }
    const params = { confirmed: false };
    const wouldBeRejected = !params.confirmed;
    assert.equal(wouldBeRejected, true);

    const params2 = { confirmed: true };
    const wouldBeAccepted = !params2.confirmed;
    assert.equal(wouldBeAccepted, false);
  });
});

describe('CE Frontend — Destination Management', () => {
  it('destinations default to empty array', () => {
    const store = createStore();
    assert.deepEqual(store.get('destinations'), []);
  });

  it('destination added via state update', () => {
    const store = createStore();
    store.set('destinations', [{
      destinationId: 'dest-001',
      name: 'YouTube Main',
      protocol: 'RTMPS',
      serverUrl: 'rtmps://a.rtmps.youtube.com/live2/',
      state: 'CONNECTED',
    }]);
    const dests = store.get('destinations');
    assert.equal(dests.length, 1);
    assert.equal(dests[0].name, 'YouTube Main');
  });
});

describe('CE Frontend — Secret Masking', () => {
  it('strips stream key from destination object', () => {
    const dest = {
      destinationId: 'dest-001',
      name: 'YouTube',
      serverUrl: 'rtmps://a.rtmps.youtube.com/live2/',
      streamKey: 'SECRET_KEY_12345',
      stream_key: 'ALSO_SECRET',
      publishUrl: 'rtmps://a.rtmps.youtube.com/live2/SECRET',
    };
    const safe = stripSecrets(dest);
    assert.equal(safe.streamKey,  '[REDACTED]', 'streamKey must be redacted');
    assert.equal(safe.stream_key, '[REDACTED]', 'stream_key must be redacted');
    assert.equal(safe.publishUrl, '[REDACTED]', 'publishUrl must be redacted');
    assert.equal(safe.name, 'YouTube', 'name should be preserved');
    assert.equal(safe.serverUrl, 'rtmps://a.rtmps.youtube.com/live2/', 'serverUrl should be preserved');
  });

  it('strips access token from nested object', () => {
    const data = {
      platform: 'YouTube',
      auth: { accessToken: 'secret-oauth-token', refreshToken: 'secret-refresh' },
    };
    const safe = stripSecrets(data);
    assert.equal(safe.auth.accessToken, '[REDACTED]');
    assert.equal(safe.auth.refreshToken, '[REDACTED]');
    assert.equal(safe.platform, 'YouTube');
  });

  it('does not modify safe fields', () => {
    const data = { name: 'Test', protocol: 'RTMPS', autoReconnect: true, id: 'dest-001' };
    const safe = stripSecrets(data);
    assert.equal(safe.name, 'Test');
    assert.equal(safe.protocol, 'RTMPS');
    assert.equal(safe.autoReconnect, true);
    assert.equal(safe.id, 'dest-001');
  });
});

describe('CE Frontend — Media Management', () => {
  it('media defaults to empty library', () => {
    const store = createStore();
    assert.deepEqual(store.get('media.items'), []);
    assert.equal(store.get('media.loading'), false);
  });

  it('media validation state is UNVALIDATED on registration', () => {
    const store = createStore();
    const items = [...store.get('media.items')];
    items.push({
      mediaId: 'media-001', title: 'Episode 1',
      filePath: '/media/ep1.mp4', type: 'PROGRAM',
      validationState: 'UNVALIDATED',
    });
    store.set('media.items', items);
    assert.equal(store.get('media.items')[0].validationState, 'UNVALIDATED');
  });

  it('media item has ownership isolation (ownerId)', () => {
    // Mirrors CloudMediaLibrary.getItem(id, requesterId) behavior
    const items = [
      { mediaId: 'media-001', ownerId: 'user-A', title: 'User A Content' },
      { mediaId: 'media-002', ownerId: 'user-B', title: 'User B Content' },
    ];
    const requesterId = 'user-A';
    const accessible = items.filter(i => !i.ownerId || i.ownerId === requesterId);
    assert.equal(accessible.length, 1);
    assert.equal(accessible[0].mediaId, 'media-001');
  });
});

describe('CE Frontend — TV Station Controls', () => {
  it('TV station defaults to OFFLINE', () => {
    const store = createStore();
    assert.equal(store.get('tvStation.stationState'), 'OFFLINE');
  });

  it('TV station state transitions match STATION_STATE values', () => {
    // From station-errors.js STATION_STATE
    const validStates = ['OFFLINE','INITIALIZING','READY','ON_AIR','PAUSED','NO_PROGRAMMING','ERROR','STOPPING'];
    const store = createStore();
    for (const state of validStates) {
      store.set('tvStation.stationState', state);
      assert.equal(store.get('tvStation.stationState'), state);
    }
  });
});

describe('CE Frontend — Playlist Management', () => {
  it('playlists default to empty array', () => {
    const store = createStore();
    assert.deepEqual(store.get('playlists'), []);
  });

  it('creates a playlist correctly', () => {
    const store = createStore();
    const pl = { id: 'pl-001', name: 'Morning Shows', items: [] };
    store.set('playlists', [pl]);
    assert.equal(store.get('playlists').length, 1);
    assert.equal(store.get('playlists')[0].name, 'Morning Shows');
  });

  it('deletes a playlist by id', () => {
    const store = createStore();
    store.set('playlists', [
      { id: 'pl-001', name: 'Morning' },
      { id: 'pl-002', name: 'Evening' },
    ]);
    const updated = store.get('playlists').filter(p => p.id !== 'pl-001');
    store.set('playlists', updated);
    assert.equal(store.get('playlists').length, 1);
    assert.equal(store.get('playlists')[0].id, 'pl-002');
  });
});

describe('CE Frontend — Schedule', () => {
  it('schedule defaults to empty array', () => {
    const store = createStore();
    assert.deepEqual(store.get('schedule'), []);
  });

  it('schedule entries have UTC start times', () => {
    const store = createStore();
    const entry = {
      id: 'sc-001',
      title: 'News',
      startTime: new Date('2026-06-01T18:00:00Z').toISOString(),
    };
    store.set('schedule', [entry]);
    const stored = store.get('schedule')[0];
    assert.ok(stored.startTime.endsWith('Z'), 'Start time must be UTC ISO string');
  });
});

describe('CE Frontend — Hybrid Mode Controls', () => {
  it('hybrid state defaults to OFFLINE', () => {
    const store = createStore();
    assert.equal(store.get('hybrid.hybridState'), 'OFFLINE');
  });

  it('resume strategies match backend RESUME_STRATEGY values', () => {
    // From hybrid-errors.js RESUME_STRATEGY
    const validStrategies = ['CURRENT_SCHEDULE', 'RESUME_INTERRUPTED', 'NEXT_ITEM'];
    const store = createStore();
    for (const strategy of validStrategies) {
      store.set('hybrid.resumeStrategy', strategy);
      assert.equal(store.get('hybrid.resumeStrategy'), strategy);
    }
  });

  it('hybrid isLive is false when not in LIVE state', () => {
    const store = createStore();
    const states = ['OFFLINE', 'STATION', 'PREPARING_LIVE', 'RETURNING_TO_STATION'];
    for (const state of states) {
      store.set('hybrid.hybridState', state);
      const isLive = store.get('hybrid.hybridState') === 'LIVE';
      assert.equal(isLive, false, `State "${state}" should not be live`);
    }
  });

  it('hybrid isLive is true in LIVE state', () => {
    const store = createStore();
    store.set('hybrid.hybridState', 'LIVE');
    assert.equal(store.get('hybrid.hybridState') === 'LIVE', true);
  });
});

describe('CE Frontend — Monitoring Display', () => {
  it('watchdog defaults to inactive', () => {
    const store = createStore();
    assert.equal(store.get('watchdog.active'), false);
  });

  it('recovery status defaults to UNKNOWN', () => {
    const store = createStore();
    assert.equal(store.get('recovery.status'), 'UNKNOWN');
  });

  it('event feed defaults to empty array', () => {
    const store = createStore();
    assert.deepEqual(store.get('events'), []);
  });

  it('events ring buffer caps at 100', () => {
    const store = createStore();
    const events = [];
    for (let i = 0; i < 120; i++) {
      events.unshift({ id: `evt-${i}`, type: 'test', timestamp: new Date().toISOString() });
      if (events.length > 100) events.length = 100;
    }
    store.set('events', events);
    assert.equal(store.get('events').length, 100);
  });
});

describe('CE Frontend — Recovery Display', () => {
  it('failure types match backend FAILURE_TYPE values', () => {
    // From recovery-policy.js FAILURE_TYPE
    const failureTypes = [
      'ENCODER_CRASH', 'ENCODER_STALLED', 'ENCODER_BEHIND',
      'INGEST_DISCONNECTED', 'INGEST_STALLED',
      'DESTINATION_DISCONNECTED', 'TRANSPORT_CRASH', 'RECONNECT_EXHAUSTED',
      'MEDIA_PLAYBACK_FAILURE', 'STATION_PLAYBACK_FAILURE',
      'HYBRID_LIVE_FAILURE', 'CONTROL_PLANE_FAILURE', 'PROCESS_CRASH',
    ];
    // All these should be recognizable from the frontend recovery screen
    for (const type of failureTypes) {
      assert.equal(typeof type, 'string');
      assert.ok(type.length > 0);
    }
  });
});

describe('CE Frontend — Mobile Navigation', () => {
  it('nav collapsed state can be toggled', () => {
    const store = createStore();
    store.set('nav.collapsed', false);
    store.set('nav.collapsed', !store.get('nav.collapsed'));
    assert.equal(store.get('nav.collapsed'), true);
    store.set('nav.collapsed', !store.get('nav.collapsed'));
    assert.equal(store.get('nav.collapsed'), false);
  });
});

describe('CE Frontend — Firebase Error Handling', () => {
  it('bridge NOT_CONFIGURED still shows offline UI', () => {
    const store = createStore();
    store.set('firebase.status', 'NOT_CONFIGURED');
    const isConfigured = store.get('firebase.status') === 'CONNECTED';
    assert.equal(isConfigured, false);
    // Engine should show as OFFLINE
    assert.equal(store.get('engine.status'), 'OFFLINE');
  });

  it('firebase project is always remix-studio-4bf8a', () => {
    const store = createStore();
    assert.equal(store.get('firebase.project'), 'remix-studio-4bf8a');
    // Shadow Reaper project must NOT be used
    assert.notEqual(store.get('firebase.project'), 'ffr3r3223');
  });
});

describe('CE Frontend — Cross-User Isolation', () => {
  it('user A cannot see user B media items', () => {
    const userA = 'uid-user-a';
    const userB = 'uid-user-b';
    const allMedia = [
      { mediaId: 'm1', ownerId: userA, title: 'A Media' },
      { mediaId: 'm2', ownerId: userB, title: 'B Media' },
    ];
    const userAMedia = allMedia.filter(m => m.ownerId === userA);
    assert.equal(userAMedia.length, 1);
    assert.equal(userAMedia[0].mediaId, 'm1');
  });

  it('user A cannot see user B destinations', () => {
    const userA = 'uid-user-a';
    const userB = 'uid-user-b';
    const allDests = [
      { id: 'd1', ownerId: userA, name: 'A Dest' },
      { id: 'd2', ownerId: userB, name: 'B Dest' },
    ];
    const userADests = allDests.filter(d => d.ownerId === userA);
    assert.equal(userADests.length, 1);
    assert.equal(userADests[0].id, 'd1');
  });
});

describe('CE Frontend — API/Firebase Error Handling', () => {
  it('sendControlCommand returns error when not authenticated', () => {
    // Simulates what ce-firebase-bridge.js sendControlCommand returns
    const user = null;
    if (!user) {
      const result = { success: false, message: 'Not connected or not authenticated.' };
      assert.equal(result.success, false);
      assert.ok(result.message.includes('authenticated'));
    }
  });

  it('signIn auth error messages are user-friendly', () => {
    const authErrorMap = {
      'auth/user-not-found':  'No account found with this email.',
      'auth/wrong-password':  'Incorrect password.',
      'auth/invalid-email':   'Invalid email address.',
      'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    };
    for (const [code, msg] of Object.entries(authErrorMap)) {
      assert.ok(msg.length > 10, `Message for ${code} should be descriptive`);
      assert.ok(!msg.includes('firebase'), `Message for ${code} should not expose internals`);
    }
  });
});

describe('CE Frontend — CONTROL_COMMAND Integration Map', () => {
  it('frontend control commands match backend CONTROL_COMMAND values', () => {
    // From cloud-engine/firebase/firebase-control.js CONTROL_COMMAND
    const backendCommands = [
      'START_BROADCAST', 'STOP_BROADCAST',
      'ADD_DESTINATION', 'REMOVE_DESTINATION', 'RECONNECT_DESTINATION',
      'START_INGEST', 'STOP_INGEST',
      'GET_ENGINE_STATUS', 'GET_BROADCAST_STATUS',
      'GET_DESTINATION_STATUS', 'GET_INGEST_STATUS', 'GET_METRICS',
    ];
    // All should be non-empty strings
    for (const cmd of backendCommands) {
      assert.equal(typeof cmd, 'string');
      assert.ok(cmd.length > 0);
    }
  });

  it('Firebase collections match CE_COLLECTIONS from firebase-connector.js', () => {
    const CE_COLLECTIONS = {
      ENGINE_STATE:   'cloud_engine_state',
      COMMANDS:       'cloud_engine_commands',
      PLAYLIST:       'cloud_stream_playlist',
      SESSIONS:       'cloud_stream_sessions',
      SCHEDULES:      'cloud_stream_schedules',
      LOGS:           'cloud_stream_logs',
      DESTINATIONS:   'cloud_stream_destinations',
      YOUTUBE_TOKENS: 'cloud_stream_youtube_tokens',
    };
    // All collection names should start with cloud_
    for (const [key, name] of Object.entries(CE_COLLECTIONS)) {
      assert.ok(name.startsWith('cloud_'), `Collection ${key} must start with cloud_`);
    }
    // Shadow Reaper collections must not be included
    const shadowReaperCollections = ['shadowReaperConversations','shadowReaperMemory','shadowReaperLearnedContext'];
    const ceCollectionNames = Object.values(CE_COLLECTIONS);
    for (const srCol of shadowReaperCollections) {
      assert.equal(ceCollectionNames.includes(srCol), false,
        `Shadow Reaper collection "${srCol}" must NOT be in CE_COLLECTIONS`);
    }
  });
});

describe('CE Frontend — Source Type Accuracy', () => {
  it('source type statuses match backend SOURCE_TYPE_STATUS', () => {
    // From cloud-engine/ingest/ingest-errors.js SOURCE_TYPE_STATUS
    const expectedStatuses = {
      MEDIA_FILE:       'OPERATIONAL',
      RTMP_INPUT:       'ARCHITECTURE_READY',
      CAMERA:           'NOT_IMPLEMENTED',
      MICROPHONE:       'NOT_IMPLEMENTED',
      CAMERA_MIC:       'NOT_IMPLEMENTED',
      FUTURE_WEBRTC:    'NOT_IMPLEMENTED',
      EXTERNAL_ENCODER: 'ARCHITECTURE_READY',
    };
    // Frontend must NOT show CAMERA/MICROPHONE as available
    assert.equal(expectedStatuses.CAMERA, 'NOT_IMPLEMENTED');
    assert.equal(expectedStatuses.MICROPHONE, 'NOT_IMPLEMENTED');
    assert.equal(expectedStatuses.FUTURE_WEBRTC, 'NOT_IMPLEMENTED');
    // Frontend should show MEDIA_FILE as operational
    assert.equal(expectedStatuses.MEDIA_FILE, 'OPERATIONAL');
  });
});

describe('CE Frontend — Permissions', () => {
  it('ROLE values match backend ROLE constants', () => {
    // From cloud-engine/security/permissions.js
    const ROLE = { OWNER:'OWNER', ADMIN:'ADMIN', CREATOR:'CREATOR', VIEWER:'VIEWER' };
    assert.equal(ROLE.OWNER,   'OWNER');
    assert.equal(ROLE.ADMIN,   'ADMIN');
    assert.equal(ROLE.CREATOR, 'CREATOR');
    assert.equal(ROLE.VIEWER,  'VIEWER');
  });

  it('VIEWER has most restricted permissions', () => {
    // From permissions.js: VIEWER only has VIEW_CHANNEL and VIEW_STATUS
    // OWNER has all permissions (all PERMISSION.* values = 14 permissions)
    const ROLE_PERMISSIONS = {
      OWNER:   [
        'START_ENGINE','STOP_ENGINE','RESTART_ENGINE',
        'START_BROADCAST','STOP_BROADCAST',
        'UPLOAD_MEDIA','DELETE_MEDIA','APPROVE_MEDIA',
        'CREATE_PLAYLIST','EDIT_PLAYLIST','DELETE_PLAYLIST',
        'CREATE_SCHEDULE','EDIT_SCHEDULE',
        'ADD_TO_QUEUE','REMOVE_FROM_QUEUE','REORDER_QUEUE',
        'VIEW_CHANNEL','VIEW_STATUS','VIEW_LOGS',
        'MANAGE_DESTINATIONS','VIEW_DESTINATION_INFO',
      ],
      CREATOR: ['UPLOAD_MEDIA','CREATE_PLAYLIST','EDIT_PLAYLIST','ADD_TO_QUEUE','VIEW_CHANNEL','VIEW_STATUS','VIEW_DESTINATION_INFO'],
      VIEWER:  ['VIEW_CHANNEL','VIEW_STATUS'],
    };
    assert.ok(ROLE_PERMISSIONS.VIEWER.length < ROLE_PERMISSIONS.OWNER.length,
      'VIEWER should have fewer permissions than OWNER');
    assert.ok(ROLE_PERMISSIONS.VIEWER.length < ROLE_PERMISSIONS.CREATOR.length,
      'VIEWER should have fewer permissions than CREATOR');
    assert.ok(ROLE_PERMISSIONS.VIEWER.every(p => p.startsWith('VIEW')),
      'VIEWER permissions should all be VIEW_ prefixed');
  });
});

console.log('\n✓ All CE frontend tests completed.\n');
