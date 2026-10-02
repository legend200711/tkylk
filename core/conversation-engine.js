// ============================================================
// Conversation Engine — Integration A Extended
// Manages conversation state, history, and the message loop.
// Integrates the full five-system intelligence pipeline.
//
// Integration A additions:
//   - MemoryIntentEngine pre-processing (remember/forget/recall)
//   - SessionContext tracking per conversation
//   - Deterministic responses for simple greetings / acks / system commands
//   - Answer depth injection via SessionContext
//   - Conversation continuity via UnderstandingEngine + SessionContext
// ============================================================
import { createConversation, addMessage, getMessages, updateConversationTitle, touchConversation } from "../firebase/firestore-service.js";

// ── Simple deterministic responses ───────────────────────
// Used ONLY for unambiguous greetings, acks, and system states.
// Normal reasoning always goes to the local model.
//
// Strict whole-message greeting detection rules:
//   1. Every pattern is fully anchored (^ … $) — no substring matching.
//   2. Each greeting token is a complete word, not a prefix.
//      "yo" must be the entire content (not "your", "yoga", "young").
//   3. Optional trailing punctuation [.!] and surrounding whitespace only.
//   4. False-match examples that MUST NOT trigger: "your", "young",
//      "yesterday", "history", "this", "higher", "project",
//      "tell me about your memory".
const GREETING_PATTERNS = [
  // Bare greeting token — optionally followed by a single punctuation mark.
  // Uses a named capture so the token can be inspected if needed.
  // This is intentionally NOT /^yo/ — it requires the FULL message to be
  // exactly one of the tokens (with optional trailing [.!]).
  /^(?:hi|hey|hello|yo|sup|howdy|greetings)[.!]?$/i,

  // Greeting + optional addressee word(s) — "hey there", "hi shadow",
  // "hello shadow reaper", "hey reaper".
  /^(?:hi|hey|hello)\s+(?:there|shadow\s+reaper|shadow|reaper)[.!]?$/i,

  // Time-of-day greetings — "good morning", "good evening", etc.
  /^good\s+(?:morning|afternoon|evening)[.!]?$/i
];

const GREETING_RESPONSES = [
  "Hey! What are we working on?",
  "Hello! What's on your mind?",
  "Hi there! Ready when you are.",
  "Hey — what do you need?"
];

const THANKS_PATTERNS = [
  /^(?:thanks?|thank\s+you|thx|ty|cheers|appreciate\s+it)\s*[.!]?\s*$/i,
  /^(?:thanks?|thank\s+you)\s+(?:a\s+(?:lot|bunch)|so\s+much|very\s+much)\s*[.!]?\s*$/i
];

const THANKS_RESPONSES = [
  "You're welcome.",
  "Happy to help.",
  "Of course.",
  "Anytime."
];

const OK_PATTERNS = [
  /^(?:ok(?:ay)?|got\s+it|sounds?\s+good|perfect|great|cool|understood|alright|noted)\s*[.!]?\s*$/i,
  /^(?:ok(?:ay)?|sure|yep|yeah)\s*[,.]?\s*$/i
];

const OK_RESPONSES = [
  "Got it.",
  "Understood.",
  "Sure.",
  "Noted."
];

export class ConversationEngine {
  constructor(modelManager, contextEngine, learningAdapter, knowledgeGraph, projectBrain = null, curiosityEngine = null) {
    this._model         = modelManager;
    this._context       = contextEngine;
    this._learning      = learningAdapter;
    this._graph         = knowledgeGraph;
    this._projectBrain  = projectBrain;
    this._curiosity     = curiosityEngine;

    this._uid           = null;
    this._convId        = null;
    this._history       = [];
    this._generating    = false;
    this._activeProject = null;

    // Integration A: MemoryIntentEngine and SessionContext (injected)
    this._memoryIntent  = null;
    this._sessionCtx    = null;
    this._learningEnabled = true;  // Checkpoint E: can be toggled off

    // Event callbacks
    this._onChunk          = null;
    this._onDone           = null;
    this._onError          = null;
    this._onLearning       = null;
    this._onTitleGenerated = null;
    this._onProjectDetected = null;
    this._onMemoryAction    = null;   // fires when memory intent is handled

    // Last response context (for "Why?" feature)
    this._lastContextParts = null;
    this._lastWhyData      = null;
  }

  // ── Inject Integration A engines ─────────────────────────
  setMemoryIntentEngine(engine) { this._memoryIntent = engine; }
  setSessionContext(ctx)        { this._sessionCtx = ctx; }
  setLearningEnabled(enabled)   { this._learningEnabled = enabled; }
  isLearningEnabled()           { return this._learningEnabled !== false; }

