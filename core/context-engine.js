// ============================================================
// Context Engine
// Constructs the full context for each model inference.
// Integrates: Mistake Memory, Project Brain, Confidence Engine,
// Curiosity Engine, Preference Application, Context Budget Manager.
// ============================================================
import { ContextBudgetManager } from "./context-budget.js";
import { MEMORY_TYPES }         from "./memory-engine.js";

export class ContextEngine {
  constructor(
    personalityEngine,
    memoryEngine,
    knowledgeEngine,
    knowledgeGraph,
    retrievalEngine,
    emotionEngine,
    mistakeMemory    = null,
    projectBrain     = null,
    confidenceEngine = null,
    curiosityEngine  = null
  ) {
    this._personality = personalityEngine;
    this._memory      = memoryEngine;
    this._knowledge   = knowledgeEngine;
    this._graph       = knowledgeGraph;
    this._retrieval   = retrievalEngine;
    this._emotion     = emotionEngine;
    this._mistakes    = mistakeMemory;
    this._projectBrain = projectBrain;
    this._confidence  = confidenceEngine;
    this._curiosity   = curiosityEngine;
    this._budget      = new ContextBudgetManager();
  }

  // ── Inform the budget manager of the actual model context window ─
  // Called by ShadowCore after the model finishes initializing so the
  // budget limits are sized correctly for the loaded model (not just
  // the static 4096-token default).
  setModelContextSize(tokens) {
    this._budget.setContextSize(tokens);
  }

