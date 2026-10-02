/**
 * 24-HOUR CLOUD ENGINE — Playlist Manager
 * cloud-engine/tv-station/playlist-manager.js
 *
 * Manages TV station playlists.
 * A playlist is an ordered list of media items used as programming content.
 *
 * Operations:
 *   create, edit, delete playlist
 *   add, remove, reorder media items
 *   loop playlist
 *
 * Stage 10 — Optional TV Station Mode
 */

import { CloudEngineLogger }                              from '../logs/logger.js';
import { STATION_ERROR_CODE, StationError }               from './station-errors.js';

const MODULE = 'tv-station/playlist-manager';

/* ═══════════════════════════════════
   PLAYLIST CLASS
═══════════════════════════════════ */
export class Playlist {
  constructor({ playlistId, ownerId, title, description = '', loop = false }) {
    if (!playlistId) throw new StationError(STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM, 'playlistId required');
    if (!ownerId)    throw new StationError(STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM, 'ownerId required');
    if (!title)      throw new StationError(STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM, 'title required');

    this.playlistId  = playlistId;
    this.ownerId     = ownerId;
    this.title       = title;
    this.description = description;
    this.loop        = loop;
    this._items      = [];   // [{ mediaId, title, duration, addedAt }]
    this.createdAt   = new Date().toISOString();
    this.updatedAt   = new Date().toISOString();
  }

  /**
   * Add a media item to the playlist.
   * @param {{ mediaId: string, title: string, duration: number|null }} item
   */
  addItem(item) {
    if (!item?.mediaId) {
      throw new StationError(STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM, 'mediaId required');
    }
    this._items.push({
      mediaId:  item.mediaId,
      title:    item.title ?? 'Untitled',
      duration: item.duration ?? null,
      addedAt:  new Date().toISOString(),
    });
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Remove an item by mediaId.
   * @param {string} mediaId
   * @returns {boolean} removed
   */
  removeItem(mediaId) {
    const before = this._items.length;
    this._items  = this._items.filter(i => i.mediaId !== mediaId);
    this.updatedAt = new Date().toISOString();
    return this._items.length < before;
  }

  /**
   * Reorder items. Provide new order as array of mediaIds.
   * @param {string[]} orderedMediaIds
   */
  reorder(orderedMediaIds) {
    const byId = new Map(this._items.map(i => [i.mediaId, i]));
    const reordered = orderedMediaIds.map(id => byId.get(id)).filter(Boolean);
    // Preserve any items not in orderedMediaIds at the end
    const included = new Set(orderedMediaIds);
    const rest     = this._items.filter(i => !included.has(i.mediaId));
    this._items    = [...reordered, ...rest];
    this.updatedAt = new Date().toISOString();
  }

  /** Get all items (shallow copy). */
  getItems()  { return [...this._items]; }

  /** Item count. */
  get length() { return this._items.length; }

  /** Whether the playlist has content. */
  get isEmpty() { return this._items.length === 0; }

  /**
   * Get item at index, with loop wrap-around if loop=true.
   * @param {number} index
   * @returns {object|null}
   */
  getItemAt(index) {
    if (this._items.length === 0) return null;
    if (this.loop) {
      return this._items[index % this._items.length] ?? null;
    }
    return this._items[index] ?? null;
  }

  /** Get total playlist duration in seconds (null if any item has unknown duration). */
  get totalDuration() {
    if (this._items.some(i => i.duration === null)) return null;
    return this._items.reduce((sum, i) => sum + i.duration, 0);
  }

  toJSON() {
    return {
      playlistId:    this.playlistId,
      ownerId:       this.ownerId,
      title:         this.title,
      description:   this.description,
      loop:          this.loop,
      itemCount:     this._items.length,
      totalDuration: this.totalDuration,
      items:         this.getItems(),
      createdAt:     this.createdAt,
      updatedAt:     this.updatedAt,
    };
  }
}

/* ═══════════════════════════════════
   PLAYLIST MANAGER
═══════════════════════════════════ */
export class PlaylistManager {
  constructor() {
    this._playlists = new Map();   // playlistId → Playlist
  }

