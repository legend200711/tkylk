# 24-HOUR CLOUD ENGINE — Architecture & Documentation
# cloud-engine/ARCHITECTURE.md
#
# 24-Hour Cloud Engine  |  Stage 3  |  Engine Version 0.3.0
# Build: stage3-2025-10-01

---

## Overview

The **24-Hour Cloud Engine** is a modular, server-side broadcast system that
powers continuous 24/7 television-style streaming within the AURENIX project.

It lives in the `cloud-engine/` directory and integrates with the existing
AURENIX `tv/` project's Firebase infrastructure without replacing it.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    24-HOUR CLOUD ENGINE                              │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   CORE (cloud-engine/core/)                   │   │
│  │                                                               │   │
│  │   engine.js          ← Lifecycle (INITIALIZING → READY…)     │   │
│  │   event-bus.js       ← Internal pub/sub event system         │   │
│  │   events.js          ← Event name catalogue                  │   │
│  │   state-manager.js   ← Central runtime state tree            │   │
│  │   commands.js        ← Command dispatcher                    │   │
│  │   health.js          ← Component health reporter             │   │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │ imports                          │
│         ┌────────────────────────┼──────────────────────────┐      │
│         ▼                        ▼                           ▼      │
│  ┌─────────────┐   ┌─────────────────────┐   ┌──────────────────┐  │
│  │  ENCODER    │   │   BROADCAST ENGINE  │   │  FIREBASE        │  │
│  │  (Stage 2)  │   │   (Stage 3)         │   │  CONNECTOR       │  │
│  │  shadow-    │   │   broadcast-        │   │  (Stage 1 ready) │  │
│  │  encoder.js │   │   engine.js         │   │  firebase-       │  │
│  │             │   │   RTMP/RTMPS        │   │  connector.js    │  │
│  │  FUNCTIONAL │   │   FUNCTIONAL        │   │                  │  │
│  └─────────────┘   └─────────────────────┘   └──────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     MEDIA PIPELINE (Stage 2)                   │  │
│  │                                                               │  │
│  │   media/      ← MediaLibrary    (reads network_media)        │  │
│  │   queue/      ← QueueEngine     (reads cloud_stream_playlist) │  │
│  │   playlists/  ← PlaylistEngine  (curated ordered playlists)   │  │
│  │   scheduler/  ← ProgrammingScheduler (time-based slots)      │  │
│  │   playback/   ← PlaybackEngine  (continuous 24/7 playback)   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐   │
│  │  DESTINATIONS        │   │  CREATOR STUDIO (Stage 1 shell)   │   │
│  │  (Stage 2)           │   │                                   │   │
│  │  destinations/       │   │  studio/creator-studio.js        │   │
│  │  youtube/            │   │  Displays: NOT IMPLEMENTED badges │   │
│  │                      │   │  Future: live engine dashboard    │   │
│  └──────────────────────┘   └──────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  BROADCAST ENGINE (Stage 3)                                   │   │
│  │                                                               │   │
│  │   broadcast/broadcast-engine.js      ← Public interface      │   │
│  │   broadcast/shadow-broadcast-engine-impl.js ← Implementation │   │
│  │   broadcast/destination-manager.js   ← RTMP/RTMPS dest mgmt │   │
│  │   broadcast/rtmp-transport.js        ← FFmpeg RTMP transport │   │
│  │   broadcast/reconnect-manager.js     ← Auto-reconnect        │   │
│  │   broadcast/broadcast-metrics.js     ← Real metrics          │   │
│  │   broadcast/broadcast-errors.js      ← Error codes           │   │
│  │   broadcast/output-cleanup.js        ← Temp file cleanup     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  RESILIENCE LAYER (Future stage)                              │   │
│  │                                                               │   │
│  │   watchdog/    ← Watchdog         (health monitoring)        │   │
│  │   recovery/    ← RecoveryEngine   (auto-restart)             │   │
│  │   fallback/    ← FallbackProgramming (slate / test card)     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐   │
│  │  SECURITY            │   │  CROSS-CUTTING                    │   │
│  │                      │   │                                   │   │
│  │  security/           │   │  logs/     ← Central logger       │   │
│  │  permissions.js      │   │  config/   ← Config system        │   │
│  │  Roles: OWNER/ADMIN/ │   │  diagnostics.js ← Stage 1 checks  │   │
│  │  CREATOR/VIEWER      │   │                                   │   │
│  └──────────────────────┘   └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

     EVENT BUS (event-bus.js)
    ═════════════════════════
    All modules emit and subscribe to named events.
    No direct module-to-module calls across boundaries.

    ENGINE_READY / ENGINE_ERROR
    MEDIA_LOADING / MEDIA_STARTED / MEDIA_ENDED / MEDIA_ERROR
    ENCODER_STARTED / ENCODER_STOPPED / ENCODER_ERROR
    BROADCAST_CONNECTED / BROADCAST_DISCONNECTED / BROADCAST_ERROR
    BROADCAST_STARTED / BROADCAST_STOPPED            (Stage 3)
    BROADCAST_RECONNECTING / BROADCAST_RECONNECTED   (Stage 3)
    QUEUE_CHANGED / SCHEDULE_CHANGED
    WATCHDOG_WARNING
    RECOVERY_STARTED / RECOVERY_COMPLETED / RECOVERY_FAILED
