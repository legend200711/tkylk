/**
 * 24-HOUR CLOUD ENGINE — YouTube Connector Placeholder
 * cloud-engine/youtube/youtube-connector.js
 *
 * Stage 1: Boundary definition only.
 * Stage 2+ will implement YouTube Live Streaming API integration.
 *
 * SECURITY NOTES:
 *   - OAuth tokens and stream keys are NEVER stored client-side.
 *   - The YouTube stream key MUST only be handled in the server-side
 *     Cloudflare Worker (upload-worker or dedicated stream worker).
 *   - This module will never call YouTube APIs directly from the browser.
 *   - Token storage: Firestore cloud_stream_youtube_tokens/{uid}
 *     (security rules: isAdmin() only — already defined in tv/firestore.rules)
 *
 * Do NOT connect to YouTube during Stage 1.
 */

import { COMPONENT_STATUS } from '../core/state-manager.js';

const _notImpl = (m) => ({
  success: false,
  status:  COMPONENT_STATUS.NOT_IMPLEMENTED,
  message: `YouTubeConnector.${m}() is not implemented in Stage 1. Implement in Stage 2.`,
});

export const YouTubeConnector = Object.freeze({
  async initialize()              { return _notImpl('initialize'); },
  async connect()                 { return _notImpl('connect'); },
  async disconnect()              { return _notImpl('disconnect'); },
  async startBroadcast()          { return _notImpl('startBroadcast'); },
  async stopBroadcast()           { return _notImpl('stopBroadcast'); },
  async getBroadcastStatus()      { return _notImpl('getBroadcastStatus'); },
  getConnectionStatus()           {
    return {
      status:    COMPONENT_STATUS.NOT_IMPLEMENTED,
      connected: false,
      note:      'Stage 2 — no YouTube connection in Stage 1.',
    };
  },
  async shutdown()                { return _notImpl('shutdown'); },
});
