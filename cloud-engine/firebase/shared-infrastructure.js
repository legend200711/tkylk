/**
 * 24-HOUR CLOUD ENGINE — Shared Infrastructure Declaration
 * cloud-engine/firebase/shared-infrastructure.js
 *
 * Documents and enforces the SHARED INFRASTRUCTURE / ISOLATED SYSTEMS model
 * between the 24-Hour Cloud Engine and Shadow Reaper.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE TOPOLOGY
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TWO SYSTEMS — ONE CLOUDFLARE ACCOUNT — TWO FIREBASE PROJECTS
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  SHARED: Cloudflare Account                                        │
 * │  ├── Worker: sr-standalone-api   → routes: /api/v1/*              │
 * │  └── Worker: ce-api              → routes: /api/cloud-engine/*    │
 * │       Separate bindings, secrets, KV namespaces per Worker.        │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────┐   ┌──────────────────────────────┐
 * │  Firebase: remix-studio-4bf8a│   │  Firebase: ffr3r3223         │
 * │  (AURENIX / Cloud Engine)    │   │  (Shadow Reaper ONLY)        │
 * │                              │   │                              │
 * │  cloud_engine_state          │   │  users/{uid}/                │
 * │  cloud_engine_commands       │   │    shadowReaperConversations │
 * │  cloud_engine_permissions    │   │    shadowReaperMemory        │
 * │  cloud_engine_recovery       │   │    shadowReaperLearnedContext│
 * │  cloud_stream_playlist       │   │    shadowReaperPreferences   │
 * │  cloud_stream_sessions       │   │  sharedKnowledge             │
 * │  cloud_stream_schedules      │   │  globalLearning              │
 * │  cloud_stream_logs           │   │  shadowReaperConfig          │
 * │  cloud_stream_destinations   │   │  webResearchCache            │
 * │  cloud_stream_youtube_tokens │   │                              │
 * │  network_media               │   │  Auth: ffr3r3223 UIDs        │
 * │  network_state               │   └──────────────────────────────┘
 * │  network_channels            │
 * │  (+ all existing AURENIX     │   THESE PROJECTS ARE INTENTIONALLY
 * │   tv/ collections)           │   SEPARATE. DO NOT MERGE THEM.
 * └──────────────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY TWO FIREBASE PROJECTS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Shadow Reaper was designed with a dedicated Firebase project (ffr3r3223)
 * before the Cloud Engine was built. Merging the projects would:
 *
 *   1. Risk exposing SR private AI memory to CE Firestore rules
 *   2. Risk exposing CE stream keys/OAuth tokens to SR rules
 *   3. Require migrating all SR user data (disruptive, risky)
 *   4. Conflate SR "Founder" role with CE "OWNER/ADMIN" roles
 *   5. Provide no technical benefit — isolation is the goal
 *
 * The correct model is: TWO PROJECTS, ONE CLOUDFLARE ACCOUNT.
 * Firebase Authentication is NOT shared at the project level —
 * each project has its own UID space and auth domain.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * AUTHENTICATION NOTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Because the Firebase projects are separate, a user can hold accounts
 * in BOTH systems using the same email address, but the Firebase UIDs
 * will be different (each project assigns its own UIDs).
 *
 * Future cross-system authentication (e.g. SSO) must be handled at the
 * application layer through the controlled integration boundary, NOT
 * by merging Firebase projects.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FUTURE SHADOW REAPER → CLOUD ENGINE INTEGRATION
 * ═══════════════════════════════════════════════════════════════════════
 *
 * When a user says "Shadow, start my broadcast" to Shadow Reaper:
 *
 *   Shadow Reaper: interprets intent → structured command JSON
 *       ↓  POST /api/cloud-engine/v1/commands
 *       ↓  Authorization: Bearer <CE_SERVICE_TOKEN>
 *   Cloud Engine Worker: verifies token + Firebase ID token
 *       ↓  CE permission check (userId → CE role)
 *   Cloud Engine: executes command
 *
 * This boundary is prepared in security/integration-boundary.js.
 * It is NOT wired yet. No direct database cross-access is created.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONFIGURATION REQUIRED BEFORE DEPLOYMENT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Cloudflare (Cloud Engine Worker):
 *   wrangler secret put CE_SERVICE_TOKENS
 *   wrangler secret put CE_ALLOWED_ORIGIN
 *   wrangler secret put CE_FIREBASE_SERVICE_ACCOUNT
 *   wrangler kv:namespace create CE_ENGINE_STATE
 *   (update wrangler.toml with real account_id and name)
 *
 * Firebase (remix-studio-4bf8a):
 *   Deploy updated tv/firestore.rules with cloud_engine_* rules
 *   Generate a service account key for the CE Worker (server-side only)
 *   Store as CE_FIREBASE_SERVICE_ACCOUNT Cloudflare secret
 *
 * NOT_CONFIGURED until the above steps are completed.
 */

