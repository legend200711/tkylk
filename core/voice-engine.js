// ============================================================
// Voice Engine — Checkpoint D
// Browser-native speech recognition and text-to-speech.
// Requires no external AI API — uses Web Speech API only.
//
// Features:
//   - Speech recognition (start/stop/state)
//   - Text-to-speech (speak/stop/voice selection)
//   - Voice preferences (persisted via preferences system)
//   - Graceful degradation when APIs unavailable
//   - Interrupt support for generation and speech
//
// IMPORTANT:
//   - Recognized speech routes to ConversationEngine, NOT a separate pipeline.
//   - Microphone is ALWAYS user-controlled. No always-listening.
//   - All behavior degrades gracefully — typed input always available.
// ============================================================

// ── State constants ───────────────────────────────────────
export const VOICE_STATE = {
  IDLE:     "IDLE",
  LISTENING:"LISTENING",
  SPEAKING: "SPEAKING",
  ERROR:    "ERROR",
  UNAVAILABLE: "UNAVAILABLE"
};

// Feature detection
const SPEECH_RECOGNITION_AVAILABLE =
  typeof window !== "undefined" &&
  (typeof window.SpeechRecognition !== "undefined" || typeof window.webkitSpeechRecognition !== "undefined");

const SPEECH_SYNTHESIS_AVAILABLE =
  typeof window !== "undefined" &&
  typeof window.speechSynthesis !== "undefined";

export class VoiceEngine {
  constructor() {
    this._state           = VOICE_STATE.IDLE;
    this._recognition     = null;
    this._synthesis       = typeof window !== "undefined" ? window.speechSynthesis : null;
    this._selectedVoice   = null;
    this._availableVoices = [];
    this._speechEnabled   = false;
    this._autoSpeak       = false;
    this._speechRate      = 1.0;
    this._speechVolume    = 0.9;
    this._onStateChange   = null;   // callback(state)
    this._onTranscript    = null;   // callback(text, isFinal)
    this._onError         = null;   // callback(error)
    this._recognitionActive = false;
    this._currentUtterance  = null;

    this._initRecognition();
    this._loadVoices();
  }

  // ── Feature detection ─────────────────────────────────────
  static get recognitionAvailable() { return SPEECH_RECOGNITION_AVAILABLE; }
  static get synthesisAvailable()   { return SPEECH_SYNTHESIS_AVAILABLE; }

  isAvailable() {
    return SPEECH_RECOGNITION_AVAILABLE || SPEECH_SYNTHESIS_AVAILABLE;
  }

  isMicAvailable()  { return SPEECH_RECOGNITION_AVAILABLE; }
  isTTSAvailable()  { return SPEECH_SYNTHESIS_AVAILABLE; }

  // ── State ─────────────────────────────────────────────────
  getState()       { return this._state; }
  isListening()    { return this._state === VOICE_STATE.LISTENING; }
  isSpeaking()     { return this._state === VOICE_STATE.SPEAKING; }
  isSpeechEnabled(){ return this._speechEnabled; }
  isAutoSpeak()    { return this._autoSpeak; }

  _setState(state) {
    this._state = state;
    this._onStateChange?.(state);
  }

  // ── Callback registration ─────────────────────────────────
  onStateChange(cb)  { this._onStateChange = cb; }
  onTranscript(cb)   { this._onTranscript = cb; }
  onError(cb)        { this._onError = cb; }

