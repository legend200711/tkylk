/**
 * 24-HOUR CLOUD ENGINE — Screen: Platform Connections
 * cloud-engine-ui/js/screens/ce-screen-platforms.js
 *
 * Shows connection status for each platform connector.
 * Maps to: PlatformManager, PLATFORM_TYPE, PLATFORM_CONNECTION_STATUS,
 *          PLATFORM_CAPABILITIES from cloud-engine/platforms/
 *
 * OAuth platforms (YouTube, Twitch, Facebook):
 *   Status: CONNECTED | NOT_CONFIGURED | AUTH_REQUIRED | TOKEN_EXPIRED | ERROR
 *   OAuth flow must be initiated server-side — frontend only shows status.
 *
 * Stream key platforms (Custom RTMP/RTMPS):
 *   Configured via Destinations screen.
 */

import * as Store from '../ce-store.js';
import { badge, platformStatusBadge, _escapeHtml } from '../ce-utils.js';

// Platform capabilities (mirrors platform-status.js PLATFORM_CAPABILITIES)
const PLATFORMS = [
  {
    id:      'YOUTUBE',
    name:    'YouTube',
    type:    'YOUTUBE',
    logoClass: 'ce-platform-logo-youtube',
    logoChar: 'YT',
    authScheme: 'OAUTH2',
    description: 'Stream to YouTube Live via OAuth 2.0.',
    capabilities: ['configure','validate','connect','disconnect','refreshAuthentication','getStatus','testConnection','revoke','oauth'],
    configNote: 'YouTube uses OAuth 2.0. Authorization must be completed server-side. Stream key injection is not used.',
  },
  {
    id:      'TWITCH',
    name:    'Twitch',
    type:    'TWITCH',
    logoClass: 'ce-platform-logo-twitch',
    logoChar: 'TW',
    authScheme: 'OAUTH2',
    description: 'Stream to Twitch via OAuth 2.0.',
    capabilities: ['configure','validate','connect','disconnect','refreshAuthentication','getStatus','testConnection','revoke','oauth'],
    configNote: 'Twitch uses OAuth 2.0. Authorization is handled server-side.',
  },
  {
    id:      'FACEBOOK',
    name:    'Facebook',
    type:    'FACEBOOK',
    logoClass: 'ce-platform-logo-facebook',
    logoChar: 'FB',
    authScheme: 'OAUTH2',
    description: 'Stream to Facebook Live via OAuth 2.0.',
    capabilities: ['configure','validate','connect','disconnect','refreshAuthentication','getStatus','testConnection','revoke','oauth'],
    configNote: 'Facebook uses OAuth 2.0. Authorization is handled server-side.',
  },
  {
    id:      'CUSTOM_RTMP',
    name:    'Custom RTMP',
    type:    'CUSTOM_RTMP',
    logoClass: 'ce-platform-logo-rtmp',
    logoChar: 'RT',
    authScheme: 'STREAM_KEY',
    description: 'Any RTMP-compatible streaming platform.',
    capabilities: ['configure','validate','connect','disconnect','getStatus','testConnection'],
    configNote: 'Configured via Destinations. Stream key stored as server-side environment variable.',
  },
  {
    id:      'CUSTOM_RTMPS',
    name:    'Custom RTMPS',
    type:    'CUSTOM_RTMPS',
    logoClass: 'ce-platform-logo-rtmp',
    logoChar: 'RS',
    authScheme: 'STREAM_KEY',
    description: 'Any RTMPS-compatible streaming platform (TLS).',
    capabilities: ['configure','validate','connect','disconnect','getStatus','testConnection'],
    configNote: 'Configured via Destinations (recommended — TLS). Stream key stored as server-side environment variable.',
  },
];

export function renderPlatforms(container) {
  container.innerHTML = buildPlatformsHTML();
  refreshPlatforms(container);

  const unsub = Store.subscribe('platforms', () => refreshPlatforms(container));
  return () => unsub();
}

function buildPlatformsHTML() {
  const cardsHTML = PLATFORMS.map(p => `
    <div class="ce-platform-card" id="plat-card-${p.id}">
      <div class="ce-platform-header">
        <div class="ce-platform-logo ${p.logoClass}">${_escapeHtml(p.logoChar)}</div>
        <div>
          <div class="ce-platform-name">${_escapeHtml(p.name)}</div>
          <div style="font-size:11px;color:var(--ce-text-muted)">${_escapeHtml(p.authScheme === 'OAUTH2' ? 'OAuth 2.0' : 'Stream Key')}</div>
        </div>
        <div style="margin-left:auto" id="plat-badge-${p.id}"></div>
      </div>

      <p style="font-size:12px;color:var(--ce-text-muted)">${_escapeHtml(p.description)}</p>

      <div class="ce-platform-capabilities">
        ${p.capabilities.map(c => `<span class="ce-capability-tag">${_escapeHtml(c)}</span>`).join('')}
      </div>

      <div id="plat-detail-${p.id}" style="font-size:11px;color:var(--ce-text-muted);background:var(--ce-bg-input);border:1px solid var(--ce-border);border-radius:var(--ce-radius-sm);padding:8px 10px;line-height:1.5">
        ${_escapeHtml(p.configNote)}
      </div>

      ${p.authScheme === 'OAUTH2' ? `
        <div style="font-size:11px;color:var(--ce-text-muted);padding:8px 10px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:var(--ce-radius-sm)">
          OAuth authorization is initiated <strong>server-side</strong>.
          To connect, run the OAuth flow on your Cloud Engine server instance.
          The frontend cannot complete OAuth — this is intentional for security.
        </div>
      ` : `
        <button class="ce-btn ce-btn-outline ce-btn-sm" onclick="location.hash='#destinations'">
          Configure via Destinations →
        </button>
      `}
    </div>
  `).join('');

  return `
<div class="ce-screen-header">
  <h1 class="ce-screen-title">Platform Connections</h1>
  <p class="ce-screen-subtitle">Status of streaming platform connectors</p>
</div>

<div class="ce-section">
  <div class="ce-arch-notice">
    <svg viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 7v4m0-6v.5" stroke-linecap="round"/></svg>
    <div>
      Platform connection status is read from the Cloud Engine runtime.
      <strong>OAuth authorization cannot be completed from the browser frontend</strong> —
      it must be completed on the server hosting the Cloud Engine.
      Platform integrations show real status from the engine when connected.
    </div>
  </div>
</div>

<div class="ce-section">
  <div class="ce-section-title">Platform Connectors</div>
  <div class="ce-grid-auto">${cardsHTML}</div>
</div>
`;
}

function refreshPlatforms(container) {
  const platforms = Store.get('platforms');

  PLATFORMS.forEach(p => {
    const badgeEl = container.querySelector(`#plat-badge-${p.id}`);
    if (!badgeEl) return;

    let status = 'NOT_CONFIGURED';
    if (platforms) {
      const key = p.type.toLowerCase().replace('_', '');
      const pData = platforms[key] ?? platforms[p.id] ?? platforms[p.type];
      if (pData) status = pData.status ?? 'NOT_CONFIGURED';
    }
    badgeEl.innerHTML = platformStatusBadge(status);
  });
}
