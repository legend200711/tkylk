/**
 * 24-HOUR CLOUD ENGINE — Shadow Reaper → Cloud Engine Integration Boundary
 * cloud-engine/security/integration-boundary.js
 *
 * Defines the CONTROLLED, AUTHORIZED path through which Shadow Reaper
 * may issue commands to the Cloud Engine in the future.
 *
 * STATUS: PREPARED — NOT YET WIRED
 *
 * This module defines the boundary contract only.
 * No direct cross-system database access is created here.
 * The boundary becomes active when:
 *   1. The CE API Worker is deployed
 *   2. CE_SERVICE_TOKENS secret is set
 *   3. Shadow Reaper is explicitly configured to call CE_API_ENDPOINT
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FUTURE INTEGRATION FLOW
 * ═══════════════════════════════════════════════════════════════════════
 *
 * User: "Shadow, start my broadcast."
 *
 *   Shadow Reaper API (/api/v1/engine/command)
 *       ↓  Natural language → structured intent
 *   {
 *     intent: 'START_BROADCAST',
 *     confidence: 0.97,
 *     parameters: { channelId: 'ALTV' }
 *   }
 *       ↓  POST /api/cloud-engine/v1/commands
 *       ↓  Header: Authorization: Bearer <CE_SERVICE_TOKEN>
 *       ↓  Body: { intent, parameters, requestingSystem: 'SHADOW_REAPER', ... }
 *   Cloud Engine Worker: verifyIntegrationToken(token)
 *       ↓  validates token is a CE_SERVICE_TOKEN (not an SR token)
 *   Cloud Engine: checkPermission(userId, 'START_BROADCAST')
 *       ↓  userId comes from CE's own auth context — NOT from SR
 *   Cloud Engine: executes broadcast start
 *       ↓
 *   Response: { success: true, broadcastId: '...', status: 'STARTED' }
 *
 * CRITICAL RULES:
 *   1. Shadow Reaper NEVER gets a Firebase Admin SDK or CE DB credentials
 *   2. Shadow Reaper NEVER reads CE Firestore directly
 *   3. CE NEVER reads SR Firestore directly
 *   4. Commands flow through the CE HTTP API only
 *   5. Authorization is verified by the CE — SR's word is not trusted
 *   6. The userId for authorization comes from the CE auth context,
 *      not from Shadow Reaper's claim
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT SHADOW REAPER IS AND IS NOT ALLOWED TO DO
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ALLOWED (via this boundary, when wired):
 *   - Issue structured commands (START_BROADCAST, STOP_BROADCAST, etc.)
 *   - Read public engine status (is broadcast running?)
 *   - Query available channels/stations (public info only)
 *
 * NOT ALLOWED (ever):
 *   - Read CE stream keys, OAuth tokens, or destination credentials
 *   - Read other users' CE data
 *   - Bypass CE authorization or ownership checks
 *   - Write directly to CE Firestore collections
 *   - Receive raw CE engine state or logs
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { ROLE, PERMISSION }         from './permissions.js';
import { authorize }                 from './authorization.js';
import { SECURITY_ERROR_CODE }       from './security-errors.js';
import { AuditLog }                  from './audit-log.js';

/* ═══════════════════════════════════
   INTEGRATION TOKEN CONSTANTS
═══════════════════════════════════ */

/** The header name Shadow Reaper uses to authenticate to the CE API. */
export const CE_API_AUTH_HEADER = 'X-CE-Service-Token';

/** The env var name that holds the CE service token in the CE Worker. */
export const CE_SERVICE_TOKEN_ENV_VAR = 'CE_SERVICE_TOKENS';

/** Requesting system identifier Shadow Reaper must include in requests. */
export const REQUESTING_SYSTEM = Object.freeze({
  SHADOW_REAPER: 'SHADOW_REAPER',
  WEB_APP:       'WEB_APP',
  MOBILE_APP:    'MOBILE_APP',
  API_CLIENT:    'API_CLIENT',
});

/* ═══════════════════════════════════
   ALLOWED INTEGRATION COMMANDS
   The exhaustive set of commands that
   external systems (SR, apps) may issue
   via the integration boundary.

   Commands NOT in this set are rejected
   before reaching the CE command dispatcher.
═══════════════════════════════════ */
export const INTEGRATION_ALLOWED_COMMANDS = Object.freeze(new Set([
  'START_BROADCAST',
  'STOP_BROADCAST',
  'GET_ENGINE_STATUS',
  'GET_CHANNEL_STATUS',
  'ADD_TO_QUEUE',
  'GET_SCHEDULE',
]));

/* ═══════════════════════════════════
   INTEGRATION COMMAND SCHEMA
   What a valid cross-system command looks like.
═══════════════════════════════════ */

/**
 * @typedef {object} IntegrationCommand
 * @property {string}  requestingSystem   REQUESTING_SYSTEM.*
 * @property {string}  command            One of INTEGRATION_ALLOWED_COMMANDS
 * @property {string}  requestingUserId   The user ID on the requesting system
 *                                        (used for audit; CE verifies its own auth)
 * @property {object}  [parameters]       Command-specific parameters
 * @property {string}  [requestId]        Optional idempotency key
 * @property {string}  timestamp          ISO 8601 timestamp
 */

/* ═══════════════════════════════════
   INTEGRATION TOKEN VERIFIER
   Called by the CE Worker to verify
   that an incoming request from SR
   carries a valid service token.

   STATUS: NOT YET ACTIVE
   This function is a placeholder until
   the CE Worker is deployed and tokens
   are configured.
═══════════════════════════════════ */

