/**
 * 24-HOUR CLOUD ENGINE — Creator Studio Foundation
 * cloud-engine/studio/creator-studio.js
 *
 * Stage 1: Minimal shell only.
 *
 * The AURENIX tv/ project already contains aurenix-control.js (Founder Panel).
 * This module does NOT replace that panel.
 *
 * The Creator Studio is a future companion interface for the 24-Hour Cloud
 * Engine — it will display live engine status, encoding metrics, broadcast
 * health, scheduling controls, and queue management.
 *
 * Stage 1: Renders the status display described in the spec.
 * Stage 2+: Connect to live CloudEngineStateManager for real-time updates.
 *
 * Integration note for the AURENIX tv/ project:
 *   Mount the Creator Studio panel into an element already present in
 *   index.html, e.g. the existing #ax-control div, or add a new route.
 *   Do NOT modify aurenix-control.js (Founder Panel) during Stage 1.
 */

import { getHealthReport, HEALTH_STATUS } from '../core/health.js';
import { ENGINE_VERSION }                  from '../core/engine.js';

/* ═══════════════════════════════════
   CREATOR STUDIO — STAGE 1 SHELL
═══════════════════════════════════ */

/**
 * Render the Stage 1 Creator Studio status panel into a DOM container.
 * @param {HTMLElement} container  The element to render into.
 */
export function renderCreatorStudio(container) {
  if (!container) {
    console.warn('[CreatorStudio] No container element provided.');
    return;
  }

  const health = getHealthReport();
  const { components } = health;

  // Helper: render a status badge
  function badge(status) {
    const map = {
      [HEALTH_STATUS.OK]:              { bg: '#1a3a1a', color: '#4ade80', label: 'OK' },
      [HEALTH_STATUS.NOT_IMPLEMENTED]: { bg: '#1a1a2e', color: '#818cf8', label: 'Not Implemented' },
      [HEALTH_STATUS.NOT_CONFIGURED]:  { bg: '#2a1a1a', color: '#f59e0b', label: 'Not Configured' },
      [HEALTH_STATUS.ERROR]:           { bg: '#3a1a1a', color: '#f87171', label: 'Error' },
      [HEALTH_STATUS.DEGRADED]:        { bg: '#2a1a1a', color: '#fb923c', label: 'Degraded' },
    };
    const style = map[status] ?? { bg: '#111', color: '#888', label: status };
    return `<span style="
      background: ${style.bg};
      color: ${style.color};
      border: 1px solid ${style.color}33;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-family: monospace;
    ">${style.label}</span>`;
  }

  // Firebase: derive display status
  const fbStatus = components.firebase.connected
    ? HEALTH_STATUS.OK
    : components.firebase.status === 'NOT_CONFIGURED'
      ? HEALTH_STATUS.NOT_CONFIGURED
      : HEALTH_STATUS.ERROR;

  container.innerHTML = `
    <div style="
      font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
      background: #050507;
      color: #c8d0e8;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 520px;
      margin: 24px auto;
    ">
      <div style="margin-bottom: 4px; font-size: 11px; letter-spacing: 0.2em; color: #4d7aff; text-transform: uppercase; font-weight: 700;">
        24-HOUR CLOUD ENGINE
      </div>
      <div style="font-size: 22px; font-weight: 800; letter-spacing: 0.06em; color: #e8eaf6;">
        CREATOR STUDIO
      </div>
      <div style="font-size: 11px; color: #404860; margin-top: 2px; margin-bottom: 20px;">
        ${ENGINE_VERSION.name} &bull; Stage ${ENGINE_VERSION.stage} &bull; v${ENGINE_VERSION.version} &bull; ${ENGINE_VERSION.build}
      </div>

      <div style="font-size: 11px; letter-spacing: 0.15em; color: #6870a0; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
        ENGINE STATUS
      </div>

      <div style="display: grid; row-gap: 10px;">
        ${_row('Encoder',   badge(HEALTH_STATUS.NOT_IMPLEMENTED), 'Shadow Encoder — Stage 2')}
        ${_row('Broadcast', badge(HEALTH_STATUS.NOT_IMPLEMENTED), 'Broadcast Engine — Stage 2')}
        ${_row('Scheduler', badge(HEALTH_STATUS.NOT_IMPLEMENTED), 'Programming Scheduler — Stage 2')}
        ${_row('Watchdog',  badge(HEALTH_STATUS.NOT_IMPLEMENTED), 'Watchdog — Stage 3')}
        ${_row('Firebase',  badge(fbStatus),                      components.firebase.connected
          ? `Connected — ${components.firebase.projectId ?? 'project id unknown'}`
          : 'Not connected in standalone Stage 1 mode'
        )}
      </div>

      <div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #404060; text-align: center;">
        Stage 1 placeholder — no streaming, no encoding. Ready for Stage 2.
      </div>
    </div>
  `;
}

function _row(label, badgeHtml, note) {
  return `
    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px;">
      <div style="width: 110px; font-size: 12px; font-weight: 600; color: #8090b0;">${label}</div>
      <div>${badgeHtml}</div>
      <div style="font-size: 11px; color: #404060; flex: 1;">${note}</div>
    </div>`;
}

/**
 * Returns an HTML string suitable for embedding in existing pages
 * (e.g. the AURENIX Founder Panel / aurenix-control.js).
 * @returns {string}
 */
export function getCreatorStudioHTML() {
  const health = getHealthReport();
  const { components } = health;

  const fbConnected = components.firebase.connected;

  return `
    <!-- 24-Hour Cloud Engine — Creator Studio Stage 1 Status -->
    <section style="font-family:monospace;background:#050507;color:#c8d0e8;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px 24px;max-width:480px;margin:0 auto;">
      <div style="font-size:10px;letter-spacing:.2em;color:#4d7aff;text-transform:uppercase;font-weight:700;margin-bottom:4px;">24-HOUR CLOUD ENGINE</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:16px;">ENGINE STATUS</div>
      <div style="display:grid;row-gap:8px;font-size:12px;">
        <div>Encoder:   <b style="color:#818cf8">Not Implemented</b></div>
        <div>Broadcast: <b style="color:#818cf8">Not Implemented</b></div>
        <div>Scheduler: <b style="color:#818cf8">Not Implemented</b></div>
        <div>Watchdog:  <b style="color:#818cf8">Not Implemented</b></div>
        <div>Firebase:  <b style="color:${fbConnected ? '#4ade80' : '#f59e0b'}">${fbConnected ? 'Connected' : 'Not Configured'}</b></div>
      </div>
      <div style="margin-top:14px;font-size:10px;color:#404060;">
        ${ENGINE_VERSION.name} v${ENGINE_VERSION.version} &bull; Stage ${ENGINE_VERSION.stage}
      </div>
    </section>`;
}
