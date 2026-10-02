// ============================================================
// Understanding Engine — Hybrid Adaptive Understanding
// Replaces pure-regex extraction with a hybrid pipeline:
//   1. Rule engine  (deterministic, fast)
//   2. Local model  (semantic analysis via existing ModelManager)
//   3. Schema validation  (never let model output corrupt DB)
//   4. Knowledge state classification
//
// Architecture:
//   USER MESSAGE
//     ↓
//   RULE ENGINE (deterministic)
//     ↓
//   LOCAL MODEL ANALYSIS (semantic, constrained prompt)
//     ↓
//   STRICT SCHEMA VALIDATION
//     ↓
//   CONFIDENCE CHECK
//     ↓
//   MEMORY WRITE DECISION
//     ↓
//   EXISTING LEARNING PIPELINE
// ============================================================

// ── Knowledge States ──────────────────────────────────────
export const KNOWLEDGE_STATE = {
  FACT:               "FACT",
  IDEA:               "IDEA",
  POSSIBILITY:        "POSSIBILITY",
  PLAN:               "PLAN",
  DECISION:           "DECISION",
  PREFERENCE:         "PREFERENCE",
  CORRECTION:         "CORRECTION",
  CURRENT:            "CURRENT",
  OUTDATED:           "OUTDATED",
  SUPERSEDED:         "SUPERSEDED",
  ABANDONED:          "ABANDONED",
  FAILED_APPROACH:    "FAILED_APPROACH",
  SUCCESSFUL_APPROACH:"SUCCESSFUL_APPROACH",
  UNRESOLVED:         "UNRESOLVED"
};

// ── Temporal states ───────────────────────────────────────
export const TEMPORAL_STATE = {
  CURRENT:   "CURRENT",
  PAST:      "PAST",
  PLANNED:   "PLANNED",
  PAUSED:    "PAUSED",
  REMOVED:   "REMOVED",
  ABANDONED: "ABANDONED",
  SUPERSEDED:"SUPERSEDED"
};

// ── Memory write decision tiers ───────────────────────────
export const WRITE_DECISION = {
  IGNORE:           "IGNORE",
  WORKING_ONLY:     "WORKING_ONLY",
  EPISODIC:         "EPISODIC",
  SEMANTIC:         "SEMANTIC",
  PROCEDURAL:       "PROCEDURAL",
  PREFERENCE:       "PREFERENCE",
  RELATIONSHIP:     "RELATIONSHIP",
  PROJECT_KNOWLEDGE:"PROJECT_KNOWLEDGE",
  MISTAKE_CORRECTION:"MISTAKE_CORRECTION"
};