  // ── Initialize speech recognition ────────────────────────
  _initRecognition() {
    if (!SPEECH_RECOGNITION_AVAILABLE) return;

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      this._recognition = new SR();
      this._recognition.continuous     = false;
      this._recognition.interimResults  = true;
      this._recognition.lang            = "en-US";
      this._recognition.maxAlternatives = 1;

      this._recognition.onresult = (e) => {
        const results = Array.from(e.results);
        const transcript = results.map(r => r[0].transcript).join(" ");
        const isFinal    = results[results.length - 1]?.isFinal ?? false;
        this._onTranscript?.(transcript, isFinal);
      };

      this._recognition.onerror = (e) => {
        const ignored = ["aborted", "no-speech"];
        if (!ignored.includes(e.error)) {
          this._onError?.({ code: e.error, message: `Speech recognition error: ${e.error}` });
        }
        this._recognitionActive = false;
        if (this._state === VOICE_STATE.LISTENING) {
          this._setState(VOICE_STATE.IDLE);
        }
      };

      this._recognition.onend = () => {
        this._recognitionActive = false;
        if (this._state === VOICE_STATE.LISTENING) {
          this._setState(VOICE_STATE.IDLE);
        }
      };

    } catch (e) {
      this._recognition = null;
    }
  }

  // ── Load available TTS voices ─────────────────────────────
  _loadVoices() {
    if (!SPEECH_SYNTHESIS_AVAILABLE) return;

    const load = () => {
      this._availableVoices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
      if (this._availableVoices.length === 0) {
        // some browsers need a slight delay
        this._availableVoices = window.speechSynthesis.getVoices();
      }
    };

    load();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  getAvailableVoices() { return this._availableVoices; }

  // ── Select a voice by name ────────────────────────────────
  selectVoice(nameOrUri) {
    if (!SPEECH_SYNTHESIS_AVAILABLE) return false;
    const voice = this._availableVoices.find(
      v => v.name === nameOrUri || v.voiceURI === nameOrUri
    );
    if (voice) {
      this._selectedVoice = voice;
      return true;
    }
    return false;
  }

  // ── Preferences ───────────────────────────────────────────
  setPreferences({ speechEnabled, autoSpeak, speechRate, speechVolume, voiceName } = {}) {
    if (typeof speechEnabled === "boolean") this._speechEnabled = speechEnabled;
    if (typeof autoSpeak     === "boolean") this._autoSpeak     = autoSpeak;
    if (typeof speechRate    === "number" ) this._speechRate    = Math.max(0.5, Math.min(2.0, speechRate));
    if (typeof speechVolume  === "number" ) this._speechVolume  = Math.max(0, Math.min(1, speechVolume));
    if (voiceName) this.selectVoice(voiceName);
  }

  getPreferences() {
    return {
      speechEnabled: this._speechEnabled,
      autoSpeak:     this._autoSpeak,
      speechRate:    this._speechRate,
      speechVolume:  this._speechVolume,
      voiceName:     this._selectedVoice?.name || null
    };
  }

  // ── Start listening ───────────────────────────────────────
  startListening() {
    if (!SPEECH_RECOGNITION_AVAILABLE || !this._recognition) {
      this._onError?.({ code: "UNAVAILABLE", message: "Speech recognition not available in this browser." });
      return false;
    }
    if (this._recognitionActive) return false;

    try {
      this._recognition.start();
      this._recognitionActive = true;
      this._setState(VOICE_STATE.LISTENING);
      return true;
    } catch (e) {
      this._onError?.({ code: "START_FAILED", message: e.message });
      return false;
    }
  }

  // ── Stop listening ────────────────────────────────────────
  stopListening() {
    if (!this._recognition || !this._recognitionActive) return;
    try {
      this._recognition.stop();
    } catch (_) {}
    this._recognitionActive = false;
    if (this._state === VOICE_STATE.LISTENING) {
      this._setState(VOICE_STATE.IDLE);
    }
  }

  // ── Abort listening (cancel, no result) ──────────────────
  abortListening() {
    if (!this._recognition || !this._recognitionActive) return;
    try {
      this._recognition.abort();
    } catch (_) {}
    this._recognitionActive = false;
    if (this._state === VOICE_STATE.LISTENING) {
      this._setState(VOICE_STATE.IDLE);
    }
  }

  // ── Speak text (TTS) ─────────────────────────────────────
  speak(text, { onDone, onError } = {}) {
    if (!SPEECH_SYNTHESIS_AVAILABLE || !this._speechEnabled || !text) {
      onDone?.();
      return;
    }

    // Stop any current speech first
    this.stopSpeaking();

    // Strip markdown for natural speech
    const clean = this._stripMarkdown(text);
    if (!clean.trim()) { onDone?.(); return; }

    // Chunk long text for better browser TTS reliability
    const chunks = this._chunkText(clean, 400);
    let chunkIndex = 0;

    const speakNext = () => {
      if (chunkIndex >= chunks.length) {
        this._setState(VOICE_STATE.IDLE);
        onDone?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex++]);
      utterance.rate   = this._speechRate;
      utterance.volume = this._speechVolume;
      if (this._selectedVoice) utterance.voice = this._selectedVoice;

      utterance.onend = speakNext;
      utterance.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") {
          onError?.({ code: e.error, message: `TTS error: ${e.error}` });
        }
        this._setState(VOICE_STATE.IDLE);
      };

      this._currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    };

    this._setState(VOICE_STATE.SPEAKING);
    speakNext();
  }

  // ── Stop speaking ─────────────────────────────────────────
  stopSpeaking() {
    if (!SPEECH_SYNTHESIS_AVAILABLE) return;
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
    this._currentUtterance = null;
    if (this._state === VOICE_STATE.SPEAKING) {
      this._setState(VOICE_STATE.IDLE);
    }
  }

  // ── Stop everything (interrupt) ───────────────────────────
  interrupt() {
    this.stopSpeaking();
    this.abortListening();
  }

  // ── Strip markdown for TTS ────────────────────────────────
  _stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, " [code block] ")
      .replace(/`[^`]+`/g, m => m.replace(/`/g, ""))
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n\n+/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Chunk long text for reliable TTS ─────────────────────
  _chunkText(text, maxLen = 400) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    // Split on sentence boundaries
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > maxLen && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += (current ? " " : "") + s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
  }
}
