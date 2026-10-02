// ============================================================
// Learning Adapter — Hybrid Understanding Integration
// Analyzes every interaction and extracts structured knowledge.
// NOW USES: UnderstandingEngine for hybrid rule+model analysis.
// Full pipeline: Interaction → Understanding → Signals → Project
//   → Corrections → Mistake Memory → Knowledge Extraction →
//   Confidence Update → Project Brain Update → Reflection Queue
// ============================================================
import { MEMORY_TYPES, PRIVACY_LEVELS } from "./memory-engine.js";
import { BRAIN_ENTRY_TYPES }            from "./project-brain.js";
import { saveCorrection, saveLearningEvent } from "../firebase/firestore-service.js";
import { UnderstandingEngine, KNOWLEDGE_STATE, TEMPORAL_STATE, WRITE_DECISION } from "./understanding-engine.js";

// ── Interaction Categories ─────────────────────────────────
const LEARN_CATEGORIES = {
  PROJECT_FACT:    "project-fact",
  SOLUTION:        "solution",
  CORRECTION:      "correction",
  PREFERENCE:      "preference",
  CONFIRMATION:    "confirmation",
  PROBLEM:         "problem",
  ARCHITECTURE:    "architecture",
  TECHNOLOGY:      "technology",
  DECISION:        "decision",
  GENERAL_FACT:    "general-fact"
};

