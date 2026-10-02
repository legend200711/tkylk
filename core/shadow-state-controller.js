// ============================================================
// Shadow Reaper State Controller — Checkpoint D
// Central state machine for Shadow Reaper's operational states.
//
// States:
//   IDLE       — ready, waiting for input
//   LISTENING  — microphone active
//   THINKING   — processing / generating
//   SPEAKING   — text-to-speech playing
//   ERROR      — recoverable error state
//   LEARNING   — optional: learning pipeline running
//   REMEMBERING— optional: memory access in progress
//
// State changes emit callbacks to update the UI presence element.
// This does NOT contain any intelligence logic — only state tracking.
// ============================================================

export const SR_STATE = {
  IDLE:        "IDLE",
  LISTENING:   "LISTENING",
  THINKING:    "THINKING",
  SPEAKING:    "SPEAKING",
  ERROR:       "ERROR",
  LEARNING:    "LEARNING",
  REMEMBERING: "REMEMBERING"
};

export class ShadowStateController {
  constructor() {
    this._state      = SR_STATE.IDLE;
    this._prevState  = SR_STATE.IDLE;
    this._errorMsg   = null;
    this._listeners  = [];
    this._presenceEl = null;  // DOM element for presence indicator
  }

  // ── Bind to a presence DOM element ───────────────────────
  bindPresence(element) {
    this._presenceEl = element;
    this._applyPresenceState(this._state);
  }

  // ── Register a state change listener ─────────────────────
  onStateChange(cb) {
    if (typeof cb === "function") this._listeners.push(cb);
    return () => { this._listeners = this._listeners.filter(l => l !== cb); };
  }

  // ── Transition to a new state ─────────────────────────────
  transition(newState, meta = {}) {
    if (!Object.values(SR_STATE).includes(newState)) return;
    if (newState === this._state) return;

    this._prevState = this._state;
    this._state     = newState;
    this._errorMsg  = meta.error || null;

    this._applyPresenceState(newState);
    this._notifyListeners(newState, this._prevState, meta);
  }

  // ── Convenience transitions ───────────────────────────────
  setIdle()        { this.transition(SR_STATE.IDLE); }
  setListening()   { this.transition(SR_STATE.LISTENING); }
  setThinking()    { this.transition(SR_STATE.THINKING); }
  setSpeaking()    { this.transition(SR_STATE.SPEAKING); }
  setLearning()    { this.transition(SR_STATE.LEARNING); }
  setRemembering() { this.transition(SR_STATE.REMEMBERING); }

  setError(msg) {
    this.transition(SR_STATE.ERROR, { error: msg });
  }

  recoverFromError() {
    if (this._state === SR_STATE.ERROR) {
      this.transition(this._prevState === SR_STATE.ERROR ? SR_STATE.IDLE : this._prevState);
    }
  }

  // ── Getters ───────────────────────────────────────────────
  getState()     { return this._state; }
  getPrevState() { return this._prevState; }
  getErrorMsg()  { return this._errorMsg; }
  isIdle()       { return this._state === SR_STATE.IDLE; }
  isActive()     { return this._state !== SR_STATE.IDLE && this._state !== SR_STATE.ERROR; }

  // ── Apply CSS state classes to presence element ──────────
  // Uses data-state attribute so CSS can respond with selectors.
  // Respects prefers-reduced-motion via CSS (not JS).
  _applyPresenceState(state) {
    if (!this._presenceEl) return;

    this._presenceEl.setAttribute("data-state", state.toLowerCase());

    // Also update any ARIA label for accessibility
    const labels = {
      [SR_STATE.IDLE]:        "Shadow Reaper: ready",
      [SR_STATE.LISTENING]:   "Shadow Reaper: listening",
      [SR_STATE.THINKING]:    "Shadow Reaper: thinking",
      [SR_STATE.SPEAKING]:    "Shadow Reaper: speaking",
      [SR_STATE.ERROR]:       "Shadow Reaper: error",
      [SR_STATE.LEARNING]:    "Shadow Reaper: learning",
      [SR_STATE.REMEMBERING]: "Shadow Reaper: remembering"
    };
    this._presenceEl.setAttribute("aria-label", labels[state] || "Shadow Reaper");
    this._presenceEl.setAttribute("title", labels[state] || "Shadow Reaper");
  }

  // ── Notify listeners ──────────────────────────────────────
  _notifyListeners(newState, prevState, meta) {
    for (const cb of this._listeners) {
      try { cb(newState, prevState, meta); } catch (_) {}
    }
  }
}
