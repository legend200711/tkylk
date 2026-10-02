// ============================================================
// Privacy Learning Firewall
// CRITICAL SECURITY LAYER — Nothing may enter Global Learning
// without passing every check in this module.
//
// Uses layered detection: regex patterns, keyword matching,
// structural heuristics, and entropy analysis.
// When uncertain — REJECT. Never assume safe.
// ============================================================

// ── Layer 1: High-precision regex patterns ───────────────────
const PATTERNS = {
  // Government / national identifiers
  SSN:           /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,
  NIN:           /\b[A-Z]{2}\d{6}[A-D ]\b/i,          // UK NI
  PASSPORT:      /\bpassport\s*(?:no|number|#)?\s*[A-Z0-9]{6,12}\b/i,
  GOV_ID:        /\b(?:ssn|sin|nin|national\s+id|driver(?:'s)?\s+license|dl\s*#)\b/i,

  // Phone numbers (international-aware)
  PHONE:         /(?:\+?\d[\d\s\-().]{7,}\d|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/,

  // Email addresses
  EMAIL:         /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/,

  // Physical addresses
  ADDRESS:       /\b\d{1,6}\s+[A-Za-z0-9\s,.-]{4,50}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|blvd|boulevard|way|court|ct|place|pl)\b/i,
  ZIP_CODE:      /\b\d{5}(?:-\d{4})?\b/,
  POSTAL_CODE:   /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i,

  // Payment & financial
  CREDIT_CARD:   /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
  IBAN:          /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]{0,16})\b/i,
  BIC_SWIFT:     /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/i,
  ROUTING_NUM:   /\b(?:routing|aba|sort\s*code)\s*(?:no|number|#)?\s*\d{6,9}\b/i,
  ACCOUNT_NUM:   /\b(?:account|acct)\s*(?:no|number|#)?\s*\d{6,18}\b/i,

  // Authentication secrets
  PASSWORD_HINT: /\b(?:password|passwd|passphrase|secret|p@ss|pw)\s*[=:]\s*\S+/i,
  API_KEY:       /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[=:]\s*["']?[\w\-./+]{16,}["']?/i,
  JWT:           /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  BEARER_TOKEN:  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/i,
  AUTH_HEADER:   /(?:Authorization|X-Api-Key|X-Auth-Token)\s*:\s*\S+/i,

  // Firebase-specific
  FIREBASE_KEY:  /AIza[0-9A-Za-z\-_]{35}/,
  FIREBASE_URL:  /https:\/\/[a-z0-9-]+\.firebaseio\.com/i,
  FIREBASE_PROJ: /(?:projectId|storageBucket|messagingSenderId|appId)\s*[=:]\s*["']?[\w.\-]+["']?/i,

  // Cloudflare-specific
  CF_TOKEN:      /\b(?:cloudflare|cf)[_-]?(?:api[_-]?token|key|secret)\s*[=:]\s*\S+/i,
  CF_ACCT_ID:    /\b[0-9a-f]{32}\b/,   // 32-char hex (account IDs)
  R2_KEY:        /\b(?:r2|s3)[_-]?(?:access|secret)[_-]?key\s*[=:]\s*\S+/i,

  // AWS / cloud
  AWS_KEY:       /(?:AKIA|ASIA|AROA)[A-Z0-9]{16}/,
  AWS_SECRET:    /(?:aws|secret)[_-]?(?:access[_-]?)?key\s*[=:]\s*[A-Za-z0-9/+]{40}/i,

  // Private keys / certs
  PRIVATE_KEY:   /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY/i,
  CERT:          /-----BEGIN\s+CERTIFICATE/i,

  // Personal names in private context
  PERSONAL_PRON: /\b(?:my|i am|i'm|i work|i live|i own|i use|my name is|i'm called)\b/i,

  // Location data
  GPS:           /(?:lat(?:itude)?|lng|lon(?:gitude)?)\s*[=:,]\s*[-+]?\d{1,3}\.\d{4,}/i,
  COORDINATES:   /[-+]?\d{1,2}\.\d{5,}\s*,\s*[-+]?\d{1,3}\.\d{5,}/,

  // Passwords in text
  PASSWORD_TEXT: /\b(?:my password|the password|password is|login credentials?|access credentials?)\b/i,

  // Internal URLs
  INTERNAL_URL:  /https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|192\.168\.|10\.\d+\.|172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.)/i,
  PRIVATE_URL:   /https?:\/\/[a-z0-9-]+\.(?:internal|local|intranet|corp|private)\b/i,
};

// ── Layer 2: Keyword categories ───────────────────────────────
const KEYWORD_BLOCKS = {
  credentials: ["password", "passwd", "passphrase", "api key", "api secret", "secret key",
                 "access token", "auth token", "bearer token", "private key", "service account",
                 "token is", "token:", "credential is", "my token", "the token is"],
  financial:   ["bank account", "routing number", "account number", "credit card", "debit card",
                 "card number", "cvv", "sort code", "iban", "swift code", "financial account"],
  identity:    ["social security", "ssn", "national insurance", "nin", "passport number",
                 "driver license", "driver's license", "tax id", "national id", "birth certificate"],
  sensitive:   ["home address", "my address", "my phone", "my email", "phone number",
                 "personal email", "private email", "my location", "my house", "i live at"],
  infra:       ["firebase config", "firebase credentials", "cloudflare token", "r2 bucket",
                 "wrangler token", "workers token", "service worker key", "deployment key",
                 "private infrastructure", "internal api", "production secret"],
  personal:    ["my full name", "my real name", "my surname", "my date of birth", "my dob",
                 "my age is", "i am years old", "customer data", "employee data",
                 "patient data", "health information", "medical record"],
  business:    ["customer list", "client list", "employee list", "proprietary", "trade secret",
                 "confidential", "nda", "non-disclosure", "internal document", "private strategy"],
  source_code: ["private repository", "private repo", "source code", ".env file", "environment variable",
                 "config.json", "secrets.json", "credentials.json"]
};

// ── Layer 2b: Token/credential value pattern ──────────────────
// Catches "token is sk-abc123" style patterns after de-attribution
const TOKEN_VALUE_PATTERN = /\b(?:token|secret|key|credential|password)\s+(?:is|:)\s+[A-Za-z0-9_\-./+]{4,}/i;
const SHORT_TOKEN_PATTERN = /\b(?:sk|pk|tok|key|api)[-_][A-Za-z0-9_\-]{8,}/i;

// ── Layer 3: Entropy-based secret detection ───────────────────
function estimateEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  return Object.values(freq).reduce((H, f) => {
    const p = f / str.length;
    return H - p * Math.log2(p);
  }, 0);
}

function looksLikeHighEntropySecret(text) {
  // Look for tokens ≥24 chars with high entropy that look like secrets
  const candidates = text.match(/[A-Za-z0-9+/=_\-]{24,}/g) || [];
  for (const c of candidates) {
    if (estimateEntropy(c) > 4.2 && !/^[a-z]+$/.test(c) && !/^\d+$/.test(c)) {
      return true;
    }
  }
  return false;
}

// ── Layer 4: Personal name heuristic ─────────────────────────
function containsPersonalNameContext(text) {
  // "Chris said", "John told me", "Sarah's project" etc.
  // Match capitalized proper noun near possessive/verb
  return /\b[A-Z][a-z]{2,15}(?:'s| said| told| mentioned| wrote| asked| prefers| likes| uses| has| is)\b/.test(text);
}

// ── Main firewall function ────────────────────────────────────
/**
 * Scan text/data before it enters Global Learning.
 *
 * @param {string|object} input  - Text or object with concept/summary/fact fields
 * @returns {{ safe: boolean, reasons: string[], redacted: string|null }}
 */
export function firewallScan(input) {
  const text = typeof input === "string"
    ? input
    : [input.concept, input.summary, input.fact, input.detail].filter(Boolean).join(" ");

  const reasons = [];

  // ── Layer 1: Regex patterns ──────────────────────────────
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(text)) {
      reasons.push(`PATTERN:${name}`);
    }
  }

  // ── Layer 2: Keywords ────────────────────────────────────
  const lc = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(KEYWORD_BLOCKS)) {
    for (const kw of keywords) {
      if (lc.includes(kw)) {
        reasons.push(`KEYWORD:${cat}:${kw}`);
        break; // one reason per category is enough
      }
    }
  }

  // ── Layer 2b: Token/credential value pattern ─────────────
  if (TOKEN_VALUE_PATTERN.test(text) || SHORT_TOKEN_PATTERN.test(text)) {
    reasons.push("TOKEN_VALUE:credential-assignment");
  }

  // ── Layer 3: Entropy ─────────────────────────────────────
  if (looksLikeHighEntropySecret(text)) {
    reasons.push("ENTROPY:high-entropy-token");
  }

  // ── Layer 4: Personal name context ───────────────────────
  if (containsPersonalNameContext(text)) {
    reasons.push("NAME:personal-name-context");
  }

  // ── Layer 5: First-person statements ─────────────────────
  if (/\b(?:my|i am|i'm|i work|i live|i own|i have|my name)\b/i.test(text)) {
    reasons.push("PERSONAL:first-person");
  }

  // ── Layer 6: Explicit project / user attribution ──────────
  if (/\b(?:user [a-z0-9]+|operator [a-z0-9]+|uid:|user id:)/i.test(text)) {
    reasons.push("ATTRIBUTION:user-reference");
  }

  const safe = reasons.length === 0;

  // Produce a redacted version for audit logs (never stored globally)
  let redacted = null;
  if (!safe) {
    redacted = text
      .replace(PATTERNS.EMAIL, "[EMAIL]")
      .replace(PATTERNS.PHONE, "[PHONE]")
      .replace(PATTERNS.SSN, "[ID]")
      .replace(PATTERNS.CREDIT_CARD, "[CARD]")
      .replace(PATTERNS.FIREBASE_KEY, "[KEY]")
      .replace(PATTERNS.JWT, "[TOKEN]")
      .replace(PATTERNS.AWS_KEY, "[KEY]")
      .replace(PATTERNS.PRIVATE_KEY, "[PRIVATE-KEY]")
      .replace(/\b[A-Z][a-z]{2,15}(?='s| said| told| mentioned)/g, "[NAME]");
  }

  return { safe, blocked: !safe, reasons, redacted };
}

/**
 * Quick boolean check — use in hot paths.
 * @param {string|object} input
 * @returns {boolean} true = safe to consider for global learning
 */
export function isGlobalSafe(input) {
  return firewallScan(input).safe;
}

/**
 * Sanitize a candidate concept for global learning.
 * Removes first-person references and replaces names with generic terms.
 * Returns null if the concept cannot be safely generalized.
 *
 * @param {string} concept
 * @returns {string|null}
 */
export function sanitizeConcept(concept) {
  if (!concept) return null;

  let s = concept
    // Remove first-person ownership
    .replace(/\bmy\s+/gi, "a user's ")
    .replace(/\bi\s+(?:found|discovered|learned|noticed|realized)\b/gi, "it was found")
    .replace(/\bi\s+(?:am|was|have|had|use|used)\b/gi, "users")
    // Remove "Chris told me" etc.
    .replace(/\b[A-Z][a-z]{2,15}(?:'s| told| said| mentioned)\b/g, "")
    // Remove email-like patterns
    .replace(PATTERNS.EMAIL, "")
    // Remove URL credentials
    .replace(/(:\/\/[^@]+@)/g, "://")
    .trim();

  // If still fails after sanitize, reject
  if (!isGlobalSafe(s)) return null;
  if (s.length < 10) return null;

  return s;
}

/**
 * Validate a global learning candidate object.
 * Returns the candidate with a privacyScanStatus field set.
 *
 * @param {object} candidate
 * @returns {{ passed: boolean, candidate: object, scanResult: object }}
 */
export function validateCandidate(candidate) {
  const scanResult = firewallScan({
    concept: candidate.generalizedConcept || "",
    summary: candidate.summary || "",
    fact:    candidate.fact || ""
  });

  const passed = scanResult.safe;

  return {
    passed,
    candidate: {
      ...candidate,
      privacyScanStatus: passed ? "passed" : "rejected",
      privacyScanReasons: passed ? [] : scanResult.reasons,
      privacyScannedAt: new Date().toISOString()
    },
    scanResult
  };
}
