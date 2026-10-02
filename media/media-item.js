/**
 * 24-HOUR CLOUD ENGINE — Media Item
 * cloud-engine/media/media-item.js
 *
 * Represents a single media item in the Cloud Media Library.
 * Tracks all metadata relevant for broadcasting.
 *
 * Media items are immutable once created — use MediaLibrary to
 * update them by creating a new version.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import { MEDIA_TYPE, MEDIA_VALIDATION_STATE } from './media-errors.js';

/* ═══════════════════════════════════
   MEDIA ITEM FACTORY
═══════════════════════════════════ */

/**
 * Create a new MediaItem.
 *
 * @param {object} params
 * @param {string} params.mediaId         Unique identifier
 * @param {string} params.ownerId         Owner user ID
 * @param {string} params.title           Human-readable title
 * @param {string} params.type            MEDIA_TYPE.*
 * @param {string} params.storageRef      Storage reference (path or URL reference — no credentials)
 * @param {object} [params.metadata]      Optional additional metadata
 * @returns {MediaItem}
 */
export function createMediaItem({ mediaId, ownerId, title, type, storageRef, metadata = {} }) {
  if (!mediaId)   throw new Error('mediaId is required');
  if (!ownerId)   throw new Error('ownerId is required');
  if (!title)     throw new Error('title is required');
  if (!type)      throw new Error('type is required');
  if (!storageRef) throw new Error('storageRef is required');

  return Object.freeze({
    // Identity
    mediaId,
    ownerId,
    title,
    type,

    // Storage
    storageRef,    // reference key / path — NOT a signed URL, NOT credentials

    // Video metadata (populated by MediaValidator)
    duration:      metadata.duration    ?? null,   // seconds (float)
    fileSize:      metadata.fileSize    ?? null,   // bytes
    mimeType:      metadata.mimeType    ?? null,   // e.g. 'video/mp4'
    container:     metadata.container   ?? null,   // e.g. 'mp4'
    videoCodec:    metadata.videoCodec  ?? null,   // e.g. 'h264'
    audioCodec:    metadata.audioCodec  ?? null,   // e.g. 'aac'
    width:         metadata.width       ?? null,
    height:        metadata.height      ?? null,
    fps:           metadata.fps         ?? null,
    sampleRate:    metadata.sampleRate  ?? null,
    hasVideo:      metadata.hasVideo    ?? false,
    hasAudio:      metadata.hasAudio    ?? false,

    // Validation
    validationState: metadata.validationState ?? MEDIA_VALIDATION_STATE.UNVALIDATED,
    validationError: metadata.validationError ?? null,

    // Timestamps
    createdAt:     metadata.createdAt   ?? new Date().toISOString(),
    validatedAt:   metadata.validatedAt ?? null,
  });
}

/**
 * Return a copy of a MediaItem with updated fields.
 * @param {MediaItem} item
 * @param {object} updates
 * @returns {MediaItem}
 */
export function updateMediaItem(item, updates) {
  return Object.freeze({ ...item, ...updates });
}

/**
 * Check if a media item is ready for broadcast.
 * @param {MediaItem} item
 * @returns {boolean}
 */
export function isMediaBroadcastReady(item) {
  return item.validationState === MEDIA_VALIDATION_STATE.VALID &&
         item.storageRef      !== null;
}