  setUID(uid) { this._uid = uid; }
  setActiveProject(p) { this._activeProject = p; }
  getActiveProject()  { return this._activeProject; }

  on(event, cb) {
    const map = {
      chunk:           "_onChunk",
      done:            "_onDone",
      error:           "_onError",
      learning:        "_onLearning",
      titleGenerated:  "_onTitleGenerated",
      projectDetected: "_onProjectDetected",
      memoryAction:    "_onMemoryAction"
    };
    if (map[event]) this[map[event]] = cb;
  }

  // ── Load/start conversation ───────────────────────────────
  async loadConversation(convId) {
    this._convId  = convId;
    this._history = [];

    const messages = await getMessages(this._uid, convId);
    this._history  = messages.map(m => ({ role: m.role, content: m.content, id: m.id }));
    return this._history;
  }

  async newConversation() {
    this._history = [];
    this._convId  = await createConversation(this._uid, "New Conversation");
    // Reset session context for the new conversation
    this._sessionCtx?.reset();
    this._memoryIntent?.cancelPendingForgetAll();
    return this._convId;
  }

  getHistory()   { return this._history; }
  getConvId()    { return this._convId; }
  isGenerating() { return this._generating; }

  // ── Get the last "Why?" data for the explanation panel ───
  getLastWhyData() { return this._lastWhyData; }