/* ═══════════════════════════════════
   FIREBASE PROJECT REGISTRY
   Single source of truth for project IDs.
   NEVER inline project ID strings — import from here.
═══════════════════════════════════ */
export const FIREBASE_PROJECTS = Object.freeze({

  /**
   * AURENIX / Cloud Engine Firebase project.
   * Used by: tv/, cloud-engine/
   * Firestore rules: tv/firestore.rules
   * Collections: cloud_engine_*, cloud_stream_*, network_*, etc.
   */
  CLOUD_ENGINE: 'remix-studio-4bf8a',

  /**
   * Shadow Reaper dedicated Firebase project.
   * Used by: shadow-reaper-v2/
   * Firestore rules: shadow-reaper-v2/firebase/firestore.rules
   *
   * ⚠️  This project is INTENTIONALLY SEPARATE from the Cloud Engine.
   *     Do NOT merge these projects.
   *     Cloud Engine code MUST NOT access this project's Firestore.
   */
  SHADOW_REAPER: 'ffr3r3223',
});

/* ═══════════════════════════════════
   CLOUDFLARE WORKER REGISTRY
   Canonical Worker names and route prefixes.
   Both Workers deploy to the same Cloudflare account.
═══════════════════════════════════ */
export const CLOUDFLARE_WORKERS = Object.freeze({

  /**
   * Shadow Reaper API Worker.
   * Route prefix: /api/v1/*
   * Secrets: SR_SERVICE_TOKENS, SR_ALLOWED_ORIGIN, SR_INTERNAL_API_KEY
   * KV bindings: SR_SHARED_KNOWLEDGE
   *
   * ⚠️  DO NOT modify SR routes, secrets, or bindings for Cloud Engine purposes.
   *     DO NOT add Cloud Engine bindings to the Shadow Reaper Worker.
   */
  SHADOW_REAPER: Object.freeze({
    name:        'sr-standalone-api',   // placeholder — configured in shadow-reaper-v2/cloudflare/wrangler.toml
    routePrefix: '/api/v1',
    secrets:     ['SR_SERVICE_TOKENS', 'SR_ALLOWED_ORIGIN', 'SR_INTERNAL_API_KEY'],
    kvBindings:  ['SR_SHARED_KNOWLEDGE'],
  }),

  /**
   * Cloud Engine API Worker.
   * Route prefix: /api/cloud-engine/*
   * Secrets: CE_SERVICE_TOKENS, CE_ALLOWED_ORIGIN, CE_FIREBASE_SERVICE_ACCOUNT
   * KV bindings: CE_ENGINE_STATE
   *
   * Completely separate from the Shadow Reaper Worker.
   * No shared environment variables or bindings.
   */
  CLOUD_ENGINE: Object.freeze({
    name:        'ce-api',              // configured in cloud-engine/cloudflare/wrangler.toml
    routePrefix: '/api/cloud-engine',
    secrets:     ['CE_SERVICE_TOKENS', 'CE_ALLOWED_ORIGIN', 'CE_FIREBASE_SERVICE_ACCOUNT',
                  'YOUTUBE_STREAM_KEY'],
    kvBindings:  ['CE_ENGINE_STATE'],
  }),
});

/* ═══════════════════════════════════
   SHADOW REAPER PROTECTED COLLECTIONS
   (ffr3r3223 Firestore — SEPARATE PROJECT)

   Listed here so Cloud Engine code can
   explicitly VERIFY it is NOT accessing
   these paths.

   In practice, the project isolation
   (different Firebase project) means CE
   code using remix-studio-4bf8a will never
   see these collections. This list is a
   documentation and audit reference.
═══════════════════════════════════ */
export const SR_PROTECTED_PATHS = Object.freeze({
  USER_CONVERSATIONS:   'users/{uid}/shadowReaperConversations',
  USER_MEMORY:          'users/{uid}/shadowReaperMemory',
  USER_LEARNED_CONTEXT: 'users/{uid}/shadowReaperLearnedContext',
  USER_PREFERENCES:     'users/{uid}/shadowReaperPreferences',
  USER_PRIVATE_ANY:     'users/{uid}/*',   // catch-all
  SHARED_KNOWLEDGE:     'sharedKnowledge',
  GLOBAL_LEARNING:      'globalLearning',
  CONFIG:               'shadowReaperConfig',
  WEB_RESEARCH_CACHE:   'webResearchCache',
});

