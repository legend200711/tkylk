/**
 * 24-HOUR CLOUD ENGINE — Main Application
 * cloud-engine-ui/js/ce-app.js
 *
 * Boot sequence:
 *   1. Initialize Firebase bridge (remix-studio-4bf8a)
 *   2. Check authentication state
 *   3. Show auth gate if not authenticated
 *   4. Boot app shell on auth success
 *   5. Subscribe to engine state from Firestore
 *   6. Route to correct screen
 *
 * Shadow Reaper is a completely separate application.
 * This frontend is dedicated to the 24-Hour Cloud Engine only.
 * It does NOT modify Shadow Reaper's index.html, Firebase data,
 * or any other Shadow Reaper files.
 */

import {
  initFirebaseBridge,
  signIn,
  signOutUser,
  onBridgeEvent,
  getBridgeStatus,
  getCurrentUser,
  subscribeEngineState,
  CE_COLLECTIONS,
  BRIDGE_STATUS,
} from './ce-firebase-bridge.js';

import * as Store from './ce-store.js';
import { applyEngineStateDoc, pushEvent } from './ce-store.js';
import { toast, initConfirmDialog, $, show } from './ce-utils.js';

// Screen modules — lazy-loaded
const SCREENS = {
  'dashboard':    () => import('./screens/ce-screen-dashboard.js'),
  'studio':       () => import('./screens/ce-screen-studio.js'),
  'destinations': () => import('./screens/ce-screen-destinations.js'),
  'platforms':    () => import('./screens/ce-screen-platforms.js'),
  'media':        () => import('./screens/ce-screen-media.js'),
  'tv-station':   () => import('./screens/ce-screen-tv-station.js'),
  'playlists':    () => import('./screens/ce-screen-playlists.js'),
  'schedule':     () => import('./screens/ce-screen-schedule.js'),
  'now-playing':  () => import('./screens/ce-screen-now-playing.js'),
  'hybrid':       () => import('./screens/ce-screen-hybrid.js'),
  'monitoring':   () => import('./screens/ce-screen-monitoring.js'),
  'recovery':     () => import('./screens/ce-screen-recovery.js'),
  'settings':     () => import('./screens/ce-screen-settings.js'),
  'account':      () => import('./screens/ce-screen-account.js'),
};

const SCREEN_RENDER_FNS = {
  'dashboard':    'renderDashboard',
  'studio':       'renderStudio',
  'destinations': 'renderDestinations',
  'platforms':    'renderPlatforms',
  'media':        'renderMedia',
  'tv-station':   'renderTVStation',
  'playlists':    'renderPlaylists',
  'schedule':     'renderSchedule',
  'now-playing':  'renderNowPlaying',
  'hybrid':       'renderHybrid',
  'monitoring':   'renderMonitoring',
  'recovery':     'renderRecovery',
  'settings':     'renderSettings',
  'account':      'renderAccount',
};

/* ═══════════════════════════════════
   APP STATE
═══════════════════════════════════ */
let _currentScreen    = 'dashboard';
let _screenUnsubFn    = null;  // cleanup for current screen
let _engineStateUnsub = null;  // Firestore subscription cleanup

/* ═══════════════════════════════════
   BOOT
═══════════════════════════════════ */
async function boot() {
  // Initialise confirm dialog
  initConfirmDialog();

  // Register service worker
  registerServiceWorker();

  // Show auth gate loading state
  showAuthStatus('Connecting to Cloud Engine…', false);

  // 1. Initialize Firebase bridge
  const bridgeOk = await initFirebaseBridge();
  Store.set('firebase.status', bridgeOk ? BRIDGE_STATUS.CONNECTED : BRIDGE_STATUS.NOT_CONFIGURED);

  if (!bridgeOk) {
    // Firebase not configured — show sign-in form with a notice
    showAuthStatus('Firebase not configured. The engine state cannot be read until credentials are set up. You may still use the UI in offline mode.', false);
    showSignInForm();
    // Allow access in offline/demo mode
    showAppShell();
    routeToScreen('dashboard');
    return;
  }

  // 2. Listen for auth state changes
  onBridgeEvent((event, data) => {
    if (event === 'auth') {
      handleAuthChange(data.user);
    }
    if (event === 'status') {
      Store.set('firebase.status', data.status);
    }
  });
}

/* ═══════════════════════════════════
   AUTH HANDLING
═══════════════════════════════════ */
function handleAuthChange(user) {
  if (user) {
    Store.merge('auth', { status: 'authenticated', user });
    onAuthenticated(user);
  } else {
    Store.merge('auth', { status: 'unauthenticated', user: null });
    showSignInForm();
  }
}

