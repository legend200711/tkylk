/**
 * 24-HOUR CLOUD ENGINE — Programming Scheduler Placeholder
 * cloud-engine/scheduler/scheduler.js
 *
 * Stage 1: Boundary definition only.
 * Stage 2 will implement time-based scheduling using the
 * cloud_stream_schedules Firestore collection.
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `ProgrammingScheduler.${m}() is not implemented in Stage 1.`,
});

export const ProgrammingScheduler = Object.freeze({
  async initialize()                    { return _notImpl('initialize'); },
  async start()                         { return _notImpl('start'); },
  async stop()                          { return _notImpl('stop'); },
  async getCurrentSlot()                { return _notImpl('getCurrentSlot'); },
  async getNextSlot()                   { return _notImpl('getNextSlot'); },
  async loadSchedule(scheduleId)        { return _notImpl('loadSchedule'); },
  async createSlot(data)                { return _notImpl('createSlot'); },
  async removeSlot(slotId)              { return _notImpl('removeSlot'); },
  isRunning()                           { return false; },
  async shutdown()                      { return _notImpl('shutdown'); },
});
