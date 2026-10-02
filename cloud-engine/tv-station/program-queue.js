/**
 * 24-HOUR CLOUD ENGINE — Program Queue
 * cloud-engine/tv-station/program-queue.js
 *
 * Manages the live program queue for a TV station.
 * The queue tracks what is playing now, what is next, and position.
 *
 * The queue can be driven by:
 *   1. A playlist (looping or one-shot)
 *   2. The schedule (time-based, deterministic)
 *   3. Manual insertion
 *
 * Stage 10 — Optional TV Station Mode
 */

import { CloudEngineLogger }        from '../logs/logger.js';
import { STATION_ERROR_CODE }       from './station-errors.js';

const MODULE = 'tv-station/program-queue';

/* ═══════════════════════════════════
   QUEUE ITEM
═══════════════════════════════════ */
export function createQueueItem({ mediaId, title, duration, source, metadata = {} }) {
  if (!mediaId) throw new Error('mediaId required');
  return Object.freeze({
    queueItemId: `qi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mediaId,
    title:       title    ?? 'Untitled',
    duration:    duration ?? null,
    source:      source   ?? 'manual',   // 'playlist' | 'schedule' | 'manual'
    enqueuedAt:  new Date().toISOString(),
    ...metadata,
  });
}

/* ═══════════════════════════════════
   PROGRAM QUEUE
═══════════════════════════════════ */
export class ProgramQueue {
  constructor() {
    this._items       = [];        // ordered queue of QueueItems
    this._currentIdx  = -1;       // Index of currently playing item
    this._startedAt   = null;     // When the current item started playing
    this._expectedEnd = null;     // When the current item should end
  }

  /* ── Queue Management ──────────────────────────────────── */

  /**
   * Enqueue one or more items.
   * @param {...QueueItem} items
   */
  enqueue(...items) {
    for (const item of items) {
      this._items.push(item);
    }
    CloudEngineLogger.debug(MODULE, 'QUEUE_ENQUEUE',
      `Enqueued ${items.length} item(s). Queue depth: ${this._items.length}`);
  }

  /**
   * Clear all items after the current position.
   */
  clearRemaining() {
    if (this._currentIdx >= 0) {
      this._items = this._items.slice(0, this._currentIdx + 1);
    } else {
      this._items = [];
    }
  }

  /**
   * Clear entire queue.
   */
  clear() {
    this._items      = [];
    this._currentIdx = -1;
    this._startedAt  = null;
    this._expectedEnd = null;
  }

  /* ── Playback Position ─────────────────────────────────── */

  /**
   * Advance to the next item.
   * @returns {QueueItem|null} The new current item, or null if queue exhausted.
   */
  advance() {
    this._currentIdx++;
    const item = this._items[this._currentIdx];
    if (item) {
      this._startedAt  = new Date().toISOString();
      this._expectedEnd = item.duration
        ? new Date(Date.now() + item.duration * 1000).toISOString()
        : null;
      CloudEngineLogger.info(MODULE, 'QUEUE_ADVANCE',
        `Queue advanced to index ${this._currentIdx}: "${item.title}" (${item.mediaId})`);
    }
    return item ?? null;
  }

  /**
   * Set the current item to a specific queue index.
   * Used for recovery to jump to the correct position.
   * @param {number} index
   * @param {object} [opts]
   * @param {string} [opts.startedAt]  Override startedAt for mid-item recovery
   */
  seekToIndex(index, { startedAt } = {}) {
    if (index < 0 || index >= this._items.length) return null;
    this._currentIdx = index;
    const item = this._items[index];
    this._startedAt  = startedAt ?? new Date().toISOString();
    this._expectedEnd = item?.duration
      ? new Date(new Date(this._startedAt).getTime() + item.duration * 1000).toISOString()
      : null;
    return item ?? null;
  }

  /* ── Status ────────────────────────────────────────────── */

  /** Currently playing item. */
  get current()    { return this._currentIdx >= 0 ? (this._items[this._currentIdx] ?? null) : null; }

  /** Next item in queue. */
  get next()       { return this._items[this._currentIdx + 1] ?? null; }

  /** Whether the queue has more items after the current position. */
  get hasNext()    { return this._currentIdx < this._items.length - 1; }

  /** Whether the queue is empty (no items at all). */
  get isEmpty()    { return this._items.length === 0; }

  /** Queue depth (total items). */
  get depth()      { return this._items.length; }

  /** Current position index. */
  get position()   { return this._currentIdx; }

  /** Items remaining after current. */
  get remaining()  { return Math.max(0, this._items.length - this._currentIdx - 1); }

  /** ISO string of when current item started. */
  get startedAt()   { return this._startedAt; }

  /** ISO string of when current item is expected to end. */
  get expectedEnd() { return this._expectedEnd; }

  /**
   * Time remaining in current item (seconds).
   * Returns null if duration unknown.
   */
  get remainingSeconds() {
    if (!this._expectedEnd) return null;
    const rem = (new Date(this._expectedEnd).getTime() - Date.now()) / 1000;
    return Math.max(0, rem);
  }

  /**
   * Get a safe status snapshot.
   */
  getStatus() {
    return {
      depth:          this._items.length,
      position:       this._currentIdx,
      current:        this.current,
      next:           this.next,
      hasNext:        this.hasNext,
      startedAt:      this._startedAt,
      expectedEnd:    this._expectedEnd,
      remainingSeconds: this.remainingSeconds,
    };
  }

  /**
   * Get all items (snapshot, not live reference).
   */
  getAll() { return [...this._items]; }
}
