// ============================================================
// Shadow Core — top-level orchestrator
// Upgraded to SHADOW REAPER AI multi-user architecture.
// Manages three strictly separated learning scopes:
//   1. PRIVATE USER BRAIN   — per-user, UID-scoped
//   2. PROJECT BRAIN        — per-project, UID-scoped
//   3. GLOBAL LEARNING BRAIN — privacy-filtered shared concepts
//
// Checkpoint D additions: VoiceEngine, ShadowStateController
// Checkpoint E additions: preference controls (history, learning, voice)
// ============================================================
import { ModelManager }          from "./model-manager.js";
import { PersonalityEngine }     from "./personality-engine.js";
import { EmotionEngine }         from "./emotion-engine.js";
import { MemoryEngine }          from "./memory-engine.js";
import { KnowledgeEngine }       from "./knowledge-engine.js";
import { KnowledgeGraph }        from "./knowledge-graph.js";
import { RetrievalEngine }       from "./retrieval-engine.js";
import { ContextEngine }         from "./context-engine.js";
import { LearningAdapter }       from "./learning-adapter.js";
import { ReflectionEngine }      from "./reflection-engine.js";
import { PrivacyEngine }         from "./privacy-engine.js";
import { ConversationEngine }    from "./conversation-engine.js";
import { MistakeMemory }         from "./mistake-memory.js";
import { ProjectBrain }          from "./project-brain.js";
import { ConfidenceEngine }      from "./confidence-engine.js";
import { CuriosityEngine }       from "./curiosity-engine.js";
import { firewallScan }          from "./privacy-learning-firewall.js";
import { generalize }            from "./generalization-engine.js";
import { submitCandidate }       from "./global-promotion-engine.js";
import { MemoryIntentEngine }    from "./memory-intent-engine.js";
import { SessionContext }        from "./session-context.js";
import { VoiceEngine }           from "./voice-engine.js";
import { ShadowStateController } from "./shadow-state-controller.js";
import {
  getAllGlobalKnowledge,
  getGlobalLearningStats,
  savePreferences,
  loadPreferences
} from "../firebase/firestore-service.js";

export class ShadowCore {
  constructor() {
    this._initialized  = false;
    this._uid          = null;
    this._globalConsent = false; // default: NOT opted in

    // ── Core engines (private-user scope) ─────────────────────
    this.model       = new ModelManager();
    this.personality = new PersonalityEngine();
    this.emotion     = new EmotionEngine();
    this.memory      = new MemoryEngine();
    this.knowledge   = new KnowledgeEngine();
    this.graph       = new KnowledgeGraph();
    this.retrieval   = new RetrievalEngine();
    this.privacy     = new PrivacyEngine();

    // ── Intelligence systems ───────────────────────────────────
    this.mistakeMemory  = new MistakeMemory(this.retrieval);
    this.projectBrain   = new ProjectBrain(this.retrieval);
    this.confidence     = new ConfidenceEngine();
    this.curiosity      = new CuriosityEngine(
      this.projectBrain,
      this.mistakeMemory,
      this.confidence
    );

    // Reflection engine
    this.reflection = new ReflectionEngine(this.memory, this.knowledge, this.graph);

    this.context = new ContextEngine(
      this.personality,
      this.memory,
      this.knowledge,
      this.graph,
      this.retrieval,
      this.emotion,
      this.mistakeMemory,
      this.projectBrain,
      this.confidence,
      this.curiosity
    );

    this.learning = new LearningAdapter(
      this.memory,
      this.knowledge,
      this.graph,
      this.retrieval,
      this.mistakeMemory,
      this.projectBrain,
      this.confidence
    );

    this.conversation = new ConversationEngine(
      this.model,
      this.context,
      this.learning,
      this.graph,
      this.projectBrain,
      this.curiosity
    );

    // ── Integration A: Memory Intent Engine + Session Context ─
    this.memoryIntent = new MemoryIntentEngine(
      this.memory,
      this.projectBrain,
      this.retrieval,
      this.privacy
    );
    this.sessionContext = new SessionContext();

    // Wire into ConversationEngine
    this.conversation.setMemoryIntentEngine(this.memoryIntent);
    this.conversation.setSessionContext(this.sessionContext);

    // ── Checkpoint D: Voice Engine + State Controller ─────────
    this.voice = new VoiceEngine();
    this.stateController = new ShadowStateController();

    // ── Checkpoint E: User-controllable settings ──────────────
    this._historyEnabled  = true;   // false → no persistent conversation history saved
    this._learningEnabled = true;   // false → no passive learning from conversations

    // ── Global learning cache ──────────────────────────────────
    this._globalKnowledgeCache = [];
    this._globalKnowledgeLoaded = false;

    // Status tracking
    this._systemStatus = {
      model:           "offline",
      memory:          "offline",
      knowledge:       "offline",
      learning:        "offline",
      reflection:      "offline",
      emotion:         "offline",
      webgpu:          "unknown",
      mistakeMemory:   "offline",
      projectBrain:    "offline",
      confidence:      "offline",
      curiosity:       "offline",
      privacyFirewall: "offline",
      globalLearning:  "disabled",
      firestore:       "offline",
      cloudflare:      "offline",
      memoryIntent:    "offline",
      sessionContext:  "offline",
      voice:           "unknown",
      stateController: "active"
    };

    this._reflecting = false;
  }

