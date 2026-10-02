// ============================================================
// Privacy Engine
// Ensures private user data never leaks across user boundaries.
// Classifies and gates information access.
// ============================================================
import { PRIVACY_LEVELS } from "./memory-engine.js";

export class PrivacyEngine {
  constructor() {}

  // ── Classify a piece of information ──────────────────────
  classify(data) {
    const text = [
      data.fact || "",
      data.concept || "",
      data.detail || ""
    ].join(" ").toLowerCase();

    // Patterns that indicate private personal information
    const privatePatterns = [
      /my\s+(?:name|email|phone|address|password)/i,
      /i\s+(?:live|am|work|own)/i,
      /personal\s+(?:project|website|business)/i,
      /\b(?:uid|user\s+id|account)\b/i
    ];

    // Patterns that indicate project-scoped information
    const projectPatterns = [
      /shadow\s+(?:nexus|reaper|salem)/i,
      /aurenix|legend/i,
      /(?:my|our)\s+(?:app|website|platform)/i
    ];

    if (privatePatterns.some(p => p.test(text))) {
      return PRIVACY_LEVELS.PRIVATE;
    }
    if (projectPatterns.some(p => p.test(text))) {
      return PRIVACY_LEVELS.PROJECT;
    }
    // Technical facts without personal info could be general
    return PRIVACY_LEVELS.PRIVATE; // Default: always private unless explicitly general
  }

  // ── Filter memories for a specific user ──────────────────
  filterForUser(memories, uid) {
    // All memories loaded from Firebase are already scoped by UID via security rules.
    // This is an additional in-memory safety check.
    return memories.filter(m => !m.ownerUid || m.ownerUid === uid);
  }

  // ── Sanitize data before any potential sharing ────────────
  sanitize(data) {
    const sanitized = { ...data };
    // Remove any fields that might contain personal identifiers
    delete sanitized.uid;
    delete sanitized.email;
    delete sanitized.ownerUid;
    delete sanitized.sourceConvId;
    return sanitized;
  }

  // ── Check if knowledge can be promoted to general tier ───
  canPromoteToGeneral(knowledge) {
    if (knowledge.privacy === PRIVACY_LEVELS.PRIVATE) return false;
    // Only promote pure technical facts
    const privatePhrases = [
      "my ", "your ", "their ", "our ", "operator's", "user's",
      "shadow nexus", "shadow reaper", "aurenix", "legend"
    ];
    const text = (knowledge.fact || "").toLowerCase();
    return !privatePhrases.some(p => text.includes(p));
  }
}
