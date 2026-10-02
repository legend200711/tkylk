// ============================================================
// Session Context — Integration A
// Lightweight, in-memory tracking of the current conversation
// context window. NOT persistent storage — this is session-only
// and dies when the conversation resets.
//
// Tracks:
//   - Active project
//   - Active topic / subject
//   - Active feature being discussed
//   - Active problem being debugged
//   - Most recently proposed solution / attempted fix
//   - Most recent decision
//   - Most recent correction
//   - Referenced objects (the last N mentioned items per type)
//   - Answer depth preference (session-only unless made permanent)
//
// This provides conversation-continuity context:
//   "Do that." → what was last discussed
//   "Use the second one." → most recent list
//   "That didn't work." → most recent fix attempt
//   "Remove that instead." → what "that" refers to
// ============================================================

// ── Pronoun/referent patterns ─────────────────────────────
const FOLLOW_UP_PATTERNS = [
  /^(?:do\s+)?(?:that|it)\s*[.!]?\s*$/i,
  /^(?:use\s+(?:that|it|this|the\s+(?:first|second|third|last)\s+one))\s*[.!]?\s*$/i,
  /^go\s+back\s+to\s+(?:what\s+we\s+were\s+doing|that|the\s+other)\b/i,
  /^no,?\s+the\s+other\s+(?:one|website|project|option)\b/i,
  /^that\s+(?:didn'?t\s+work|worked|fixed\s+it)\s*[.!]?\s*$/i,
  /^(?:let'?s\s+)?keep\s+that\s*[.!]?\s*$/i,
  /^remove\s+that\s+(?:instead|one|feature|option)\s*[.!]?\s*$/i,
  /^what\s+about\s+the\s+other\s+(?:idea|option|approach|one)\b/i,
  /\bdo\s+(?:the\s+same|that\s+too|it\s+again)\b/i
];

// ── Answer depth signals ──────────────────────────────────
const DEPTH_PATTERNS = {
  QUICK: [
    /\bjust\s+(?:tell\s+me|say|give\s+me)\s+(?:yes\s+or\s+no|the\s+answer|a\s+quick|briefly)\b/i,
    /\bquick\s+(?:answer|question|check)\b/i,
    /\byes\s+or\s+no\b/i,
    /\bjust\s+(?:yes|no|tell\s+me\s+if)\b/i,
    /\bone[\-\s]?liner\b/i,
    /\bbriefly\b/i,
    /\bin\s+a\s+sentence\b/i,
    /\bshort\s+answer\b/i,
    /\btl;?dr\b/i
  ],
  DETAILED: [
    /\bexplain\s+(?:that|this|in\s+detail|thoroughly|fully)\b/i,
    /\bgo\s+into\s+(?:detail|more\s+depth|depth)\b/i,
    /\bin\s+detail\b/i,
    /\bthorough(?:ly)?\b/i,
    /\bcomprehensive(?:ly)?\b/i,
    /\bfull\s+(?:explanation|breakdown|walkthrough)\b/i
  ],
  STEP_BY_STEP: [
    /\bstep[\-\s]by[\-\s]step\b/i,
    /\bgive\s+me\s+the\s+steps\b/i,
    /\bwalk\s+me\s+through\b/i,
    /\bhow\s+do\s+i\s+(?:do|set\s+up|install|configure|implement)\b/i,
    /\binstruction\b/i
  ],
  TECHNICAL: [
    /\bgo\s+(?:technical|deep)\b/i,
    /\btechnical\s+(?:detail|explanation|breakdown)\b/i,
    /\bunder\s+the\s+hood\b/i,
    /\bhow\s+does\s+(?:it|this|that)\s+actually\s+work\b/i
  ],
  IDEAS: [
    /\bgive\s+me\s+(?:some\s+)?ideas\b/i,
    /\bbrainstorm\b/i,
    /\bwhat\s+(?:are\s+)?(?:some\s+)?(?:options|possibilities|alternatives)\b/i,
    /\bsuggest\s+(?:some|a\s+few)\b/i
  ],
  NO_PROMPT: [
    /\bdon'?t\s+(?:give\s+me|write|show\s+me)\s+(?:a\s+prompt|the\s+prompt|any\s+prompt)\b/i,
    /\bno\s+prompt\s+yet\b/i,
    /\bjust\s+(?:explain|tell\s+me|discuss)\b/i
  ]
};

export const ANSWER_DEPTH = {
  NORMAL:      "NORMAL",
  QUICK:       "QUICK",
  DETAILED:    "DETAILED",
  STEP_BY_STEP:"STEP_BY_STEP",
  TECHNICAL:   "TECHNICAL",
  IDEAS:       "IDEAS",
  NO_PROMPT:   "NO_PROMPT"
};

// ── Temporary preference signals ─────────────────────────
// "just this time", "for now", "keep this short" → temporary
// "from now on", "always", "going forward" → permanent
const TEMP_PREF_SIGNALS = [
  /\bjust\s+(?:this\s+(?:time|once)|for\s+(?:now|today|this\s+message))\b/i,
  /\bfor\s+(?:now|today|this\s+one)\b/i,
  /\bthis\s+(?:time\s+only|once)\b/i,
  /\bjust\s+(?:now|here)\b/i
];

const PERM_PREF_SIGNALS = [
  /\bfrom\s+now\s+on\b/i,
  /\bgoing\s+forward\b/i,
  /\balways\b/i,
  /\bevery\s+time\b/i,
  /\bpermanently\b/i,
  /\bin\s+(?:general|all\s+(?:future|my))\b/i
];

export class SessionContext {
  constructor() {
    this._reset();
  }

  // ── Reset for new conversation ────────────────────────────
  reset() { this._reset(); }

  _reset() {
    this._activeProject     = null;
    this._activeTopic       = null;
    this._activeFeature     = null;
    this._activeProblem     = null;
    this._activeProposedFix = null;
    this._activeSolution    = null;
    this._lastDecision      = null;
    this._lastCorrection    = null;

    // Ring buffer of recently mentioned objects (last 5 per type)
    this._recentObjects     = {
      features:  [],
      fixes:     [],
      ideas:     [],
      files:     [],
      options:   [],
      generic:   []
    };

    // Answer depth for the session (may be overridden per-message)
    this._sessionAnswerDepth = ANSWER_DEPTH.NORMAL;

    // Per-message depth override (reset each turn)
    this._currentAnswerDepth = ANSWER_DEPTH.NORMAL;

    // Session-only preferences (not persisted)
    this._sessionPreferences = [];
  }

  // ── Update from a user message + understanding result ─────
  update(userMessage, understandingResult = null, assistantResponse = null) {
    const msg = userMessage || "";

    // Detect answer depth for this message
    this._currentAnswerDepth = this._detectAnswerDepth(msg);

    // Detect temporary preferences
    const tempPref = this._detectTemporaryPreference(msg);
    if (tempPref) {
      this._sessionPreferences = this._sessionPreferences.filter(
        p => !this._isSimilar(p.fact, tempPref.fact)
      );
      this._sessionPreferences.push(tempPref);
    }

    // Extract topic from message
    const topic = this._extractTopic(msg);
    if (topic) this._activeTopic = topic;

    // Extract feature mentions
    const feature = this._extractFeature(msg);
    if (feature) {
      this._activeFeature = feature;
      this._pushObject("features", feature);
    }

    // Track problems
    if (/\b(?:error|bug|broken|crash|failing|issue|problem|not\s+working)\b/i.test(msg)) {
      this._activeProblem = msg.slice(0, 200);
    }

    // Track proposed fixes (from assistant responses)
    if (assistantResponse && /\btry\b|\buse\b|\bchange\b|\bupdate\b|\bfix\b/i.test(assistantResponse)) {
      this._activeProposedFix = assistantResponse.slice(0, 300);
      this._pushObject("fixes", this._activeProposedFix.slice(0, 80));
    }

    // Track corrections
    if (understandingResult?.isCorrection) {
      this._lastCorrection = msg.slice(0, 200);
    }

    // Track decisions
    if (understandingResult?.isDecision || /\bdecided\b|\bgoing\s+with\b/i.test(msg)) {
      this._lastDecision = msg.slice(0, 200);
    }

    // Extract options/list items (when user or assistant presents numbered/lettered options)
    this._extractOptions(msg);
  }

  // ── Resolve pronouns/referents from context ───────────────
  // Returns the most likely referent for "that", "it", "the second one", etc.
  resolveReferent(msg) {
    if (!msg) return null;

    // "the second one" / "the first one" — resolve from recent options
    const ordinalMatch = msg.match(/\bthe\s+(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+one\b/i);
    if (ordinalMatch && this._recentObjects.options.length > 0) {
      const ordinals = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, last: -1 };
      const idx = ordinals[ordinalMatch[1].toLowerCase()];
      const options = this._recentObjects.options;
      const resolved = idx === -1 ? options[options.length - 1] : options[idx];
      return resolved ? { type: "option", value: resolved } : null;
    }

    // "that feature" / "the feature" — resolve from active feature
    if (/\bthat\s+feature\b|\bthe\s+feature\b/i.test(msg) && this._activeFeature) {
      return { type: "feature", value: this._activeFeature };
    }

    // "that fix" / "that change" — resolve from active proposed fix
    if (/\bthat\s+(?:fix|change|approach|solution)\b/i.test(msg) && this._activeProposedFix) {
      return { type: "fix", value: this._activeProposedFix };
    }

    // "that problem" / "the issue" — resolve from active problem
    if (/\bthat\s+(?:problem|issue|bug|error)\b/i.test(msg) && this._activeProblem) {
      return { type: "problem", value: this._activeProblem };
    }

    // "that decision" — resolve from last decision
    if (/\bthat\s+decision\b/i.test(msg) && this._lastDecision) {
      return { type: "decision", value: this._lastDecision };
    }

    // Generic "that" / "it" — use most recently mentioned important item
    if (/\b(do\s+)?that\b|\bit\b/i.test(msg)) {
      const generic = this._recentObjects.generic[this._recentObjects.generic.length - 1];
      if (generic) return { type: "generic", value: generic };
      if (this._activeFeature) return { type: "feature", value: this._activeFeature };
    }

    return null;
  }

  // ── Detect answer depth from message ─────────────────────
  detectAnswerDepth(msg) {
    return this._detectAnswerDepth(msg);
  }

  _detectAnswerDepth(msg) {
    if (!msg) return this._sessionAnswerDepth;

    for (const [depth, patterns] of Object.entries(DEPTH_PATTERNS)) {
      if (patterns.some(p => p.test(msg))) {
        return ANSWER_DEPTH[depth];
      }
    }

    return ANSWER_DEPTH.NORMAL;
  }

  // ── Detect whether preference is temporary or permanent ───
  isTemporaryPreference(msg) {
    if (!msg) return false;
    return TEMP_PREF_SIGNALS.some(p => p.test(msg));
  }

  isPermanentPreference(msg) {
    if (!msg) return false;
    return PERM_PREF_SIGNALS.some(p => p.test(msg));
  }

  // ── Detect a session-only preference ─────────────────────
  _detectTemporaryPreference(msg) {
    if (!msg) return null;

    // Detect format/length preferences with temporary signals
    if (this.isTemporaryPreference(msg)) {
      const prefMatch = msg.match(/\b(?:keep\s+(?:it|this|the\s+answer|your\s+response|answers?)\s+)?(short|brief|concise|simple|detailed|long)\b/i);
      if (prefMatch) {
        return {
          fact:      `Response style: ${prefMatch[1]}`,
          scope:     "session",
          temporary: true,
          source:    "explicit-request"
        };
      }
    }

    return null;
  }

  // ── Get answer depth hint for context injection ───────────
  getAnswerDepthHint() {
    const depth = this._currentAnswerDepth;
    if (depth === ANSWER_DEPTH.NORMAL) return "";

    const hints = {
      [ANSWER_DEPTH.QUICK]:       "\n\n[RESPONSE STYLE: Be concise — one or two sentences maximum.]",
      [ANSWER_DEPTH.DETAILED]:    "\n\n[RESPONSE STYLE: Give a thorough, detailed explanation.]",
      [ANSWER_DEPTH.STEP_BY_STEP]:"\n\n[RESPONSE STYLE: Walk through this step by step, numbered.]",
      [ANSWER_DEPTH.TECHNICAL]:   "\n\n[RESPONSE STYLE: Technical depth — implementation details welcome.]",
      [ANSWER_DEPTH.IDEAS]:       "\n\n[RESPONSE STYLE: Brainstorm mode — generate multiple ideas/options.]",
      [ANSWER_DEPTH.NO_PROMPT]:   "\n\n[RESPONSE STYLE: Explain and discuss, do not write a prompt or template.]"
    };

    return hints[depth] || "";
  }

  // ── Get session-only preferences for context injection ────
  getSessionPreferences() { return [...this._sessionPreferences]; }

  // ── Getters ───────────────────────────────────────────────
  getActiveProject()     { return this._activeProject; }
  getActiveTopic()       { return this._activeTopic; }
  getActiveFeature()     { return this._activeFeature; }
  getActiveProblem()     { return this._activeProblem; }
  getActiveProposedFix() { return this._activeProposedFix; }
  getLastDecision()      { return this._lastDecision; }
  getLastCorrection()    { return this._lastCorrection; }
  getCurrentAnswerDepth(){ return this._currentAnswerDepth; }

  setActiveProject(p)     { this._activeProject = p; }
  setActiveTopic(t)       { this._activeTopic = t; }
  setActiveFeature(f)     { this._activeFeature = f; if (f) this._pushObject("features", f); }
  setActiveProblem(p)     { this._activeProblem = p; }
  setActiveProposedFix(f) {
    this._activeProposedFix = f;
    if (f) this._pushObject("fixes", f.slice(0, 80));
  }

  // ── Serializable snapshot for "Why?" panel ────────────────
  toSnapshot() {
    return {
      activeProject:      this._activeProject,
      activeTopic:        this._activeTopic,
      activeFeature:      this._activeFeature,
      activeProblem:      this._activeProblem?.slice(0, 100) || null,
      activeProposedFix:  this._activeProposedFix?.slice(0, 100) || null,
      lastDecision:       this._lastDecision?.slice(0, 100) || null,
      lastCorrection:     this._lastCorrection?.slice(0, 100) || null,
      currentAnswerDepth: this._currentAnswerDepth,
      sessionPrefs:       this._sessionPreferences.length
    };
  }

  // ── Private helpers ───────────────────────────────────────

  _extractTopic(msg) {
    // Try to identify the primary topic from a message
    // Look for "about X", "with X", "for X"
    const match = msg.match(/\babout\s+([\w\s]{3,40}?)(?:\s*[?.,!]|$)/i);
    if (match) return match[1].trim();
    return null;
  }

  _extractFeature(msg) {
    const match = msg.match(/\b(?:the|a|our|my)\s+([\w\s]{3,40}?)\s+(?:feature|function|component|module|page|section|button|panel|widget)\b/i);
    if (match) return match[1].trim() + " " + (msg.match(/(?:feature|function|component|module|page|section|button|panel|widget)/i)?.[0] || "feature");
    return null;
  }

  _extractOptions(msg) {
    // Detect numbered/lettered list items from message
    const numbered = msg.match(/\d+[.)]\s+([\w\s]{3,60})/g);
    if (numbered) {
      this._recentObjects.options = numbered.map(s => s.replace(/^\d+[.)]\s*/, "").slice(0, 60));
    }

    // Also push generic recent items for pronoun resolution
    // Look for quoted strings or explicit feature mentions
    const quoted = msg.match(/"([^"]{3,60})"/g);
    if (quoted) {
      for (const q of quoted) {
        this._pushObject("generic", q.replace(/"/g, ""));
      }
    }
  }

  _pushObject(type, value) {
    if (!value) return;
    const arr = this._recentObjects[type] || (this._recentObjects[type] = []);
    arr.push(value);
    if (arr.length > 5) arr.shift(); // Keep last 5
  }

  _isSimilar(a, b) {
    if (!a || !b) return false;
    const tokA = new Set((a.toLowerCase()).split(/\s+/).filter(w => w.length > 3));
    const tokB = new Set((b.toLowerCase()).split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const t of tokA) if (tokB.has(t)) overlap++;
    return tokA.size > 0 && (overlap / tokA.size) > 0.5;
  }
}