```

---

## Module Responsibilities

| Module            | Directory            | Responsibility                                  | Stage |
|-------------------|----------------------|-------------------------------------------------|-------|
| Core Engine       | `core/engine.js`     | Lifecycle, module registry, boot/shutdown       | 1     |
| Event Bus         | `core/event-bus.js`  | Internal pub/sub — decouples all modules        | 1     |
| Event Catalogue   | `core/events.js`     | Canonical event name constants                  | 1     |
| State Manager     | `core/state-manager.js` | Central runtime state tree                   | 1     |
| Commands          | `core/commands.js`   | Command dispatcher, NOT_IMPLEMENTED stubs       | 1     |
| Health Service    | `core/health.js`     | Component health aggregator                     | 1     |
| Logger            | `logs/logger.js`     | Structured logging, secret redaction            | 1     |
| Configuration     | `config/config.js`   | Centralized config, no secrets                  | 1     |
| Shadow Encoder    | `encoder/`           | H.264/AAC encoding (interface only)             | 2     |
| Broadcast Engine  | `broadcast/`         | RTMPS output stream (interface only)            | 2     |
| Playback Engine   | `playback/`          | Continuous media playback (interface only)      | 2     |
| Media Library     | `media/`             | Media scanning, Firestore sync (interface only) | 2     |
| Queue Engine      | `queue/`             | Playback queue management (interface only)      | 2     |
| Playlist Engine   | `playlists/`         | Ordered/shuffled playlists (interface only)     | 2     |
| Scheduler         | `scheduler/`         | Time-based programming (interface only)         | 2     |
| Destinations      | `destinations/`      | Stream destination management (interface only)  | 2     |
| YouTube Connector | `youtube/`           | YouTube Live API integration (interface only)   | 2     |
| Watchdog          | `watchdog/`          | Health monitoring (interface only)              | 3     |
| Recovery Engine   | `recovery/`          | Auto-recovery (interface only)                  | 3     |
| Fallback          | `fallback/`          | Slate/test-card programming (interface only)    | 3     |
| Security          | `security/`          | Role/permission matrix                          | 1     |
| Firebase Boundary | `firebase/`          | Clean Firebase connector, safe init             | 1     |
| Creator Studio    | `studio/`            | Engine dashboard shell                          | 1     |
| Diagnostics       | `diagnostics.js`     | Stage 1 self-test suite                         | 1     |

---

## Event Flow

```
initCloudEngine()
      │
      ▼
  CloudEngineConfig.load()
      │
      ▼
  [For each registered module] module.initialize()
      │
      ▼
  engine status → READY
  CloudEngineStateManager.set('engine.status', 'READY')
      │
      ▼
  CloudEngineEventBus.emit(ENGINE_READY, { version, startedAt })
      │
      ├──► Creator Studio: re-render status panel
      ├──► Firebase Connector: update cloud_engine_state doc (Stage 2)
      └──► Any subscriber: custom reaction

Stage 2 — media starts playing:
  PlaybackEngine.play(item)
      │
      ├──► emit(MEDIA_LOADING, { item })
      ├──► ShadowEncoder.loadMedia(item)
      ├──► emit(MEDIA_STARTED, { item })
      ├──► BroadcastEngine.startBroadcast()
      └──► emit(BROADCAST_CONNECTED, { destination })

