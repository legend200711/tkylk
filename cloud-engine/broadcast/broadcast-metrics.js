/**
 * 24-HOUR CLOUD ENGINE — Broadcast Metrics
 * cloud-engine/broadcast/broadcast-metrics.js
 *
 * Tracks real broadcast performance metrics.
 * All fields that cannot be determined return null — nothing is fabricated.
 *
 * Stage 3 — Shadow Broadcast Engine
 */

/* ═══════════════════════════════════
   METRICS SHAPE
═══════════════════════════════════ */

/**
 * Create an empty broadcast metrics object.
 * All fields that haven't been measured are null or appropriate defaults.
 *
 * @param {object} [initial] Optional preset values.
 * @returns {BroadcastMetrics}
 */
export function createBroadcastMetrics(initial = {}) {
  return {
    // Lifecycle
    state:               initial.state              ?? null,  // BROADCAST_STATE.*

    // Destination (safe — no stream key)
    destinationId:       initial.destinationId      ?? null,
    destinationName:     initial.destinationName    ?? null,
    serverUrl:           initial.serverUrl          ?? null,
    protocol:            initial.protocol           ?? null,

    // Timing
    connectedAt:         initial.connectedAt        ?? null,  // ISO timestamp
    broadcastStartedAt:  initial.broadcastStartedAt ?? null,  // ISO timestamp
    uptimeSec:           null,    // computed from connectedAt

    // Connection quality
    reconnectCount:      initial.reconnectCount     ?? 0,
    lastReconnectAt:     initial.lastReconnectAt    ?? null,  // ISO timestamp
    connectionStatus:    initial.connectionStatus   ?? null,

    // Throughput (real from FFmpeg progress, or null if not available)
    bytesSent:           null,    // updated from transport
    currentBitrate:      null,    // kbps — NOT_AVAILABLE until measurable

    // Encoder relationship
    encoderSpeed:        null,    // from encoder metrics
    fps:                 null,    // from encoder metrics

    // Process
    pid:                 initial.pid                ?? null,

    // Error
    lastError:           initial.lastError          ?? null,  // BroadcastError | null
  };
}

/**
 * Update the uptime field from the connectedAt timestamp.
 * @param {object} metrics  Broadcast metrics object (mutated in place).
 * @returns {object} The same metrics object.
 */
export function updateUptimeMetric(metrics) {
  if (metrics.connectedAt) {
    const connectedMs = new Date(metrics.connectedAt).getTime();
    metrics.uptimeSec = Math.floor((Date.now() - connectedMs) / 1000);
  } else {
    metrics.uptimeSec = null;
  }
  return metrics;
}

/**
 * Return a snapshot of broadcast metrics.
 * Uptime is computed at call time.
 *
 * @param {object} metrics  Current broadcast metrics.
 * @returns {object}        Snapshot (plain object, no references to internals).
 */
export function snapshotMetrics(metrics) {
  const snap = { ...metrics };
  updateUptimeMetric(snap);
  return snap;
}