  // ── Send a message and generate response ─────────────────
  async sendMessage(userMessage, allMemories, allKnowledge) {
    if (!this._uid)    throw new Error("No user authenticated");
    if (!this._convId) await this.newConversation();
    if (this._generating) return;

    this._generating = true;

    try {
      // ── Integration A: Pre-process memory intents ─────────
      // BEFORE saving to Firestore, check if this is a memory-directed message.
      // If yes, handle it deterministically and return early.
      if (this._memoryIntent) {
        const intentResult = await this._memoryIntent.process(userMessage, {
          allMemories,
          allKnowledge,
          activeProject:  this._activeProject,
          conversationId: this._convId,
          uid:            this._uid
        });

        if (intentResult && intentResult.handled) {
          // Handle forget-all confirmation pattern specially
          // The MemoryIntentEngine already has memory reference — deletion happens there.
          // We just need to clear the local cache after.
          if (intentResult.intent === "FORGET_ALL" && intentResult.proceedWithDeletion) {
            // MemoryIntentEngine owns the memory reference; directly delete via it
            for (const m of [...allMemories]) {
              await this._memoryIntent._memory?.deleteMemory?.(m.id).catch(() => {});
            }
            allMemories.splice(0); // Clear the reference array
          }

          // Save message + response to Firestore
          const userMsgId = await addMessage(this._uid, this._convId, "user", userMessage);
          this._history.push({ role: "user", content: userMessage, id: userMsgId });

          const resp = intentResult.confirmationMessage;
          const asstMsgId = await addMessage(
            this._uid, this._convId, "assistant", resp,
            { isMemoryAction: true, intent: intentResult.intent }
          );
          this._history.push({ role: "assistant", content: resp, id: asstMsgId });
          await touchConversation(this._uid, this._convId);

          if (this._history.length === 2) this._generateTitle(userMessage);

          this._onMemoryAction?.(intentResult);
          this._onDone?.(resp, { contextParts: {}, isMemoryAction: true });
          return resp;
        }
      }

      // ── Integration A: Cancel pending forget-all on unrelated message ─
      this._memoryIntent?.cancelPendingForgetAll();

      // ── Integration A: Check for simple deterministic responses ──
      const deterministicResponse = this._getDeterministicResponse(userMessage);
      if (deterministicResponse !== null) {
        const userMsgId = await addMessage(this._uid, this._convId, "user", userMessage);
        this._history.push({ role: "user", content: userMessage, id: userMsgId });
        const asstMsgId = await addMessage(this._uid, this._convId, "assistant", deterministicResponse);
        this._history.push({ role: "assistant", content: deterministicResponse, id: asstMsgId });
        await touchConversation(this._uid, this._convId);
        if (this._history.length === 2) this._generateTitle(userMessage);
        this._onDone?.(deterministicResponse, { contextParts: {}, isDeterministic: true });
        return deterministicResponse;
      }

      // 1. Save user message to Firestore
      const userMsgId = await addMessage(this._uid, this._convId, "user", userMessage);
      this._history.push({ role: "user", content: userMessage, id: userMsgId });

      // 2. Build context (includes project identification, mistake memory,
      //    project brain, confidence, and curiosity gap analysis)
      const contextResult = await this._context.buildContext(
        userMessage,
        this._history.slice(0, -1),
        {
          activeProject:  this._activeProject,
          allMemories,
          allKnowledge,
          maxHistoryTurns: 12,
          uid:            this._uid,
          conversationId: this._convId,
          sessionContext: this._sessionCtx   // Integration A: pass session context
        }
      );

      const { messages, contextParts, clarificationNeeded, clarificationQuestion,
              resolvedProject, resolvedProjectName } = contextResult;

      // 3. Update active project if newly identified
      if (resolvedProject && resolvedProject !== this._activeProject) {
        this._activeProject = resolvedProject;
        this._onProjectDetected?.(resolvedProject, resolvedProjectName);
      }

      // 4. If Curiosity Engine flagged a critical knowledge gap, ask instead of guessing
      if (clarificationNeeded && clarificationQuestion) {
        const clarificationResponse = this._curiosity
          ? this._curiosity.buildClarificationResponse(
              clarificationQuestion,
              contextParts.curiosityAnalysis?.analysis || {}
            )
          : clarificationQuestion;

        const asstMsgId = await addMessage(
          this._uid, this._convId, "assistant", clarificationResponse,
          { isClarification: true, project: resolvedProject }
        );
        this._history.push({ role: "assistant", content: clarificationResponse, id: asstMsgId });
        await touchConversation(this._uid, this._convId);

        // Store why data for this clarification
        this._lastContextParts = contextParts;
        this._lastWhyData = this._buildWhyData(contextParts, userMessage, clarificationResponse);

        this._onDone?.(clarificationResponse, { contextParts, isClarification: true });
        return clarificationResponse;
      }

      // 5. Stream response from local model
      let fullResponse = "";

      await this._model.generateStream(
        messages,
        { temperature: 0.75, maxTokens: 2048 },
        (delta, accumulated) => {
          fullResponse = accumulated;
          this._onChunk?.(delta, accumulated);
        },
        (finalText) => {
          fullResponse = finalText;
        }
      );

      // 6. Save assistant response
      const asstMsgId = await addMessage(
        this._uid, this._convId, "assistant", fullResponse,
        { project: resolvedProject }
      );
      this._history.push({ role: "assistant", content: fullResponse, id: asstMsgId });

      // 7. Touch conversation timestamp
      await touchConversation(this._uid, this._convId);

      // 8. Auto-generate title on first exchange
      if (this._history.length === 2) {
        this._generateTitle(userMessage);
      }

      // 9. Store context for "Why?" feature
      this._lastContextParts = contextParts;
      this._lastWhyData = this._buildWhyData(contextParts, userMessage, fullResponse);

      // 10. Update session context (Integration A)
      if (this._sessionCtx) {
        this._sessionCtx.update(userMessage, null, fullResponse);
        if (resolvedProject) this._sessionCtx.setActiveProject(resolvedProject);
        // Snapshot session context into contextParts for "Why?" panel
        contextParts.sessionSnapshot = this._sessionCtx.toSnapshot();
      }

      // 11. Run full learning pipeline (async, non-blocking)
      // Respects learningEnabled flag (Checkpoint E)
      const lastAssistantMsg = this._history
        .filter(m => m.role === "assistant")
        .slice(-2, -1)[0]?.content || null;
      if (this._learningEnabled !== false) {
        this._runLearning(userMessage, fullResponse, allMemories, allKnowledge, resolvedProject, {
          ...contextParts,
          lastAssistantResponse: lastAssistantMsg,
          sessionContext: this._sessionCtx
        });
      }

      this._onDone?.(fullResponse, { contextParts });
      return fullResponse;

    } catch (err) {
      this._onError?.(err);
      throw err;
    } finally {
      this._generating = false;
    }
  }

  // ── Run full learning pipeline ────────────────────────────
  // Pipeline: Learning Adapter → Mistake/Correction Detection →
  // Memory Update → Project Brain Update → Confidence Update →
  // Relationship Update → Reflection Queue
  async _runLearning(userMessage, assistantResponse, allMemories, allKnowledge, project, contextParts) {
    try {
      const results = await this._learning.processInteraction({
        userMessage,
        assistantResponse,
        conversationId: this._convId,
        project,
        allMemories,
        allKnowledge,
        contextParts     // Pass the full context so mistakes can be identified
      });

      // Update knowledge graph with new relationships
      if (results.newRelationships.length > 0) {
        await this._graph.processLearningRelationships(
          results.newRelationships,
          project,
          this._convId
        );
      }

      // Update active project display if newly detected by learning adapter
      if (results.detectedProject && !this._activeProject) {
        this._activeProject = results.detectedProject;
        this._onProjectDetected?.(results.detectedProject, results.detectedProject);
      }

      this._onLearning?.(results, this._learning.getActivityLog());
    } catch (err) {
      console.warn("[ConversationEngine] Learning error (non-fatal):", err);
    }
  }