  // ── Initialize for a specific user ────────────────────────────
  async initializeForUser(uid, preferences = {}) {
    this._uid = uid;

    // Load global consent from preferences
    this._globalConsent = preferences.globalLearningConsent === true;

    // Set UID on all private engines
    this.memory.setUID(uid);
    this.knowledge.setUID(uid);
    this.graph.setUID(uid);
    this.reflection.setUID(uid);
    this.conversation.setUID(uid);
    this.learning.setUID(uid);
    this.mistakeMemory.setUID(uid);
    this.projectBrain.setUID(uid);
    this.confidence.setUID(uid);

    // Integration A: Reset session context for new user session
    this.sessionContext.reset();

    // Load persisted project registry (fixes project persistence across reloads)
    this.projectBrain.loadRegistry().catch(() => {});

    // Personalization
    if (preferences.personality) {
      this.personality.loadCustomizations(preferences.personality);
    }

    // Load emotional state (user-specific)
    await this.emotion.initialize(uid);

    this._systemStatus.emotion        = "active";
    this._systemStatus.memory         = "active";
    this._systemStatus.knowledge      = "active";
    this._systemStatus.learning       = "active";
    this._systemStatus.reflection     = "idle";
    this._systemStatus.mistakeMemory  = "active";
    this._systemStatus.projectBrain   = "active";
    this._systemStatus.confidence     = "active";
    this._systemStatus.curiosity      = "active";
    this._systemStatus.privacyFirewall = "active";
    this._systemStatus.globalLearning  = this._globalConsent ? "enabled" : "disabled";
    this._systemStatus.firestore       = "connected";
    this._systemStatus.memoryIntent   = "active";
    this._systemStatus.sessionContext  = "active";

    // Checkpoint D: Load voice preferences from stored prefs
    if (preferences.voice) {
      this.voice.setPreferences(preferences.voice);
    }
    this._systemStatus.voice = this.voice.isAvailable()
      ? (VoiceEngine.recognitionAvailable ? "available" : "tts-only")
      : "unavailable";

    // Checkpoint E: Load history/learning toggles
    if (typeof preferences.historyEnabled  === "boolean") this._historyEnabled  = preferences.historyEnabled;
    if (typeof preferences.learningEnabled === "boolean") {
      this._learningEnabled = preferences.learningEnabled;
      this.conversation.setLearningEnabled(preferences.learningEnabled);
    }

    // Pre-load global knowledge (shared, read-only context enrichment)
    this._loadGlobalKnowledge().catch(() => {});

    this._initialized = true;
  }

  // ── Global consent management ──────────────────────────────────
  async setGlobalLearningConsent(uid, enabled) {
    this._globalConsent = enabled;
    this._systemStatus.globalLearning = enabled ? "enabled" : "disabled";
    // Persist to preferences
    try {
      await savePreferences(uid, { globalLearningConsent: enabled });
    } catch (_) {}
  }

  getGlobalLearningConsent() { return this._globalConsent; }

  // ── Pre-load global knowledge ──────────────────────────────────
  async _loadGlobalKnowledge() {
    try {
      this._globalKnowledgeCache  = await getAllGlobalKnowledge(100);
      this._globalKnowledgeLoaded = true;
    } catch (_) {
      this._globalKnowledgeCache  = [];
    }
  }

  // Returns cached global knowledge for context enrichment
  getGlobalKnowledge() { return this._globalKnowledgeCache; }

  // ── Submit to global learning pipeline ────────────────────────
  // Called after private learning, when consent is given.
  // Input: a learning event from LearningAdapter.
  async submitToGlobalLearning(learningEvent) {
    if (!this._globalConsent || !this._uid) return;
    if (!learningEvent) return;

    try {
      // Step 1: Generalize
      const candidate = generalize(learningEvent);
      if (!candidate) return;

      // Step 2: Submit through promotion engine (includes firewall + dedup)
      await submitCandidate(this._uid, candidate, this._globalConsent);
    } catch (_) {
      // Global learning failure must never affect the user's private session
    }
  }

