/**
 * 24-HOUR CLOUD ENGINE — Queue Engine Placeholder
 * cloud-engine/queue/queue-engine.js
 *
 * Stage 1: Boundary definition only.
 * Stage 2 will implement the priority queue for scheduled media playback.
 *
 * The queue is backed by Firestore cloud_stream_playlist collection
 * (security rules already defined in tv/firestore.rules).
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `QueueEngine.${m}() is not implemented in Stage 1.`,
});

export const QueueEngine = Object.freeze({
  async initialize()             { return _notImpl('initialize'); },
  async enqueue(item)            { return _notImpl('enqueue'); },
  async dequeue()                { return _notImpl('dequeue'); },
  async peek()                   { return _notImpl('peek'); },
  async remove(itemId)           { return _notImpl('remove'); },
  async reorder(fromIdx, toIdx)  { return _notImpl('reorder'); },
  async clear()                  { return _notImpl('clear'); },
  getLength()                    { return 0; },
  getItems()                     { return []; },
  async shutdown()               { return _notImpl('shutdown'); },
});
