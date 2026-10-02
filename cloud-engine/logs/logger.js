/**
 * 24-HOUR CLOUD ENGINE — Central Logger
 * cloud-engine/logs/logger.js
 *
 * Structured logging for all engine modules.
 * Supports: INFO | WARNING | ERROR | DEBUG
 *
 * SECURITY: Never log passwords, tokens, OAuth credentials, or stream keys.
 * The redactSecrets() helper strips common secret field names before writing.
 */

/* ═══════════════════════════════════
   LOG LEVELS
═══════════════════════════════════ */
export const LOG_LEVEL = Object.freeze({
  DEBUG:   'DEBUG',
  INFO:    'INFO',
  WARNING: 'WARNING',
  ERROR:   'ERROR',
});

// Fields that must never appear in log output
const SECRET_FIELDS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'idToken',
  'streamKey', 'stream_key', 'apiKey', 'api_key', 'secret',
  'clientSecret', 'client_secret', 'serviceAccountKey',
  'supabaseServiceKey', 'firebaseServiceKey',
]);

/**
 * Redact secret fields from a metadata object before logging.
 * @param {object|null} meta
 * @returns {object|null}
 */
function redactSecrets(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const safe = {};
  for (const [k, v] of Object.entries(meta)) {
    safe[k] = SECRET_FIELDS.has(k) ? '[REDACTED]' : v;
  }
  return safe;
}

/* ═══════════════════════════════════
   LOG STORE (in-memory ring buffer)
═══════════════════════════════════ */
const MAX_LOG_ENTRIES = 500;
const _logs = [];

function _write(level, module, event, message, meta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    event,
    message,
    metadata: redactSecrets(meta) ?? null,
  };

  _logs.push(entry);
  if (_logs.length > MAX_LOG_ENTRIES) _logs.shift();

  // Mirror to browser/Node console
  const prefix = `[CloudEngine][${level}][${module}] ${event}: ${message}`;
  if (level === LOG_LEVEL.ERROR)        console.error(prefix, entry.metadata ?? '');
  else if (level === LOG_LEVEL.WARNING) console.warn(prefix,  entry.metadata ?? '');
  else if (level === LOG_LEVEL.DEBUG)   console.debug(prefix, entry.metadata ?? '');
  else                                  console.log(prefix,   entry.metadata ?? '');
}

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

function info(module, event, message, meta)    { _write(LOG_LEVEL.INFO,    module, event, message, meta); }
function warn(module, event, message, meta)    { _write(LOG_LEVEL.WARNING, module, event, message, meta); }
function error(module, event, message, meta)   { _write(LOG_LEVEL.ERROR,   module, event, message, meta); }
function debug(module, event, message, meta)   { _write(LOG_LEVEL.DEBUG,   module, event, message, meta); }

/**
 * Return a copy of all log entries (newest last).
 * @param {string} [levelFilter]  Optional: only return entries of this level.
 * @returns {Array<object>}
 */
function getLogs(levelFilter) {
  if (!levelFilter) return [..._logs];
  return _logs.filter(e => e.level === levelFilter);
}

/** Clear the in-memory log buffer. */
function clearLogs() { _logs.length = 0; }

export const CloudEngineLogger = Object.freeze({ info, warn, error, debug, getLogs, clearLogs, LOG_LEVEL });
