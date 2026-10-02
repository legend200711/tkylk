/**
 * 24-HOUR CLOUD ENGINE — Service Worker
 * cloud-engine-ui/sw.js
 *
 * Provides:
 *   - Offline shell (app loads even without network)
 *   - Static asset caching
 *
 * IMPORTANT:
 *   Offline PWA support does NOT mean the Cloud Engine can broadcast offline.
 *   When the control plane/runtime cannot be reached, the UI shows ENGINE OFFLINE.
 *   All engine operations require the persistent Node.js Cloud Engine server.
 *
 * Does NOT cache Firebase data or engine state (always fetch live).
 */

const CE_CACHE_NAME   = 'cloud-engine-ui-v1';
const CE_SHELL_ASSETS = [
  './index.html',
  './manifest.json',
  './css/ce-base.css',
  './css/ce-components.css',
  './css/ce-screens.css',
  './css/ce-responsive.css',
  './js/ce-app.js',
  './js/ce-store.js',
  './js/ce-utils.js',
  './js/ce-firebase-bridge.js',
];

/* ═══════════════════════════════════
   INSTALL — cache shell assets
═══════════════════════════════════ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CE_CACHE_NAME).then((cache) => {
      return cache.addAll(CE_SHELL_ASSETS).catch((err) => {
        console.warn('[CE SW] Failed to cache some shell assets:', err);
        // Non-fatal — continue install even if some assets fail
      });
    }).then(() => self.skipWaiting())
  );
});

/* ═══════════════════════════════════
   ACTIVATE — clean up old caches
═══════════════════════════════════ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(k => k !== CE_CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/* ═══════════════════════════════════
   FETCH — shell-first strategy
═══════════════════════════════════ */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Firebase requests — always go to network
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('firebaseapp.com')) {
    return;
  }

  // For navigation requests: return shell from cache, fallback to network
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => {
        return cached ?? fetch(event.request).catch(() => {
          return new Response(OFFLINE_HTML, {
            headers: { 'Content-Type': 'text/html' }
          });
        });
      })
    );
    return;
  }

  // For static assets: cache first, then network
  if (CE_SHELL_ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached ?? fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CE_CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // For JS screen modules: network first, cache fallback
  if (url.pathname.includes('/js/screens/')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CE_CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
});

/* ═══════════════════════════════════
   OFFLINE FALLBACK PAGE
═══════════════════════════════════ */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>24-Hour Cloud Engine — Offline</title>
  <style>
    body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; background: #080a10; color: #c8cfe8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #111520; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 32px; max-width: 380px; text-align: center; }
    .brand { font-size: 11px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: #3b82f6; margin-bottom: 12px; }
    h1 { font-size: 18px; font-weight: 700; color: #e8ecff; margin: 0 0 10px; }
    p { font-size: 13px; color: #5a6480; margin: 0; line-height: 1.6; }
    .badge { display: inline-block; background: rgba(239,68,68,0.15); color: #ef4444; border-radius: 100px; padding: 4px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 14px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">24-Hour Cloud Engine</div>
    <div class="badge">ENGINE OFFLINE</div>
    <h1>No Network Connection</h1>
    <p>The Cloud Engine control interface could not load. Please check your network connection and try again.</p>
  </div>
</body>
</html>`;
