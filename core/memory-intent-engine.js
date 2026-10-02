// ============================================================
// Memory Intent Engine — Integration A
// Detects explicit memory intentions from natural language,
// extracts WHAT should be remembered, checks for near-duplicates,
// and handles forget/recall/list/forget-all safely.
//
// Does NOT replace LearningAdapter's passive learning pipeline.
// This handles EXPLICIT user-directed memory operations only.
//
// Architecture:
//   USER MESSAGE
//     ↓
//   INTENT DETECTION (deterministic patterns + confidence)
//     ↓
//   CONTENT EXTRACTION (structured fact from raw text)
//     ↓
//   NEAR-DUPLICATE CHECK (semantic normalized comparison)
//     ↓
//   WRITE DECISION → MemoryEngine / ProjectBrain
//     ↓
//   NATURAL LANGUAGE CONFIRMATION → user
// ============================================================

import { MEMORY_TYPES, PRIVACY_LEVELS } from "./memory-engine.js";
import { firewallScan } from "./privacy-learning-firewall.js";

// ── Intent types ──────────────────────────────────────────
export const MEMORY_INTENT = {
  REMEMBER:   "REMEMBER",    // "Remember this", "Keep in mind..."
  RECALL:     "RECALL",      // "What did I tell you about..."
  SEARCH:     "SEARCH",      // "Find what I said about..."
  LIST:       "LIST",        // "What do you know about..."
  FORGET_ONE: "FORGET_ONE",  // "Forget that", "Remove that memory"
  FORGET_ALL: "FORGET_ALL",  // "Forget everything", "Clear all memories"
  NONE:       "NONE"         // Not a memory-directed message
};

// ── Duplicate classification ──────────────────────────────
export const DUPLICATE_CLASS = {
  NEW:           "NEW",           // No similar memory found
  DUPLICATE:     "DUPLICATE",     // Exact or near-exact match
  CONFIRMATION:  "CONFIRMATION",  // Restates existing with same meaning
  UPDATE:        "UPDATE",        // Same concept, new/different value
  CORRECTION:    "CORRECTION",    // Explicitly contradicts prior knowledge
  CONTRADICTION: "CONTRADICTION", // Implicitly contradicts
  SUPERSEDING:   "SUPERSEDING"    // Replaces prior with newer state
};

// ── Remember intent patterns ──────────────────────────────
const REMEMBER_PATTERNS = [
  /^remember\s+(?:this|that)\s*[.!]?\s*$/i,
  /^remember\s+(?:that\s+)?(.+)/i,
  /\bkeep\s+this\s+in\s+mind\b/i,
  /\bdon'?t\s+forget\s+(?:that\s+)?(.+)/i,
  /\bsave\s+this\s+for\s+later\b/i,
  /\bi\s+want\s+you\s+to\s+remember\b/i,
  /\bfrom\s+now\s+on[,\s]+(?:always\s+)?(.+)/i,
  /\bgoing\s+forward[,\s]+(.+)/i,
  /\bplease\s+(?:note|remember|keep\s+in\s+mind)\s+(?:that\s+)?(.+)/i,
  /\bnote\s+(?:that\s+)?(.+)/i,
  /\bjust\s+so\s+you\s+know[,\s]+(.+)/i,
  /\bfor\s+(?:future\s+reference|the\s+record)[,\s]+(.+)/i,
  /\bmake\s+a\s+note\s+(?:that\s+)?(.+)/i
];

// ── Recall intent patterns ────────────────────────────────
const RECALL_PATTERNS = [
  /\bwhat\s+did\s+i\s+(?:tell|say)\s+you\s+about\b/i,
  /\bdo\s+you\s+remember\b/i,
  /\bwhat\s+do\s+you\s+(?:know|remember)\s+about\b/i,
  /\bwhat\s+did\s+we\s+(?:decide|discuss|talk\s+about)\b/i,
  /\bwhat\s+was\s+that\s+(?:thing|idea|decision|feature)\s+(?:we|i)\s+(?:talked|mentioned|discussed)\b/i,
  /\bdidn'?t\s+i\s+(?:tell|say|mention)\s+you\b/i,
  /\bwhat'?s?\s+(?:that|the)\s+(?:thing|decision|plan)\s+(?:about|for|we)\b/i
];

