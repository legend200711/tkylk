/**
 * 24-HOUR CLOUD ENGINE — Platform Status Constants
 * cloud-engine/platforms/platform-status.js
 *
 * Status values reported by platform connectors to Studio/API consumers.
 * These are safe to return to the browser — they contain NO credentials.
 *
 * Stage 8 — Platform Connections
 */

/* ═══════════════════════════════════
   PLATFORM TYPES
═══════════════════════════════════ */
export const PLATFORM_TYPE = Object.freeze({
  YOUTUBE:      'YOUTUBE',
  TWITCH:       'TWITCH',
  FACEBOOK:     'FACEBOOK',
  CUSTOM_RTMP:  'CUSTOM_RTMP',
  CUSTOM_RTMPS: 'CUSTOM_RTMPS',
  OTHER:        'OTHER',
});

/* ═══════════════════════════════════
   AUTH SCHEMES
═══════════════════════════════════ */
export const PLATFORM_AUTH_SCHEME = Object.freeze({
  OAUTH2:    'OAUTH2',       // OAuth 2.0 (YouTube, Facebook, Twitch)
  STREAM_KEY: 'STREAM_KEY',  // Direct stream key (Custom RTMP/RTMPS)
  NONE:      'NONE',         // No auth required
});

/* ═══════════════════════════════════
   CONNECTION STATUS
   Safe values returned to Studio/API — no secrets.
═══════════════════════════════════ */
export const PLATFORM_CONNECTION_STATUS = Object.freeze({
  CONNECTED:      'CONNECTED',
  DISCONNECTED:   'DISCONNECTED',
  AUTH_REQUIRED:  'AUTH_REQUIRED',
  TOKEN_EXPIRED:  'TOKEN_EXPIRED',
  ERROR:          'ERROR',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONNECTING:     'CONNECTING',
  TESTING:        'TESTING',
});

/* ═══════════════════════════════════
   CAPABILITIES MAP
   Describes what each platform connector genuinely supports.
═══════════════════════════════════ */
export const PLATFORM_CAPABILITIES = Object.freeze({
  [PLATFORM_TYPE.YOUTUBE]: Object.freeze({
    configure:              true,
    validate:               true,
    connect:                true,
    disconnect:             true,
    refreshAuthentication:  true,   // OAuth token refresh
    getStatus:              true,
    getDestination:         true,
    testConnection:         true,
    revoke:                 true,   // OAuth revoke
    oauth:                  true,
    streamKey:              false,  // YouTube uses OAuth, not raw stream key in env
  }),
  [PLATFORM_TYPE.TWITCH]: Object.freeze({
    configure:              true,
    validate:               true,
    connect:                true,
    disconnect:             true,
    refreshAuthentication:  true,   // OAuth token refresh
    getStatus:              true,
    getDestination:         true,
    testConnection:         true,
    revoke:                 true,
    oauth:                  true,
    streamKey:              false,
  }),
  [PLATFORM_TYPE.FACEBOOK]: Object.freeze({
    configure:              true,
    validate:               true,
    connect:                true,
    disconnect:             true,
    refreshAuthentication:  true,
    getStatus:              true,
    getDestination:         true,
    testConnection:         true,
    revoke:                 true,
    oauth:                  true,
    streamKey:              false,
  }),
  [PLATFORM_TYPE.CUSTOM_RTMP]: Object.freeze({
    configure:              true,
    validate:               true,
    connect:                true,
    disconnect:             true,
    refreshAuthentication:  false,  // No OAuth — stream key based
    getStatus:              true,
    getDestination:         true,
    testConnection:         true,
    revoke:                 false,  // No token to revoke
    oauth:                  false,
    streamKey:              true,
  }),
  [PLATFORM_TYPE.CUSTOM_RTMPS]: Object.freeze({
    configure:              true,
    validate:               true,
    connect:                true,
    disconnect:             true,
    refreshAuthentication:  false,
    getStatus:              true,
    getDestination:         true,
    testConnection:         true,
    revoke:                 false,
    oauth:                  false,
    streamKey:              true,
  }),
});

/**
 * Build a safe status snapshot for consumption by Studio/API.
 * NEVER includes stream keys, tokens, or OAuth credentials.
 *
 * @param {string} platformType  PLATFORM_TYPE.*
 * @param {string} connStatus    PLATFORM_CONNECTION_STATUS.*
 * @param {object} [extra]       Safe additional fields
 * @returns {object}
 */
export function buildSafePlatformStatus(platformType, connStatus, extra = {}) {
  return {
    platformType,
    status: connStatus,
    capabilities: PLATFORM_CAPABILITIES[platformType] ?? null,
    updatedAt: new Date().toISOString(),
    ...extra,
    // Explicitly strip any secret fields that might be passed accidentally
    streamKey:    undefined,
    token:        undefined,
    accessToken:  undefined,
    refreshToken: undefined,
    apiKey:       undefined,
    clientSecret: undefined,
    publishUrl:   undefined,
  };
}