function onAuthenticated(user) {
  // Show app shell
  showAppShell();

  // Update nav user display
  const emailEl = document.getElementById('ce-nav-user-email');
  if (emailEl) emailEl.textContent = user.email;

  // Subscribe to engine state from Firestore
  if (_engineStateUnsub) _engineStateUnsub();
  _engineStateUnsub = subscribeEngineState((doc) => {
    applyEngineStateDoc(doc);
    // Update nav engine status
    updateNavEngineBadge();
    if (doc === null) {
      pushEvent('system', { message: 'Engine state document not found. Runtime may be offline.' });
    }
  });

  // Start uptime tick
  startUptimeTick();

  // Route
  routeToScreen(getInitialScreen());
}

/* ═══════════════════════════════════
   AUTH GATE DOM
═══════════════════════════════════ */
function showAuthStatus(message, isLoading) {
  const statusEl = document.getElementById('ce-auth-status');
  const loadingEl = document.getElementById('ce-auth-loading');
  if (statusEl) statusEl.textContent = message;
  if (loadingEl) loadingEl.style.display = isLoading ? '' : 'none';
}

function showSignInForm() {
  const formEl   = document.getElementById('ce-auth-form');
  const statusEl = document.getElementById('ce-auth-status');
  if (formEl)   formEl.style.display   = '';
  if (statusEl) {
    const dot = statusEl.querySelector('.ce-status-dot');
    if (dot) { dot.className = 'ce-status-dot ce-status-offline'; }
    statusEl.lastChild.textContent = ' Sign in to continue';
  }
}

function showAppShell() {
  const gate  = document.getElementById('ce-auth-gate');
  const shell = document.getElementById('ce-app-shell');
  if (gate)  gate.style.display  = 'none';
  if (shell) shell.style.display = '';
}

/* ═══════════════════════════════════
   SIGN IN
═══════════════════════════════════ */
function bindSignInForm() {
  const btn      = document.getElementById('ce-sign-in-btn');
  const emailInp = document.getElementById('ce-email');
  const pwdInp   = document.getElementById('ce-password');
  const errEl    = document.getElementById('ce-auth-error');

  const doSignIn = async () => {
    const email = emailInp?.value?.trim();
    const pwd   = pwdInp?.value;
    if (!email) { if (errEl) errEl.textContent = 'Email required.'; return; }
    if (!pwd)   { if (errEl) errEl.textContent = 'Password required.'; return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    if (errEl) errEl.textContent = '';

    const result = await signIn(email, pwd);

    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }

    if (result.success) {
      if (errEl) errEl.textContent = '';
      // handleAuthChange will be called by the Firebase onAuthStateChanged listener
    } else {
      if (errEl) errEl.textContent = result.message;
    }
  };

  btn?.addEventListener('click', doSignIn);
  pwdInp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
}

/* ═══════════════════════════════════
   SIGN OUT
═══════════════════════════════════ */
function bindSignOut() {
  document.getElementById('ce-sign-out-btn')?.addEventListener('click', async () => {
    if (_engineStateUnsub) { _engineStateUnsub(); _engineStateUnsub = null; }
    if (_screenUnsubFn)    { _screenUnsubFn();    _screenUnsubFn    = null; }
    await signOutUser();
    Store.merge('auth', { status: 'unauthenticated', user: null });

    // Show auth gate
    const shell = document.getElementById('ce-app-shell');
    const gate  = document.getElementById('ce-auth-gate');
    if (shell) shell.style.display = 'none';
    if (gate)  gate.style.display  = '';
    showSignInForm();
    showAuthStatus('Signed out.', false);
  });
}

/* ═══════════════════════════════════
   NAVIGATION
═══════════════════════════════════ */
function bindNavigation() {
  // Navigation links
  document.querySelectorAll('.ce-nav-link[data-screen]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const screen = link.getAttribute('data-screen');
      routeToScreen(screen);
    });
  });

  // Nav toggle (collapse/expand)
  document.getElementById('ce-nav-toggle')?.addEventListener('click', () => {
    const nav = document.getElementById('ce-nav');
    if (!nav) return;
    const collapsed = nav.classList.toggle('collapsed');
    Store.set('nav.collapsed', collapsed);
  });

  // Hash-based routing
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && SCREENS[hash]) routeToScreen(hash);
  });
}