// ── Search intent patterns ────────────────────────────────
const SEARCH_PATTERNS = [
  /\bfind\s+(?:what\s+i\s+said|what\s+we\s+discussed)\s+about\b/i,
  /\blook\s+(?:through|up)\s+(?:what\s+you\s+remember|your\s+memory)\s+(?:about|for)\b/i,
  /\bwhat\s+conversations?\s+did\s+we\s+have\s+about\b/i,
  /\bsearch\s+(?:your\s+)?(?:memory|memories|knowledge)\s+(?:for|about)\b/i
];

// ── List intent patterns ──────────────────────────────────
const LIST_PATTERNS = [
  /\bwhat\s+do\s+you\s+(?:know|remember)\s+about\s+(?:this\s+project|me|shadow\s+nexus|my\s+project)\b/i,
  /\bwhat\s+have\s+you\s+learned\s+about\s+me\b/i,
  /\bwhat\s+do\s+you\s+know\s+about\s+shadow\s+nexus\b/i,
  /\blist\s+(?:what\s+you\s+know|your\s+memories|everything\s+you\s+know)\b/i,
  /\bshow\s+me\s+(?:what\s+you\s+(?:know|remember))\b/i
];

// ── Forget-one intent patterns ────────────────────────────
const FORGET_ONE_PATTERNS = [
  /^forget\s+that\s*[.!]?\s*$/i,
  /\bforget\s+(?:that|this)\s*[.!]?\s*$/i,
  /\bdon'?t\s+remember\s+that\s+(?:anymore|any\s+more)\b/i,
  /\bremove\s+that\s+from\s+(?:your\s+)?memory\b/i,
  /\bi\s+don'?t\s+want\s+you\s+(?:keeping|to\s+keep)\s+that\b/i,
  /\bdelete\s+that\s+(?:from\s+your\s+)?memory\b/i,
  /\bwipe\s+that\b/i
];

// ── Forget-all intent patterns ────────────────────────────
const FORGET_ALL_PATTERNS = [
  /\bforget\s+everything\b/i,
  /\bclear\s+(?:all\s+)?(?:your\s+)?(?:memories|memory)\b/i,
  /\bwipe\s+(?:all\s+)?(?:your\s+)?(?:memories|memory|everything)\b/i,
  /\bstart\s+(?:completely\s+)?fresh\s+(?:with\s+no\s+memory|and\s+forget)\b/i,
  /\bdelete\s+all\s+(?:your\s+)?(?:memories|memory|data)\b/i,
  /\breset\s+(?:your\s+)?(?:memory|memories|everything)\b/i
];

// ── Common typo/speech correction table ──────────────────
// Only for clear, unambiguous corrections. Never for tech terms.
const TYPO_TABLE = {
  "remeber":    "remember",
  "rember":     "remember",
  "remembr":    "remember",
  "dont":       "don't",
  "wont":       "won't",
  "cant":       "can't",
  "didnt":      "didn't",
  "wasnt":      "wasn't",
  "doesnt":     "doesn't",
  "isnt":       "isn't",
  "youre":      "you're",
  "theyre":     "they're",
  "havent":     "haven't",
  "shouldnt":   "shouldn't",
  "couldnt":    "couldn't",
  "wouldnt":    "wouldn't",
  "teh":        "the",
  "taht":       "that",
  "hte":        "the",
  "nad":        "and",
  "fo":         "of",
  "ot":         "to",
  "wiht":       "with",
  "fro":        "for",
  "itss":       "its",
  "thsi":       "this",
  "waht":       "what",
  "proejct":    "project",
  "projcet":    "project",
  "firbase":    "firebase",
  "firebae":    "firebase",
  "firestor":   "firestore",
  "cloudflrare":"cloudflare",
  "cloudflar":  "cloudflare"
};