  // ── Build full context for a message ─────────────────────
  // Returns { messages, contextParts, clarificationNeeded, clarificationQuestion }
  async buildContext(userMessage, conversationHistory, options = {}) {
    const {
      activeProject   = null,
      allMemories     = [],
      allKnowledge    = [],
      maxHistoryTurns = 12,
      maxMemories     = 6,
      maxKnowledge    = 8,
      uid             = null,
      sessionContext  = null    // Integration A: SessionContext instance
    } = options;

    const contextParts = {
      activeProject: null,
      projectName:   null
    };

    // ── 1. Project identification ─────────────────────────────
    let resolvedProject = activeProject;
    let resolvedProjectName = activeProject;

    if (!resolvedProject && this._projectBrain) {
      const detected = this._projectBrain.identifyProject(
        userMessage + " " + conversationHistory.slice(-4).map(m => m.content).join(" ")
      );
      if (detected) {
        resolvedProject     = detected.id;
        resolvedProjectName = detected.name;
      }
    } else if (resolvedProject && this._projectBrain) {
      // Look up the display name
      const sig = this._projectBrain.getKnownProjects().find(
        p => p.id === resolvedProject || p.name === resolvedProject
      );
      if (sig) {
        resolvedProject     = sig.id;
        resolvedProjectName = sig.name;
      }
    }

    contextParts.activeProject = resolvedProject;
    contextParts.projectName   = resolvedProjectName;

    // ── 2. System identity + personality ─────────────────────
    const emotionState = this._emotion?.getState?.() ?? null;
    // Checkpoint C: detect tone signal from current message + emotion state
    let toneSignal = null;
    if (this._personality?.detectToneFromContext) {
      toneSignal = this._personality.detectToneFromContext(userMessage, emotionState);
      this._personality.setToneSignal(toneSignal);
    }
    contextParts.systemPrompt = this._personality.getSystemPrompt(emotionState, resolvedProjectName, toneSignal);
    contextParts.toneSignal = toneSignal;

    // ── 3. Retrieve relevant memories ─────────────────────────
    // Separate preferences from general memories for targeted application
    const allPreferenceMemories = allMemories.filter(
      m => m.memoryType === MEMORY_TYPES.PREFERENCE || m.category === "preference"
    );
    const nonPreferenceMemories = allMemories.filter(
      m => m.memoryType !== MEMORY_TYPES.PREFERENCE && m.category !== "preference"
    );

    const relevantMemories = this._retrieval.retrieveRelevant(
      nonPreferenceMemories,
      userMessage,
      { topN: maxMemories, context: { project: resolvedProject } }
    );
    contextParts.memories = relevantMemories;

    // Mark accessed
    for (const m of relevantMemories) {
      if (m.id) this._memory.recordAccess(m.id, m).catch(() => {});
    }

    // ── 3b. Retrieve applicable preferences ───────────────────
    // Apply preferences that are: relevant, fresh, project-scoped or global
    const relevantPreferences = this._retrievePreferences(
      allPreferenceMemories, userMessage, resolvedProject
    );
    contextParts.preferences = relevantPreferences;

    // ── 4. Retrieve relevant knowledge ────────────────────────
    const relevantKnowledge = this._retrieval.retrieveRelevant(
      allKnowledge,
      userMessage,
      { topN: maxKnowledge, context: { project: resolvedProject } }
    );
    contextParts.knowledge = relevantKnowledge;

    // ── 5. Mistake memory search ──────────────────────────────
    let relevantMistakes = [];
    if (this._mistakes) {
      relevantMistakes = await this._mistakes.getRelevantMistakes(userMessage, {
        project: resolvedProject
      });
      contextParts.mistakes = relevantMistakes;
    }

    // ── 6. Project Brain retrieval ────────────────────────────
    let projectBrainEntries = [];
    if (this._projectBrain && resolvedProject) {
      projectBrainEntries = await this._projectBrain.getRelevantEntries(
        resolvedProject, userMessage, { topN: 6 }
      );
      contextParts.projectBrainEntries = projectBrainEntries;
    }

    // ── 7. Curiosity / knowledge gap analysis ─────────────────
    let clarificationNeeded  = false;
    let clarificationQuestion = null;
    let curiosityAnalysis    = null;

    if (this._curiosity) {
      const evaluation = await this._curiosity.evaluate(userMessage, {
        activeProject:      resolvedProject,
        relevantMemories,
        relevantKnowledge,
        relevantMistakes,
        projectBrainEntries,
        conversationHistory,
        sessionContext      // Integration A: pass session context for pronoun resolution
      });

      contextParts.curiosityAnalysis = evaluation;
      curiosityAnalysis = evaluation;

      if (evaluation.shouldAsk) {
        clarificationNeeded   = true;
        clarificationQuestion = evaluation.question;

        // Log gap event (fire-and-forget)
        if (uid) {
          this._curiosity.recordGapEvent(uid, {
            query:          userMessage,
            gaps:           evaluation.gaps,
            projectId:      resolvedProject,
            conversationId: options.conversationId
          });
        }
      }
    }

    contextParts.clarificationNeeded  = clarificationNeeded;
    contextParts.clarificationQuestion = clarificationQuestion;

    // ── 8. Get relationship context ───────────────────────────
    let relationshipContext = "";
    if (resolvedProject) {
      try {
        relationshipContext = await this._graph.getRelationshipContext(resolvedProject);
      } catch (_) {}
    }
    contextParts.relationships = relationshipContext;

    // ── 9. Confidence context ─────────────────────────────────
    let confidenceContext = "";
    if (this._confidence && (relevantMemories.length > 0 || relevantKnowledge.length > 0)) {
      const combined = [...relevantMemories, ...relevantKnowledge];
      const confidenceRecords = await this._buildConfidenceRecords(combined);
      confidenceContext = this._confidence.formatForContext(confidenceRecords);
      contextParts.confidenceContext = confidenceContext;
    }

    // ── 9b. Build preference context string ───────────────────
    // Merge persistent preferences with session-only preferences (Integration A)
    let allPreferences = relevantPreferences;
    if (sessionContext) {
      const sessionPrefs = sessionContext.getSessionPreferences();
      if (sessionPrefs.length > 0) {
        // Session prefs go first (higher priority), prevent duplicates
        const sessionPrefFacts = new Set(sessionPrefs.map(p => p.fact));
        const dedupedPersistent = relevantPreferences.filter(p => !sessionPrefFacts.has(p.fact));
        allPreferences = [...sessionPrefs, ...dedupedPersistent];
      }
    }
    const preferenceContext = this._buildPreferenceContext(allPreferences);
    contextParts.preferenceContext = preferenceContext;

    // ── 9c. Answer depth hint (Integration A) ─────────────────
    const answerDepthHint = sessionContext ? sessionContext.getAnswerDepthHint() : "";
    contextParts.answerDepthHint = answerDepthHint;

    // ── 10. Apply Context Budget Manager ─────────────────────
    // Prevents context overflow before inference
    const budgeted = this._budget.allocate({
      systemPrompt:        contextParts.systemPrompt,
      projectBrainEntries,
      mistakes:            relevantMistakes,
      memories:            relevantMemories,
      knowledge:           relevantKnowledge,
      preferenceContext,
      confidenceContext,
      conversationHistory,
      userMessage
    });

    contextParts.budgetLog = budgeted.budgetLog;

    // ── 11. Proactive connection (Checkpoint B) ───────────────
    // Check for relevant cross-project parallels when context is sparse
    let proactiveConnection = null;
    if ((projectBrainEntries.length === 0 || relevantMistakes.length === 0) && resolvedProject) {
      proactiveConnection = await this.findProactiveConnection(
        userMessage, resolvedProject, allKnowledge
      ).catch(() => null);
    }
    contextParts.proactiveConnection = proactiveConnection;

    // ── 12. Build message array for model ─────────────────────
    const messages = this._assembleMessages({
      systemPrompt:        budgeted.systemPrompt,
      memories:            budgeted.memories,
      knowledge:           budgeted.knowledge,
      mistakes:            budgeted.mistakes,
      projectBrainEntries: budgeted.projectBrainEntries,
      relationships:       relationshipContext,
      confidenceContext:   budgeted.confidenceContext,
      preferenceContext:   budgeted.preferenceContext,
      answerDepthHint,                               // Integration A
      conversationHistory: budgeted.conversationHistory,
      userMessage,
      maxHistoryTurns,
      activeProject:       resolvedProject,
      activeProjectName:   resolvedProjectName,
      options:             { proactiveConnection }
    });

    return {
      messages,
      contextParts,
      clarificationNeeded,
      clarificationQuestion,
      resolvedProject,
      resolvedProjectName
    };
  }

