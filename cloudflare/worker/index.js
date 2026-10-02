/**
 * 24-HOUR CLOUD ENGINE — Cloudflare Worker (API v1)
 * cloud-engine/cloudflare/worker/index.js
 *
 * STATUS: SKELETON — NOT YET DEPLOYED
 *
 * This Worker is the Cloud Engine API gateway.
 * It handles all /api/cloud-engine/* requests.
 *
 * SHARED INFRASTRUCTURE:
 *   Deployed to the SAME Cloudflare account as the Shadow Reaper Worker
 *   (sr-standalone-api), but with completely separate:
 *     - Route prefix:  /api/cloud-engine/*  (SR uses /api/v1/*)
 *     - Secrets:       CE_* prefix only     (SR uses SR_* prefix)
 *     - KV bindings:   CE_ENGINE_STATE      (SR uses SR_SHARED_KNOWLEDGE)
 *     - Worker name:   ce-api               (SR uses sr-standalone-api)
 *
 * WHAT THIS WORKER DOES:
 *   - Authenticates requests via CE_SERVICE_TOKENS
 *   - Routes /api/cloud-engine/v1/* to CE command handlers
 *   - Verifies Firebase ID tokens server-side before any sensitive command
 *   - Accepts structured commands from authorized systems (Web App, Mobile, Shadow Reaper)
 *   - Enforces CE authorization + ownership checks
 *
 * WHAT THIS WORKER NEVER DOES:
 *   - Access the Shadow Reaper Firebase project (ffr3r3223)
 *   - Read SR user conversations, memory, or private context
 *   - Execute FFmpeg or run persistent broadcast processes
 *     (those live on the persistent streaming runtime, separate from this control plane)
 *   - Share secrets with the Shadow Reaper Worker
 *   - Return stream keys or OAuth tokens to any client
 *
 * DEPLOYMENT REQUIREMENTS:
 *   See cloudflare/wrangler.toml for full setup instructions.
 *
 * SHADOW REAPER → CLOUD ENGINE INTEGRATION:
 *   When wired, Shadow Reaper sends structured commands to this Worker via:
 *     POST /api/cloud-engine/v1/commands
 *     Header: X-CE-Service-Token: <CE_SERVICE_TOKEN>
 *   Authorization is verified here — SR's claimed userId is NOT trusted directly.
 *   See security/integration-boundary.js for the full boundary contract.
 */

'use strict';

import { verifyIntegrationToken, validateIntegrationCommand, CE_API_AUTH_HEADER }
  from '../../security/integration-boundary.js';

const ROUTE_PREFIX = '/api/cloud-engine';

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const origin = env.CE_ALLOWED_ORIGIN || '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': `Content-Type, Authorization, ${CE_API_AUTH_HEADER}`,
      'Access-Control-Max-Age':       '86400',
    };

    // ── Preflight ──────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Route: /api/cloud-engine/v1/health ────────────────────────────────
    if (url.pathname === `${ROUTE_PREFIX}/v1/health`) {
      return new Response(JSON.stringify({
        ok:      true,
        service: 'cloud-engine-api',
        status:  'SKELETON_NOT_DEPLOYED',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Route: /api/cloud-engine/v1/commands ─────────────────────────────
    if (url.pathname === `${ROUTE_PREFIX}/v1/commands` && request.method === 'POST') {
      // Verify integration token
      const token = request.headers.get(CE_API_AUTH_HEADER);
      const tokenResult = verifyIntegrationToken(token, env);
      if (!tokenResult.valid) {
        return new Response(JSON.stringify({
          ok:    false,
          error: { code: 'UNAUTHORIZED', message: tokenResult.reason },
        }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({
          ok:    false,
          error: { code: 'INVALID_REQUEST', message: 'Malformed JSON.' },
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const cmdResult = validateIntegrationCommand(body, tokenResult.system);
      if (!cmdResult.valid) {
        return new Response(JSON.stringify({
          ok:    false,
          error: { code: 'INVALID_COMMAND', message: cmdResult.reason },
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // TODO (Stage 14+): dispatch validated command to CE command processor
      // For now, acknowledge receipt of the validated command.
      return new Response(JSON.stringify({
        ok:      true,
        status:  'ACCEPTED',
        command: body.command,
        note:    'Command accepted by integration boundary. Dispatcher not yet wired.',
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 404 ───────────────────────────────────────────────────────────────
    return new Response(JSON.stringify({
      ok:    false,
      error: { code: 'NOT_FOUND', message: `No route: ${url.pathname}` },
    }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  },
};