export class MemoryIntentEngine {
  constructor(memoryEngine, projectBrain, retrievalEngine, privacyEngine = null) {
    this._memory      = memoryEngine;
    this._projectBrain = projectBrain;
    this._retrieval   = retrievalEngine;
    this._privacy     = privacyEngine;

    // Pending forget-all state — two-step confirmation
    this._pendingForgetAll = false;
    this._pendingForgetAllTimestamp = 0;
    this._FORGET_ALL_WINDOW_MS = 60 * 1000; // 60-second window for confirmation
  }

  // ── Main entry point ──────────────────────────────────────
  // Returns null if no explicit memory intent detected.
  // Returns { intent, handled, confirmationMessage, recallResults } if handled.
  async process(userMessage, {
    allMemories    = [],
    allKnowledge   = [],
    activeProject  = null,
    conversationId = null,
    uid            = null
  } = {}) {
    const corrected = this._applyTypoCorrections(userMessage);
    const intent    = this.detectIntent(corrected);

    if (intent === MEMORY_INTENT.NONE) return null;

    switch (intent) {
      case MEMORY_INTENT.REMEMBER:
        return this._handleRemember(corrected, allMemories, allKnowledge, activeProject, conversationId);

      case MEMORY_INTENT.FORGET_ALL:
        return this._handleForgetAll(allMemories);

      case MEMORY_INTENT.FORGET_ONE:
        return this._handleForgetOne(corrected, allMemories, activeProject);

      case MEMORY_INTENT.RECALL:
      case MEMORY_INTENT.SEARCH:
        return this._handleRecall(corrected, allMemories, allKnowledge, activeProject);

      case MEMORY_INTENT.LIST:
        return this._handleList(corrected, allMemories, allKnowledge, activeProject);

      default:
        return null;
    }
  }

  // ── Detect memory intent ──────────────────────────────────
  detectIntent(msg) {
    if (!msg || typeof msg !== "string") return MEMORY_INTENT.NONE;

    if (FORGET_ALL_PATTERNS.some(p => p.test(msg)))  return MEMORY_INTENT.FORGET_ALL;
    if (FORGET_ONE_PATTERNS.some(p => p.test(msg)))  return MEMORY_INTENT.FORGET_ONE;
    if (REMEMBER_PATTERNS.some(p => p.test(msg)))    return MEMORY_INTENT.REMEMBER;
    // LIST before RECALL — LIST has more specific patterns that overlap with RECALL
    if (LIST_PATTERNS.some(p => p.test(msg)))        return MEMORY_INTENT.LIST;
    if (SEARCH_PATTERNS.some(p => p.test(msg)))      return MEMORY_INTENT.SEARCH;
    if (RECALL_PATTERNS.some(p => p.test(msg)))      return MEMORY_INTENT.RECALL;

    return MEMORY_INTENT.NONE;
  }

  // ── Apply typo corrections ────────────────────────────────
  _applyTypoCorrections(text) {
    if (!text) return text;
    // Word-boundary replacement only
    return text.replace(/\b([a-z]+)\b/gi, (match) => {
      const lower = match.toLowerCase();
      return TYPO_TABLE[lower] || match;
    });
  }

