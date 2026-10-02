/**
 * 24-HOUR CLOUD ENGINE — UI Utilities
 * cloud-engine-ui/js/ce-utils.js
 *
 * DOM helpers, toast notifications, confirmation dialogs, and badge rendering.
 */

/* ═══════════════════════════════════
   DOM HELPERS
═══════════════════════════════════ */

/**
 * Shorthand for document.querySelector.
 */
export const $ = (sel, ctx = document) => ctx.querySelector(sel);

/**
 * Shorthand for document.querySelectorAll.
 */
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/**
 * Create a DOM element with attributes and children.
 */
export function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') elem.className = v;
    else if (k === 'html')  elem.innerHTML  = v;
    else if (k === 'text')  elem.textContent = v;
    else if (k.startsWith('on')) elem.addEventListener(k.slice(2), v);
    else elem.setAttribute(k, v);
  }
  for (const child of children) {
    if (!child) continue;
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
    else elem.appendChild(child);
  }
  return elem;
}

/**
 * Set element text safely (no XSS).
 */
export function setText(selector, text, ctx = document) {
  const e = $(selector, ctx);
  if (e) e.textContent = text ?? '';
}

/**
 * Set innerHTML safely (only use with trusted, sanitized content).
 */
export function setHTML(selector, html, ctx = document) {
  const e = $(selector, ctx);
  if (e) e.innerHTML = html ?? '';
}

/**
 * Show or hide an element.
 */
export function show(selector, visible = true, ctx = document) {
  const e = $(selector, ctx);
  if (e) e.style.display = visible ? '' : 'none';
}

/**
 * Toggle a CSS class on an element.
 */
export function toggleClass(selector, cls, on, ctx = document) {
  const e = $(selector, ctx);
  if (e) e.classList.toggle(cls, on);
}

/* ═══════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════ */
const _toastArea = () => document.getElementById('ce-toast-area');

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warn'|'info'} type
 * @param {number} duration  ms (default 4000)
 */
export function toast(message, type = 'info', duration = 4000) {
  const area = _toastArea();
  if (!area) return;

  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10l4 4 6-7"/></svg>',
    error:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="M10 7v4m0 2v.5"/></svg>',
    warn:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4l7 12H3L10 4z"/><path d="M10 9v3m0 2v.5"/></svg>',
    info:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="M10 9v5m0-7v.5"/></svg>',
  };

  const div = document.createElement('div');
  div.className = `ce-toast ce-toast-${type}`;
  div.innerHTML = `
    <span class="ce-toast-icon" style="width:18px;height:18px;flex-shrink:0;color:${type==='success'?'var(--ce-live)':type==='error'?'var(--ce-error)':type==='warn'?'var(--ce-warn)':'var(--ce-accent)'}">${icons[type]??''}</span>
    <span>${_escapeHtml(message)}</span>
  `;
  area.appendChild(div);

  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(4px)';
    div.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => div.remove(), 220);
  }, duration);
}

/* ═══════════════════════════════════
   CONFIRMATION DIALOG
═══════════════════════════════════ */

let _confirmResolve = null;

export function initConfirmDialog() {
  const overlay = document.getElementById('ce-confirm-overlay');
  const cancelBtn = document.getElementById('ce-confirm-cancel');
  const okBtn = document.getElementById('ce-confirm-ok');

  cancelBtn?.addEventListener('click', () => {
    overlay.style.display = 'none';
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  });

  okBtn?.addEventListener('click', () => {
    overlay.style.display = 'none';
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
  });

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
    }
  });
}

/**
 * Show a confirmation dialog.
 * @param {string} title
 * @param {string} body
 * @param {string} confirmLabel  Text on the confirm button
 * @returns {Promise<boolean>}
 */
export function confirm(title, body, confirmLabel = 'Confirm') {
  const overlay = document.getElementById('ce-confirm-overlay');
  const titleEl = document.getElementById('ce-confirm-title');
  const bodyEl  = document.getElementById('ce-confirm-body');
  const okBtn   = document.getElementById('ce-confirm-ok');

  if (!overlay) return Promise.resolve(false);

  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.textContent  = body;
  if (okBtn)   okBtn.textContent   = confirmLabel;
  overlay.style.display = 'flex';

  return new Promise((resolve) => { _confirmResolve = resolve; });
}

/* ═══════════════════════════════════
   STATUS BADGE HELPERS
═══════════════════════════════════ */

/**
 * Generate a status badge HTML string.
 * @param {string} status   Status label
 * @param {string} variant  CSS class suffix (live|offline|error|warn|ready|arch|recovering|etc.)
 * @returns {string} HTML
 */
export function badge(status, variant) {
  return `<span class="ce-badge ce-badge-${variant}">${_escapeHtml(status)}</span>`;
}

/**
 * Map a backend status string to badge variant + label.
 */
