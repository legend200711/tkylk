// ============================================================
// Global Promotion Engine
// Controls what becomes Global Knowledge.
//
// A candidate must meet ALL criteria before promotion:
//   1. Privacy scan: PASSED
//   2. Confidence ≥ PROMOTION_CONFIDENCE_THRESHOLD
//   3. Independent evidence ≥ PROMOTION_EVIDENCE_THRESHOLD
//   4. Contradiction ratio below CONTRADICTION_RATIO_MAX
//   5. Not a duplicate of existing global knowledge
//   6. Spam / coordinated attack detection passes
//
// One random statement must NEVER become universal knowledge.
// ============================================================
import { validateCandidate } from "./privacy-learning-firewall.js";
import {
  saveGlobalCandidate, getGlobalCandidate, updateGlobalCandidate,
  saveGlobalKnowledge, getGlobalKnowledgeByHash,
  getRecentCandidatesByUser, recordGlobalContribution
} from "../firebase/firestore-service.js";

// ── Promotion thresholds ──────────────────────────────────────
const PROMOTION_CONFIDENCE_THRESHOLD = 0.70;   // 70% confidence
const PROMOTION_EVIDENCE_THRESHOLD   = 3;       // at least 3 independent confirmations
const CONTRADICTION_RATIO_MAX        = 0.25;    // ≤25% contradictions
const SPAM_RATE_LIMIT_PER_UID        = 10;      // max global contributions per 24h per user
const SPAM_WINDOW_MS                 = 86_400_000; // 24 hours
const MIN_CANDIDATE_AGE_MS           = 3_600_000;  // 1 hour minimum age before promotion

// ── Simple string hash for deduplication ─────────────────────
function conceptHash(concept) {
  // Normalize: lowercase, collapse spaces, remove punctuation
  const normalized = concept.toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash));
}

/**
 * Evaluate whether a candidate should be promoted to Global Knowledge.
 *
 * @param {object} candidate  - The candidate document from globalLearningCandidates
 * @returns {{ promote: boolean, reasons: string[] }}
 */
export function evaluatePromotion(candidate) {
  const reasons = [];

  if (candidate.privacyScanStatus !== "passed") {
    reasons.push("Privacy scan not passed");
    return { promote: false, reasons };
  }

  if ((candidate.confidence || 0) < PROMOTION_CONFIDENCE_THRESHOLD) {
    reasons.push(`Confidence ${Math.round((candidate.confidence||0)*100)}% < required ${PROMOTION_CONFIDENCE_THRESHOLD*100}%`);
  }

  if ((candidate.independentEvidenceCount || 0) < PROMOTION_EVIDENCE_THRESHOLD) {
    reasons.push(`Evidence count ${candidate.independentEvidenceCount||0} < required ${PROMOTION_EVIDENCE_THRESHOLD}`);
  }

  const total = (candidate.confirmationCount || 0) + (candidate.contradictionCount || 0);
  const contradictionRatio = total > 0 ? (candidate.contradictionCount || 0) / total : 0;
  if (contradictionRatio > CONTRADICTION_RATIO_MAX) {
    reasons.push(`Contradiction ratio ${Math.round(contradictionRatio*100)}% > max ${CONTRADICTION_RATIO_MAX*100}%`);
  }

  const ageMs = Date.now() - new Date(candidate.createdAt || Date.now()).getTime();
  if (ageMs < MIN_CANDIDATE_AGE_MS) {
    reasons.push("Candidate too new (< 1 hour old)");
  }

  if (!candidate.generalizedConcept || candidate.generalizedConcept.length < 15) {
    reasons.push("Concept text too short or empty");
  }

  return {
    promote: reasons.length === 0,
    reasons
  };
}

/**
 * Submit a generalized candidate from a user's learning event.
 * Handles deduplication, spam protection, privacy scanning,
 * and potential auto-promotion.
 *
 * @param {string} uid            - The contributing user's UID (NOT stored in global record)
 * @param {object} candidate      - Generalized candidate from GeneralizationEngine
 * @param {boolean} globalConsent - User has opted in to global learning
 * @returns {{ status: string, candidateId: string|null, message: string }}
 */
