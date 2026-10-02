/**
 * 24-HOUR CLOUD ENGINE — Fallback Programming Placeholder
 * cloud-engine/fallback/fallback.js
 *
 * Stage 1: Boundary definition only.
 * Stage 3 will implement fallback media (static slate, test card, etc.)
 * that plays when the main broadcast pipeline fails.
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `FallbackProgramming.${m}() is not implemented in Stage 1. Implement in Stage 3.`,
});

export const FallbackProgramming = Object.freeze({
  async initialize()          { return _notImpl('initialize'); },
  async activate(reason)      { return _notImpl('activate'); },
  async deactivate()          { return _notImpl('deactivate'); },
  isActive()                  { return false; },
  getStatus()                 {
    return {
      active: false,
      reason: null,
      status: COMPONENT_STATUS.NOT_IMPLEMENTED,
      note:   'Stage 3',
    };
  },
  async shutdown()            { return _notImpl('shutdown'); },
});