  // ── Initialize model ──────────────────────────────────────────
  async initializeModel(onProgress, preferredModelId = null) {
    this.model.setProgressCallback(onProgress);
    try {
      await this.model.initialize(preferredModelId);
      // Check actual model status — initialize() may return without throwing
      // even on failure (e.g. WebGPU unavailable), in which case status is "error".
      const actualStatus = this.model.getStatus();
      if (actualStatus === "online") {
        this._systemStatus.model  = "online";
        this._systemStatus.webgpu = this.model.getWebGPU()?.available ? "available" : "unavailable";
        // Notify learning adapter so it can enable semantic understanding
        this.learning.setModelReady(this.model);
        // ── Bug fix: propagate REAL context window size to ContextBudgetManager ──
        // Without this the budget manager defaults to 4096 regardless of the
        // loaded model.  SmolLM2-135M had only 2048 tokens; the CPU fallback
        // (Qwen2.5-0.5B) has 4096 — but GPU models (Llama 3.2 3B) have 4096+.
        // Always let the actual loaded model size drive the budget.
        const caps = this.model.getCapabilities();
        if (caps.contextLength && caps.contextLength > 0) {
          this.context.setModelContextSize(caps.contextLength);
          console.log(`[SHADOW] Context budget set to model context length: ${caps.contextLength} tokens`);
        }
      } else {
        this._systemStatus.model  = "error";
        this._systemStatus.webgpu = this.model.getWebGPU()?.available ? "available" : "unavailable";
        // Throw so the caller (.catch) handles it correctly
        throw new Error(this.model.getError() || "Model initialization failed");
      }
    } catch (err) {
      this._systemStatus.model = "error";
      throw err;
    }
  }

  // ── Load private context data ─────────────────────────────────
  async loadContextData() {
    const [memories, knowledge] = await Promise.all([
      this.memory.getAllMemories(),
      this.knowledge.getAllKnowledge()
    ]);
    return { memories, knowledge };
  }

  // ── Persist emotional state ───────────────────────────────────
  async persistEmotionalState() {
    await this.emotion.persist();
  }

  // ── Run reflection pass ───────────────────────────────────────
  async runReflection() {
    if (!this._uid) return [];
    this._reflecting = true;
    this._systemStatus.reflection = "reflecting";
    try {
      const results = await this.reflection.reflectRecent(7);
      return results;
    } finally {
      this._reflecting = false;
      this._systemStatus.reflection = "idle";
    }
  }

  // ── Privacy scan (for UI/testing) ────────────────────────────
  firewallCheck(text) {
    return firewallScan(text);
  }

  // ── Get stats ─────────────────────────────────────────────────
  async getStats() {
    const [memories, knowledge, relationships, brains, mistakes] = await Promise.all([
      this.memory.getAllMemories(),
      this.knowledge.getAllKnowledge(),
      this.graph.getAllRelationships(),
      this.projectBrain.getAllBrains(),
      this.mistakeMemory.getAllMistakes()
    ]);

    let globalStats = { candidateCount: 0, promotedCount: 0 };
    try {
      globalStats = await getGlobalLearningStats();
    } catch (_) {}

    return {
      memoryCount:       memories.length,
      knowledgeCount:    knowledge.length,
      relationshipCount: relationships.length,
      projectBrainCount: brains.length,
      mistakeCount:      mistakes.length,
      emotionalState:    this.emotion.getState(),
      globalCandidates:  globalStats.candidateCount,
      globalKnowledge:   globalStats.promotedCount
    };
  }

  // ── Sub-system accessors ──────────────────────────────────────
  getProjectBrain()       { return this.projectBrain; }
  getMistakeMemory()      { return this.mistakeMemory; }
  getConfidenceEngine()   { return this.confidence; }
  getCuriosityEngine()    { return this.curiosity; }
  getMemoryIntentEngine() { return this.memoryIntent; }
  getSessionContext()     { return this.sessionContext; }
  getVoiceEngine()        { return this.voice; }
  getStateController()    { return this.stateController; }

  // ── Checkpoint E: Learning control ────────────────────────────
  isLearningEnabled()  { return this._learningEnabled; }
  isHistoryEnabled()   { return this._historyEnabled; }

  async setLearningEnabled(uid, enabled) {
    this._learningEnabled = enabled;
    this.conversation.setLearningEnabled(enabled);
    try { await savePreferences(uid, { learningEnabled: enabled }); } catch (_) {}
  }

  async setHistoryEnabled(uid, enabled) {
    this._historyEnabled = enabled;
    // Do NOT delete existing history — just stop saving new messages
    try { await savePreferences(uid, { historyEnabled: enabled }); } catch (_) {}
  }

  // ── Checkpoint D: Voice preferences persistence ───────────────
  async saveVoicePreferences(uid) {
    const prefs = this.voice.getPreferences();
    try { await savePreferences(uid, { voice: prefs }); } catch (_) {}
  }

  // ── Checkpoint E: Enhanced getSystemStatus ────────────────────
  getSystemStatus() {
    return {
      ...this._systemStatus,
      modelId:         this.model.getModelId(),
      modelError:      this.model.getError(),
      initialized:     this._initialized,
      reflecting:      this._reflecting,
      globalConsent:   this._globalConsent,
      // Checkpoint E additions
      historyEnabled:  this._historyEnabled,
      learningEnabled: this._learningEnabled,
      speechEnabled:   this.voice.isSpeechEnabled(),
      micAvailable:    VoiceEngine.recognitionAvailable,
      ttsAvailable:    VoiceEngine.synthesisAvailable,
      srState:         this.stateController.getState()
    };
  }
}
