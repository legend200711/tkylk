/**
 * 24-HOUR CLOUD ENGINE — Destinations Registry Placeholder
 * cloud-engine/destinations/destinations.js
 *
 * Stage 1: Boundary definition only.
 * Stage 2 will implement stream destination management.
 *
 * SECURITY: Stream keys are NEVER stored in this module or returned
 * to browser JavaScript. The server-side Cloudflare Worker manages
 * the encrypted keys via Firestore cloud_stream_destinations (admin-only read).
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `Destinations.${m}() is not implemented in Stage 1.`,
});

export const Destinations = Object.freeze({
  async initialize()           { return _notImpl('initialize'); },
  async list()                 { return _notImpl('list'); },
  async get(id)                { return _notImpl('get'); },
  async add(data)              { return _notImpl('add'); },
  async remove(id)             { return _notImpl('remove'); },
  async setActive(id)          { return _notImpl('setActive'); },
  getActive()                  { return null; },
  async shutdown()             { return _notImpl('shutdown'); },
});
