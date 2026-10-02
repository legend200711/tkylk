// ============================================================
// Curiosity Engine
// Evaluates knowledge gaps before answering.
// When critical information is missing and existing memory
// cannot resolve the ambiguity, formulates one smart question
// rather than inventing an answer.
// ============================================================

// ── Gap severity levels ───────────────────────────────────
export const GAP_SEVERITY = {
  CRITICAL: "critical",   // Cannot answer meaningfully without this
  MODERATE: "moderate",   // Answer quality would improve significantly
  MINOR:    "minor"       // Nice to know but not required
};

// ── Patterns that signal ambiguity or missing context ─────
const AMBIGUOUS_REFERENTS = [
  /\bthe (stream|video|channel|tv|feed|player)\b/i,
  /\bthe (app|site|website|project|system|service)\b/i,
  /\bmy (app|site|project|system|service|stream)\b/i,
  /\bit (stopped?|broke|failed|crashed|won't|isn't|doesn't)\b/i,
  /\b(stopped?|broke|failed|crashed) (working|again|suddenly)\b/i,
  /\bthe (error|issue|bug|problem)\b/i
];

const MISSING_PROJECT_INDICATORS = [
  /\b(it|this|that|the app|the site|the stream|the system)\b.*(stopped?|broken|failing|not working|black screen|error)/i,
  /\b(not working|doesn't work|stopped working|broken again)\b/i
];

export class CuriosityEngine {
  constructor(projectBrain, mistakeMemory, confidenceEngine) {
    this._projectBrain   = projectBrain;
    this._mistakeMemory  = mistakeMemory;
    this._confidence     = confidenceEngine;
  }

  // ── Main: evaluate a message for knowledge gaps ──────────
  // Returns { shouldAsk: bool, question: string|null, gaps: Array, analysis: Object }
  async evaluate(userMessage, {
    activeProject   = null,
    relevantMemories = [],
    relevantKnowledge = [],
    relevantMistakes = [],
    projectBrainEntries = [],
    conversationHistory = [],
    sessionContext  = null    // Integration A: SessionContext for pronoun resolution
  } = {}) {
    const gaps = [];

    // ── 1. Project identification gap ────────────────────────
    if (!activeProject) {
      const ambiguous = MISSING_PROJECT_INDICATORS.some(p => p.test(userMessage));
      const hasSig    = AMBIGUOUS_REFERENTS.some(p => p.test(userMessage));

      if (ambiguous || hasSig) {
        // Integration A: Check session context first (may have active project)
        const sessionProject = sessionContext?.getActiveProject();
        if (sessionProject) {
          // Session context resolves it — no need to ask
        } else {
          // Check if conversation history resolves it
          const historyResolvesProject = this._historyContainsProject(conversationHistory);

          if (!historyResolvesProject) {
            const knownNames = this._projectBrain
              ? this._projectBrain.getKnownProjects().map(p => p.name)
              : [];

            gaps.push({
              severity: GAP_SEVERITY.CRITICAL,
              type:     "unknown-project",
              question: knownNames.length > 0
                ? `Which project is this for? (${knownNames.slice(0, 4).join(", ")}?)`
                : "Which project are you referring to?",
              reason:   "Cannot retrieve targeted project knowledge without knowing the project."
            });
          }
        }
      }
    }

    // ── 2. Technical specificity gap ─────────────────────────
    if (activeProject || gaps.length === 0) {
      const streamQuery = /\b(stream|tv|channel|video|player|feed)\b/i.test(userMessage);
      if (streamQuery && !activeProject) {
        // Do we have multiple stream-related entries across projects?
        const memoryHasStream = relevantMemories.some(m =>
          /stream|tv|channel|video/i.test((m.fact || "") + (m.concept || ""))
        );

        if (!memoryHasStream) {
          gaps.push({
            severity: GAP_SEVERITY.MODERATE,
            type:     "stream-type-unknown",
            question: "Is this the live stream, the 24-hour TV system, or another video component?",
            reason:   "Stream type affects which knowledge is applicable."
          });
        }
      }
    }

    // ── 3. Error details gap ──────────────────────────────────
    const mentionsError = /\b(error|crash|exception|failed|failing|broken)\b/i.test(userMessage);
    const hasErrorDetail = /\b(error:?|exception:?|message:?|log:?)\s*[`"']?[\w\s]{5,}/i.test(userMessage);

    if (mentionsError && !hasErrorDetail && gaps.length === 0) {
      // Only ask for error details if memories don't contain a known recent error
      const memoryHasRecentError = relevantMemories.some(m =>
        m.category === "problem" &&
        (Date.now() - new Date(m.lastObserved || m.createdAt || 0).getTime()) < 7 * 86400000
      );

      if (!memoryHasRecentError && projectBrainEntries.length === 0) {
        gaps.push({
          severity: GAP_SEVERITY.MODERATE,
          type:     "missing-error-detail",
          question: "What error message or behavior are you seeing?",
          reason:   "Error details would allow more targeted diagnosis."
        });
      }
    }

    // ── 3b. Integration A: Ambiguous pronoun/referent in follow-up ──
    // "Remove that feature" when multiple features are active
    const isReferentAmbiguous = /\b(that|it|this)\s+(feature|fix|change|option|one|approach|thing)\b/i.test(userMessage);
    if (isReferentAmbiguous && sessionContext) {
      const referent = sessionContext.resolveReferent(userMessage);
      // If session context resolves the referent clearly, no need to ask
      // If not resolved and multiple options exist, ask
      if (!referent) {
        const recentFeatures = sessionContext._recentObjects?.features || [];
        if (recentFeatures.length > 1) {
          gaps.push({
            severity: GAP_SEVERITY.CRITICAL,
            type:     "ambiguous-referent",
            question: `Which one do you mean? Recent options: ${recentFeatures.slice(-3).join(", ")}`,
            reason:   "Multiple recent items — cannot determine which one you mean."
          });
        }
      }
    }

    // ── 4. Contradiction in available knowledge ───────────────
    if (relevantMistakes.length > 0 && relevantKnowledge.length > 0) {
      // Check if any knowledge directly contradicts a past mistake lesson
      const contradiction = this._detectKnowledgeContradiction(
        relevantMistakes, relevantKnowledge
      );
      if (contradiction) {
        gaps.push({
          severity: GAP_SEVERITY.MODERATE,
          type:     "contradictory-knowledge",
          question: null,  // Internal note, not asked to user
          reason:   `Contradictory knowledge detected: ${contradiction}`,
          internal: true
        });
      }
    }

    // ── 5. Determine whether to ask ───────────────────────────
    // Only ask if there is a CRITICAL gap with no resolution in memory
    const criticalGaps = gaps.filter(g => g.severity === GAP_SEVERITY.CRITICAL && !g.internal);
    const shouldAsk    = criticalGaps.length > 0;

    // Pick the single most important question (CRITICAL first, then MODERATE)
    const questionableGaps = gaps.filter(g => g.question && !g.internal);
    const topGap           = questionableGaps[0] || null;

    return {
      shouldAsk,
      question:     topGap?.question || null,
      gaps,
      analysis: {
        projectKnown:       !!activeProject,
        memoriesFound:      relevantMemories.length,
        knowledgeFound:     relevantKnowledge.length,
        mistakesFound:      relevantMistakes.length,
        brainEntriesFound:  projectBrainEntries.length,
        hasContradiction:   gaps.some(g => g.type === "contradictory-knowledge"),
        criticalGapCount:   criticalGaps.length
      }
    };
  }

  // ── Build a curiosity question message ───────────────────
  buildClarificationResponse(question, analysis) {
    let response = question;

    // Add context about what IS known if helpful
    if (analysis.memoriesFound > 0 || analysis.knowledgeFound > 0) {
      const total = analysis.memoriesFound + analysis.knowledgeFound;
      response += `\n\n(I have ${total} relevant ${total === 1 ? "record" : "records"} that may apply once I know more.)`;
    }

    return response;
  }

  // ── Format gap analysis for the "Why?" panel ──────────────
  formatAnalysis(evaluation) {
    const { analysis, gaps } = evaluation;
    const lines = [];

    lines.push(`Project identified: ${analysis.projectKnown ? "Yes" : "No"}`);
    lines.push(`Memories found: ${analysis.memoriesFound}`);
    lines.push(`Knowledge found: ${analysis.knowledgeFound}`);
    lines.push(`Past mistakes found: ${analysis.mistakesFound}`);
    lines.push(`Project brain entries: ${analysis.brainEntriesFound}`);

    if (gaps.length > 0) {
      lines.push("\nKnowledge gaps:");
      for (const g of gaps) {
        lines.push(`  [${g.severity.toUpperCase()}] ${g.type}: ${g.reason}`);
      }
    }

    return lines.join("\n");
  }

  // ── Record that curiosity detected a gap ─────────────────
  async recordGapEvent(uid, { query, gaps, projectId, conversationId }) {
    // Fire-and-forget — just for dashboard stats
    if (!uid) return;
    try {
      const { saveCuriosityEvent } = await import("../firebase/firestore-service.js");
      await saveCuriosityEvent(uid, {
        query:          query?.slice(0, 200),
        gapTypes:       gaps.map(g => g.type),
        projectId:      projectId || null,
        conversationId: conversationId || null,
        createdAt:      new Date().toISOString()
      });
    } catch (_) {}
  }

  // ── Private: check conversation history for project name ─
  _historyContainsProject(history) {
    if (!history || history.length === 0) return false;
    const recentText = history
      .slice(-6)
      .map(m => m.content || "")
      .join(" ")
      .toLowerCase();

    const knownProjects = this._projectBrain?.getKnownProjects() || [];
    return knownProjects.some(p =>
      p.aliases?.some(a => recentText.includes(a.toLowerCase())) ||
      p.keywords?.some(k => recentText.includes(k.toLowerCase()))
    );
  }

  // ── Private: detect contradiction between mistakes and knowledge ──
  _detectKnowledgeContradiction(mistakes, knowledge) {
    for (const mistake of mistakes) {
      for (const k of knowledge) {
        // If a knowledge item's fact is very similar to a mistake's original conclusion
        const mistakeFact = (mistake.originalConclusion || "").toLowerCase();
        const knowledgeFact = (k.fact || "").toLowerCase();

        // Simple overlap detection
        const mistakeWords   = new Set(mistakeFact.split(/\s+/).filter(w => w.length > 4));
        const knowledgeWords = new Set(knowledgeFact.split(/\s+/).filter(w => w.length > 4));

        let overlap = 0;
        for (const w of mistakeWords) {
          if (knowledgeWords.has(w)) overlap++;
        }

        const overlapRatio = mistakeWords.size > 0 ? overlap / mistakeWords.size : 0;
        if (overlapRatio > 0.4) {
          return `Knowledge concept "${k.concept}" overlaps with a previously corrected conclusion`;
        }
      }
    }
    return null;
  }
}
