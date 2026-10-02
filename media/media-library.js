/**
 * 24-HOUR CLOUD ENGINE — Cloud Media Library
 * cloud-engine/media/media-library.js
 *
 * Replaces the Stage 1 placeholder with the real Cloud Media Library.
 *
 * The Media Library is an in-process registry of MediaItem objects.
 * Storage lives in a pluggable MediaStorageAdapter (default: local filesystem).
 *
 * Architecture:
 *   Creator → registerMedia() → MediaLibrary
 *   MediaLibrary → validateMediaItem() → MediaValidator
 *   MediaLibrary → resolveToLocalPath() → StorageAdapter
 *   MediaLibrary → createMediaPlaybackSource() → MediaPlaybackSource
 *     ↓
 *   Shadow Encoder → Fan-Out → Destinations
 *
 * Ownership isolation:
 *   Each media item has an ownerId.
 *   getItem(id, requesterId) enforces that requesterId === ownerId
 *   (or requesterId is null for system-level access).
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import { CloudEngineLogger }                              from '../logs/logger.js';
import { CloudEngineEventBus }                            from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }                            from '../core/events.js';
import { COMPONENT_STATUS }                               from '../core/state-manager.js';
import { createMediaItem, updateMediaItem,
         isMediaBroadcastReady }                          from './media-item.js';
import { validateMediaItem }                              from './media-validator.js';
import { MEDIA_ERROR_CODE, MEDIA_TYPE,
         MEDIA_VALIDATION_STATE, MediaError }             from './media-errors.js';
import { MediaPlaybackSource }                            from './media-playback-source.js';
import { defaultStorageAdapter }                          from './media-storage-adapter.js';
import { detectCodecEngine }                              from '../encoder/codec-adapter.js';

const MODULE = 'media/media-library';

/* ═══════════════════════════════════
   MEDIA LIBRARY CLASS
═══════════════════════════════════ */
export class CloudMediaLibrary {
  constructor(storageAdapter = defaultStorageAdapter) {
    this._items      = new Map();   // mediaId → MediaItem
    this._adapter    = storageAdapter;
    this._ffprobe    = null;        // Resolved at first use
    this._initialized = false;
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  async initialize() {
    if (this._initialized) return { success: true, message: 'Already initialized.' };

    // Resolve ffprobe path
    try {
      const codec = await detectCodecEngine();
      if (codec.found) {
        this._ffprobe = codec.ffprobePath;
        CloudEngineLogger.info(MODULE, 'MEDIA_LIBRARY_INIT',
          `Media Library initialized. ffprobe: ${this._ffprobe}`);
      } else {
        CloudEngineLogger.warn(MODULE, 'FFPROBE_UNAVAILABLE',
          'ffprobe not found — media validation will be limited.');
      }
    } catch {
      CloudEngineLogger.warn(MODULE, 'CODEC_DETECT_FAILED',
        'Could not detect ffprobe. Validation will be limited.');
    }

    this._initialized = true;
    return { success: true, message: 'Media Library initialized.' };
  }

  async shutdown() {
    this._items.clear();
    this._initialized = false;
    return { success: true, message: 'Media Library shut down.' };
  }

  /* ── Media Registration ─────────────────────────────────── */

  /**
   * Register a media item with the library.
   * Does NOT validate — call validateItem() separately.
   *
   * @param {object} params  MediaItem creation params
   * @returns {{ success: boolean, item: MediaItem|null, message: string }}
   */
  register(params) {
    try {
      const item = createMediaItem(params);
      if (this._items.has(item.mediaId)) {
        return {
          success: false, item: null,
          message: `Media item "${item.mediaId}" already registered.`,
          code:    MEDIA_ERROR_CODE.MEDIA_ALREADY_EXISTS,
        };
      }
      this._items.set(item.mediaId, item);
      CloudEngineLogger.info(MODULE, 'MEDIA_REGISTERED',
        `Media registered: "${item.mediaId}" (${item.type}) owner=${item.ownerId}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.MEDIA_LOADING,
        { mediaId: item.mediaId, type: item.type });
      return { success: true, item, message: 'Media item registered.' };
    } catch (err) {
      return { success: false, item: null, message: err.message,
               code: MEDIA_ERROR_CODE.INVALID_MEDIA_ITEM };
    }
  }

  /**
   * Validate a registered media item.
   * Updates the stored item with probe results and validation state.
   *
   * @param {string} mediaId
   * @returns {Promise<{ success: boolean, item: MediaItem, valid: boolean, issues: string[] }>}
   */
  async validateItem(mediaId) {
    const item = this._items.get(mediaId);
    if (!item) {
      return { success: false, item: null, valid: false,
               issues: [`Media item "${mediaId}" not found.`] };
    }

    const result = await validateMediaItem(item, this._ffprobe);
    this._items.set(mediaId, result.item);  // Store updated item
    return { success: true, item: result.item, valid: result.valid, issues: result.issues };
  }

  /**
   * Register AND validate in one step.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async registerAndValidate(params) {
    const reg = this.register(params);
    if (!reg.success) return reg;
    return this.validateItem(reg.item.mediaId);
  }

  /* ── Media Access ───────────────────────────────────────── */

  /**
   * Get a media item by ID.
   * Optionally enforces owner check.
   *
   * @param {string}      mediaId
   * @param {string|null} [requesterId]  Owner ID for auth check (null = system access)
   * @returns {{ success: boolean, item: MediaItem|null, message: string }}
   */
  getItem(mediaId, requesterId = null) {
    const item = this._items.get(mediaId);
    if (!item) {
      return { success: false, item: null, message: `Media item "${mediaId}" not found.`,
               code: MEDIA_ERROR_CODE.MEDIA_NOT_FOUND };
    }
    if (requesterId !== null && item.ownerId !== requesterId) {
      CloudEngineLogger.warn(MODULE, 'MEDIA_ACCESS_DENIED',
        `Requester "${requesterId}" denied access to media "${mediaId}" owned by "${item.ownerId}"`);
      return { success: false, item: null, message: 'Access denied.',
               code: MEDIA_ERROR_CODE.ACCESS_DENIED };
    }
    return { success: true, item };
  }

  /**
   * Get all media items owned by a user.
   * @param {string} ownerId
   * @returns {MediaItem[]}
   */
  getByOwner(ownerId) {
    return [...this._items.values()].filter(i => i.ownerId === ownerId);
  }

  /**
   * Get all validated + broadcast-ready items owned by a user.
   * @param {string} ownerId
   * @returns {MediaItem[]}
   */
  getReadyByOwner(ownerId) {
    return this.getByOwner(ownerId).filter(isMediaBroadcastReady);
  }

  /**
   * Get all items by type.
   * @param {string} type  MEDIA_TYPE.*
   * @returns {MediaItem[]}
   */
  getByType(type) {
    return [...this._items.values()].filter(i => i.type === type);
  }

  /**
   * Remove a media item.
   * @param {string} mediaId
   * @param {string} requesterId
   */
  remove(mediaId, requesterId) {
    const check = this.getItem(mediaId, requesterId);
    if (!check.success) return check;
    this._items.delete(mediaId);
    CloudEngineLogger.info(MODULE, 'MEDIA_REMOVED', `Media removed: "${mediaId}"`);
    return { success: true, message: `Media "${mediaId}" removed.` };
  }

  /** Total items registered. */
  getCount() { return this._items.size; }

  /** @returns {MediaItem[]} All registered items (system use only). */
  getAll() { return [...this._items.values()]; }

  /* ── Playback Source Creation ──────────────────────────── */

  /**
   * Create a MediaPlaybackSource for a media item.
   * Loads the item from storage and prepares it for encoding.
   *
   * @param {string}      mediaId
   * @param {string|null} [requesterId]
   * @returns {Promise<{ success: boolean, source: MediaPlaybackSource|null, message: string }>}
   */
  async createPlaybackSource(mediaId, requesterId = null) {
    const check = this.getItem(mediaId, requesterId);
    if (!check.success) {
      return { success: false, source: null, message: check.message, code: check.code };
    }

    if (!isMediaBroadcastReady(check.item)) {
      return {
        success: false, source: null,
        message: `Media "${mediaId}" is not broadcast-ready ` +
                 `(state: ${check.item.validationState}).`,
        code:    MEDIA_ERROR_CODE.NOT_PLAYABLE,
      };
    }

    const source = new MediaPlaybackSource(this._adapter);
    const loaded = await source.load(check.item);
    if (!loaded.success) {
      return { success: false, source: null, message: loaded.message, code: loaded.code };
    }

    return { success: true, source, message: 'Playback source created.' };
  }
}

/* ═══════════════════════════════════
   SHARED INSTANCE
═══════════════════════════════════ */
export { MEDIA_TYPE, MEDIA_VALIDATION_STATE, MEDIA_ERROR_CODE };
export const SharedMediaLibrary = new CloudMediaLibrary();
