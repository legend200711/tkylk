/**
 * 24-HOUR CLOUD ENGINE — Station Metrics
 * cloud-engine/tv-station/station-metrics.js
 *
 * Metrics collection and reporting for TV stations.
 *
 * Stage 10 — Optional TV Station Mode
 */

/* ═══════════════════════════════════
   STATION METRICS
═══════════════════════════════════ */
export function createStationMetrics(stationId) {
  return {
    stationId,
    programsPlayed:   0,
    totalAirtimeSec:  0,
    scheduleHits:     0,    // Times schedule correctly determined current program
    scheduleMisses:   0,    // Times no scheduled content found
    fallbackActivations: 0,
    errors:           0,
    lastUpdated:      new Date().toISOString(),
  };
}

export function incrementMetric(metrics, field, amount = 1) {
  return {
    ...metrics,
    [field]: (metrics[field] ?? 0) + amount,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Safe metric snapshot for Studio/API.
 * No secrets, no internal state.
 */
export function safeMetricSnapshot(metrics) {
  return { ...metrics };
}