  // ── Retrieve active preferences ────────────────────────────
  _retrievePreferences(preferences, userMessage, activeProject) {
    if (!preferences || preferences.length === 0) return [];

    const now = Date.now();
    const scored = preferences.map(pref => {
      let score = 0;

      // Freshness (preferences within 30 days get boost)
      const lastObserved = pref.lastObserved || pref.updatedAt;
      if (lastObserved) {
        const ageDays = (now - new Date(lastObserved).getTime()) / 86400000;
        score += Math.max(0, 15 - ageDays * 0.3);
      }

      // Confidence
      score += (pref.confidence || 0.7) * 10;

      // Project match
      if (activeProject && pref.project === activeProject) {
        score += 20;
      } else if (!pref.project) {
        score += 5; // global preferences still apply
      }

      // Relevance to current message
      const prefText = ((pref.fact || "") + " " + (pref.concept || "")).toLowerCase();
      const msgLower = userMessage.toLowerCase();
      const prefWords = prefText.split(/\s+/).filter(w => w.length > 3);
      for (const word of prefWords) {
        if (msgLower.includes(word)) score += 3;
      }

      return { pref, score };
    });

    // Return top-5 most applicable preferences
    return scored
      .filter(s => s.score > 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.pref);
  }

  // ── Build preference context string for system prompt ────
  _buildPreferenceContext(preferences) {
    if (!preferences || preferences.length === 0) return "";

    let block = "\n\n--- OPERATOR PREFERENCES (apply these) ---\n";
    for (const pref of preferences) {
      const scope = pref.project ? `[project: ${pref.project}]` : "[global]";
      block += `${scope} ${pref.fact || pref.concept}\n`;
    }
    return block;
  }