  // ── Deterministic responses for trivial inputs ────────────
  // Returns a response string for simple greetings/acks, null otherwise.
  // These NEVER bypass the model for real reasoning/content.
  _getDeterministicResponse(msg) {
    const trimmed = (msg || "").trim();
    if (!trimmed || trimmed.length > 120) return null;

    if (GREETING_PATTERNS.some(p => p.test(trimmed))) {
      return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];
    }
    if (THANKS_PATTERNS.some(p => p.test(trimmed))) {
      return THANKS_RESPONSES[Math.floor(Math.random() * THANKS_RESPONSES.length)];
    }
    if (OK_PATTERNS.some(p => p.test(trimmed))) {
      // Only deterministic if there's nothing else interesting to say
      // i.e., no active project/topic that needs acknowledgment
      if (!this._activeProject) {
        return OK_RESPONSES[Math.floor(Math.random() * OK_RESPONSES.length)];
      }
    }

    return null; // Not deterministic — use local model
  }

  // ── Build "Why?" explanation data ────────────────────────
  _buildWhyData(contextParts, userMessage, response) {
    return {
      userMessage:        userMessage?.slice(0, 200),
      activeProject:      contextParts.projectName || contextParts.activeProject || null,
      memoriesUsed:       (contextParts.memories || []).map(m => ({
        concept:        m.concept,
        fact:           m.fact?.slice(0, 120),
        confidence:     Math.round((m.confidence || 0.5) * 100),
        category:       m.category,
        knowledgeState: m.knowledgeState || null,
        temporalState:  m.temporalState  || null
      })),
      knowledgeUsed:      (contextParts.knowledge || []).map(k => ({
        concept:        k.concept,
        fact:           k.fact?.slice(0, 120),
        confidence:     Math.round((k.confidence || 0.5) * 100),
        category:       k.category,
        knowledgeState: k.knowledgeState || null,
        temporalState:  k.temporalState  || null
      })),
      mistakesConsidered: (contextParts.mistakes || []).map(m => ({
        topic:      m.topic,
        lesson:     m.lesson?.slice(0, 120),
        confirmed:  m.confirmed
      })),
      projectBrainEntries: (contextParts.projectBrainEntries || []).map(e => ({
        type:           e.type,
        title:          e.title,
        content:        e.content?.slice(0, 120),
        knowledgeState: e.metadata?.knowledgeState || null,
        temporalState:  e.metadata?.temporalState  || null
      })),
      preferencesApplied: (contextParts.preferences || []).map(p => ({
        fact:    p.fact?.slice(0, 100),
        project: p.project || null,
        scope:   p.project ? "project" : "global"
      })),
      confidenceNotes:    contextParts.confidenceContext || null,
      curiosityAnalysis:  contextParts.curiosityAnalysis
        ? this._curiosity?.formatAnalysis(contextParts.curiosityAnalysis) || null
        : null,
      budgetLog:          contextParts.budgetLog || null,
      sessionSnapshot:    contextParts.sessionSnapshot || null,
      generatedAt:        new Date().toISOString()
    };
  }

  // ── Auto-generate conversation title ─────────────────────
  async _generateTitle(firstMessage) {
    try {
      if (!this._model.isOnline()) return;
      const prompt = `Generate a short, descriptive title (4-6 words maximum) for a conversation that starts with: "${firstMessage.slice(0, 200)}". Reply with ONLY the title, no quotes, no punctuation at end.`;

      const messages = [
        { role: "system", content: "You generate concise conversation titles. Reply with only the title text." },
        { role: "user", content: prompt }
      ];

      let title = "";
      await this._model.generateStream(
        messages,
        { temperature: 0.3, maxTokens: 20 },
        (delta, acc) => { title = acc; },
        () => {}
      );

      title = title.trim().replace(/^["']|["']$/g, "").slice(0, 60);
      if (title && this._convId) {
        await updateConversationTitle(this._uid, this._convId, title);
        this._onTitleGenerated?.(this._convId, title);
      }
    } catch (_) {}
  }

  // ── Stop generation ───────────────────────────────────────
  stop() {
    this._model.stop();
    this._generating = false;
  }

  // ── Edit and regenerate a message ─────────────────────────
  async editAndRegenerate(messageIndex, newContent, allMemories, allKnowledge) {
    this._history = this._history.slice(0, messageIndex);
    return this.sendMessage(newContent, allMemories, allKnowledge);
  }
}
