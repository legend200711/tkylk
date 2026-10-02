/**
 * 24-HOUR CLOUD ENGINE — Ingest Metrics
 * cloud-engine/ingest/ingest-metrics.js
 *
 * Defines the metrics shape for an active ingest session.
 * All fields that cannot be determined return null — nothing is fabricated.
 *
 * Stage 5 — Live Input / Ingest
 */

/**
 * Create an empty ingest metrics object.
 * @param {object} [initial]  Optional preset values.
 * @returns {IngestMetrics}
 */
export function createIngestMetrics(initial = {}) {
  return {
    // Session identity
    sessionId:        initial.sessionId    ?? null,
    sourceType:       initial.sourceType   ?? null,

    // Connection / activity
    connected:        initial.connected    ?? false,
    startedAt:        initial.startedAt    ?? null,  // ISO timestamp
    uptimeSec:        null,                          // computed at read time
    lastActivityAt:   initial.lastActivityAt ?? null,// ISO timestamp

    // Stream presence
    videoPresent:     initial.videoPresent ?? null,  // true | false | null (unknown)
    audioPresent:     initial.audioPresent ?? null,

    // Video metrics (real, from probe/progress — null if unavailable)
    inputFps:         null,
    resolution:       null,   // e.g. "1920x1080" or null
    videoCodec:       null,

    // Audio metrics
    audioSampleRate:  null,
    audioChannels:    null,
    audioCodec:       null,

    // Throughput
    bytesReceived:    initial.bytesReceived ?? 0,

    // Source health
    health:           initial.health       ?? null,  // 'OK' | 'DEGRADED' | 'ERROR' | null
    lastError:        initial.lastError    ?? null,
  };
}

/**
 * Update uptime from startedAt timestamp.
 * @param {object} metrics  Ingest metrics object (mutated in place).
 * @returns {object}
 */
export function updateIngestUptime(metrics) {
  if (metrics.startedAt && metrics.connected) {
    const startMs = new Date(metrics.startedAt).getTime();
    metrics.uptimeSec = Math.floor((Date.now() - startMs) / 1000);
  } else {
    metrics.uptimeSec = null;
  }
  return metrics;
}

/**
 * Snapshot ingest metrics with uptime computed at call time.
 * @param {object} metrics
 * @returns {object}
 */
export function snapshotIngestMetrics(metrics) {
  const snap = { ...metrics };
  updateIngestUptime(snap);
  return snap;
}

/**
 * Determine ingest health from current state.
 * @param {object} metrics
 * @returns {'OK'|'DEGRADED'|'ERROR'|null}
 */
export function computeIngestHealth(metrics) {
  if (!metrics.connected) return null;
  if (metrics.lastError)  return 'ERROR';
  if (metrics.videoPresent === false && metrics.audioPresent === false) return 'ERROR';
  if (metrics.videoPresent === false || metrics.audioPresent === false) return 'DEGRADED';
  return 'OK';
}
