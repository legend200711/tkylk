/**
 * 24-HOUR CLOUD ENGINE — Screen: Settings
 * cloud-engine-ui/js/screens/ce-screen-settings.js
 */

import * as Store from '../ce-store.js';
import { _escapeHtml, toast } from '../ce-utils.js';
import { getBridgeStatus } from '../ce-firebase-bridge.js';

export function renderSettings(container) {
  container.innerHTML = buildSettingsHTML();
  refreshSettings(container);
  bindSettingsEvents(container);
  const unsub = Store.subscribe('firebase', () => refreshSettings(container));
  return () => unsub();
}

function buildSettingsHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Settings</h1>
  <p class="ce-screen-subtitle">Cloud Engine configuration and connection settings</p>
</div>

<!-- Firebase Connection -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Firebase Connection</div>
    <div style="display:grid;gap:10px;font-size:13px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Project</span>
        <span class="ce-mono" style="font-size:11px">remix-studio-4bf8a (AURENIX)</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Status</span>
        <span id="settings-fb-status"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Shadow Reaper Project</span>
        <span class="ce-mono" style="font-size:11px">ffr3r3223 (ISOLATED — do not use here)</span>
      </div>
    </div>
    <div class="ce-arch-notice">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3a7 7 0 1 0 6 6" stroke-linecap="round"/><path d="M13 1v5h5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div>
        The Cloud Engine uses Firebase project <strong>remix-studio-4bf8a</strong>.
        Shadow Reaper uses <strong>ffr3r3223</strong>.
        These projects are permanently isolated. Do not swap them.
      </div>
    </div>
  </div>
</div>

<!-- Engine API Config -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Cloud Engine Runtime</div>
    <div style="display:grid;gap:12px">
      <div class="ce-arch-notice">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 7v4m0 2v.5" stroke-linecap="round"/></svg>
        <div>
          The Cloud Engine backend runs as a persistent Node.js process with FFmpeg.
          It cannot run on GitHub Pages or in the browser. A persistent server host is required:
          VPS, dedicated server, cloud VM, or a container runtime.
          <strong>The frontend communicates with the engine via Firebase control commands.</strong>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
        <span class="ce-text-muted">Persistent Runtime</span>
        <span id="settings-runtime-status"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
        <span class="ce-text-muted">Engine Version</span>
        <span id="settings-engine-ver" class="ce-mono" style="font-size:11px">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
        <span class="ce-text-muted">Engine Stage</span>
        <span class="ce-mono" style="font-size:11px">Stage 13</span>
      </div>
    </div>
  </div>
</div>

<!-- Cloudflare Workers -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Cloudflare Workers</div>
    <div style="font-size:13px;color:var(--ce-text-muted);margin-bottom:12px">
      The architecture defines a <code style="font-family:var(--ce-font-mono);font-size:11px;background:var(--ce-bg-input);padding:2px 5px;border-radius:3px">ce-api</code> Cloudflare Worker
      for the Cloud Engine API boundary. Separate from the Shadow Reaper <code style="font-family:var(--ce-font-mono);font-size:11px;background:var(--ce-bg-input);padding:2px 5px;border-radius:3px">sr-standalone-api</code> Worker.
    </div>
    <div style="display:grid;gap:8px;font-size:13px">
      <div style="display:flex;justify-content:space-between">
        <span class="ce-text-muted">ce-api Worker</span>
        <span class="ce-badge ce-badge-not-configured">NOT CONFIGURED</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span class="ce-text-muted">sr-standalone-api Worker</span>
        <span class="ce-badge ce-badge-arch">SEPARATE — NOT CE</span>
      </div>
    </div>
  </div>
</div>

<!-- PWA -->
<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">PWA / App Install</div>
    <p style="font-size:12px;color:var(--ce-text-muted);margin-bottom:12px">
      The Cloud Engine frontend is installable as a Progressive Web App.
      Offline support shows a shell with "ENGINE OFFLINE" status — it does NOT allow broadcasting offline.
    </p>
    <button class="ce-btn ce-btn-outline" id="settings-install-btn" style="display:none">Install App</button>
    <div id="settings-install-note" style="font-size:11px;color:var(--ce-text-muted)">
      PWA install prompt will appear here when available (Chrome, Edge, Safari 16.4+).
    </div>
  </div>
</div>
`;
}

let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  const btn = document.getElementById('settings-install-btn');
  if (btn) btn.style.display = '';
});

function refreshSettings(container) {
  const firebase = Store.get('firebase');
  const engine   = Store.get('engine');

  const fbBadgeEl = container.querySelector('#settings-fb-status');
  if (fbBadgeEl) {
    const fbMap = {
      'CONNECTED':      ['CONNECTED',      'live'],
      'NOT_CONFIGURED': ['NOT CONFIGURED', 'not-configured'],
      'ERROR':          ['ERROR',          'error'],
      'INITIALIZING':   ['CONNECTING',     'warn'],
      'OFFLINE':        ['OFFLINE',        'offline'],
    };
    const [fl, fc] = fbMap[firebase.status] ?? ['UNKNOWN', 'offline'];
    fbBadgeEl.innerHTML = `<span class="ce-badge ce-badge-${fc}">${fl}</span>`;
  }

  const runtimeEl = container.querySelector('#settings-runtime-status');
  if (runtimeEl) {
    const isOnline = engine.status !== 'OFFLINE' && engine.status !== 'UNKNOWN';
    runtimeEl.innerHTML = isOnline
      ? `<span class="ce-badge ce-badge-live">ONLINE</span>`
      : `<span class="ce-badge ce-badge-offline">OFFLINE — Start Cloud Engine server</span>`;
  }

  const verEl = container.querySelector('#settings-engine-ver');
  if (verEl) verEl.textContent = engine.version?.version ? `v${engine.version.version}` : '—';
}

function bindSettingsEvents(container) {
  container.querySelector('#settings-install-btn')?.addEventListener('click', async () => {
    if (_deferredInstallPrompt) {
      _deferredInstallPrompt.prompt();
      const result = await _deferredInstallPrompt.userChoice;
      if (result.outcome === 'accepted') toast('App installed.', 'success');
      _deferredInstallPrompt = null;
    }
  });
}