export function engineStatusBadge(status) {
  const map = {
    'RUNNING':      ['LIVE',       'live'],
    'READY':        ['READY',      'ready'],
    'STARTING':     ['STARTING',   'warn'],
    'STOPPING':     ['STOPPING',   'warn'],
    'RECOVERING':   ['RECOVERING', 'recovering'],
    'ERROR':        ['ERROR',      'error'],
    'STOPPED':      ['OFFLINE',    'offline'],
    'OFFLINE':      ['OFFLINE',    'offline'],
    'INITIALIZING': ['STARTING',   'warn'],
    'UNKNOWN':      ['UNKNOWN',    'offline'],
  };
  const [label, cls] = map[status] ?? [status ?? 'UNKNOWN', 'offline'];
  return badge(label, cls);
}

export function broadcastStateBadge(state) {
  const map = {
    'BROADCASTING': ['LIVE',     'live'],
    'PARTIAL':      ['PARTIAL',  'partial'],
    'STOPPING':     ['STOPPING', 'warn'],
    'STOPPED':      ['STOPPED',  'offline'],
    'IDLE':         ['IDLE',     'offline'],
    'BROADCASTING_WITH_FAILURES': ['PARTIAL', 'partial'],
  };
  const [label, cls] = map[state] ?? [state ?? 'IDLE', 'offline'];
  return badge(label, cls);
}

export function stationStateBadge(state) {
  const map = {
    'ON_AIR':          ['ON AIR',    'live'],
    'READY':           ['READY',     'ready'],
    'OFFLINE':         ['OFFLINE',   'offline'],
    'NO_PROGRAMMING':  ['NO PROG',   'warn'],
    'ERROR':           ['ERROR',     'error'],
    'PAUSED':          ['PAUSED',    'warn'],
    'STOPPING':        ['STOPPING',  'warn'],
    'INITIALIZING':    ['STARTING',  'warn'],
  };
  const [label, cls] = map[state] ?? [state ?? 'OFFLINE', 'offline'];
  return badge(label, cls);
}

export function hybridStateBadge(state) {
  const map = {
    'STATION':              ['STATION ON AIR',   'ready'],
    'PREPARING_LIVE':       ['PREPARING LIVE',   'warn'],
    'LIVE':                 ['LIVE OVERRIDE',    'live'],
    'RETURNING_TO_STATION': ['RETURNING',        'warn'],
    'ERROR':                ['ERROR',            'error'],
    'OFFLINE':              ['OFFLINE',          'offline'],
  };
  const [label, cls] = map[state] ?? [state ?? 'OFFLINE', 'offline'];
  return badge(label, cls);
}

export function platformStatusBadge(status) {
  const map = {
    'CONNECTED':      ['CONNECTED',    'connected'],
    'DISCONNECTED':   ['DISCONNECTED', 'disconnected'],
    'AUTH_REQUIRED':  ['AUTH REQUIRED','warn'],
    'TOKEN_EXPIRED':  ['TOKEN EXPIRED','warn'],
    'ERROR':          ['ERROR',        'error'],
    'NOT_CONFIGURED': ['NOT CONFIGURED','not-configured'],
    'CONNECTING':     ['CONNECTING',   'warn'],
    'ARCHITECTURE_READY': ['ARCH READY','arch'],
    'UNAVAILABLE':    ['UNAVAILABLE',  'not-impl'],
  };
  const [label, cls] = map[status] ?? [status ?? 'UNKNOWN', 'offline'];
  return badge(label, cls);
}

export function sourceTypeBadge(status) {
  const map = {
    'OPERATIONAL':     ['OPERATIONAL',     'live'],
    'ARCHITECTURE_READY': ['ARCH READY',   'arch'],
    'NOT_IMPLEMENTED': ['NOT IMPLEMENTED', 'not-impl'],
  };
  const [label, cls] = map[status] ?? [status, 'offline'];
  return badge(label, cls);
}

/* ═══════════════════════════════════
   FORMATTING HELPERS
═══════════════════════════════════ */

/**
 * Format ISO timestamp as local time string.
 */
export function formatTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(); }
  catch { return iso; }
}

/**
 * Format ISO timestamp as date+time string.
 */
export function formatDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

/**
 * Format duration in seconds as mm:ss or hh:mm:ss.
 */
export function formatDuration(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return [h, m, s].map(n => String(n).padStart(2,'0')).join(':');
  return [m, s].map(n => String(n).padStart(2,'0')).join(':');
}

/**
 * Format uptime seconds as HH:MM:SS.
 */
export function formatUptime(secs) {
  if (secs == null || secs < 0) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

/**
 * Format bytes as human-readable string.
 */
export function formatBytes(bytes) {
  if (bytes == null) return 'Unavailable';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/**
 * Escape HTML to prevent XSS in innerHTML.
 */
export function _escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/**
 * Unavailable placeholder.
 */
export const UNAVAILABLE = '<span class="ce-text-muted" style="font-style:italic">Unavailable</span>';
export const NOT_CONFIGURED = '<span class="ce-text-muted" style="font-style:italic">Not Configured</span>';
export const NOT_SUPPORTED = '<span class="ce-text-muted" style="font-style:italic">Not Supported</span>';
