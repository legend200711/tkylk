/**
 * 24-HOUR CLOUD ENGINE — Screen: Account
 * cloud-engine-ui/js/screens/ce-screen-account.js
 *
 * User account and role information.
 * Roles (from permissions.js ROLE): OWNER, ADMIN, CREATOR, VIEWER
 * Role enforcement is SERVER-SIDE. Frontend shows hints only.
 */

import * as Store from '../ce-store.js';
import { _escapeHtml, toast } from '../ce-utils.js';
import { signOutUser } from '../ce-firebase-bridge.js';

// Permission descriptions for display
const ROLE_PERMISSIONS = {
  OWNER:   ['All permissions — Full control'],
  ADMIN:   ['Start/stop engine & broadcast','Upload & manage media','Manage destinations','View all logs'],
  CREATOR: ['Upload media','Create & edit playlists','Add to queue','View status'],
  VIEWER:  ['View channel','View status only'],
};

export function renderAccount(container) {
  container.innerHTML = buildAccountHTML();
  refreshAccount(container);
  bindAccountEvents(container);
  const unsub = Store.subscribe('auth', () => refreshAccount(container));
  return () => unsub();
}

function buildAccountHTML() {
  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Account</h1>
  <p class="ce-screen-subtitle">User account and role-based access</p>
</div>

<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Signed In As</div>
    <div style="display:grid;gap:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Email</span>
        <span id="acct-email">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">User ID</span>
        <span class="ce-mono" style="font-size:11px" id="acct-uid">—</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="ce-text-muted">Role</span>
        <span id="acct-role"></span>
      </div>
    </div>
    <div style="margin-top:16px">
      <button class="ce-btn ce-btn-outline" id="acct-signout-btn">Sign Out</button>
    </div>
  </div>
</div>

<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Role-Based Access</div>
    <div class="ce-arch-notice" style="margin-bottom:14px">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2a4 4 0 0 1 4 4v2h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h2V6a4 4 0 0 1 4-4z"/></svg>
      <div>
        <strong>Frontend role restrictions are UI hints only.</strong>
        The Cloud Engine backend enforces authorization server-side via Firebase Security Rules
        and custom claims. Frontend restrictions do NOT replace server-side security.
      </div>
    </div>
    <div style="display:grid;gap:12px" id="acct-role-detail">
      ${Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => `
        <div id="acct-role-${role}" style="padding:12px 14px;background:var(--ce-bg-input);border:1px solid var(--ce-border);border-radius:var(--ce-radius)">
          <div style="font-weight:700;font-size:12px;color:var(--ce-text-heading);margin-bottom:6px">${_escapeHtml(role)}</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;color:var(--ce-text-muted)">
            ${perms.map(p => `<li>${_escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>
  </div>
</div>

<div class="ce-section">
  <div class="ce-card">
    <div class="ce-card-title">Data Isolation</div>
    <div style="font-size:12px;color:var(--ce-text-muted);display:grid;gap:6px">
      <div>Your broadcasts, destinations, credentials, media, playlists, schedules, stations, queues, and recovery state are only accessible to your account.</div>
      <div>Cross-user data access is blocked at the Firestore security rules level (cloud_engine_* collections, Stage 13 hardening).</div>
    </div>
  </div>
</div>
`;
}

function refreshAccount(container) {
  const auth = Store.get('auth');
  const user = auth.user;

  const emailEl = container.querySelector('#acct-email');
  const uidEl   = container.querySelector('#acct-uid');
  const roleEl  = container.querySelector('#acct-role');

  if (emailEl) emailEl.textContent = user?.email  ?? '—';
  if (uidEl)   uidEl.textContent   = user?.uid    ?? '—';
  if (roleEl) {
    const role = auth.role ?? 'VIEWER';
    const roleMap = { OWNER:'live', ADMIN:'ready', CREATOR:'arch', VIEWER:'offline' };
    roleEl.innerHTML = `<span class="ce-badge ce-badge-${roleMap[role] ?? 'offline'}">${_escapeHtml(role)}</span>`;
  }

  // Highlight current role card
  ['OWNER','ADMIN','CREATOR','VIEWER'].forEach(r => {
    const card = container.querySelector(`#acct-role-${r}`);
    if (!card) return;
    const isCurrent = (auth.role ?? 'VIEWER') === r;
    card.style.borderColor = isCurrent ? 'var(--ce-accent)' : 'var(--ce-border)';
    card.style.opacity     = isCurrent ? '1' : '0.6';
  });
}

function bindAccountEvents(container) {
  container.querySelector('#acct-signout-btn')?.addEventListener('click', async () => {
    await signOutUser();
    Store.merge('auth', { status: 'unauthenticated', user: null });
    window.location.reload();
  });
}