// ── Signal patterns ───────────────────────────────────────
const CORRECTION_PATTERNS = [
  /actually,?\s+(that'?s?\s+)?(?:not|wrong|incorrect)/i,
  /no,?\s+that('s|\s+is)?\s+(?:not|wrong|incorrect)/i,
  /you('re|\s+are)\s+(?:wrong|incorrect|mistaken)/i,
  /that(?:'s|\s+is)\s+(?:not\s+)?(?:wrong|incorrect|false)/i,
  /please\s+(?:correct|fix|update)\s+(?:that|this|your)/i,
  /i\s+(?:said|meant|told\s+you)/i,
  /that('s| is) not right/i,
  /that('s| is) incorrect/i,
  /not what i (said|meant|asked)/i
];

const SUCCESS_PATTERNS = [
  /(?:that\s+)?(?:worked|fixed\s+it|solved\s+it|works)/i,
  /(?:thank\s+you|thanks)[\.,!]/i,
  /perfect[\.!]/i,
  /exactly\s+(?:right|correct|what\s+i\s+needed)/i,
  /(?:yes|yep|yeah)[,!\s]+that'?s?\s+(?:right|correct|it)/i
];

const FAILURE_PATTERNS = [
  /(?:doesn'?t|did\s+not|didn'?t)\s+work/i,
  /still\s+(?:broken|failing|not\s+working)/i,
  /same\s+(?:error|issue|problem)/i,
  /that\s+didn'?t\s+(?:help|work|fix)/i
];

const PROJECT_PATTERNS = [
  /(?:for|in|on|about)\s+shadow\s+(?:nexus\s+social|reaper|of\s+salem)/i,
  /(?:for|in|on|about)\s+(?:aurenix|legend)/i,
  /(?:my|the)\s+(?:website|project|app|site)\s+(?:called|named)?\s+(\w+)/i
];

const TECH_PATTERNS = [
  /(?:using|built\s+with|powered\s+by|runs\s+on)\s+([\w\s]+?)(?:\.|,|$)/i,
  /firebase|firestore|react|vue|angular|next\.?js|node\.?js|typescript|javascript/i,
  /cloudflare|vercel|netlify|aws|gcp|azure/i
];

export class LearningAdapter {
  constructor(memoryEngine, knowledgeEngine, knowledgeGraph, retrievalEngine,
              mistakeMemory = null, projectBrain = null, confidenceEngine = null) {
    this._memory      = memoryEngine;
    this._knowledge   = knowledgeEngine;
    this._graph       = knowledgeGraph;
    this._retrieval   = retrievalEngine;
    this._mistakes    = mistakeMemory;
    this._projectBrain = projectBrain;
    this._confidence  = confidenceEngine;
    this._activityLog = [];
    this._uid         = null;

    // Hybrid Understanding Engine — passes model manager when available
    this._understanding = new UnderstandingEngine(null);
  }

  // Called when local model is ready — enables semantic analysis
  setModelReady(modelManager) {
    this._understanding.setModelReady(modelManager);
  }

  setUID(uid) { this._uid = uid; }
  clearActivityLog() { this._activityLog = []; }
  getActivityLog()   { return [...this._activityLog]; }

  _log(step, detail = "") {
    this._activityLog.push({ step, detail, timestamp: Date.now() });
  }

  // ── Main entry point ──────────────────────────────────────
  async processInteraction({ userMessage, assistantResponse, conversationId, project, allMemories, allKnowledge, contextParts = {} }) {
    this._activityLog = [];
    this._log("INTERACTION RECEIVED", userMessage.slice(0, 80));

    // Integration A: extract sessionContext if passed through contextParts
    const sessionContext = contextParts.sessionContext || null;

    const results = {
      signals:          {},
      newMemories:      [],
      updatedMemory:    null,
      newKnowledge:     [],
      newRelationships: [],
      corrections:      [],
      newMistakes:      [],
      shouldReflect:    false,
      detectedProject:  null,
      understanding:    null  // semantic analysis result
    };

    // 0. Hybrid understanding analysis (rule + optional model)
    this._understanding.updateModelState();
    const understanding = await this._understanding.analyze(userMessage, {
      assistantResponse,
      conversationHistory: contextParts.conversationHistory || [],
      activeProject:       project,
      knownProjects:       this._projectBrain?.getKnownProjects() || [],
      sessionContext                                          // Integration A
    }).catch(() => null);

    if (understanding) {
      results.understanding = understanding;
      this._log("UNDERSTANDING", `state=${understanding.knowledgeState} temporal=${understanding.temporalState} write=${understanding.writeDecision} source=${understanding.source}`);
    }

    // 1. Detect interaction signals (kept for compatibility)
    results.signals = this._detectSignals(userMessage, assistantResponse);

    // Merge understanding engine signals with rule signals
    if (understanding) {
      results.signals.isCorrection = results.signals.isCorrection || understanding.isCorrection;
      results.signals.isSuccess    = results.signals.isSuccess    || understanding.isSuccess;
      results.signals.isFailure    = results.signals.isFailure    || understanding.isFailed;
    }

    this._log("SIGNALS DETECTED", JSON.stringify(results.signals));

    // 2. Detect active project (supplement what context engine already found)
    let detectedProject = project ||
      (this._projectBrain
        ? this._projectBrain.identifyProject(userMessage + " " + assistantResponse)?.name || null
        : this._detectProject(userMessage + " " + assistantResponse));

    // Use understanding engine's project if we don't have one
    if (!detectedProject && understanding?.project) {
      detectedProject = understanding.project;
    }

    // Auto-detect and register new project mentions
    if (!detectedProject && this._projectBrain) {
      const newProjMention = this._projectBrain.detectNewProjectMention(userMessage);
      if (newProjMention) {
        this._log("NEW PROJECT DETECTED", newProjMention.name);
        await this._projectBrain.registerProject(
          newProjMention.id, newProjMention.name,
          newProjMention.aliases, newProjMention.keywords
        ).catch(() => {});
        detectedProject = newProjMention.name;
      }
    }

    if (detectedProject) {
      this._log("PROJECT IDENTIFIED", typeof detectedProject === "object" ? detectedProject.name : detectedProject);
      results.detectedProject = typeof detectedProject === "object" ? detectedProject.name : detectedProject;
    }

    const activeProject = results.detectedProject || project;

    // 2b. Early exit: if write decision is IGNORE, skip all learning
    if (understanding?.writeDecision === WRITE_DECISION.IGNORE) {
      this._log("WRITE DECISION: IGNORE — no learning from this message");
      return results;
    }

    // 3. Handle corrections — full pipeline
    if (results.signals.isCorrection) {
      this._log("CORRECTION DETECTED");
      const correction = await this._processCorrection(
        userMessage, assistantResponse, allMemories, activeProject, conversationId, contextParts
      );
      results.corrections.push(correction);

      // Record in Mistake Memory
      if (this._mistakes && this._uid) {
        this._log("RECORDING IN MISTAKE MEMORY");
        const mistake = await this._mistakes.recordMistake({
          originalQuestion:  this._extractOriginalQuestion(contextParts),
          originalResponse:  correction.originalAssistantResponse,
          correction:        userMessage,
          projectId:         activeProject,
          topic:             correction.topic,
          confidenceBefore:  correction.confidenceBefore,
          conversationId
        });
        if (mistake) {
          results.newMistakes.push(mistake);
          this._log("MISTAKE RECORDED", mistake.topic || "general");
        }
      }

      // Update Project Brain with correction
      if (this._projectBrain && activeProject && this._uid) {
        this._log("UPDATING PROJECT BRAIN WITH CORRECTION");
        await this._projectBrain.recordCorrection(activeProject, {
          topic:             correction.topic,
          originalConclusion: correction.originalAssistantResponse?.slice(0, 200),
          correction:        userMessage.slice(0, 200),
          mistakeId:         results.newMistakes[0]?.id || null
        }).catch(() => {});
      }

      // Adjust confidence for the affected concepts
      if (this._confidence) {
        for (const concept of correction.relatedConcepts) {
          this._log("REDUCING CONFIDENCE", concept);
          await this._confidence.applyCorrection(concept, userMessage).catch(() => {});
        }
      }
    }

    // 4. Handle confirmations
    if (results.signals.isSuccess) {
      this._log("SUCCESS CONFIRMATION DETECTED");
      await this._processConfirmation(userMessage, allMemories);

      // Confirm any mistakes that were being worked on
      if (this._mistakes && this._uid && results.corrections.length === 0) {
        // If there were pending unconfirmed mistakes related to this context, confirm them
        const recentMistakes = await this._mistakes.getRelevantMistakes(userMessage, {
          project: activeProject
        }).catch(() => []);
        for (const m of recentMistakes.filter(m => !m.confirmed)) {
          await this._mistakes.confirmMistake(m.id).catch(() => {});
          this._log("MISTAKE CONFIRMED", m.topic);
        }
      }

      // Boost confidence on confirmed concepts
      if (this._confidence) {
        const relatedMemories = this._retrieval.retrieveRelevant(allMemories, userMessage, { topN: 3 });
        for (const mem of relatedMemories) {
          await this._confidence.confirm(mem.concept || mem.id || "unknown").catch(() => {});
        }
      }
    }

    // 5. Extract new learnable information
    this._log("ANALYZING FOR NEW INFORMATION");
    const extracted = this._extractInformation(userMessage, assistantResponse, activeProject);

    // 6. Check against existing knowledge to avoid duplicates
    for (const item of extracted) {
      const isDuplicate = this._checkDuplicate(item, allMemories, allKnowledge);
      if (!isDuplicate && item.importance >= 0.3) {
        this._log("NEW INFORMATION FOUND", item.concept);

        // Apply understanding engine's write decision and knowledge state
        const writeDecision = understanding?.writeDecision || WRITE_DECISION.SEMANTIC;
        const knowledgeState = understanding?.knowledgeState || KNOWLEDGE_STATE.FACT;
        const temporalState  = understanding?.temporalState  || "CURRENT";

        // CRITICAL: Ideas must never be stored as facts
        if (knowledgeState === KNOWLEDGE_STATE.IDEA ||
            knowledgeState === KNOWLEDGE_STATE.POSSIBILITY) {
          // Store as episodic/idea only — NOT semantic fact
          if (writeDecision !== WRITE_DECISION.IGNORE) {
            const memory = await this._memory._storeMemory({
              memoryType:    MEMORY_TYPES.EPISODIC,
              concept:       item.concept,
              category:      "idea",
              fact:          `IDEA (unconfirmed): ${item.fact}`,
              project:       activeProject,
              importance:    Math.min(item.importance, 0.55), // cap idea importance
              confidence:    Math.min(item.confidence, 0.65),
              sourceConvId:  conversationId,
              privacy:       PRIVACY_LEVELS.PRIVATE,
              tags:          [...(item.tags || []), "idea", "unconfirmed"],
              knowledgeState,
              temporalState
            });
            results.newMemories.push(memory);
            this._log("IDEA STORED (not fact)", item.concept);

            // Record as idea in project brain
            if (this._projectBrain && activeProject) {
              await this._projectBrain.recordIdea(activeProject, {
                title:       item.concept,
                content:     item.fact,
                confidence:  Math.min(item.confidence, 0.65),
                sourceConvId: conversationId
              }).catch(() => {});
            }
          }
          continue; // skip normal fact/knowledge storage
        }

        // ABANDONED/REMOVED: preserve history, mark current state
        if (knowledgeState === KNOWLEDGE_STATE.ABANDONED) {
          if (this._projectBrain && activeProject) {
            await this._projectBrain.recordAbandoned(activeProject, {
              title:       item.concept,
              content:     item.fact,
              reason:      understanding?.reason || null,
              sourceConvId: conversationId
            }).catch(() => {});
            this._log("ABANDONED RECORDED", item.concept);
          }
          // Still store in memory as historical record
          const memory = await this._memory._storeMemory({
            memoryType:    MEMORY_TYPES.EPISODIC,
            concept:       item.concept,
            category:      "abandoned",
            fact:          `REMOVED: ${item.fact}${understanding?.reason ? ` (reason: ${understanding.reason})` : ""}`,
            project:       activeProject,
            importance:    item.importance,
            confidence:    item.confidence,
            sourceConvId:  conversationId,
            privacy:       PRIVACY_LEVELS.PRIVATE,
            tags:          [...(item.tags || []), "abandoned", "removed"],
            knowledgeState: KNOWLEDGE_STATE.ABANDONED,
            temporalState:  "REMOVED"
          });
          results.newMemories.push(memory);
          continue;
        }

        // PAUSED/ON HOLD: store without deleting
        if (understanding?.isHold) {
          if (this._projectBrain && activeProject) {
            await this._projectBrain.addEntry(activeProject, {
              type:        BRAIN_ENTRY_TYPES.PAUSED,
              title:       `ON HOLD: ${item.concept}`,
              content:     item.fact,
              confidence:  item.confidence,
              importance:  item.importance,
              tags:        [...(item.tags || []), "paused"],
              sourceConvId: conversationId,
              metadata:    { knowledgeState: KNOWLEDGE_STATE.PLAN, temporalState: "PAUSED" }
            }).catch(() => {});
            this._log("PAUSED RECORDED", item.concept);
          }
          continue;
        }

        const memoryType = this._classifyMemoryTypeFromWrite(writeDecision, item);
        const memory = await this._memory._storeMemory({
          memoryType,
          concept:       item.concept,
          category:      item.category,
          fact:          item.fact,
          project:       activeProject,
          importance:    item.importance,
          confidence:    item.confidence,
          sourceConvId:  conversationId,
          privacy:       PRIVACY_LEVELS.PRIVATE,
          relationships: item.relationships || [],
          tags:          item.tags || [],
          knowledgeState,
          temporalState
        });
        results.newMemories.push(memory);
        this._log("MEMORY STORED", item.concept);

        // Register confidence record for new information
        if (this._confidence) {
          await this._confidence.registerNew(item.concept, {
            confidence:  item.confidence,
            sourceType:  "conversation"
          }).catch(() => {});
        }

        // Update knowledge graph relationships
        if (item.relationships?.length > 0) {
          for (const rel of item.relationships) {
            this._log("RELATIONSHIP IDENTIFIED", `${item.concept} → ${rel}`);
            results.newRelationships.push({ from: item.concept, to: rel, type: "related-to" });
          }
        }

        // Promote to learned knowledge if high confidence AND it's a real fact/decision
        const promotableStates = [
          KNOWLEDGE_STATE.FACT, KNOWLEDGE_STATE.DECISION,
          KNOWLEDGE_STATE.SUCCESSFUL_APPROACH, KNOWLEDGE_STATE.PREFERENCE
        ];
        if (item.confidence >= 0.8 && item.importance >= 0.6 &&
            promotableStates.includes(knowledgeState)) {
          this._log("PROMOTING TO KNOWLEDGE", item.concept);
          const knowledge = await this._knowledge.storeKnowledge({
            concept:    item.concept,
            category:   item.category,
            fact:       item.fact,
            project:    activeProject,
            importance: item.importance,
            confidence: item.confidence,
            sourceConvId: conversationId,
            privacy:    PRIVACY_LEVELS.PRIVATE,
            relationships: item.relationships || [],
            knowledgeState,
            temporalState
          });
          results.newKnowledge.push(knowledge);
          this._log("KNOWLEDGE STORED", item.concept);
        }

        // Add to Project Brain
        if (this._projectBrain && activeProject && item.importance >= 0.55) {
          const brainEntryType = this._mapToBrainEntryType(item.category, knowledgeState);
          await this._projectBrain.addEntry(activeProject, {
            type:         brainEntryType,
            title:        item.concept,
            content:      item.fact,
            confidence:   item.confidence,
            importance:   item.importance,
            tags:         item.tags || [],
            sourceConvId: conversationId,
            metadata:     { knowledgeState, temporalState }
          }).catch(() => {});
          this._log("PROJECT BRAIN UPDATED", `${activeProject}: ${item.concept}`);
        }
      }
    }

    // 7. Handle failure signals (record attempted fix that didn't work)
    if (results.signals.isFailure && activeProject && this._projectBrain) {
      this._log("FAILURE DETECTED — RECORDING ATTEMPTED FIX");
      await this._projectBrain.addEntry(activeProject, {
        type:        BRAIN_ENTRY_TYPES.FIX_ATTEMPTED,
        title:       "Attempted fix (unsuccessful)",
        content:     userMessage.slice(0, 300),
        confidence:  0.5,
        importance:  0.6,
        tags:        ["failed-fix"],
        sourceConvId: conversationId
      }).catch(() => {});
    }

    // 8. Handle success signals (record successful fix)
    if (results.signals.isSuccess && activeProject && this._projectBrain) {
      this._log("SUCCESS — RECORDING SOLUTION");
      const solutionText = this._extractSolutionContext(userMessage, assistantResponse);
      if (solutionText) {
        await this._projectBrain.recordSolvedIssue(activeProject, {
          title:       "Resolved issue",
          description: solutionText.problem,
          solution:    solutionText.solution
        }).catch(() => {});
      }
    }

    // 9. Determine if reflection needed
    const newCount = results.newMemories.length + results.corrections.length + results.newMistakes.length;
    results.shouldReflect = newCount >= 3;
    if (results.shouldReflect) this._log("REFLECTION TRIGGERED");

    // 10. Persist learning event summary to Firestore
    if (this._uid && (results.newMemories.length > 0 || results.corrections.length > 0 || results.newKnowledge.length > 0)) {
      saveLearningEvent(this._uid, {
        conversationId:    conversationId,
        project:           activeProject || null,
        newMemoryCount:    results.newMemories.length,
        newKnowledgeCount: results.newKnowledge.length,
        correctionCount:   results.corrections.length,
        mistakeCount:      results.newMistakes.length,
        signals:           results.signals
      }).catch(() => {});
    }

    this._log("ADAPTIVE STATE UPDATED");
    return results;
  }

  // ── Signal Detection ──────────────────────────────────────
  _detectSignals(userMsg, assistantMsg) {
    const combined = userMsg + " " + assistantMsg;
    return {
      isCorrection: CORRECTION_PATTERNS.some(p => p.test(userMsg)),
      isSuccess:    SUCCESS_PATTERNS.some(p => p.test(userMsg)),
      isFailure:    FAILURE_PATTERNS.some(p => p.test(userMsg)),
      hasProject:   PROJECT_PATTERNS.some(p => p.test(combined)),
      hasTech:      TECH_PATTERNS.some(p => p.test(combined)),
      isQuestion:   userMsg.includes("?") || /^(what|how|why|when|where|who|can|could|would|should|is|are|does|do|did)\b/i.test(userMsg.trim()),
      isLong:       userMsg.length > 300,
      mentionsError:/error|bug|broken|failing|crash|issue|problem/i.test(combined),
      mentionsSolution: /(?:fix|solution|solved|working|resolved|answer)/i.test(combined)
    };
  }

  // ── Project Detection (fallback) ──────────────────────────
  _detectProject(text) {
    const knownProjects = [
      "Shadow Nexus Social", "Shadow of Salem", "Shadow Reaper",
      "Aurenix", "Legend"
    ];
    const lower = text.toLowerCase();
    for (const p of knownProjects) {
      if (lower.includes(p.toLowerCase())) return p;
    }
    return null;
  }

  // ── Information Extraction ────────────────────────────────
  _extractInformation(userMsg, assistantMsg, project) {
    const extracted = [];
    const combined  = userMsg + "\n" + assistantMsg;

    // Extract technology mentions
    const techMatch = combined.match(/\b(firebase|firestore|react|vue|angular|next\.?js|node\.?js|typescript|javascript|cloudflare|vercel|webgpu|webllm|indexeddb)\b/gi);
    if (techMatch) {
      const techs = [...new Set(techMatch.map(t => t.toLowerCase()))];
      for (const tech of techs) {
        extracted.push({
          concept:   tech,
          category:  LEARN_CATEGORIES.TECHNOLOGY,
          fact:      `Uses ${tech}${project ? ` in ${project}` : ""}`,
          importance: project ? 0.7 : 0.4,
          confidence: 0.8,
          relationships: project ? [project] : [],
          tags: ["technology", tech]
        });
      }
    }

    // Extract problem statements
    if (/error|bug|broken|failing|crash|issue|problem/i.test(combined)) {
      const problemMatch = combined.match(/(?:error|bug|issue|problem)[:.]?\s*([^\n.!?]{10,100})/i);
      if (problemMatch) {
        extracted.push({
          concept:   project ? `${project} issue` : "technical issue",
          category:  LEARN_CATEGORIES.PROBLEM,
          fact:      problemMatch[1].trim(),
          importance: 0.75,
          confidence: 0.7,
          relationships: project ? [project] : [],
          tags: ["problem", "technical"]
        });
      }
    }

    // Extract solutions
    if (/fix|solution|solved|resolved/i.test(combined)) {
      const solutionMatch = combined.match(/(?:fix|solution|solved|resolved)[:.]?\s*([^\n.!?]{10,150})/i);
      if (solutionMatch) {
        extracted.push({
          concept:   project ? `${project} solution` : "technical solution",
          category:  LEARN_CATEGORIES.SOLUTION,
          fact:      solutionMatch[1].trim(),
          importance: 0.85,
          confidence: 0.75,
          relationships: project ? [project] : [],
          tags: ["solution", "technical"]
        });
      }
    }

    // Extract preferences — Integration A: distinguish temporary from permanent
    const prefMatch = userMsg.match(/(?:i\s+(?:prefer|like|want|always)\s+)([^\n.!?]{5,80})/i);
    if (prefMatch) {
      // Check for temporary signals — if temporary, lower importance so it's not
      // promoted to permanent knowledge (stays episodic at best)
      const TEMP_SIGNALS = [/\bjust\s+(?:this\s+time|for\s+now|once|here)\b/i, /\bfor\s+(?:now|today)\b/i];
      const PERM_SIGNALS = [/\bfrom\s+now\s+on\b/i, /\bgoing\s+forward\b/i, /\balways\b/i, /\beverytime\b/i];
      const isTemporary  = TEMP_SIGNALS.some(p => p.test(userMsg));
      const isPermanent  = PERM_SIGNALS.some(p => p.test(userMsg));

      extracted.push({
        concept:    "operator preference",
        category:   LEARN_CATEGORIES.PREFERENCE,
        fact:       prefMatch[1].trim(),
        importance: isPermanent ? 0.80 : isTemporary ? 0.25 : 0.65,
        confidence: isPermanent ? 0.95 : isTemporary ? 0.50 : 0.90,
        relationships: [],
        tags: ["preference", isTemporary ? "temporary" : isPermanent ? "permanent" : "inferred"]
      });
    }

    // Integration A: also catch "from now on" preferences even without "prefer/like"
    const fromNowOnMatch = userMsg.match(/\bfrom\s+now\s+on[,\s]+(.{5,120})$/i) ||
                           userMsg.match(/\bgoing\s+forward[,\s]+(.{5,120})$/i);
    if (fromNowOnMatch && !prefMatch) {
      // Could be a preference about style, format, behavior
      const content = fromNowOnMatch[1].trim();
      if (/\b(?:keep|make|give|use|write|explain|show|respond|answer|always)\b/i.test(content)) {
        extracted.push({
          concept:    "operator preference",
          category:   LEARN_CATEGORIES.PREFERENCE,
          fact:       content,
          importance: 0.80,
          confidence: 0.90,
          relationships: [],
          tags: ["preference", "permanent", "explicit"]
        });
      }
    }

    // Extract project features
    if (project) {
      const featureMatch = combined.match(/(?:feature|function|component|module|system|page|section)[:.]?\s*([^\n.!?]{5,100})/i);
      if (featureMatch) {
        extracted.push({
          concept:   `${project} feature`,
          category:  LEARN_CATEGORIES.PROJECT_FACT,
          fact:      featureMatch[1].trim(),
          importance: 0.7,
          confidence: 0.7,
          relationships: [project],
          tags: ["feature", project.toLowerCase().replace(/\s/g, "-")]
        });
      }
    }

    return extracted;
  }

  // ── Correction Processing (enhanced) ─────────────────────
  async _processCorrection(userMsg, assistantMsg, allMemories, project, convId, contextParts = {}) {
    const relatedMemories = this._retrieval.retrieveRelevant(allMemories, userMsg, {
      topN: 3,
      context: { project }
    });

    // Try to identify what the original (wrong) assistant response was
    const originalAssistantResponse = this._extractLastAssistantResponse(contextParts) || assistantMsg?.slice(0, 300);

    // Estimate confidence before correction from related memories
    const avgConf = relatedMemories.length > 0
      ? relatedMemories.reduce((s, m) => s + (m.confidence || 0.5), 0) / relatedMemories.length
      : 0.5;

    const correctionRecord = {
      originalMessage:          userMsg.slice(0, 500),
      originalAssistantResponse: originalAssistantResponse,
      project:                  project || null,
      topic:                    this._detectTopic(userMsg, assistantMsg),
      sourceConvId:             convId,
      relatedConcepts:          relatedMemories.map(m => m.concept).filter(Boolean),
      correctionSummary:        `Correction: ${userMsg.slice(0, 200)}`,
      confidenceBefore:         avgConf,
      privacy:                  PRIVACY_LEVELS.PRIVATE
    };

    // Persist to corrections collection
    if (this._uid) {
      saveCorrection(this._uid, correctionRecord).catch(() => {});
    }

    // Contradict related memories
    for (const mem of relatedMemories) {
      if (mem.id) {
        await this._memory.contradictMemory(mem.id, correctionRecord.correctionSummary);
      }
    }

    return correctionRecord;
  }

  // ── Confirmation Processing ────────────────────────────────
  async _processConfirmation(userMsg, allMemories) {
    const relatedMemories = this._retrieval.retrieveRelevant(allMemories, userMsg, { topN: 3 });
    for (const mem of relatedMemories) {
      if (mem.id) await this._memory.confirmMemory(mem.id);
    }
  }

  // ── Duplicate Check — enhanced with semantic token overlap ──
  _checkDuplicate(item, allMemories, allKnowledge) {
    const factLower    = item.fact?.toLowerCase() || "";
    const conceptLower = item.concept?.toLowerCase() || "";

    // Tokenize for semantic overlap
    const factTokens    = new Set(factLower.split(/\s+/).filter(w => w.length > 3));
    const conceptTokens = new Set(conceptLower.split(/\s+/).filter(w => w.length > 3));

    const inMemories = allMemories.some(m => {
      const mFact    = (m.fact || "").toLowerCase();
      const mConcept = (m.concept || "").toLowerCase();

      // Exact match
      if (mFact === factLower && factLower.length > 10) return true;

      // Near-duplicate: concept + fact overlap both high
      if (conceptTokens.size > 0 && factTokens.size > 0) {
        const mConceptToks = new Set(mConcept.split(/\s+/).filter(w => w.length > 3));
        const mFactToks    = new Set(mFact.split(/\s+/).filter(w => w.length > 3));

        let cOverlap = 0;
        for (const t of conceptTokens) if (mConceptToks.has(t)) cOverlap++;
        let fOverlap = 0;
        for (const t of factTokens) if (mFactToks.has(t)) fOverlap++;

        const conceptRatio = conceptTokens.size > 0 ? cOverlap / conceptTokens.size : 0;
        const factRatio    = factTokens.size > 0 ? fOverlap / Math.max(factTokens.size, mFactToks.size) : 0;

        // Both concept and fact are very similar → near duplicate
        if (conceptRatio > 0.7 && factRatio > 0.7) return true;
      }

      return false;
    });

    const inKnowledge = allKnowledge.some(k => {
      const kFact = (k.fact || "").toLowerCase();
      if (kFact === factLower && factLower.length > 10) return true;

      if (factTokens.size > 0) {
        const kFactToks = new Set(kFact.split(/\s+/).filter(w => w.length > 3));
        let fOverlap = 0;
        for (const t of factTokens) if (kFactToks.has(t)) fOverlap++;
        const factRatio = fOverlap / Math.max(factTokens.size, kFactToks.size || 1);
        if (factRatio > 0.85) return true;
      }

      return false;
    });

    return inMemories || inKnowledge;
  }

  // ── Classify Memory Type ──────────────────────────────────
  _classifyMemoryType(item) {
    switch (item.category) {
      case LEARN_CATEGORIES.SOLUTION:    return MEMORY_TYPES.PROCEDURAL;
      case LEARN_CATEGORIES.PREFERENCE:  return MEMORY_TYPES.PREFERENCE;
      case LEARN_CATEGORIES.CORRECTION:  return MEMORY_TYPES.SEMANTIC;
      case LEARN_CATEGORIES.PROBLEM:     return MEMORY_TYPES.EPISODIC;
      default:                           return MEMORY_TYPES.SEMANTIC;
    }
  }

  // ── Classify Memory Type from write decision ─────────────
  _classifyMemoryTypeFromWrite(writeDecision, item) {
    switch (writeDecision) {
      case WRITE_DECISION.PROCEDURAL:          return MEMORY_TYPES.PROCEDURAL;
      case WRITE_DECISION.PREFERENCE:          return MEMORY_TYPES.PREFERENCE;
      case WRITE_DECISION.EPISODIC:            return MEMORY_TYPES.EPISODIC;
      case WRITE_DECISION.MISTAKE_CORRECTION:  return MEMORY_TYPES.SEMANTIC;
      case WRITE_DECISION.SEMANTIC:            return MEMORY_TYPES.SEMANTIC;
      default:                                 return this._classifyMemoryType(item);
    }
  }

  // ── Map learning category + knowledge state to brain entry type ──
  _mapToBrainEntryType(category, knowledgeState = null) {
    // Knowledge state takes priority for new state types
    if (knowledgeState) {
      if (knowledgeState === KNOWLEDGE_STATE.IDEA)
        return BRAIN_ENTRY_TYPES.IDEA;
      if (knowledgeState === KNOWLEDGE_STATE.ABANDONED)
        return BRAIN_ENTRY_TYPES.ABANDONED;
      if (knowledgeState === KNOWLEDGE_STATE.FAILED_APPROACH)
        return BRAIN_ENTRY_TYPES.FIX_FAILED;
      if (knowledgeState === KNOWLEDGE_STATE.SUCCESSFUL_APPROACH)
        return BRAIN_ENTRY_TYPES.FIX_SUCCEEDED;
      if (knowledgeState === KNOWLEDGE_STATE.DECISION)
        return BRAIN_ENTRY_TYPES.DECISION;
      if (knowledgeState === KNOWLEDGE_STATE.PLAN)
        return BRAIN_ENTRY_TYPES.REQUIREMENT;
    }

    switch (category) {
      case LEARN_CATEGORIES.SOLUTION:      return BRAIN_ENTRY_TYPES.FIX_SUCCEEDED;
      case LEARN_CATEGORIES.PROBLEM:       return BRAIN_ENTRY_TYPES.BUG;
      case LEARN_CATEGORIES.TECHNOLOGY:    return BRAIN_ENTRY_TYPES.TECHNOLOGY;
      case LEARN_CATEGORIES.ARCHITECTURE:  return BRAIN_ENTRY_TYPES.ARCHITECTURE;
      case LEARN_CATEGORIES.DECISION:      return BRAIN_ENTRY_TYPES.DECISION;
      case LEARN_CATEGORIES.PROJECT_FACT:  return BRAIN_ENTRY_TYPES.FEATURE;
      default:                             return BRAIN_ENTRY_TYPES.HISTORY;
    }
  }

  // ── Extract the original assistant question from context ──
  _extractOriginalQuestion(contextParts) {
    // The last assistant message before the correction
    return contextParts?.lastAssistantResponse || null;
  }

  // ── Extract last assistant response from contextParts ────
  _extractLastAssistantResponse(contextParts) {
    return contextParts?.lastAssistantResponse || null;
  }

  // ── Detect topic from text ────────────────────────────────
  _detectTopic(question, response) {
    const combined = ((question || "") + " " + (response || "")).toLowerCase();
    if (/tv|stream|playback|video|channel/i.test(combined))  return "media-playback";
    if (/firebase|firestore|database|auth/i.test(combined))  return "firebase";
    if (/cloudflare|r2|worker|pages/i.test(combined))        return "cloudflare";
    if (/webgpu|model|llm|ai|inference/i.test(combined))     return "ai-model";
    if (/css|layout|style|design/i.test(combined))           return "ui-design";
    if (/api|fetch|request|endpoint/i.test(combined))        return "api";
    if (/error|bug|crash|exception/i.test(combined))         return "debugging";
    if (/access|permission|guest|user/i.test(combined))      return "access-control";
    return "general";
  }

  // ── Extract solution context from text ────────────────────
  _extractSolutionContext(userMsg, assistantMsg) {
    const problemMatch  = assistantMsg?.match(/(?:issue|problem|error|bug)[:.]?\s*([^\n.!?]{10,150})/i);
    const solutionMatch = assistantMsg?.match(/(?:fix|solution|solved|resolved|try|use)[:.]?\s*([^\n.!?]{10,200})/i);
    if (!solutionMatch) return null;
    return {
      problem:  problemMatch?.[1]?.trim() || userMsg.slice(0, 150),
      solution: solutionMatch[1].trim()
    };
  }
}