// ── Conversation continuity signals ──────────────────────
// Detect vague follow-up references that need session context
export const CONTINUITY_PATTERNS = [
  /^(?:do\s+)?(?:that|it)\s*[.!]?\s*$/i,
  /^(?:use\s+(?:that|it|this|the\s+(?:first|second|third|last)\s+one))\s*[.!]?\s*$/i,
  /^go\s+back\s+to\s+(?:what\s+we\s+were\s+doing|that|the\s+other)\b/i,
  /^no,?\s+the\s+other\s+(?:one|website|project|option)\b/i,
  /\bthat\s+(?:didn'?t\s+work|worked|fixed\s+it)\s*[.!]?\s*$/i,
  /^remove\s+that\s+(?:instead|one|feature|option)\s*[.!]?\s*$/i,
  /^what\s+about\s+the\s+other\s+(?:idea|option|approach|one)\b/i
];

// ── Rule-based signal patterns ────────────────────────────

// IDEA / POSSIBILITY signals
const IDEA_PATTERNS = [
  /\bmaybe\s+(we\s+)?(?:could|should|can)\b/i,
  /\bwhat\s+if\s+(we|i)?\b/i,
  /\bthinking\s+about\s+add/i,
  /\bconsidering\s+/i,
  /\bit\s+might\s+be\s+(good|nice|cool|worth)/i,
  /\bpotentially\b/i,
  /\beventually\s+(we|i|it)\b/i,
  /\bwould\s+be\s+(cool|nice|good|great|interesting)\s+if\b/i,
  /\bthought\s+about\b/i
];

// DECISION / STRONG COMMITMENT signals
const DECISION_PATTERNS = [
  /\b(definitely|absolutely|yes,?\s+let'?s|let'?s\s+go\s+with)\b/i,
  /\bi\s+(?:definitely|absolutely)\s+want\b/i,
  /\bwe('re|\s+are)\s+going\s+(with|to\s+use)\b/i,
  /\bdecided\s+to\b/i,
  /\bgoing\s+with\b/i,
  /\byeah,?\s+let'?s\s+(definitely|add|do|use)\b/i,
  /\bi\s+want\s+(to\s+)?(add|use|include|build)\b/i
];

// REJECTION / REMOVAL / ABANDONMENT signals
const REJECTION_PATTERNS = [
  /\bnever\s+mind\b/i,
  /\bdon'?t\s+(want|need|do)\s+(it|that|this)\s+(anymore|any\s+more)\b/i,
  /\bremove[d]?\s+(the|that|this)?\s*\b/i,
  /\bactually\s+(never\s+mind|no|cancel)\b/i,
  /\bforget\s+(it|that|about)\b/i,
  /\bcancell?e?d?\b/i,
  /\bdrop(ping|ped)?\s+(the|that|this)?\s*\b/i,
  /\bi\s+removed\b/i,
  /\bno\s+longer\s+(want|need)\b/i,
  /\bdoesn'?t\s+belong\s+(in|to|there)\b/i
];

// HOLD / PAUSE signals
const HOLD_PATTERNS = [
  /\bput\s+(that|it|this)\s+on\s+hold\b/i,
  /\bhold\s+(that|it|this|off)\b/i,
  /\bpause\s+(that|it|this)\b/i,
  /\bnot\s+right\s+now\b/i,
  /\bmaybe\s+later\b/i,
  /\bdeferred?\b/i
];

// FAILED APPROACH signals
const FAILED_PATTERNS = [
  /\bwe\s+tried\s+(that|this)\s+(already|before)\b/i,
  /\btried\s+that\s+and\s+it\s+(didn'?t|does\s+not)\s+work\b/i,
  /\bthat\s+(approach|method|way)\s+didn'?t\s+(work|help)\b/i,
  /\balready\s+tried\b/i,
  /\bfailed\s+(before|already|approach)\b/i,
  /\bdidn'?t\s+work\b/i,
  /\b(kept|was)\s+causing\s+(conflicts?|errors?|issues?|problems?)\b/i
];

// SUCCESSFUL APPROACH signals
const SUCCESS_PATTERNS = [
  /\bthat\s+fixed\s+it\b/i,
  /\bthat\s+worked\b/i,
  /\bsolved\s+it\b/i,
  /\b(it'?s?\s+)?working\s+now\b/i
];

// CORRECTION signals
const CORRECTION_PATTERNS = [
  /\bi\s+was\s+wrong\s+(earlier|before|about)\b/i,
  /\bactually\s+it\s+(uses?|is|was|has)\b/i,
  /\bthat'?s\s+not\s+(right|correct|accurate)\b/i,
  /\bwrong\s+information\b/i,
  /\blet\s+me\s+correct\b/i,
  /\bgave\s+you\s+(the\s+wrong|wrong|incorrect)\b/i,
  /\bactually\s+uses?\b/i
];

// REASON / BECAUSE signals
const REASON_PATTERNS = [
  /\bbecause\s+(it|they|that)\b/i,
  /\bdue\s+to\b/i,
  /\bsince\s+(it|they)\b/i,
  /\bkept\s+causing\b/i,
  /\bwas\s+causing\b/i
];

// ── Structured analysis schema ────────────────────────────
const ANALYSIS_SCHEMA = {
  required: ["knowledgeState", "temporalState", "subject", "confidence", "writeDecision"],
  optional: ["project", "reason", "supersedes", "extractedFact", "isIdea", "isDecision",
             "isRemoval", "isFailed", "isCorrection", "isHold"]
};

export class UnderstandingEngine {
  constructor(modelManager = null) {
    this._model = modelManager;
    this._modelEnabled = false; // activated when model is online
  }

  // Called when model becomes available
  setModelReady(modelManager) {
    this._model = modelManager;
    this._modelEnabled = modelManager?.isOnline?.() === true;
  }

  updateModelState() {
    this._modelEnabled = this._model?.isOnline?.() === true;
  }

  // ── Check if message is a conversation continuity follow-up ──
  isContinuityFollowUp(userMessage) {
    if (!userMessage) return false;
    return CONTINUITY_PATTERNS.some(p => p.test(userMessage.trim()));
  }

  // ── Main analysis entry point ─────────────────────────────
  // Returns a validated UnderstandingResult
  async analyze(userMessage, {
    assistantResponse = "",
    conversationHistory = [],
    activeProject = null,
    knownProjects = [],
    sessionContext = null
  } = {}) {
    const result = this._ruleAnalysis(userMessage, assistantResponse, activeProject, sessionContext);

    // Attempt model-assisted semantic analysis when model is available
    // Only for complex statements where rules are uncertain
    if (this._modelEnabled && this._model && result.needsSemanticAnalysis) {
      try {
        const modelResult = await this._modelAnalysis(
          userMessage, assistantResponse, conversationHistory, activeProject, knownProjects
        );
        if (modelResult) {
          // Merge model result into rule result — model wins for semantic fields
          // but rule-based hard signals always override
          return this._mergeResults(result, modelResult, userMessage);
        }
      } catch (_) {
        // Model analysis is non-fatal — fall back to rule result
      }
    }

    return result;
  }

  // ── Rule-based analysis ───────────────────────────────────
  _ruleAnalysis(userMsg, assistantMsg, activeProject, sessionContext = null) {
    const isIdea       = IDEA_PATTERNS.some(p => p.test(userMsg));
    const isDecision   = DECISION_PATTERNS.some(p => p.test(userMsg));
    const isRejection  = REJECTION_PATTERNS.some(p => p.test(userMsg));
    const isHold       = HOLD_PATTERNS.some(p => p.test(userMsg));
    const isFailed     = FAILED_PATTERNS.some(p => p.test(userMsg));
    const isSuccess    = SUCCESS_PATTERNS.some(p => p.test(userMsg));
    const isCorrection = CORRECTION_PATTERNS.some(p => p.test(userMsg));
    const hasReason    = REASON_PATTERNS.some(p => p.test(userMsg));

    // Determine primary knowledge state
    let knowledgeState = KNOWLEDGE_STATE.FACT; // default for unqualified statements
    let temporalState  = TEMPORAL_STATE.CURRENT;
    let confidence     = 0.70;
    let isIdea_flag    = false;

    if (isCorrection) {
      knowledgeState = KNOWLEDGE_STATE.CORRECTION;
      temporalState  = TEMPORAL_STATE.CURRENT;
      confidence     = 0.90;
    } else if (isRejection) {
      knowledgeState = KNOWLEDGE_STATE.ABANDONED;
      temporalState  = TEMPORAL_STATE.REMOVED;
      confidence     = 0.85;
    } else if (isHold) {
      knowledgeState = KNOWLEDGE_STATE.PLAN;
      temporalState  = TEMPORAL_STATE.PAUSED;
      confidence     = 0.80;
    } else if (isFailed) {
      knowledgeState = KNOWLEDGE_STATE.FAILED_APPROACH;
      temporalState  = TEMPORAL_STATE.PAST;
      confidence     = 0.85;
    } else if (isSuccess) {
      knowledgeState = KNOWLEDGE_STATE.SUCCESSFUL_APPROACH;
      temporalState  = TEMPORAL_STATE.CURRENT;
      confidence     = 0.90;
    } else if (isDecision) {
      knowledgeState = KNOWLEDGE_STATE.DECISION;
      temporalState  = TEMPORAL_STATE.CURRENT;
      confidence     = 0.85;
    } else if (isIdea) {
      knowledgeState = KNOWLEDGE_STATE.IDEA;
      temporalState  = TEMPORAL_STATE.PLANNED;
      confidence     = 0.55; // Ideas are not facts
      isIdea_flag    = true;
    }

    // Extract reason if present
    let reason = null;
    const reasonMatch = userMsg.match(/(?:because|due to|since)\s+(.{5,100})/i);
    if (reasonMatch) reason = reasonMatch[1].trim();

    // Write decision based on knowledge state
    const writeDecision = this._determineWriteDecision(knowledgeState, confidence, userMsg);

    // Needs semantic analysis if message is complex/ambiguous
    const needsSemanticAnalysis =
      userMsg.length > 40 &&
      !isCorrection && !isRejection && !isHold && !isFailed && !isSuccess &&
      (isIdea || isDecision || hasReason || userMsg.length > 100);

    // Detect conversation continuity (vague pronoun follow-ups)
    const isContinuityFollowUp = CONTINUITY_PATTERNS.some(p => p.test(userMsg.trim()));

    // Enrich with session context when available (for pronoun resolution)
    let resolvedReferent = null;
    if (isContinuityFollowUp && sessionContext) {
      resolvedReferent = sessionContext.resolveReferent(userMsg);
    }

    return {
      knowledgeState,
      temporalState,
      confidence,
      reason,
      writeDecision,
      isIdea: isIdea_flag,
      isDecision,
      isRejection,
      isHold,
      isFailed,
      isSuccess,
      isCorrection,
      isContinuityFollowUp,
      resolvedReferent,
      needsSemanticAnalysis,
      project: activeProject,
      source:  "rule-engine",
      rawMessage: userMsg
    };
  }

  // ── Model-assisted semantic analysis ─────────────────────
  async _modelAnalysis(userMsg, assistantMsg, history, activeProject, knownProjects) {
    const projectList = knownProjects.map(p => p.name || p.id).slice(0, 8).join(", ");
    const recentHistory = history.slice(-4).map(m =>
      `${m.role === "user" ? "User" : "AI"}: ${(m.content || "").slice(0, 80)}`
    ).join("\n");

    const prompt = `Analyze this user message and return ONLY a JSON object with these exact fields.

User message: "${userMsg.slice(0, 300)}"
${activeProject ? `Active project: ${activeProject}` : ""}
${projectList ? `Known projects: ${projectList}` : ""}
${recentHistory ? `Recent context:\n${recentHistory}` : ""}

Return JSON only, no other text:
{
  "knowledgeState": one of [FACT, IDEA, POSSIBILITY, PLAN, DECISION, PREFERENCE, CORRECTION, ABANDONED, FAILED_APPROACH, SUCCESSFUL_APPROACH, UNRESOLVED],
  "temporalState": one of [CURRENT, PAST, PLANNED, PAUSED, REMOVED, ABANDONED, SUPERSEDED],
  "subject": "main topic/subject (max 50 chars)",
  "project": "project name if clearly stated, else null",
  "reason": "reason given by user if any, else null",
  "confidence": number 0.0-1.0,
  "writeDecision": one of [IGNORE, WORKING_ONLY, EPISODIC, SEMANTIC, PROCEDURAL, PREFERENCE, PROJECT_KNOWLEDGE, MISTAKE_CORRECTION],
  "extractedFact": "concise factual statement (max 150 chars)",
  "supersedes": "what this corrects/replaces if applicable, else null"
}`;

    const messages = [
      {
        role: "system",
        content: "You are a structured information extraction system. Return ONLY valid JSON. Never add explanation or prose."
      },
      { role: "user", content: prompt }
    ];

    let rawOutput = "";
    await this._model.generateStream(
      messages,
      { temperature: 0.1, maxTokens: 300 },
      (delta, acc) => { rawOutput = acc; },
      () => {}
    );

    return this._parseAndValidateModelOutput(rawOutput);
  }

  // ── Parse and strictly validate model JSON output ────────
  _parseAndValidateModelOutput(raw) {
    if (!raw || typeof raw !== "string") return null;

    // Extract JSON from response (model may add prose)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return null; // Malformed JSON — reject entirely
    }

    // Validate required fields
    for (const field of ANALYSIS_SCHEMA.required) {
      if (!(field in parsed)) return null;
    }

    // Validate enum values
    const validKS = Object.values(KNOWLEDGE_STATE);
    const validTS = Object.values(TEMPORAL_STATE);
    const validWD = Object.values(WRITE_DECISION);

    if (!validKS.includes(parsed.knowledgeState)) return null;
    if (!validTS.includes(parsed.temporalState))   return null;
    if (!validWD.includes(parsed.writeDecision))   return null;

    // Validate confidence range
    if (typeof parsed.confidence !== "number" ||
        parsed.confidence < 0 || parsed.confidence > 1) {
      return null;
    }

    // Sanitize string fields
    if (parsed.subject && typeof parsed.subject !== "string")    return null;
    if (parsed.project && typeof parsed.project !== "string")    return null;
    if (parsed.reason  && typeof parsed.reason  !== "string")    return null;
    if (parsed.extractedFact && typeof parsed.extractedFact !== "string") return null;

    // Truncate overly long strings for safety
    if (parsed.subject)       parsed.subject       = parsed.subject.slice(0, 100);
    if (parsed.project)       parsed.project       = parsed.project.slice(0, 100);
    if (parsed.reason)        parsed.reason        = parsed.reason.slice(0, 200);
    if (parsed.extractedFact) parsed.extractedFact = parsed.extractedFact.slice(0, 200);
    if (parsed.supersedes)    parsed.supersedes    = String(parsed.supersedes).slice(0, 200);

    parsed.source = "model+rules";
    return parsed;
  }

  // ── Merge rule result with model result ───────────────────
  _mergeResults(ruleResult, modelResult, userMsg) {
    if (!modelResult) return ruleResult;

    // Rule-based hard signals always win for core state detection
    const merged = { ...modelResult };

    // Rules override for clear deterministic signals
    if (ruleResult.isCorrection) {
      merged.knowledgeState = KNOWLEDGE_STATE.CORRECTION;
      merged.writeDecision  = WRITE_DECISION.MISTAKE_CORRECTION;
    }
    if (ruleResult.isRejection) {
      merged.knowledgeState = KNOWLEDGE_STATE.ABANDONED;
      merged.temporalState  = TEMPORAL_STATE.REMOVED;
    }
    if (ruleResult.isHold) {
      merged.temporalState = TEMPORAL_STATE.PAUSED;
    }
    if (ruleResult.isFailed) {
      merged.knowledgeState = KNOWLEDGE_STATE.FAILED_APPROACH;
    }
    if (ruleResult.isSuccess) {
      merged.knowledgeState = KNOWLEDGE_STATE.SUCCESSFUL_APPROACH;
    }

    // Critical: ideas must not become facts
    if (ruleResult.isIdea && merged.knowledgeState === KNOWLEDGE_STATE.FACT) {
      merged.knowledgeState = KNOWLEDGE_STATE.IDEA;
      merged.confidence = Math.min(merged.confidence, 0.65);
    }

    // Preserve rule-detected reason if model didn't find one
    if (!merged.reason && ruleResult.reason) {
      merged.reason = ruleResult.reason;
    }

    // Carry over rule flags
    merged.isIdea       = ruleResult.isIdea;
    merged.isDecision   = ruleResult.isDecision;
    merged.isRejection  = ruleResult.isRejection;
    merged.isHold       = ruleResult.isHold;
    merged.isFailed     = ruleResult.isFailed;
    merged.isSuccess    = ruleResult.isSuccess;
    merged.isCorrection = ruleResult.isCorrection;
    merged.rawMessage   = userMsg;
    merged.source       = "hybrid";

    return merged;
  }

  // ── Determine memory write decision ──────────────────────
  _determineWriteDecision(knowledgeState, confidence, userMsg) {
    // Never persist raw brainstorming as permanent fact
    if (knowledgeState === KNOWLEDGE_STATE.IDEA ||
        knowledgeState === KNOWLEDGE_STATE.POSSIBILITY) {
      return confidence > 0.6 ? WRITE_DECISION.EPISODIC : WRITE_DECISION.WORKING_ONLY;
    }

    if (knowledgeState === KNOWLEDGE_STATE.CORRECTION) {
      return WRITE_DECISION.MISTAKE_CORRECTION;
    }

    if (knowledgeState === KNOWLEDGE_STATE.PREFERENCE) {
      return WRITE_DECISION.PREFERENCE;
    }

    if (knowledgeState === KNOWLEDGE_STATE.FAILED_APPROACH ||
        knowledgeState === KNOWLEDGE_STATE.SUCCESSFUL_APPROACH) {
      return WRITE_DECISION.PROCEDURAL;
    }

    if (knowledgeState === KNOWLEDGE_STATE.DECISION ||
        knowledgeState === KNOWLEDGE_STATE.PLAN) {
      return WRITE_DECISION.PROJECT_KNOWLEDGE;
    }

    if (knowledgeState === KNOWLEDGE_STATE.ABANDONED) {
      return WRITE_DECISION.PROJECT_KNOWLEDGE; // preserve history
    }

    if (confidence < 0.35) return WRITE_DECISION.WORKING_ONLY;
    if (confidence < 0.50) return WRITE_DECISION.EPISODIC;

    // Short messages with no real content
    if (userMsg.length < 12 || /^(ok|okay|yes|no|sure|thanks|great|cool)$/i.test(userMsg.trim())) {
      return WRITE_DECISION.IGNORE;
    }

    return WRITE_DECISION.SEMANTIC;
  }

  // ── Format analysis for "Why?" transparency panel ────────
  formatForWhyPanel(analysis) {
    if (!analysis) return null;
    return {
      knowledgeState:        analysis.knowledgeState,
      temporalState:         analysis.temporalState,
      confidence:            Math.round((analysis.confidence || 0) * 100),
      source:                analysis.source || "rule-engine",
      isIdea:                analysis.isIdea || false,
      isDecision:            analysis.isDecision || false,
      isRejection:           analysis.isRejection || false,
      isFailed:              analysis.isFailed || false,
      isCorrection:          analysis.isCorrection || false,
      isContinuityFollowUp:  analysis.isContinuityFollowUp || false,
      resolvedReferent:      analysis.resolvedReferent || null,
      reason:                analysis.reason || null,
      writeDecision:         analysis.writeDecision,
      project:               analysis.project || null
    };
  }
}
