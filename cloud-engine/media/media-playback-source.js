/**
 * 24-HOUR CLOUD ENGINE — Media Playback Source
 * cloud-engine/media/media-playback-source.js
 *
 * Converts a validated MediaItem into an input source for the Shadow Encoder.
 *
 * Supported source types:
 *   VIDEO   → resolved local path passed to Shadow Encoder as input
 *   AUDIO   → audio-only file; a black video frame is added as required
 *             by video destinations
 *   IMAGE   → still image is converted to a timed video source using
 *             ffmpeg (not passed as-is — images are not video streams)
 *   PROGRAM, CLIP, BUMPER, STATION_ID → same as VIDEO
 *
 * The playback source resolves the media and prepares it for encoding.
 * It does NOT start encoding — that belongs to the Shadow Encoder.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import { CloudEngineLogger }              from '../logs/logger.js';
import { MEDIA_TYPE, MEDIA_ERROR_CODE,
         MEDIA_VALIDATION_STATE }         from './media-errors.js';
import { MediaError }                     from './media-errors.js';
import { defaultStorageAdapter }          from './media-storage-adapter.js';
import { isMediaBroadcastReady }          from './media-item.js';

const MODULE = 'media/media-playback-source';

/* ═══════════════════════════════════
   PLAYBACK SOURCE STATES
═══════════════════════════════════ */
export const PLAYBACK_SOURCE_STATE = Object.freeze({
  IDLE:     'IDLE',
  LOADING:  'LOADING',
  READY:    'READY',
  ERROR:    'ERROR',
});

/* ═══════════════════════════════════
   MEDIA PLAYBACK SOURCE
═══════════════════════════════════ */
export class MediaPlaybackSource {
  constructor(storageAdapter = defaultStorageAdapter) {
    this._adapter = storageAdapter;
    this._state   = PLAYBACK_SOURCE_STATE.IDLE;
    this._item    = null;
    this._localPath = null;
    this._tempPath  = null;    // Set if adapter created a temp file
  }

  get state()      { return this._state; }
  get localPath()  { return this._localPath; }
  get mediaItem()  { return this._item; }

  /**
   * Load a media item and prepare it for encoding.
   * Resolves the storage reference to a local path.
   *
   * @param {MediaItem} item   A validated MediaItem
   * @returns {Promise<{ success: boolean, localPath: string|null, message: string }>}
   */
  async load(item) {
    if (!item) {
      this._state = PLAYBACK_SOURCE_STATE.ERROR;
      return { success: false, localPath: null, message: 'item is required' };
    }

    if (!isMediaBroadcastReady(item)) {
      const reason = item.validationState !== MEDIA_VALIDATION_STATE.VALID
        ? `Media is not valid (state: ${item.validationState})`
        : 'Media storageRef is missing';
      this._state = PLAYBACK_SOURCE_STATE.ERROR;
      CloudEngineLogger.warn(MODULE, 'MEDIA_NOT_READY',
        `[${item.mediaId}] ${reason}`);
      return {
        success:   false,
        localPath: null,
        message:   reason,
        code:      MEDIA_ERROR_CODE.NOT_PLAYABLE,
      };
    }

    this._state = PLAYBACK_SOURCE_STATE.LOADING;
    this._item  = item;

    const resolved = await this._adapter.resolveToLocalPath(item.storageRef);
    if (!resolved.success) {
      this._state = PLAYBACK_SOURCE_STATE.ERROR;
      CloudEngineLogger.warn(MODULE, 'STORAGE_RESOLVE_FAILED',
        `[${item.mediaId}] Cannot resolve storageRef: ${resolved.message}`);
      return {
        success:   false,
        localPath: null,
        message:   resolved.message,
        code:      MEDIA_ERROR_CODE.STORAGE_READ_FAILED,
      };
    }

    this._localPath = resolved.localPath;
    this._state     = PLAYBACK_SOURCE_STATE.READY;

    CloudEngineLogger.info(MODULE, 'PLAYBACK_SOURCE_READY',
      `[${item.mediaId}] Playback source ready. type=${item.type} path=${this._localPath}`);

    return {
      success:   true,
      localPath: this._localPath,
      mediaType: item.type,
      duration:  item.duration,
      message:   'Playback source ready.',
    };
  }

  /**
   * Get the encoder input specification for this source.
   * VIDEO/PROGRAM/CLIP/BUMPER/STATION_ID → use the file directly
   * IMAGE → use as still image source (ffmpeg handles it)
   * AUDIO → use audio file (caller must add visual source separately)
   *
   * @returns {{ inputPath: string, mediaType: string, isImage: boolean, isAudioOnly: boolean }|null}
   */
  getEncoderInput() {
    if (this._state !== PLAYBACK_SOURCE_STATE.READY || !this._localPath) return null;
    return {
      inputPath:    this._localPath,
      mediaType:    this._item?.type ?? null,
      isImage:      this._item?.type === MEDIA_TYPE.IMAGE,
      isAudioOnly:  this._item?.type === MEDIA_TYPE.AUDIO &&
                    !this._item?.hasVideo,
      duration:     this._item?.duration ?? null,
    };
  }

  /**
   * Release this playback source and clean up temp files if any.
   */
  async release() {
    if (this._tempPath) {
      await this._adapter.releaseTempPath(this._tempPath).catch(() => {});
      this._tempPath = null;
    }
    this._localPath = null;
    this._item      = null;
    this._state     = PLAYBACK_SOURCE_STATE.IDLE;
  }
}
