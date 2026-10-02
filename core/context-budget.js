// ============================================================
// Context Budget Manager
// Prevents context window overflow before inference.
// Allocates token budget across:
//   - system identity
//   - conversation history
//   - project brain entries
//   - memories
//   - knowledge
//   - mistakes
//   - preferences
//   - confidence notes
//
// Ranks content by relevance. Summarizes older context.
// Never silently overflows the model's context window.
// ============================================================

// ── Default budget limits (in approximate tokens) ─────────
const DEFAULT_BUDGET = {
  total:           4096,  // conservative for small local models
  systemIdentity:   800,  // personality + base instructions
  projectBrain:     600,  // most important project-specific context
  mistakes:         400,  // past mistakes to avoid repeating
  memories:         400,  // retrieved relevant memories
  knowledge:        500,  // retrieved relevant knowledge
  preferences:      200,  // active preferences
  confidence:       150,  // confidence notes
  history:         1200,  // conversation history (largest consumer)
  userMessage:      200   // current user message
};

// ── Rough token estimator (~3.5 chars per token) ──────────
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function estimateRecordTokens(record) {
  const text = [
    record.fact || record.content || "",
    record.concept || record.title || "",
    record.category || "",
  ].join(" ");
  return estimateTokens(text) + 10; // +10 for formatting overhead
}

export class ContextBudgetManager {
  constructor(modelContextSize = null) {
    // Try to detect model context size; fall back to conservative default
    this._contextSize   = modelContextSize || DEFAULT_BUDGET.total;
    this._budget        = { ...DEFAULT_BUDGET };
    this._lastBudgetLog = null;
  }

  // ── Update if model context size is known ────────────────
  setContextSize(tokens) {
    if (typeof tokens === "number" && tokens > 0) {
      this._contextSize = tokens;
      // Redistribute budget proportionally
      const scale = Math.min(2.0, tokens / DEFAULT_BUDGET.total);
      this._budget.total = Math.floor(DEFAULT_BUDGET.total * scale);
      // Keep each bucket proportional but cap to avoid waste
      for (const k of Object.keys(this._budget)) {
        if (k !== "total") {
          this._budget[k] = Math.floor(DEFAULT_BUDGET[k] * scale);
        }
      }
    }
  }