  /**
   * Create a new playlist.
   */
  create({ playlistId, ownerId, title, description, loop }) {
    if (this._playlists.has(playlistId)) {
      return { success: false, playlist: null,
               message: `Playlist "${playlistId}" already exists.`,
               code: STATION_ERROR_CODE.PLAYLIST_ALREADY_EXISTS };
    }
    try {
      const pl = new Playlist({ playlistId, ownerId, title, description, loop });
      this._playlists.set(playlistId, pl);
      CloudEngineLogger.info(MODULE, 'PLAYLIST_CREATED',
        `Playlist created: "${playlistId}" owner=${ownerId}`);
      return { success: true, playlist: pl };
    } catch (err) {
      return { success: false, playlist: null, message: err.message,
               code: STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM };
    }
  }

  /**
   * Get a playlist, enforcing ownership.
   * @param {string} playlistId
   * @param {string|null} [requesterId]  null = system access
   */
  get(playlistId, requesterId = null) {
    const pl = this._playlists.get(playlistId);
    if (!pl) {
      return { success: false, playlist: null,
               message: `Playlist "${playlistId}" not found.`,
               code: STATION_ERROR_CODE.PLAYLIST_NOT_FOUND };
    }
    if (requesterId !== null && pl.ownerId !== requesterId) {
      return { success: false, playlist: null, message: 'Access denied.',
               code: STATION_ERROR_CODE.ACCESS_DENIED };
    }
    return { success: true, playlist: pl };
  }

  /**
   * Update playlist metadata.
   */
  update(playlistId, { title, description, loop }, requesterId = null) {
    const r = this.get(playlistId, requesterId);
    if (!r.success) return r;
    if (title !== undefined)       r.playlist.title       = title;
    if (description !== undefined) r.playlist.description = description;
    if (loop !== undefined)        r.playlist.loop        = loop;
    r.playlist.updatedAt = new Date().toISOString();
    return { success: true, playlist: r.playlist };
  }

  /**
   * Delete a playlist.
   */
  delete(playlistId, requesterId = null) {
    const r = this.get(playlistId, requesterId);
    if (!r.success) return r;
    this._playlists.delete(playlistId);
    CloudEngineLogger.info(MODULE, 'PLAYLIST_DELETED', `Playlist deleted: "${playlistId}"`);
    return { success: true, message: `Playlist "${playlistId}" deleted.` };
  }

  /**
   * Add a media item to a playlist.
   */
  addItem(playlistId, item, requesterId = null) {
    const r = this.get(playlistId, requesterId);
    if (!r.success) return r;
    try {
      r.playlist.addItem(item);
      return { success: true, playlist: r.playlist };
    } catch (err) {
      return { success: false, message: err.message,
               code: STATION_ERROR_CODE.INVALID_PLAYLIST_ITEM };
    }
  }

  /**
   * Remove a media item from a playlist.
   */
  removeItem(playlistId, mediaId, requesterId = null) {
    const r = this.get(playlistId, requesterId);
    if (!r.success) return r;
    const removed = r.playlist.removeItem(mediaId);
    return { success: true, removed, playlist: r.playlist };
  }

  /**
   * Reorder playlist items.
   */
  reorder(playlistId, orderedMediaIds, requesterId = null) {
    const r = this.get(playlistId, requesterId);
    if (!r.success) return r;
    r.playlist.reorder(orderedMediaIds);
    return { success: true, playlist: r.playlist };
  }

  /**
   * Get all playlists for an owner.
   */
  getByOwner(ownerId) {
    return [...this._playlists.values()].filter(p => p.ownerId === ownerId);
  }

  /** Total playlist count. */
  get count() { return this._playlists.size; }
}