Media ends:
  emit(MEDIA_ENDED, { item })
      │
      ├──► QueueEngine.dequeue() → next item
      └──► PlaybackEngine.play(nextItem)
```

---

## Configuration

Configuration lives in `config/config.js`.

**Secrets are never stored in configuration files.**
Sensitive values (stream keys, OAuth tokens, service account JSON) must be
stored in:
- Cloudflare Worker secrets (`wrangler secret put`)
- Firebase Functions environment config
- Server-side environment variables

The `config/.env.example` file shows the env var names without real values.

---

## Security Model

### Roles
| Role    | Description                            |
|---------|----------------------------------------|
| OWNER   | Full engine control (verified server-side via Firebase custom claims) |
| ADMIN   | Administrative access, all features except ownership transfer |
| CREATOR | Upload media, manage playlists, add to queue |
| VIEWER  | Watch channels, read public status only |

### Enforcement
- Roles are NEVER trusted from the browser.
- The existing `isAdmin()` function in `tv/firestore.rules` enforces access to
  Firestore collections. This is the server-side authority.
- Future Cloud Engine API endpoints (Cloudflare Worker) will verify Firebase ID
  tokens server-side before executing any sensitive command.
- The permission matrix in `security/permissions.js` is for UI hints only.

---

## Firebase Integration

The Cloud Engine uses the **same Firebase project** as the existing AURENIX
`tv/` application (`remix-studio-4bf8a`).

### Collections (already defined in `tv/firestore.rules`)
| Collection                     | Purpose                                |
|--------------------------------|----------------------------------------|
| `cloud_stream_playlist`        | Playback queue                         |
| `cloud_stream_sessions`        | Active engine session state            |
| `cloud_stream_schedules`       | Programming schedules                  |
| `cloud_stream_logs`            | Remote log shipping (Stage 2)          |
| `cloud_stream_destinations`    | Stream destination config (admin-only) |
| `cloud_stream_youtube_tokens`  | OAuth tokens (admin-only, server-side) |

### New Collections (Stage 1 — no rule changes required)
| Collection                | Purpose                                      |
|---------------------------|----------------------------------------------|
| `cloud_engine_state`      | Live engine status (Stage 2 writes this)     |
| `cloud_engine_commands`   | Remote command queue (Stage 2 consumes this) |
| `cloud_engine_permissions`| Role assignments per user (Stage 2)          |
| `cloud_engine_recovery`   | Recovery state (Stage 3)                     |

**Stage 1 does not write to Firestore.** No Firestore rule changes are needed
for Stage 1. These collections are defined here for Stage 2 planning.

When Stage 2 adds these collections, update `tv/firestore.rules` to add rules
following the same pattern as the existing `cloud_stream_*` rules:
- Read: `isAdmin()` or owner via `resource.data.owner_uid`
- Write: `isAdmin()` only (or via admin SDK in Cloudflare Worker)

---

## Stage 1 Limitations

- No H.264 or AAC encoding (Stage 2).
- No RTMPS/RTMP broadcast output (Stage 2).
- No 24/7 continuous playback loop (Stage 2).
- No YouTube connection (Stage 2).
- No watchdog or auto-recovery (Stage 3).
- No remote logging to Firestore (Stage 2).
- Firebase connector initializes safely but does not read/write (Stage 2).
- Creator Studio shows status badges only — no live data (Stage 2).

---

## How Stage 2 Plugs Into the Encoder Module

1. Create `cloud-engine/encoder/shadow-encoder-impl.js` that fulfils the
   same interface as `shadow-encoder.js`.
2. The implementation communicates with a server-side process (Cloudflare
   Worker, Node.js, or similar) via `fetch()` to start/stop/query FFmpeg.
3. The server process receives media URLs from the QueueEngine/PlaybackEngine,
   runs FFmpeg with RTMPS output pointed at the destination stream key.
4. The stream key is loaded from a Cloudflare Worker secret — it NEVER
   reaches browser JavaScript.
5. Register the real implementation with the engine:
   ```js
   import { ShadowEncoderImpl } from './encoder/shadow-encoder-impl.js';
   import { registerModule }    from './core/engine.js';
   registerModule('encoder', ShadowEncoderImpl);
   ```
6. The engine calls `ShadowEncoderImpl.initialize()` during `initCloudEngine()`.

---

## Version

```
24-Hour Cloud Engine
Stage 3
Engine Version 0.3.0
Build: stage3-2025-10-01
```

## Stage 3 — New Modules (Shadow Broadcast Engine)

| Module                         | File                                            | Responsibility                              |
|--------------------------------|-------------------------------------------------|---------------------------------------------|
| Broadcast Engine (public API)  | `broadcast/broadcast-engine.js`                 | Stage 3 RTMPS output stream, real impl      |
| Broadcast Engine (impl)        | `broadcast/shadow-broadcast-engine-impl.js`     | Full broadcast lifecycle (Stage 3)          |
| Destination Manager            | `broadcast/destination-manager.js`              | RTMP/RTMPS destination config               |
| RTMP Transport                 | `broadcast/rtmp-transport.js`                   | FFmpeg RTMP/RTMPS process management        |
| Broadcast Metrics              | `broadcast/broadcast-metrics.js`                | Real broadcast performance metrics          |
| Reconnect Manager              | `broadcast/reconnect-manager.js`                | Exponential backoff reconnect logic         |
| Broadcast Errors               | `broadcast/broadcast-errors.js`                 | Structured broadcast error codes            |
| Output Cleanup                 | `broadcast/output-cleanup.js`                   | Temp file lifecycle management              |
| Live Encoder Profile           | `encoder/encoder-profiles.js` (youtube_live_1080p30) | veryfast H.264/AAC for live broadcast |

## Stage 3 — Secret Management

Stream keys are loaded at runtime via `process.env[streamKeyEnvVar]`.
They are **never** stored in:
- Source code or git commits
- State manager snapshots
- Log output (redacted as `********`)
- Diagnostic output (redacted)
- URLs displayed in status/metrics
- Error messages

The full RTMP publish URL (containing the stream key) is:
- Passed as an argument array element to `spawn()` (shell:false — no injection risk)
- Discarded after use
- Never logged by the engine (all stderr lines are scanned and key is replaced with `********`)

---

## Shared Infrastructure Design

### Overview

The 24-Hour Cloud Engine and Shadow Reaper operate as **two logically isolated
systems sharing one Cloudflare account** and each using their own **dedicated
Firebase project**.

```
SHARED: Cloudflare Account
├── Worker: sr-standalone-api    → routes: /api/v1/*         (Shadow Reaper)
└── Worker: ce-api               → routes: /api/cloud-engine/* (Cloud Engine)
     Separate bindings, secrets, KV namespaces per Worker.

SEPARATE Firebase Projects:
├── remix-studio-4bf8a           → Cloud Engine + AURENIX tv/
│     cloud_engine_state, cloud_engine_commands, cloud_engine_permissions
│     cloud_engine_recovery, cloud_stream_*, network_*, (all AURENIX collections)
└── ffr3r3223                    → Shadow Reaper ONLY
      users/{uid}/shadowReaperConversations, shadowReaperMemory,
      shadowReaperLearnedContext, shadowReaperPreferences,
      sharedKnowledge, globalLearning, shadowReaperConfig, webResearchCache
```

### Why Two Firebase Projects

Shadow Reaper was designed with a dedicated Firebase project (`ffr3r3223`) before
the Cloud Engine was built. Merging the projects would:

- Risk exposing SR private AI memory to CE Firestore rules (and vice versa)
- Conflate SR "Founder" role with CE "OWNER/ADMIN" role model
- Require migrating all existing SR user data (disruptive, unnecessary)
- Provide no technical benefit — isolation is already the goal

**Do not merge these projects.**

### Data Isolation Guarantee

| System            | MUST NOT access                                                 |
|-------------------|-----------------------------------------------------------------|
| Cloud Engine      | Any `users/{uid}/shadowReaper*`, `sharedKnowledge`, `globalLearning`, `shadowReaperConfig`, `webResearchCache` |
| Shadow Reaper     | `cloud_stream_destinations` (stream keys), `cloud_stream_youtube_tokens` (OAuth), `cloud_engine_commands` |

Because they are separate Firebase projects, accidental cross-access is prevented
at the platform level. The explicit isolation check in `firebase/firebase-connector.js`
additionally prevents the CE from initializing with the wrong project ID.

### Cloudflare Worker Separation

| Concern           | Shadow Reaper Worker       | Cloud Engine Worker        |
|-------------------|----------------------------|----------------------------|
| Worker name       | `sr-standalone-api`        | `ce-api`                   |
| Route prefix      | `/api/v1/*`                | `/api/cloud-engine/*`      |
| Auth header       | `Authorization: Bearer`    | `X-CE-Service-Token`       |
| Secrets prefix    | `SR_*`                     | `CE_*`                     |
| KV binding        | `SR_SHARED_KNOWLEDGE`      | `CE_ENGINE_STATE`          |
| Firebase project  | ffr3r3223                  | remix-studio-4bf8a         |

**No secrets, bindings, or environment variables are shared between Workers.**

### Authentication Sharing Design

Firebase Authentication is **not shared** at the project level because the two
systems use separate Firebase projects with separate UID spaces.

| Concern               | Design                                                  |
|-----------------------|---------------------------------------------------------|
| Authentication        | Each system verifies its own Firebase Auth tokens       |
| UIDs                  | Different UID spaces (separate projects)                |
| Future SSO            | Application-layer only — never via project merge        |
| CE authorization      | CE verifies its own custom claims (OWNER/ADMIN/CREATOR) |
| SR authorization      | SR verifies its own Founder/user claims                 |

### Shadow Reaper → Cloud Engine Integration Boundary

The controlled future path for "Shadow, start my broadcast" style commands:

```
Shadow Reaper (/api/v1/engine/command)
    ↓  interprets natural language → structured command JSON
    ↓  POST /api/cloud-engine/v1/commands
    ↓  Header: X-CE-Service-Token: <CE_SERVICE_TOKEN>
Cloud Engine Worker: verifyIntegrationToken()
    ↓  validateIntegrationCommand()
    ↓  CE permission + ownership check
Cloud Engine: executes command
```

**Status: PREPARED, NOT YET WIRED**

- Integration boundary contract: `security/integration-boundary.js`
- Shared infrastructure registry: `firebase/shared-infrastructure.js`
- No direct cross-database access exists or is planned
- Shadow Reaper NEVER receives CE Firestore credentials
- CE NEVER reads SR Firestore collections

### Secret Management

| Secret                         | Lives in                       | Never in                         |
|--------------------------------|--------------------------------|----------------------------------|
| `CE_SERVICE_TOKENS`            | CE Worker secret               | SR Worker, source code, git      |
| `CE_FIREBASE_SERVICE_ACCOUNT`  | CE Worker secret               | SR config, client JS, git        |
| `CE_ALLOWED_ORIGIN`            | CE Worker secret               | wrangler.toml vars               |
| `YOUTUBE_STREAM_KEY`           | CE Worker secret               | logs, state, diagnostics         |
| `SR_SERVICE_TOKENS`            | SR Worker secret               | CE Worker, source code, git      |
| `SR_INTERNAL_API_KEY`          | SR Worker secret               | CE bindings                      |

All secrets are loaded via `process.env[envVarName]` or `env[secretName]` at
runtime. Nothing is committed to source control. See `config/.env.example`.

### Files Added by This Infrastructure Update

| File                                        | Purpose                                              |
|---------------------------------------------|------------------------------------------------------|
| `firebase/shared-infrastructure.js`        | Infrastructure registry, isolation assertion         |
| `security/integration-boundary.js`         | SR→CE command boundary contract (not yet wired)      |
| `cloudflare/wrangler.toml`                 | CE Worker configuration skeleton                     |
| `cloudflare/worker/index.js`               | CE Worker entry point (skeleton)                     |

### Changes to Existing Files

| File                              | Change                                               |
|-----------------------------------|------------------------------------------------------|
| `firebase/firebase-connector.js`  | Added isolation assertion in `initialize()`          |
| `config/.env.example`             | Added CE Worker + shared infra env var documentation |
| `ARCHITECTURE.md`                 | Added this section                                   |

**No Shadow Reaper files were modified.**
**No existing Cloud Engine functionality was removed or downgraded.**
