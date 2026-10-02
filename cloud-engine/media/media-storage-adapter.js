/**
 * 24-HOUR CLOUD ENGINE — Media Storage Adapter
 * cloud-engine/media/media-storage-adapter.js
 *
 * Adapter pattern for cloud media storage.
 * The engine itself uses this adapter interface; actual storage
 * providers (local filesystem, Supabase, S3, etc.) plug in here.
 *
 * This keeps the engine from being tightly coupled to any one provider.
 *
 * Built-in adapter: LocalFileStorageAdapter — resolves storageRef as a
 *   local filesystem path. Suitable for development and testing.
 *
 * Production adapter: configure the SupabaseStorageAdapter or
 *   S3StorageAdapter by supplying it to MediaLibrary.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

import fs   from 'fs/promises';
import path from 'path';

import { MediaError, MEDIA_ERROR_CODE } from './media-errors.js';
import { CloudEngineLogger }            from '../logs/logger.js';

const MODULE = 'media/media-storage-adapter';

/* ═══════════════════════════════════
   BASE ADAPTER (interface)
═══════════════════════════════════ */
export class MediaStorageAdapter {
  get adapterName() { return 'base'; }

  /**
   * Resolve a storageRef to an accessible local path for ffprobe/ffmpeg.
   * For local storage: this is a no-op (returns the path directly).
   * For cloud storage: may download to a temp file and return that path.
   *
   * NEVER expose signed URLs or auth tokens to callers.
   *
   * @param {string} storageRef
   * @returns {Promise<{ success: boolean, localPath: string|null, message: string }>}
   */
  async resolveToLocalPath(storageRef) {
    throw new MediaError(MEDIA_ERROR_CODE.STORAGE_UNAVAILABLE,
      `${this.adapterName} does not implement resolveToLocalPath()`);
  }

  /**
   * Check if a storageRef is accessible.
   * @param {string} storageRef
   * @returns {Promise<{ exists: boolean, size: number|null }>}
   */
  async exists(storageRef) {
    throw new MediaError(MEDIA_ERROR_CODE.STORAGE_UNAVAILABLE,
      `${this.adapterName} does not implement exists()`);
  }

  /**
   * Clean up a temporary local file created by resolveToLocalPath().
   * @param {string} localPath
   * @returns {Promise<void>}
   */
  async releaseTempPath(localPath) {
    // No-op by default; override for cloud adapters that create temp files
  }
}

/* ═══════════════════════════════════
   LOCAL FILE ADAPTER
   Treats storageRef as a local filesystem path.
═══════════════════════════════════ */
export class LocalFileStorageAdapter extends MediaStorageAdapter {
  get adapterName() { return 'LocalFile'; }

  async resolveToLocalPath(storageRef) {
    if (!storageRef) {
      return { success: false, localPath: null, message: 'storageRef is required' };
    }
    const absPath = path.resolve(storageRef);
    try {
      await fs.access(absPath);
      return { success: true, localPath: absPath, message: 'Resolved to local path.' };
    } catch {
      return {
        success:   false,
        localPath: null,
        message:   `File not accessible at "${absPath}"`,
      };
    }
  }

  async exists(storageRef) {
    if (!storageRef) return { exists: false, size: null };
    const absPath = path.resolve(storageRef);
    try {
      const stat = await fs.stat(absPath);
      return { exists: true, size: stat.size };
    } catch {
      return { exists: false, size: null };
    }
  }
}

/* ═══════════════════════════════════
   EXTERNAL CLOUD ADAPTER STUB
   Returns NOT_CONFIGURED — production integrations plug in here.
   Does NOT expose any credentials.
═══════════════════════════════════ */
export class ExternalCloudStorageAdapter extends MediaStorageAdapter {
  constructor({ adapterName = 'ExternalCloud' } = {}) {
    super();
    this._adapterName = adapterName;
  }

  get adapterName() { return this._adapterName; }

  async resolveToLocalPath(storageRef) {
    CloudEngineLogger.warn(MODULE, 'EXTERNAL_CLOUD_NOT_CONFIGURED',
      `${this._adapterName} storage is not configured. storageRef="${storageRef}"`);
    return {
      success:   false,
      localPath: null,
      message:   `${this._adapterName} storage adapter is not configured. ` +
                 'Configure a storage adapter for cloud media access.',
    };
  }

  async exists(storageRef) {
    return { exists: false, size: null };
  }
}

/* ═══════════════════════════════════
   DEFAULT ADAPTER
═══════════════════════════════════ */
export const defaultStorageAdapter = new LocalFileStorageAdapter();