  // ── Assemble OpenAI-format messages array ─────────────────
  _assembleMessages({
    systemPrompt, memories, knowledge, mistakes, projectBrainEntries,
    relationships, confidenceContext, preferenceContext, answerDepthHint,
    conversationHistory, userMessage, maxHistoryTurns, activeProject, activeProjectName,
    options = {}
  }) {
    const messages = [];
    let system = systemPrompt;

    // Append project brain context (highest priority — project-specific knowledge)
    if (projectBrainEntries && projectBrainEntries.length > 0 && this._projectBrain) {
      system += this._projectBrain.formatForContext(activeProject, activeProjectName, projectBrainEntries);
    }

    // Append past mistakes (prevent repeating errors)
    if (mistakes && mistakes.length > 0 && this._mistakes) {
      system += this._mistakes.formatForContext(mistakes);
    }

    // Append operator preferences (active, relevant, freshness-ranked)
    if (preferenceContext) {
      system += preferenceContext;
    }

    // Append relevant memories — include knowledge state if present
    if (memories.length > 0) {
      system += "\n\n--- RELEVANT MEMORIES ---\n";
      for (const m of memories) {
        const conf  = Math.round((m.confidence || 0.5) * 100);
        const state = m.knowledgeState ? ` [${m.knowledgeState}]` : "";
        const temporal = m.temporalState && m.temporalState !== "CURRENT"
          ? ` (${m.temporalState})`
          : "";
        system += `[${m.category || "memory"}, ${conf}%${state}${temporal}] ${m.concept}: ${m.fact}\n`;
      }
    }

    // Append knowledge — include knowledge state if present
    if (knowledge.length > 0) {
      system += "\n\n--- RELEVANT KNOWLEDGE ---\n";
      for (const k of knowledge) {
        const conf  = Math.round((k.confidence || 0.5) * 100);
        const state = k.knowledgeState ? ` [${k.knowledgeState}]` : "";
        const temporal = k.temporalState && k.temporalState !== "CURRENT"
          ? ` (${k.temporalState})`
          : "";
        // Flag ideas explicitly so model doesn't treat them as facts
        const ideaFlag = k.knowledgeState === "IDEA" ? "IDEA/UNCONFIRMED: " : "";
        system += `[${k.category || "knowledge"}, ${conf}%${state}${temporal}] ${k.concept}: ${ideaFlag}${k.fact}\n`;
      }
    }

    // Append confidence notes
    if (confidenceContext) {
      system += confidenceContext;
    }

    // Append relationship context
    if (relationships) {
      system += `\n\n${relationships}`;
    }

    // Append active project reminder
    if (activeProjectName) {
      system += `\n\nCurrent context: Working within project "${activeProjectName}".`;
    }

    // Append proactive cross-project connection (Checkpoint B)
    if (options?.proactiveConnection) {
      const pc = options.proactiveConnection;
      system += `\n\n[PROACTIVE CONTEXT] A similar situation was encountered in project "${pc.project}". ` +
        `You may mention this if directly relevant: "${pc.concept}: ${pc.fact}"`;
    }

    // Append answer depth style hint (Integration A — session-level preference)
    if (answerDepthHint) {
      system += answerDepthHint;
    }

    messages.push({ role: "system", content: system });

    // Conversation history — already trimmed by budget manager
    for (const msg of conversationHistory) {
      if (msg.role === "system") {
        // Context window summary markers passed through as system notes
        messages.push({ role: "system", content: msg.content });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Current user message (add if not already last)
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
      messages.push({ role: "user", content: userMessage });
    }

    return messages;
  }

  // ── Build confidence records for a set of items ──────────
  async _buildConfidenceRecords(items) {
    if (!this._confidence) return [];
    const records = [];
    for (const item of items.slice(0, 10)) {
      const key = item.concept || item.id || "unknown";
      try {
        const record = await this._confidence.getRecord(key, {
          confidence:         item.confidence,
          confirmationCount:  item.confirmationCount,
          contradictionCount: item.contradictionCount
        });
        if (record) records.push(record);
      } catch (_) {}
    }
    return records;
  }

  // ── Estimate token count (rough approximation) ───────────
  estimateTokens(messages) {
    return messages.reduce((sum, m) => sum + Math.ceil((m.content || "").length / 3.5), 0);
  }

  // ── Checkpoint B: Proactive cross-project connection ──────
  // Checks if current query has parallels in OTHER projects.
  // Returns null unless similarity is strong (score >= 30).
  // Only called when relevantMistakes or projectBrainEntries are sparse.
  async findProactiveConnection(userMessage, resolvedProject, allKnowledge) {
    if (!this._retrieval || !allKnowledge || allKnowledge.length === 0) return null;

    // Only look at knowledge from OTHER projects
    const otherProjectKnowledge = allKnowledge.filter(k =>
      k.project && k.project !== resolvedProject &&
      (k.tags || []).some(t => ["fix-succeeded", "pattern", "reflected"].includes(t))
    );

    if (otherProjectKnowledge.length === 0) return null;

    const relevant = this._retrieval.retrieveRelevant(
      otherProjectKnowledge,
      userMessage,
      { topN: 1, minScore: 30 }  // high threshold — only if very relevant
    );

    if (relevant.length === 0) return null;

    const hit = relevant[0];
    return {
      project:   hit.project,
      concept:   hit.concept,
      fact:      (hit.fact || "").slice(0, 200),
      score:     hit._relevanceScore,
      sourceType: hit.sourceType || "knowledge"
    };
  }

  // ── Get context summary for display ──────────────────────
  summarizeContext(contextParts) {
    const lines = [];
    lines.push(`System: ${contextParts.systemPrompt?.slice(0, 80)}...`);
    lines.push(`Project: ${contextParts.projectName || "—"}`);
    lines.push(`Memories loaded: ${contextParts.memories?.length || 0}`);
    lines.push(`Knowledge loaded: ${contextParts.knowledge?.length || 0}`);
    lines.push(`Mistakes checked: ${contextParts.mistakes?.length || 0}`);
    lines.push(`Project brain entries: ${contextParts.projectBrainEntries?.length || 0}`);
    if (contextParts.relationships) lines.push("Relationships: yes");
    return lines.join("\n");
  }
}
