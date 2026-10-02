/**
 * 24-HOUR CLOUD ENGINE — Resume Controller
 * cloud-engine/hybrid/resume-controller.js
 *
 * Determines what the TV station should resume playing after a live
 * broadcast ends.
 *
 * Resume strategies:
 *   CURRENT_SCHEDULE (default):
 *     Calculate what SHOULD be airing right now according to the schedule.
 *     If live ran from 8:20–8:45 and Program B was scheduled 8:30–9:00,
 *     resume Program B at its schedule-correct point.
 *     The interrupted program is NOT automatically replayed.
 *
 *   RESUME_INTERRUPTED:
 *     Resume the program that was playing when live started,
 *     from its interrupted position if known.
 *
 *   NEXT_ITEM:
 *     Skip the interrupted program entirely and advance to the next
 *     scheduled or queued item.
 *
 * Stage 11 — Hybrid Mode
 */

import { CloudEngineLogger }        from '../logs/logger.js';
import { RESUME_STRATEGY }          from './hybrid-errors.js';

const MODULE = 'hybrid/resume-controller';

/* ═══════════════════════════════════
   RESUME CONTROLLER
═══════════════════════════════════ */
export class ResumeController {
  constructor() {
    // No state — this is a pure calculation component
  }

  /**
   * Determine what to resume after live ends.
   *
   * @param {object} params
   * @param {string}         params.strategy          RESUME_STRATEGY.*
   * @param {ScheduleManager} params.scheduleManager
   * @param {string}         params.stationId
   * @param {object|null}    params.interruptedProgram  State at live takeover
   * @param {number}         [params.atTime]           Current timestamp (default: now)
   * @returns {{ action: string, resumeTarget: object|null, rationale: string }}
   */
  determineResume({
    strategy = RESUME_STRATEGY.CURRENT_SCHEDULE,
    scheduleManager,
    stationId,
    interruptedProgram = null,
    atTime = Date.now(),
  }) {
    CloudEngineLogger.info(MODULE, 'RESUME_DETERMINATION',
      `Determining resume for station="${stationId}" strategy=${strategy} at ${new Date(atTime).toISOString()}`);

    switch (strategy) {
      case RESUME_STRATEGY.CURRENT_SCHEDULE:
        return this._resumeCurrentSchedule({ scheduleManager, stationId, atTime });

      case RESUME_STRATEGY.RESUME_INTERRUPTED:
        return this._resumeInterrupted({ interruptedProgram, scheduleManager, stationId, atTime });

      case RESUME_STRATEGY.NEXT_ITEM:
        return this._resumeNextItem({ scheduleManager, stationId, atTime });

      default:
        CloudEngineLogger.warn(MODULE, 'UNKNOWN_STRATEGY',
          `Unknown resume strategy "${strategy}". Falling back to CURRENT_SCHEDULE.`);
        return this._resumeCurrentSchedule({ scheduleManager, stationId, atTime });
    }
  }

  /* ── Strategy implementations ──────────────────────────── */

  _resumeCurrentSchedule({ scheduleManager, stationId, atTime }) {
    const { current, next } = scheduleManager.getCurrentAndNext(stationId, atTime);

    if (current) {
      const elapsed = scheduleManager.getElapsedInEntry(current, atTime);
      CloudEngineLogger.info(MODULE, 'RESUME_CURRENT_SCHEDULE',
        `Resuming current schedule: "${current.title}" ` +
        `(${elapsed.toFixed(1)}s into the program)`);
      return {
        action:       'RESUME_CURRENT_SCHEDULE',
        resumeTarget: { ...current, elapsedSec: elapsed },
        rationale:    `Schedule shows "${current.title}" should be airing now (${elapsed.toFixed(1)}s in).`,
      };
    }

    if (next) {
      CloudEngineLogger.info(MODULE, 'RESUME_UPCOMING',
        `No current program; next is "${next.title}" at ${next.startAt}`);
      return {
        action:       'WAIT_FOR_NEXT',
        resumeTarget: next,
        rationale:    `Gap in schedule. Next program: "${next.title}" at ${next.startAt}.`,
      };
    }

    return {
      action:       'NO_PROGRAMMING',
      resumeTarget: null,
      rationale:    'No scheduled content found at current time.',
    };
  }

  _resumeInterrupted({ interruptedProgram, scheduleManager, stationId, atTime }) {
    if (!interruptedProgram) {
      CloudEngineLogger.warn(MODULE, 'NO_INTERRUPTED_PROGRAM',
        'RESUME_INTERRUPTED requested but no interrupted program recorded. Falling back to schedule.');
      return this._resumeCurrentSchedule({ scheduleManager, stationId, atTime });
    }

    CloudEngineLogger.info(MODULE, 'RESUME_INTERRUPTED',
      `Resuming interrupted program: "${interruptedProgram.title}"`);

    return {
      action:       'RESUME_INTERRUPTED',
      resumeTarget: { ...interruptedProgram },
      rationale:    `Resuming interrupted program: "${interruptedProgram.title}".`,
    };
  }

  _resumeNextItem({ scheduleManager, stationId, atTime }) {
    const { next } = scheduleManager.getCurrentAndNext(stationId, atTime);

    if (next) {
      CloudEngineLogger.info(MODULE, 'RESUME_NEXT_ITEM',
        `Skipping to next item: "${next.title}" at ${next.startAt}`);
      return {
        action:       'SKIP_TO_NEXT',
        resumeTarget: next,
        rationale:    `Skipping to next scheduled item: "${next.title}".`,
      };
    }

    return {
      action:       'NO_PROGRAMMING',
      resumeTarget: null,
      rationale:    'No next scheduled item available.',
    };
  }
}