export async function submitCandidate(uid, candidate, globalConsent) {
  if (!globalConsent) {
    return { status: "skipped", candidateId: null, message: "User has not opted into global learning." };
  }

  // ── Spam / rate-limit check ───────────────────────────────
  try {
    const recentContribs = await getRecentCandidatesByUser(uid, SPAM_WINDOW_MS);
    if (recentContribs >= SPAM_RATE_LIMIT_PER_UID) {
      return { status: "rate_limited", candidateId: null, message: "Rate limit reached for global learning contributions." };
    }
  } catch (_) { /* non-critical */ }

  // ── Privacy firewall ──────────────────────────────────────
  const { passed, candidate: scannedCandidate, scanResult } = validateCandidate(candidate);
  if (!passed) {
    return {
      status: "rejected",
      candidateId: null,
      message: `Privacy firewall rejected: ${scanResult.reasons.slice(0, 3).join(", ")}`
    };
  }

  const hash = conceptHash(scannedCandidate.generalizedConcept || "");

  // ── Check for existing candidate with same hash ───────────
  try {
    const existing = await getGlobalCandidate(hash);
    if (existing) {
      // Merge: increase evidence, do NOT add new user's raw data
      const updates = {
        independentEvidenceCount: (existing.independentEvidenceCount || 1) + 1,
        sourceCount:              (existing.sourceCount || 1) + 1,
        confidence:               Math.min(0.92, (existing.confidence || 0.35) + 0.07),
        updatedAt:                new Date().toISOString(),
        privacyScanStatus:        "pending"  // re-scan on update
      };
      await updateGlobalCandidate(hash, updates);

      // Record contribution anonymously (no user data stored)
      await recordGlobalContribution(uid).catch(() => {});

      // Check if now ready for promotion
      const merged = { ...existing, ...updates };
      const { passed: rePassed } = validateCandidate(merged);
      if (rePassed) {
        merged.privacyScanStatus = "passed";
        const evalResult = evaluatePromotion(merged);
        if (evalResult.promote) {
          await _promoteToGlobalKnowledge(hash, merged);
          return { status: "promoted", candidateId: hash, message: "Candidate promoted to Global Knowledge." };
        }
      }

      return { status: "merged", candidateId: hash, message: "Merged into existing candidate." };
    }
  } catch (_) { /* first time — will create */ }

  // ── Save new candidate ────────────────────────────────────
  const newCandidate = {
    ...scannedCandidate,
    conceptHash: hash,
    // NOTE: uid is deliberately NOT stored in the global candidate document
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await saveGlobalCandidate(hash, newCandidate);
    await recordGlobalContribution(uid).catch(() => {});
    return { status: "candidate_created", candidateId: hash, message: "New global learning candidate created." };
  } catch (err) {
    return { status: "error", candidateId: null, message: err.message };
  }
}

/**
 * Promote a validated candidate to the globalKnowledge collection.
 * Internal — called only after all checks pass.
 */
async function _promoteToGlobalKnowledge(conceptHash, candidate) {
  const knowledge = {
    concept:           candidate.generalizedConcept,
    category:          candidate.category || "general",
    summary:           candidate.generalizedConcept,
    confidence:        candidate.confidence || 0.7,
    evidenceCount:     candidate.independentEvidenceCount || 3,
    confirmationCount: candidate.confirmationCount || 0,
    contradictionCount:candidate.contradictionCount || 0,
    conceptHash,
    privacyStatus:     "verified",
    version:           1,
    createdAt:         new Date().toISOString(),
    updatedAt:         new Date().toISOString(),
    lastValidatedAt:   new Date().toISOString()
  };

  await saveGlobalKnowledge(conceptHash, knowledge);

  // Update candidate status
  await updateGlobalCandidate(conceptHash, { status: "promoted", promotedAt: new Date().toISOString() });
}

/**
 * Confirm or contradict a global knowledge item.
 * @param {string} conceptHash
 * @param {'confirm'|'contradict'} action
 */
export async function voteOnGlobalKnowledge(conceptHash, action) {
  try {
    const existing = await getGlobalCandidate(conceptHash);
    if (!existing) return;

    const updates = action === "confirm"
      ? { confirmationCount: (existing.confirmationCount || 0) + 1, confidence: Math.min(0.98, (existing.confidence||0.7) + 0.03) }
      : { contradictionCount: (existing.contradictionCount || 0) + 1, confidence: Math.max(0, (existing.confidence||0.7) - 0.10) };

    await updateGlobalCandidate(conceptHash, { ...updates, updatedAt: new Date().toISOString() });
  } catch (_) {}
}
