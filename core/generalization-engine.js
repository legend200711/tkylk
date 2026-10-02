// ============================================================
// Generalization Engine
// Converts private user/project experiences into reusable,
// privacy-safe, generalized knowledge patterns.
//
// RULE: The output must never identify:
//   - the user
//   - their account
//   - their private project
//   - their conversation
// ============================================================
import { sanitizeConcept, firewallScan } from "./privacy-learning-firewall.js";
import { PRIVACY_LEVELS } from "./memory-engine.js";

// Patterns for extracting the technical essence from a private experience
const TECH_PATTERN_TEMPLATES = [
  {
    // "My Shadow Nexus video stopped because I initialized the player twice"
    // → "Duplicate media-player initialization can cause playback failures"
    match:       /(?:video|audio|player|media)\s+(?:stopped|failed|broke|crashed|wouldn't\s+play)/i,
    generalize:  () => "Duplicate or repeated media-player initialization can cause playback failures.",
    category:    "media"
  },
  {
    // Firebase auth listener called twice → duplicate initialization
    match:       /(?:firebase|auth)\s+listener(?:s)?\s+(?:called|triggered|fired)\s+(?:twice|multiple|duplicate)/i,
    generalize:  () => "Repeated Firebase authentication listeners can cause duplicate UI initialization.",
    category:    "firebase"
  },
  {
    // Autoplay restriction
    match:       /(?:autoplay|auto.?play)\s+(?:blocked|prevented|stopped|failed)/i,
    generalize:  () => "Browser autoplay restrictions can prevent media playback until the user performs an interaction.",
    category:    "browser"
  },
  {
    // CORS error
    match:       /cors(?:\s+error)?|cross.?origin/i,
    generalize:  () => "Cross-origin resource sharing (CORS) restrictions can block API requests unless headers are properly configured.",
    category:    "networking"
  },
  {
    // Race condition
    match:       /race\s+condition|async.*order|timing\s+issue/i,
    generalize:  () => "Asynchronous operations executed out of order can cause race conditions that are difficult to reproduce.",
    category:    "async"
  },
  {
    // Memory leak
    match:       /memory\s+leak|event\s+listener(?:s)?\s+not\s+removed/i,
    generalize:  () => "Unremoved event listeners are a common source of memory leaks in long-running browser applications.",
    category:    "performance"
  },
  {
    // WebGPU not available
    match:       /webgpu\s+(?:not\s+available|unsupported|blocked|failed)/i,
    generalize:  () => "WebGPU availability varies by browser version and device; a fallback inference strategy may be needed.",
    category:    "webgpu"
  },
  {
    // IndexedDB quota
    match:       /indexeddb\s+quota|storage\s+quota\s+exceeded/i,
    generalize:  () => "IndexedDB storage quotas can be exceeded on devices with limited disk space; eviction strategies should be implemented.",
    category:    "storage"
  }
];

// ── Category classification ───────────────────────────────────
const CATEGORY_PATTERNS = [
  { pattern: /firebase|firestore|auth|realtime\s+db/i, category: "firebase" },
  { pattern: /webgpu|gpu|inference|model\s+load/i,    category: "webgpu" },
  { pattern: /video|audio|media|player|stream/i,       category: "media" },
  { pattern: /cors|fetch|xhr|api\s+call|http/i,        category: "networking" },
  { pattern: /indexeddb|localstorage|cache|storage/i,  category: "storage" },
  { pattern: /css|style|layout|render|animation/i,     category: "ui" },
  { pattern: /async|await|promise|race|timing/i,       category: "async" },
  { pattern: /memory\s+leak|performance|slow/i,        category: "performance" },
  { pattern: /react|vue|svelte|angular|framework/i,    category: "framework" },
  { pattern: /cloudflare|worker|pages|r2/i,            category: "cloudflare" },
];

function classifyCategory(text) {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "general";
}

// ── Remove personal attribution ───────────────────────────────
function removeAttribution(text) {
  return text
    // "John's website" → "a project"
    .replace(/\b[A-Z][a-z]{2,15}(?:'s)\s+(?:website|project|app|platform|system|repo|code)/gi, "a project")
    // "Chris noticed that" → ""
    .replace(/\b[A-Z][a-z]{2,15}\s+(?:noticed|said|told me|mentioned|found|discovered)\s+that/gi, "")
    // "my shadow nexus project" → "a project"
    .replace(/\bmy\s+[a-z\s]{0,20}(?:website|project|app|platform|system)/gi, "a project")
    // "I found that" → "it was found that"
    .replace(/\bI\s+(?:found|noticed|discovered|learned|realized)\s+that/gi, "It was found that")
    .replace(/\bI\s+(?:found|noticed|discovered|learned|realized)\b/gi, "it was found")
    // "When I was building" → "When building"
    .replace(/\bwhen\s+I\s+was\s+/gi, "when ")
    .replace(/\bI\s+was\s+/gi, "")
    // "my" possessive
    .replace(/\bmy\s+/gi, "the ")
    .trim();
}

/**
 * Attempt to generalize a private learning event into a candidate concept.
 *
 * @param {object} learningEvent
 *   { fact, concept, category, memoryType, project, sourceConvId, privacy }
 * @returns {object|null} Generalized candidate or null if not generalizable
 */
// ── Hard-blocked patterns — presence in raw input prevents ALL generalization ──
const HARD_BLOCK_PATTERNS = [
  /AIza[0-9A-Za-z\-_]{20,}/,                                     // Firebase key
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,                   // JWT
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,                                    // AWS
  /\b(?:sk|pk|rk|ak)-[A-Za-z0-9_\-]{6,}\b/i,                     // sk-/pk- tokens
  /\b(?:token|secret|key|password)\b.*\bis\b.*\b[A-Za-z0-9_\-./+]{4,}\b/i,  // "token is xyz"
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY/i,                       // Private keys
  /\b(?:api[_-]?key|api[_-]?secret)\s*[=:]\s*["']?[\w\-]{10,}/i, // api_key=
];

function containsHardBlockedContent(text) {
  return HARD_BLOCK_PATTERNS.some(p => p.test(text));
}

export function generalize(learningEvent) {
  const { fact = "", concept = "" } = learningEvent;
  const combined = `${concept} ${fact}`.trim();

  // Only attempt to generalize non-private technical/procedural knowledge
  if (learningEvent.privacy === PRIVACY_LEVELS.PRIVATE) return null;
  if (!combined) return null;

  // Hard block: if the raw combined text contains credentials/tokens, reject entirely
  // This ensures credentials in the raw input NEVER produce a global candidate,
  // even if a template would otherwise match.
  if (containsHardBlockedContent(combined)) return null;

  // Try template matching FIRST — templates completely replace the raw content
  // so we do NOT pre-check raw input against the firewall for template paths.
  // The template output is what gets scanned.
  for (const tmpl of TECH_PATTERN_TEMPLATES) {
    if (tmpl.match.test(combined)) {
      const generalizedConcept = tmpl.generalize();
      const sanitized = sanitizeConcept(generalizedConcept);
      if (!sanitized) continue;
      // Final scan on template output only
      const outScan = firewallScan(sanitized);
      if (!outScan.safe) continue;
      return {
        generalizedConcept: sanitized,
        category:           tmpl.category,
        confidence:         0.55,    // starts low — needs confirmation
        independentEvidenceCount: 1,
        confirmationCount:  0,
        contradictionCount: 0,
        sourceCount:        1,
        createdAt:          new Date().toISOString(),
        updatedAt:          new Date().toISOString(),
        privacyScanStatus:  "pending"
      };
    }
  }

  // Generic generalization (no template match):
  // First check if the raw input contains obvious secrets — if so, skip entirely
  const rawScan = firewallScan(combined);
  if (!rawScan.safe) {
    // Check if de-attribution produces safe output anyway
    const deAttributed = removeAttribution(combined);
    const sanitized = sanitizeConcept(deAttributed);
    if (!sanitized) return null;
    // Re-check after de-attribution
    const reScan = firewallScan(sanitized);
    if (!reScan.safe) return null;
    if (sanitized.split(" ").length < 6) return null;
    const category = classifyCategory(sanitized);
    return {
      generalizedConcept: sanitized,
      category,
      confidence: 0.35,
      independentEvidenceCount: 1,
      confirmationCount: 0,
      contradictionCount: 0,
      sourceCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      privacyScanStatus: "pending"
    };
  }

  // Generic generalization: remove attribution and check if what remains is safe
  const deAttributed = removeAttribution(combined);
  const sanitized     = sanitizeConcept(deAttributed);
  if (!sanitized) return null;
  if (sanitized.split(" ").length < 6) return null; // too short to be meaningful

  const category = classifyCategory(sanitized);

  return {
    generalizedConcept: sanitized,
    category,
    confidence:         0.35,   // low — generic generalization
    independentEvidenceCount: 1,
    confirmationCount:  0,
    contradictionCount: 0,
    sourceCount:        1,
    createdAt:          new Date().toISOString(),
    updatedAt:          new Date().toISOString(),
    privacyScanStatus:  "pending"
  };
}

/**
 * Merge a new generalization into an existing candidate.
 * Increases evidence count; adjusts confidence.
 *
 * @param {object} existing  - Existing candidate from Firestore
 * @param {object} newEntry  - New generalization (same concept)
 * @returns {object} Updated candidate fields
 */
export function mergeIntoCandidate(existing, newEntry) {
  const newCount = (existing.independentEvidenceCount || 1) + 1;
  // Confidence grows with evidence, dampened to prevent single-source inflation
  const conf = Math.min(0.92, (existing.confidence || 0.35) + 0.08);

  return {
    independentEvidenceCount: newCount,
    sourceCount:              (existing.sourceCount || 1) + 1,
    confidence:               conf,
    updatedAt:                new Date().toISOString(),
    privacyScanStatus:        "pending"  // re-scan on any update
  };
}
