/**
 * 24-HOUR CLOUD ENGINE — Ingest Validator
 * cloud-engine/ingest/ingest-validator.js
 *
 * Validates ingest source configurations before they are accepted.
 * Checks source type, file existence for MEDIA_FILE, and other constraints.
 *
 * Stage 5 — Live Input / Ingest
 */

import fs from 'fs/promises';
import path from 'path';
import { SOURCE_TYPE, SOURCE_TYPE_STATUS, IngestError, INGEST_ERROR_CODE } from './ingest-errors.js';

const MODULE = 'ingest/ingest-validator';

/* ═══════════════════════════════════
   SUPPORTED SOURCE CONFIG SHAPES
═══════════════════════════════════ */

/**
 * @typedef {object} IngestSourceConfig
 * @property {string}  sourceType    One of SOURCE_TYPE.*
 * @property {string}  [filePath]    Required for SOURCE_TYPE.MEDIA_FILE
 * @property {string}  [rtmpUrl]     Required for SOURCE_TYPE.RTMP_INPUT / EXTERNAL_ENCODER
 * @property {string}  [deviceId]    Required for CAMERA / MICROPHONE / CAMERA_MIC (future)
 * @property {string}  [sessionId]   Optional: caller-assigned session ID
 */

/**
 * Validate a source configuration object.
 * Throws IngestError if invalid.
 *
 * @param {IngestSourceConfig} config
 * @throws {IngestError}
 */
export function validateSourceConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new IngestError(
      INGEST_ERROR_CODE.SOURCE_INVALID,
      'Source config must be a non-null object.',
    );
  }

  if (!config.sourceType || !SOURCE_TYPE[config.sourceType]) {
    throw new IngestError(
      INGEST_ERROR_CODE.SOURCE_INVALID,
      `Invalid or missing sourceType: "${config.sourceType}". ` +
      `Valid types: ${Object.values(SOURCE_TYPE).join(', ')}`,
    );
  }

  const operability = SOURCE_TYPE_STATUS[config.sourceType];
  if (operability === 'NOT_IMPLEMENTED') {
    throw new IngestError(
      INGEST_ERROR_CODE.SOURCE_NOT_OPERATIONAL,
      `Source type "${config.sourceType}" is not implemented in this environment. ` +
      `Status: ${operability}`,
      { sourceType: config.sourceType, status: operability },
    );
  }

  // Source-type-specific validation
  switch (config.sourceType) {
    case SOURCE_TYPE.MEDIA_FILE:
      if (!config.filePath || typeof config.filePath !== 'string') {
        throw new IngestError(
          INGEST_ERROR_CODE.SOURCE_INVALID,
          'MEDIA_FILE source requires a non-empty filePath.',
        );
      }
      break;

    case SOURCE_TYPE.RTMP_INPUT:
    case SOURCE_TYPE.EXTERNAL_ENCODER:
      // ARCHITECTURE_READY — interface defined, but RTMP listener not yet running.
      // Accept config but note the state.
      break;
  }
}

/**
 * Validate that a media file exists and is accessible.
 * @param {string} filePath  Absolute path to the media file.
 * @throws {IngestError}
 */
export async function validateMediaFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new IngestError(INGEST_ERROR_CODE.SOURCE_INVALID, 'filePath must be a non-empty string.');
  }

  const resolved = path.resolve(filePath);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new IngestError(
        INGEST_ERROR_CODE.SOURCE_INVALID,
        `Path is not a regular file: "${path.basename(resolved)}"`,
        { filePath: path.basename(resolved) },
      );
    }
    if (stat.size === 0) {
      throw new IngestError(
        INGEST_ERROR_CODE.SOURCE_INVALID,
        `File is empty: "${path.basename(resolved)}"`,
        { filePath: path.basename(resolved) },
      );
    }
  } catch (err) {
    if (err instanceof IngestError) throw err;
    if (err.code === 'ENOENT') {
      throw new IngestError(
        INGEST_ERROR_CODE.SOURCE_NOT_FOUND,
        `Media file not found: "${path.basename(resolved)}"`,
        { filePath: path.basename(resolved) },
      );
    }
    throw new IngestError(
      INGEST_ERROR_CODE.SOURCE_INVALID,
      `Cannot access file "${path.basename(resolved)}": ${err.message}`,
    );
  }
}