  // ── Extract the factual content from a remember request ───
  // Returns { concept, fact, project, temporalState, source }
  extractMemoryContent(msg, activeProject = null) {
    if (!msg) return null;

    // Remove the "remember" command prefix to isolate the content
    let content = msg
      .replace(/^(remember\s+that|remember\s+this:?\s*|please\s+note\s+that|don'?t\s+forget\s+that|note\s+that|keep\s+this\s+in\s+mind:?\s*|from\s+now\s+on[,\s]+|going\s+forward[,\s]+|make\s+a\s+note\s+that|just\s+so\s+you\s+know[,\s]+|for\s+(?:future\s+reference|the\s+record)[,\s]+)/i, "")
      .trim();

    if (!content || content.length < 3) return null;

    // Detect temporal state from content
    let temporalState = "CURRENT";
    if (/\bno\s+longer\b|\bremoved\b|\bdeprecated\b|\bdisabled\b|\bnot\s+(?:used|active|available)\b/i.test(content)) {
      temporalState = "REMOVED";
    } else if (/\bplanning\s+to\b|\bwill\s+be\b|\bin\s+the\s+future\b/i.test(content)) {
      temporalState = "PLANNED";
    }

    // Try to detect project from content if not passed
    let project = activeProject;
    if (!project && this._projectBrain) {
      const detected = this._projectBrain.identifyProject(content);
      if (detected) project = detected.id;
    }

    // Extract concept (subject) — look for named entities, project names, feature names
    let concept = null;

    // Pattern: "X uses Y" / "X is Y" / "X has Y" / "X no longer uses Y"
    const subjectMatch = content.match(/^([\w\s]{2,40})\s+(?:uses?|is|has|was|had|doesn'?t\s+use|no\s+longer\s+uses?|removed|uses?\s+no\s+longer)\b/i);
    if (subjectMatch) {
      concept = subjectMatch[1].trim();
    }

    // Fallback: first meaningful noun phrase
    if (!concept) {
      const nounMatch = content.match(/^(?:the\s+)?([\w\s]{2,40?}?)(?:\s+(?:is|are|was|uses?|has|doesn't|no\s+longer)\b|[.,])/i);
      if (nounMatch) concept = nounMatch[1].trim();
    }

    // Last fallback: first few words
    if (!concept) {
      concept = content.split(/\s+/).slice(0, 4).join(" ");
    }

    return {
      concept:       concept.slice(0, 80),
      fact:          content.slice(0, 300),
      project:       project || null,
      temporalState,
      source:        "explicit-remember"
    };
  }

  // ── Near-duplicate detection ──────────────────────────────
  // Returns { class, existingId?, existingMemory? }
  detectDuplicate(extracted, allMemories, allKnowledge) {
    if (!extracted) return { class: DUPLICATE_CLASS.NEW };

    const factNorm    = this._normalize(extracted.fact);
    const conceptNorm = this._normalize(extracted.concept);

    // Check memories
    for (const m of allMemories) {
      const mFactNorm    = this._normalize(m.fact || "");
      const mConceptNorm = this._normalize(m.concept || "");

      // Exact or near-exact duplicate
      if (factNorm === mFactNorm && factNorm.length > 10) {
        return { class: DUPLICATE_CLASS.DUPLICATE, existingId: m.id, existingMemory: m };
      }

      // Same concept — check if it's an update/correction/confirmation
      if (conceptNorm && mConceptNorm && this._tokenOverlap(conceptNorm, mConceptNorm) > 0.6) {
        const factOverlap = this._tokenOverlap(factNorm, mFactNorm);

        if (factOverlap > 0.8) {
          return { class: DUPLICATE_CLASS.CONFIRMATION, existingId: m.id, existingMemory: m };
        }

        // Check for negation/removal of existing fact
        const existingHasActive = /\buses?\b|\bis\b|\bare\b|\bhas\b/i.test(m.fact || "");
        const newHasRemoval     = /\bno\s+longer\b|\bremoved\b|\bdoesn'?t\s+use\b|\bnot\s+(?:used|active)\b/i.test(extracted.fact);
        if (existingHasActive && newHasRemoval) {
          return { class: DUPLICATE_CLASS.SUPERSEDING, existingId: m.id, existingMemory: m };
        }

        // Same concept, different fact = UPDATE
        if (factOverlap < 0.4) {
          return { class: DUPLICATE_CLASS.UPDATE, existingId: m.id, existingMemory: m };
        }

        return { class: DUPLICATE_CLASS.CONFIRMATION, existingId: m.id, existingMemory: m };
      }
    }

    // Check knowledge
    for (const k of allKnowledge) {
      const kFactNorm = this._normalize(k.fact || "");
      if (factNorm === kFactNorm && factNorm.length > 10) {
        return { class: DUPLICATE_CLASS.DUPLICATE, existingId: k.id, existingMemory: k };
      }
    }

    return { class: DUPLICATE_CLASS.NEW };
  }

  // ── Handle remember request ───────────────────────────────
  async _handleRemember(msg, allMemories, allKnowledge, activeProject, conversationId) {
    const extracted = this.extractMemoryContent(msg, activeProject);
    if (!extracted) {
      return {
        intent: MEMORY_INTENT.REMEMBER,
        handled: true,
        confirmationMessage: "What would you like me to remember? Please provide more detail.",
        stored: null,
        duplicateClass: null
      };
    }

    // Privacy firewall check
    const scan = firewallScan(extracted.fact);
    if (!scan.safe) {
      // Check if it's a credential/secret — block those but allow project facts
      const isCredential = scan.reasons.some(r =>
        r.includes("PATTERN:API_KEY") || r.includes("PATTERN:PASSWORD") ||
        r.includes("PATTERN:JWT") || r.includes("PATTERN:FIREBASE_KEY") ||
        r.includes("KEYWORD:credentials") || r.includes("ENTROPY")
      );
      if (isCredential) {
        return {
          intent: MEMORY_INTENT.REMEMBER,
          handled: true,
          confirmationMessage: "I can't store credentials or secrets in memory — that would be a security risk. For project configuration, I can remember general setup facts without sensitive values.",
          stored: null,
          duplicateClass: null,
          privacyBlocked: true
        };
      }
    }

    // Near-duplicate check
    const dupCheck = this.detectDuplicate(extracted, allMemories, allKnowledge);

    // Handle based on duplicate class
    if (dupCheck.class === DUPLICATE_CLASS.DUPLICATE) {
      return {
        intent: MEMORY_INTENT.REMEMBER,
        handled: true,
        confirmationMessage: `I already have that: "${(dupCheck.existingMemory?.fact || "").slice(0, 100)}". No change needed.`,
        stored: null,
        duplicateClass: DUPLICATE_CLASS.DUPLICATE,
        existingMemory: dupCheck.existingMemory
      };
    }

    if (dupCheck.class === DUPLICATE_CLASS.CONFIRMATION) {
      // Boost confidence on existing
      if (dupCheck.existingId && this._memory) {
        await this._memory.confirmMemory(dupCheck.existingId).catch(() => {});
      }
      return {
        intent: MEMORY_INTENT.REMEMBER,
        handled: true,
        confirmationMessage: `Got it — that confirms what I already knew: "${(dupCheck.existingMemory?.fact || "").slice(0, 100)}".`,
        stored: dupCheck.existingMemory,
        duplicateClass: DUPLICATE_CLASS.CONFIRMATION,
        existingMemory: dupCheck.existingMemory
      };
    }

    if (dupCheck.class === DUPLICATE_CLASS.SUPERSEDING || dupCheck.class === DUPLICATE_CLASS.UPDATE) {
      // Mark old memory as superseded
      if (dupCheck.existingId && this._memory) {
        await this._memory.contradictMemory(dupCheck.existingId, extracted.fact).catch(() => {});
      }
    }

    // Determine memory type
    let memoryType = MEMORY_TYPES.SEMANTIC;
    if (/\bprefer\b|\blike\s+it\s+when\b|\balways\s+want\b|\bstyle\b|\bformat\b/i.test(extracted.fact)) {
      memoryType = MEMORY_TYPES.PREFERENCE;
    }

    // Write to memory
    let stored = null;
    if (this._memory) {
      stored = await this._memory._storeMemory({
        memoryType,
        concept:      extracted.concept,
        category:     extracted.project ? "project-fact" : "general-fact",
        fact:         extracted.fact,
        project:      extracted.project || null,
        importance:   0.85,  // Explicit remember = high importance
        confidence:   0.90,  // Explicit = high confidence
        sourceConvId: conversationId || null,
        privacy:      PRIVACY_LEVELS.PRIVATE,
        tags:         ["explicit-remember"],
        knowledgeState: "FACT",
        temporalState:  extracted.temporalState || "CURRENT"
      }).catch(() => null);
    }

    // Also add to project brain if project detected
    if (extracted.project && this._projectBrain && stored) {
      const entry = {
        type:        "feature",
        title:       extracted.concept,
        content:     extracted.fact,
        confidence:  0.90,
        importance:  0.85,
        tags:        ["explicit-remember"],
        sourceConvId: conversationId || null,
        metadata:    { knowledgeState: "FACT", temporalState: extracted.temporalState || "CURRENT" }
      };
      await this._projectBrain.addEntry(extracted.project, entry).catch(() => {});
    }

    // Build natural confirmation
    const storageNote = stored ? "" : " (note: storage failed — I'll remember for this session)";
    let confirmation;
    if (dupCheck.class === DUPLICATE_CLASS.SUPERSEDING) {
      confirmation = `Updated — I've replaced the old information. I'll remember that ${extracted.fact.slice(0, 120)}.${storageNote}`;
    } else if (dupCheck.class === DUPLICATE_CLASS.UPDATE) {
      confirmation = `Got it — I've updated that. I'll remember that ${extracted.fact.slice(0, 120)}.${storageNote}`;
    } else {
      confirmation = `Got it — I'll remember that ${extracted.fact.slice(0, 120)}.${storageNote}`;
      if (extracted.project) {
        confirmation += ` (stored for ${extracted.project})`;
      }
    }

    return {
      intent: MEMORY_INTENT.REMEMBER,
      handled: true,
      confirmationMessage: confirmation,
      stored,
      duplicateClass: dupCheck.class,
      existingMemory: dupCheck.existingMemory || null
    };
  }

  // ── Handle forget-all request ─────────────────────────────
  _handleForgetAll(allMemories) {
    const now = Date.now();

    // Check if this is confirmation of a pending forget-all
    if (this._pendingForgetAll && (now - this._pendingForgetAllTimestamp) < this._FORGET_ALL_WINDOW_MS) {
      // Confirmed — caller must execute the deletion
      this._pendingForgetAll = false;
      return {
        intent:              MEMORY_INTENT.FORGET_ALL,
        handled:             true,
        requiresConfirmation: false,
        confirmed:           true,
        confirmationMessage: `Understood. Deleting all ${allMemories.length} memories. This cannot be undone.`,
        proceedWithDeletion: true
      };
    }

    // First time — require confirmation
    this._pendingForgetAll = true;
    this._pendingForgetAllTimestamp = now;

    const count = allMemories.length;
    return {
      intent:              MEMORY_INTENT.FORGET_ALL,
      handled:             true,
      requiresConfirmation: true,
      confirmed:           false,
      confirmationMessage: `⚠ This will permanently delete all ${count} stored memor${count === 1 ? "y" : "ies"}. This cannot be undone.\n\nSay "confirm forget everything" or "yes, forget all" to proceed, or anything else to cancel.`,
      proceedWithDeletion: false
    };
  }

  // ── Handle forget-one request ─────────────────────────────
  async _handleForgetOne(msg, allMemories, activeProject) {
    // Find most recent or most relevant memory to the current context
    const recent = allMemories
      .filter(m => activeProject ? m.project === activeProject : true)
      .sort((a, b) => {
        const ta = new Date(b.lastObserved || b.updatedAt || 0).getTime();
        const tb = new Date(a.lastObserved || a.updatedAt || 0).getTime();
        return ta - tb;
      })
      .slice(0, 1)[0];

    if (!recent) {
      return {
        intent: MEMORY_INTENT.FORGET_ONE,
        handled: true,
        confirmationMessage: "I don't have a specific memory to forget — I'm not sure which one you mean. Could you be more specific?",
        deleted: null
      };
    }

    if (this._memory) {
      await this._memory.deleteMemory(recent.id).catch(() => {});
    }

    return {
      intent: MEMORY_INTENT.FORGET_ONE,
      handled: true,
      confirmationMessage: `I've removed that memory: "${(recent.fact || recent.concept || "").slice(0, 100)}".`,
      deleted: recent
    };
  }

  // ── Handle recall/search request ─────────────────────────
  _handleRecall(msg, allMemories, allKnowledge, activeProject) {
    // Extract the search subject
    const subjectMatch = msg.match(
      /(?:about|for|regarding|of)\s+(.{3,80})$/i
    );
    const subject = subjectMatch?.[1]?.trim() || msg;

    const results = this._retrieval.retrieveRelevant(
      [...allMemories, ...allKnowledge],
      subject,
      { topN: 5, context: { project: activeProject } }
    );

    if (results.length === 0) {
      return {
        intent: MEMORY_INTENT.RECALL,
        handled: true,
        confirmationMessage: `I don't have any stored information about "${subject.slice(0, 60)}".`,
        recallResults: []
      };
    }

    const lines = results.map(r => `• ${r.concept}: ${(r.fact || "").slice(0, 120)}`).join("\n");
    return {
      intent: MEMORY_INTENT.RECALL,
      handled: true,
      confirmationMessage: `Here's what I remember about "${subject.slice(0, 60)}":\n\n${lines}`,
      recallResults: results
    };
  }

  // ── Handle list request ───────────────────────────────────
  _handleList(msg, allMemories, allKnowledge, activeProject) {
    const projectMemories = activeProject
      ? allMemories.filter(m => m.project === activeProject)
      : allMemories;

    if (projectMemories.length === 0 && allMemories.length === 0) {
      return {
        intent: MEMORY_INTENT.LIST,
        handled: true,
        confirmationMessage: "I don't have any stored memories yet.",
        recallResults: []
      };
    }

    const top = (activeProject ? projectMemories : allMemories)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 10);

    const projectNote = activeProject ? ` about "${activeProject}"` : "";
    const lines = top.map(m => `• ${m.concept}: ${(m.fact || "").slice(0, 100)}`).join("\n");
    return {
      intent: MEMORY_INTENT.LIST,
      handled: true,
      confirmationMessage: `Here's what I remember${projectNote}:\n\n${lines}${top.length < (activeProject ? projectMemories.length : allMemories.length) ? `\n\n(showing top ${top.length} of ${activeProject ? projectMemories.length : allMemories.length})` : ""}`,
      recallResults: top
    };
  }

  // ── Normalize text for comparison ─────────────────────────
  _normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Token overlap ratio ───────────────────────────────────
  _tokenOverlap(a, b) {
    const tokA = new Set(a.split(/\s+/).filter(w => w.length > 2));
    const tokB = new Set(b.split(/\s+/).filter(w => w.length > 2));
    if (tokA.size === 0) return 0;
    let overlap = 0;
    for (const t of tokA) { if (tokB.has(t)) overlap++; }
    return overlap / Math.max(tokA.size, tokB.size);
  }

  // ── Cancel pending forget-all if user says anything else ──
  cancelPendingForgetAll() {
    this._pendingForgetAll = false;
  }

  // ── Check if there's a pending forget-all awaiting confirm ─
  hasPendingForgetAll() {
    const now = Date.now();
    if (this._pendingForgetAll && (now - this._pendingForgetAllTimestamp) > this._FORGET_ALL_WINDOW_MS) {
      this._pendingForgetAll = false;
    }
    return this._pendingForgetAll;
  }
}
