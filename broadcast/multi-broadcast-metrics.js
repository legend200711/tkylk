/**
 * 24-HOUR CLOUD ENGINE — Multi-Broadcast Metrics
 * cloud-engine/broadcast/multi-broadcast-metrics.js
 *
 * Aggregates and reports metrics across all active fan-out destination sessions.
 *
 * Metrics are computed from real session state — nothing is fabricated.
 * Fields that cannot be determined return null.
 *
 * Stage 4 — Multi-Platform Fan-Out
 */

import { SESSION_STATE } from './destination-session.js';

/* ═══════════════════════════════════
   METRIC HELPERS
═══════════════════════════════════ */

/**
 * Compute aggregate metrics from all active DestinationSession status objects.
 *
 * @param {object[]} sessionStatuses  Array of session.getStatus() results.
 * @param {object}   fanoutMeta       { fanoutState, startedAt }
 * @returns {object}  Aggregate multi-broadcast metrics
 */
export function computeMultiBroadcastMetrics(sessionStatuses, fanoutMeta = {}) {
  const sessions = sessionStatuses ?? [];

  // Count per state
  const counts = {
    broadcasting:  0,
    connected:     0,
    reconnecting:  0,
    error:         0,
    exhausted:     0,
    stopped:       0,
    idle:          0,
    other:         0,
  };

  let totalBytesSent   = 0;
  let maxUptimeSec     = null;
  let reconnectTotal   = 0;

  for (const s of sessions) {
    switch (s.state) {
      case SESSION_STATE.BROADCASTING: counts.broadcasting++;  break;
      case SESSION_STATE.CONNECTED:    counts.connected++;     break;
      case SESSION_STATE.RECONNECTING: counts.reconnecting++;  break;
      case SESSION_STATE.ERROR:        counts.error++;         break;
      case SESSION_STATE.EXHAUSTED:    counts.exhausted++;     break;
      case SESSION_STATE.STOPPED:      counts.stopped++;       break;
      case SESSION_STATE.IDLE:         counts.idle++;          break;
      default:                         counts.other++;         break;
    }

    totalBytesSent += s.bytesSent ?? 0;
    reconnectTotal += s.reconnectCount ?? 0;

    if (s.uptimeSec != null) {
      if (maxUptimeSec === null || s.uptimeSec > maxUptimeSec) {
        maxUptimeSec = s.uptimeSec;
      }
    }
  }

  const activeSessions  = counts.broadcasting + counts.connected + counts.reconnecting;
  const failedSessions  = counts.error + counts.exhausted;
  const healthyRatio    = sessions.length > 0
    ? (activeSessions / sessions.length).toFixed(2)
    : null;

  const uptimeSec = fanoutMeta.startedAt
    ? Math.floor((Date.now() - new Date(fanoutMeta.startedAt).getTime()) / 1000)
    : null;

  return {
    // Fan-out state
    fanoutState:         fanoutMeta.fanoutState ?? null,
    startedAt:           fanoutMeta.startedAt   ?? null,
    uptimeSec,

    // Destination counts
    destinationCount:    sessions.length,
    activeSessions,
    failedSessions,
    healthyRatio,         // 0.00 to 1.00

    // Per-state breakdowns
    stateCounts: { ...counts },

    // Throughput aggregate
    totalBytesSent,
    reconnectTotal,

    // Per-destination detail (safe — no stream keys)
    destinations: sessions.map(s => ({
      destinationId:   s.destinationId,
      name:            s.name,
      state:           s.state,
      uptimeSec:       s.uptimeSec,
      bytesSent:       s.bytesSent,
      reconnectCount:  s.reconnectCount,
      lastError:       s.lastError ? {
        code:    s.lastError.code    ?? null,
        message: s.lastError.message ?? null,
      } : null,
    })),
  };
}

/**
 * Format a multi-broadcast metrics snapshot as a human-readable summary string.
 * Suitable for diagnostics logs.
 *
 * @param {object} metrics  Result of computeMultiBroadcastMetrics()
 * @returns {string}
 */
export function formatMultiBroadcastMetrics(metrics) {
  const lines = [
    `Fan-out state: ${metrics.fanoutState ?? 'unknown'}`,
    `Destinations:  ${metrics.destinationCount} total — ${metrics.activeSessions} active, ${metrics.failedSessions} failed`,
    `Uptime:        ${metrics.uptimeSec != null ? `${metrics.uptimeSec}s` : 'n/a'}`,
    `Bytes sent:    ${metrics.totalBytesSent.toLocaleString()} bytes`,
    `Reconnects:    ${metrics.reconnectTotal}`,
  ];

  for (const d of metrics.destinations) {
    const err = d.lastError ? ` ERR: ${d.lastError.message}` : '';
    lines.push(
      `  [${d.destinationId}] ${d.state}  ` +
      `uptime=${d.uptimeSec ?? 'n/a'}s  ` +
      `bytes=${d.bytesSent ?? 0}  ` +
      `reconnects=${d.reconnectCount ?? 0}${err}`,
    );
  }

  return lines.join('\n');
}