function getInitialScreen() {
  const hash = window.location.hash.replace('#', '');
  return (hash && SCREENS[hash]) ? hash : 'dashboard';
}

export function routeToScreen(screenId) {
  if (!SCREENS[screenId]) {
    console.warn(`[CE App] Unknown screen: "${screenId}"`);
    return;
  }

  _currentScreen = screenId;
  Store.set('nav.currentScreen', screenId);

  // Update nav active state
  document.querySelectorAll('.ce-nav-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-screen') === screenId);
    link.setAttribute('aria-current', link.getAttribute('data-screen') === screenId ? 'page' : 'false');
  });

  // Update URL hash
  if (window.location.hash !== `#${screenId}`) {
    history.pushState(null, '', `#${screenId}`);
  }

  // Cleanup previous screen
  if (_screenUnsubFn) { _screenUnsubFn(); _screenUnsubFn = null; }

  // Render new screen
  const container = document.getElementById('ce-screen-container');
  if (!container) return;

  // Loading placeholder
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px;color:var(--ce-text-muted)"><div class="ce-spinner" style="margin-right:12px"></div>Loading…</div>`;

  SCREENS[screenId]().then(mod => {
    const renderFn = SCREENS_RENDER_FNS?.[screenId] ?? SCREEN_RENDER_FNS[screenId];
    const fn = mod[renderFn ?? Object.keys(mod).find(k => k.startsWith('render'))];
    if (typeof fn === 'function') {
      container.innerHTML = '';
      _screenUnsubFn = fn(container) ?? null;
    } else {
      container.innerHTML = `<div class="ce-section"><div class="ce-card"><p class="ce-text-muted">Screen "${screenId}" has no render function.</p></div></div>`;
    }
  }).catch(err => {
    container.innerHTML = `<div class="ce-section"><div class="ce-card"><p style="color:var(--ce-error)">Failed to load screen: ${err.message}</p></div></div>`;
    console.error('[CE App] Screen load error:', err);
  });
}

const SCREENS_RENDER_FNS = SCREEN_RENDER_FNS; // alias for use in routeToScreen

/* ═══════════════════════════════════
   NAV ENGINE BADGE
═══════════════════════════════════ */
function updateNavEngineBadge() {
  const dot   = document.getElementById('ce-nav-status-dot');
  const label = document.getElementById('ce-nav-status-label');
  const engineStatus = Store.get('engine.status');
  const broadcastState = Store.get('broadcast.state');
  const isLive = broadcastState === 'BROADCASTING' || broadcastState === 'PARTIAL';

  const statusMap = {
    'RUNNING':    ['ce-status-live',      'LIVE'],
    'READY':      ['ce-status-ready',     'READY'],
    'STARTING':   ['ce-status-warn',      'STARTING'],
    'RECOVERING': ['ce-status-recovering','RECOVERING'],
    'ERROR':      ['ce-status-error',     'ERROR'],
    'STOPPING':   ['ce-status-warn',      'STOPPING'],
    'STOPPED':    ['ce-status-offline',   'STOPPED'],
    'OFFLINE':    ['ce-status-offline',   'OFFLINE'],
    'UNKNOWN':    ['ce-status-offline',   'OFFLINE'],
  };

  const displayStatus = isLive ? 'RUNNING' : engineStatus;
  const [cls, text] = statusMap[displayStatus] ?? ['ce-status-offline', 'OFFLINE'];

  if (dot)   { dot.className = `ce-status-dot ${cls}`; }
  if (label) { label.textContent = isLive ? 'LIVE' : text; }
}

/* ═══════════════════════════════════
   UPTIME TICKER
═══════════════════════════════════ */
let _uptimeTick = null;
function startUptimeTick() {
  if (_uptimeTick) clearInterval(_uptimeTick);
  _uptimeTick = setInterval(() => {
    const uptime = Store.get('engine.uptime');
    if (uptime > 0) {
      Store.set('engine.uptime', uptime + 1);
    }
    const broadcastUptime = Store.get('broadcast.uptimeSec');
    const isLive = Store.get('broadcast.state') === 'BROADCASTING';
    if (isLive && broadcastUptime != null) {
      Store.set('broadcast.uptimeSec', broadcastUptime + 1);
    }
  }, 1000);
}

/* ═══════════════════════════════════
   SERVICE WORKER
═══════════════════════════════════ */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Service worker registration failures are non-fatal
    });
  }
}

/* ═══════════════════════════════════
   INIT
═══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  bindSignInForm();
  bindSignOut();
  bindNavigation();
  boot();
});
