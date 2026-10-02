/**
 * 24-HOUR CLOUD ENGINE — Playback Engine Placeholder
 * cloud-engine/playback/playback-engine.js
 *
 * Stage 1: Interface / contract only.
 * Stage 2 will implement continuous 24/7 media playback.
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `PlaybackEngine.${m}() is not implemented in Stage 1.`,
});

export const PlaybackEngine = Object.freeze({
  async initialize() { return _notImpl('initialize'); },
  async play(mediaItem) { return _notImpl('play'); },
  async stop() { return _notImpl('stop'); },
  async pause() { return _notImpl('pause'); },
  async resume() { return _notImpl('resume'); },
  async next() { return _notImpl('next'); },
  async previous() { return _notImpl('previous'); },
  getStatus() {
    return {
      state:        COMPONENT_STATUS.NOT_IMPLEMENTED,
      currentMedia: null,
      position:     null,
      duration:     null,
      note:         'Stage 2',
    };
  },
  async shutdown() { return _notImpl('shutdown'); },
});
