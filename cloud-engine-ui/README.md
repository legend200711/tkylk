# 24-HOUR CLOUD ENGINE — Frontend

Professional cloud broadcasting control center for the 24-Hour Cloud Engine.

## What This Is

A dedicated frontend application for controlling the existing 24-Hour Cloud Engine backend.
It is NOT Shadow Reaper. It is NOT a social network. It is a broadcast control interface.

## Structure

```
cloud-engine-ui/
  index.html          — Main application shell
  manifest.json       — PWA manifest
  sw.js               — Service worker (offline shell)
  css/
    ce-base.css       — Design tokens, layout, navigation
    ce-components.css — Buttons, inputs, cards, badges, tables
    ce-screens.css    — Screen-specific styles
    ce-responsive.css — Tablet/mobile responsive rules
  js/
    ce-app.js           — Main application, boot, routing
    ce-store.js         — Reactive state store
    ce-firebase-bridge.js — Firebase connection (remix-studio-4bf8a)
    ce-utils.js         — DOM helpers, toasts, badges
    screens/
      ce-screen-dashboard.js    — Dashboard
      ce-screen-studio.js       — Broadcast Studio
      ce-screen-destinations.js — Destination management
      ce-screen-platforms.js    — Platform connections
      ce-screen-media.js        — Media library
      ce-screen-tv-station.js   — TV Station (optional mode)
      ce-screen-playlists.js    — Playlist management
      ce-screen-schedule.js     — Programming schedule
      ce-screen-now-playing.js  — Now Playing
      ce-screen-hybrid.js       — Hybrid Mode
      ce-screen-monitoring.js   — System monitoring
      ce-screen-recovery.js     — Recovery status
      ce-screen-settings.js     — Settings
      ce-screen-account.js      — Account
  tests/
    ce-frontend.test.mjs — Frontend test suite (50 tests)
  icons/
    icon-192.png       — PWA icon (to be generated)
    icon-512.png       — PWA icon (to be generated)
```

## Firebase Configuration

This frontend connects to **Firebase project `remix-studio-4bf8a` (AURENIX)** ONLY.

Shadow Reaper uses **`ffr3r3223`**. These projects are permanently isolated.

To configure, edit `ce-firebase-bridge.js` and replace the `CE_FIREBASE_CONFIG` values
with the actual API credentials from the `remix-studio-4bf8a` project.

## Running the Frontend

```bash
# Serve from the cloud-engine-ui/ directory
npx serve cloud-engine-ui/
# or
python3 -m http.server 8080 --directory cloud-engine-ui/
```

Open: http://localhost:8080

## Running the Frontend Tests

```bash
node --test cloud-engine-ui/tests/ce-frontend.test.mjs
```

## Deployment

The Cloud Engine frontend is a static site. Deploy `cloud-engine-ui/` to any static host.

**Important:** Deploy to a SEPARATE path/subdomain from Shadow Reaper.
Do NOT deploy over `index.html` (Shadow Reaper).

Options:
- A separate GitHub Pages path (e.g. `/cloud-engine/`)
- A dedicated subdomain (e.g. `control.yourdomain.com`)
- Any static CDN (Cloudflare Pages, Netlify, Vercel)

## The Cloud Engine Backend

The backend (`cloud-engine/`) runs as a persistent Node.js server with FFmpeg.
It CANNOT run on GitHub Pages. It requires a VPS, cloud VM, or container host.

The frontend communicates with the backend via Firebase control commands.
When the backend is offline, the frontend shows **ENGINE OFFLINE**.

## Project Separation

| | Shadow Reaper | 24-Hour Cloud Engine |
|---|---|---|
| Firebase Project | ffr3r3223 | remix-studio-4bf8a |
| Frontend | `/index.html` | `cloud-engine-ui/` |
| Cloudflare Worker | sr-standalone-api | ce-api (architecture ready) |
| Purpose | AI chat | Cloud broadcasting |