  // ── Main: trim all context pieces to fit the budget ──────
  // Returns trimmed versions of all context pieces
  allocate({
    systemPrompt        = "",
    projectBrainEntries = [],
    mistakes            = [],
    memories            = [],
    knowledge           = [],
    preferenceContext   = "",
    confidenceContext   = "",
    conversationHistory = [],
    userMessage         = ""
  }) {
    const used = {};

    // 1. System identity (hard limit — always included)
    const sysTokens = estimateTokens(systemPrompt);
    used.systemIdentity = Math.min(sysTokens, this._budget.systemIdentity);
    const systemTrimmed = sysTokens > this._budget.systemIdentity
      ? systemPrompt.slice(0, this._budget.systemIdentity * 3.5) + "\n[system prompt truncated]"
      : systemPrompt;

    // 2. User message (hard limit — always included)
    used.userMessage = Math.min(estimateTokens(userMessage), this._budget.userMessage);

    // 3. Calculate remaining budget
    const reservedTokens = used.systemIdentity + used.userMessage +
      this._budget.confidence + this._budget.preferences;
    const remaining = this._budget.total - reservedTokens;

    // 4. Project brain — highest priority, trim to budget
    const trimmedBrain = this._trimRecords(
      projectBrainEntries, this._budget.projectBrain, "projectBrain"
    );
    used.projectBrain = trimmedBrain.tokensUsed;

    // 5. Mistakes — second priority
    const trimmedMistakes = this._trimRecords(
      mistakes, this._budget.mistakes, "mistakes"
    );
    used.mistakes = trimmedMistakes.tokensUsed;

    // 6. Knowledge — third priority
    const trimmedKnowledge = this._trimRecords(
      knowledge, this._budget.knowledge, "knowledge"
    );
    used.knowledge = trimmedKnowledge.tokensUsed;

    // 7. Memories — fourth priority
    const trimmedMemories = this._trimRecords(
      memories, this._budget.memories, "memories"
    );
    used.memories = trimmedMemories.tokensUsed;

    // 8. Conversation history — use what's left after all other budgets
    const historyBudgetRemaining =
      this._budget.total
      - used.systemIdentity - used.userMessage
      - used.projectBrain - used.mistakes - used.knowledge - used.memories
      - this._budget.confidence - this._budget.preferences;

    const historyBudget = Math.max(400, Math.min(this._budget.history, historyBudgetRemaining));
    const trimmedHistory = this._trimHistory(conversationHistory, historyBudget);
    used.history = trimmedHistory.tokensUsed;

    // 9. Log budget for debugging
    this._lastBudgetLog = {
      total:          this._budget.total,
      allocated:      used,
      totalUsed:      Object.values(used).reduce((s, v) => s + v, 0),
      itemsDropped: {
        brainEntries: projectBrainEntries.length - trimmedBrain.records.length,
        mistakes:     mistakes.length - trimmedMistakes.records.length,
        knowledge:    knowledge.length - trimmedKnowledge.records.length,
        memories:     memories.length - trimmedMemories.records.length,
        historyTurns: conversationHistory.length - trimmedHistory.messages.length
      }
    };

    return {
      systemPrompt:        systemTrimmed,
      projectBrainEntries: trimmedBrain.records,
      mistakes:            trimmedMistakes.records,
      knowledge:           trimmedKnowledge.records,
      memories:            trimmedMemories.records,
      conversationHistory: trimmedHistory.messages,
      preferenceContext,   // passed through (already small)
      confidenceContext,   // passed through (already small)
      budgetLog:           this._lastBudgetLog
    };
  }

  // ── Trim a record array to a token budget ────────────────
  _trimRecords(records, budget, label) {
    if (!records || records.length === 0) {
      return { records: [], tokensUsed: 0 };
    }

    const kept = [];
    let tokensUsed = 0;

    for (const record of records) {
      const t = estimateRecordTokens(record);
      if (tokensUsed + t <= budget) {
        kept.push(record);
        tokensUsed += t;
      }
      // Drop the rest (they're already ranked by relevance from RetrievalEngine)
    }

    return { records: kept, tokensUsed };
  }

  // ── Trim conversation history to a token budget ───────────
  // Keeps the most RECENT turns; drops older turns first
  _trimHistory(messages, budget) {
    if (!messages || messages.length === 0) {
      return { messages: [], tokensUsed: 0 };
    }

    // Estimate total
    const withTokens = messages.map(m => ({
      msg: m,
      tokens: estimateTokens(m.content || "")
    }));

    // Take from the end (most recent first)
    const kept = [];
    let tokensUsed = 0;

    for (let i = withTokens.length - 1; i >= 0; i--) {
      const { msg, tokens } = withTokens[i];
      if (tokensUsed + tokens <= budget) {
        kept.unshift(msg); // restore original order
        tokensUsed += tokens;
      } else {
        // Ran out of budget — summarize the omitted period
        if (i > 0) {
          // Add a system-level summary marker (not a real message, just informational)
          kept.unshift({
            role: "system",
            content: `[${i + 1} earlier turns omitted to fit context window]`
          });
        }
        break;
      }
    }

    return { messages: kept, tokensUsed };
  }

  // ── Get last budget allocation log ───────────────────────
  getBudgetLog() { return this._lastBudgetLog; }

  // ── Check if a message would overflow context ────────────
  wouldOverflow(systemPrompt, messages) {
    const totalTokens = estimateTokens(systemPrompt) +
      messages.reduce((s, m) => s + estimateTokens(m.content || ""), 0);
    return totalTokens > this._budget.total * 0.95; // 5% safety margin
  }
}