/**
 * Verify an integration token from an external system.
 *
 * In production, this checks the token against CE_SERVICE_TOKENS env var,
 * which is a JSON registry of { [tokenHash]: { system, permissions, active } }.
 *
 * Returns NOT_CONFIGURED when CE_SERVICE_TOKENS is not set.
 *
 * @param {string|null} token     The token from X-CE-Service-Token header
 * @param {object}      [env]     Cloudflare Worker env (or process.env)
 * @returns {{ valid: boolean, system?: string, reason: string }}
 */
export function verifyIntegrationToken(token, env) {
  if (!token) {
    return {
      valid:  false,
      reason: 'No integration token provided.',
      code:   SECURITY_ERROR_CODE.NOT_AUTHENTICATED,
    };
  }

  // Resolve token registry from environment
  const envSource  = env ?? (typeof process !== 'undefined' ? process.env : null);
  const rawTokens  = envSource ? (envSource[CE_SERVICE_TOKEN_ENV_VAR] ?? null) : null;

  if (!rawTokens) {
    return {
      valid:  false,
      reason: `Integration token registry (${CE_SERVICE_TOKEN_ENV_VAR}) is not configured. ` +
              'Set this secret via: wrangler secret put CE_SERVICE_TOKENS',
      code:   'NOT_CONFIGURED',
    };
  }

  let tokenRegistry;
  try {
    tokenRegistry = JSON.parse(rawTokens);
  } catch {
    return {
      valid:  false,
      reason: `${CE_SERVICE_TOKEN_ENV_VAR} contains invalid JSON.`,
      code:   SECURITY_ERROR_CODE.PERMISSION_DENIED,
    };
  }

  // Token registry format: { [tokenHash]: { system, active, permissions } }
  // In production use a constant-time comparison / HMAC — this is a placeholder
  const entry = tokenRegistry[token] ?? null;
  if (!entry || !entry.active) {
    AuditLog.record({
      actor:        'integration-boundary',
      action:       'VERIFY_INTEGRATION_TOKEN',
      resourceType: 'INTEGRATION_TOKEN',
      resourceId:   '[REDACTED]',
      result:       'DENIED',
      reason:       'Token not found or inactive in registry.',
    });
    return {
      valid:  false,
      reason: 'Invalid or inactive integration token.',
      code:   SECURITY_ERROR_CODE.PERMISSION_DENIED,
    };
  }

  return {
    valid:  true,
    system: entry.system,
    reason: `Integration token verified for system: ${entry.system}`,
  };
}

/* ═══════════════════════════════════
   INTEGRATION COMMAND VALIDATOR
   Validates an incoming integration command
   before it reaches the CE command dispatcher.
═══════════════════════════════════ */

/**
 * Validate an integration command from an external system.
 *
 * @param {IntegrationCommand} cmd
 * @param {string}             verifiedSystem  System from verifyIntegrationToken()
 * @returns {{ valid: boolean, reason: string }}
 */
export function validateIntegrationCommand(cmd, verifiedSystem) {
  if (!cmd || typeof cmd !== 'object') {
    return { valid: false, reason: 'Command must be an object.' };
  }

  if (!cmd.command || typeof cmd.command !== 'string') {
    return { valid: false, reason: 'command field is required.' };
  }

  if (!INTEGRATION_ALLOWED_COMMANDS.has(cmd.command)) {
    return {
      valid:  false,
      reason: `Command "${cmd.command}" is not permitted via the integration boundary. ` +
              `Allowed commands: ${[...INTEGRATION_ALLOWED_COMMANDS].join(', ')}`,
    };
  }

  if (!cmd.requestingSystem || cmd.requestingSystem !== verifiedSystem) {
    return {
      valid:  false,
      reason: 'requestingSystem field does not match verified token system.',
    };
  }

  if (!cmd.timestamp || typeof cmd.timestamp !== 'string') {
    return { valid: false, reason: 'timestamp field is required.' };
  }

  return { valid: true, reason: 'Command is valid.' };
}

/* ═══════════════════════════════════
   INTEGRATION BOUNDARY STATUS
   Reports whether the boundary is
   configured and active.
═══════════════════════════════════ */

/**
 * Returns the current integration boundary status.
 * Safe to call at any time — no secrets returned.
 *
 * @param {object} [env]  Cloudflare Worker env or process.env
 * @returns {object}
 */
export function getIntegrationBoundaryStatus(env) {
  const envSource = env ?? (typeof process !== 'undefined' ? process.env : null);
  const tokensSet = !!(envSource && envSource[CE_SERVICE_TOKEN_ENV_VAR]);

  return Object.freeze({
    status:         tokensSet ? 'CONFIGURED' : 'NOT_CONFIGURED',
    active:         false,  // NOT yet wired — set to true when SR integration is enabled
    allowedCommands: [...INTEGRATION_ALLOWED_COMMANDS],
    authHeader:     CE_API_AUTH_HEADER,
    tokenEnvVar:    CE_SERVICE_TOKEN_ENV_VAR,
    notConfigured:  tokensSet ? [] : [
      `${CE_SERVICE_TOKEN_ENV_VAR} secret is not set.`,
      'Run: wrangler secret put CE_SERVICE_TOKENS (in the CE Worker context)',
      'Token format: JSON object { [token]: { system, active, permissions } }',
    ],
    securityNotes: [
      'Shadow Reaper NEVER receives CE Firestore credentials.',
      'CE NEVER reads SR Firestore collections.',
      'Authorization is always verified by the CE — SR intent is not trusted.',
      'Cross-system commands are audited via AuditLog.',
    ],
  });
}