/* ═══════════════════════════════════
   CLOUD ENGINE PROTECTED COLLECTIONS
   (remix-studio-4bf8a Firestore)

   Shadow Reaper MUST NOT directly access
   these collections. The integration
   boundary (security/integration-boundary.js)
   is the only authorized cross-system path.
═══════════════════════════════════ */
export const CE_PROTECTED_PATHS = Object.freeze({
  // Inline the collection names to avoid circular imports with firebase-connector.js
  DESTINATIONS:   'cloud_stream_destinations',   // stream keys (admin + server-side only)
  YOUTUBE_TOKENS: 'cloud_stream_youtube_tokens', // OAuth tokens (admin + server-side only)
  COMMANDS:       'cloud_engine_commands',       // only CE Worker writes commands here
  ENGINE_STATE:   'cloud_engine_state',          // internal engine state
  PERMISSIONS:    'cloud_engine_permissions',    // per-user CE role assignments
});

/* ═══════════════════════════════════
   ISOLATION ASSERTION
   Call during FirebaseConnector.initialize()
   to verify the CE is using the correct project.
═══════════════════════════════════ */

/**
 * Assert that the Cloud Engine is connected to the correct Firebase project.
 * Logs a critical error if the Shadow Reaper project is accidentally used.
 *
 * @param {string|null} actualProjectId  The projectId from the initialized db instance
 * @returns {{ safe: boolean, reason: string }}
 */
export function assertCloudEngineFirebaseProject(actualProjectId) {
  if (!actualProjectId) {
    return { safe: true, reason: 'Project ID not available — running in NOT_CONFIGURED mode.' };
  }

  if (actualProjectId === FIREBASE_PROJECTS.SHADOW_REAPER) {
    const reason =
      'CRITICAL ISOLATION VIOLATION: Cloud Engine is initialized with the Shadow Reaper ' +
      `Firebase project (${FIREBASE_PROJECTS.SHADOW_REAPER}). This must not happen — ` +
      `use the Cloud Engine project (${FIREBASE_PROJECTS.CLOUD_ENGINE}) instead.`;
    console.error(`[shared-infrastructure] ${reason}`);
    return { safe: false, reason };
  }

  if (actualProjectId !== FIREBASE_PROJECTS.CLOUD_ENGINE) {
    const reason =
      `WARNING: Cloud Engine is using an unexpected Firebase project: "${actualProjectId}". ` +
      `Expected: "${FIREBASE_PROJECTS.CLOUD_ENGINE}". Verify configuration.`;
    console.warn(`[shared-infrastructure] ${reason}`);
    return { safe: false, reason };
  }

  return { safe: true, reason: `Firebase project verified: ${FIREBASE_PROJECTS.CLOUD_ENGINE}` };
}

/* ═══════════════════════════════════
   INTEGRATION STATUS
   Reports the current shared-infra
   configuration state.
═══════════════════════════════════ */

/**
 * Returns the shared infrastructure configuration status.
 * Safe to call at any time — no credentials returned.
 *
 * @returns {object}
 */
export function getSharedInfrastructureStatus() {
  return Object.freeze({
    cloudflareAccount: {
      shared:         true,
      shadowReaperWorker: CLOUDFLARE_WORKERS.SHADOW_REAPER.name,
      cloudEngineWorker:  CLOUDFLARE_WORKERS.CLOUD_ENGINE.name,
      routeSeparation: {
        shadowReaper: CLOUDFLARE_WORKERS.SHADOW_REAPER.routePrefix + '/*',
        cloudEngine:  CLOUDFLARE_WORKERS.CLOUD_ENGINE.routePrefix + '/*',
      },
    },
    firebase: {
      cloudEngineProject:  FIREBASE_PROJECTS.CLOUD_ENGINE,
      shadowReaperProject: FIREBASE_PROJECTS.SHADOW_REAPER,
      projectsAreSeparate: true,
      authShared:          false,  // separate Firebase projects = separate auth domains
      dataIsolated:        true,   // separate projects enforce isolation at the platform level
    },
    integrationBoundary: {
      status:      'PREPARED_NOT_WIRED',
      description: 'SR→CE integration boundary exists (security/integration-boundary.js) ' +
                   'but is not yet active. No cross-system database access exists.',
    },
    notConfigured: [
      'CE Cloudflare Worker (ce-api) — needs account_id + wrangler deploy',
      'CE_SERVICE_TOKENS secret — wrangler secret put CE_SERVICE_TOKENS',
      'CE_ALLOWED_ORIGIN secret — wrangler secret put CE_ALLOWED_ORIGIN',
      'CE_FIREBASE_SERVICE_ACCOUNT secret — wrangler secret put CE_FIREBASE_SERVICE_ACCOUNT',
      'CE_ENGINE_STATE KV namespace — wrangler kv:namespace create CE_ENGINE_STATE',
    ],
  });
}
