// ============================================================
// app.js — Shadow Reaper Main Entry Point
// Initializes all systems and orchestrates the full application
// ============================================================

import { initializeApp }         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { firebaseConfig }        from "../firebase/firebase-config.js";
import { initFirestore }         from "../firebase/firestore-service.js";
import { initAuth, onAuthChange, login, register, logout, sendPasswordReset } from "./auth.js";
import { initIndexedDB }         from "../storage/indexeddb.js";
import { SyncManager }           from "../storage/sync-manager.js";
import { ShadowCore }            from "../core/shadow-core.js";
import {
  addBootLine, finalizeBootLine, setBootProgress, hideBootScreen,
  showAuthScreen, hideAuthScreen, showApp,
  showAuthError, clearAuthError,
  renderConversationList, appendMessage, updateStreamingMessage,
  finalizeStreamingMessage, showThinkingIndicator, removeThinkingIndicator,
  renderEmotionDisplay, renderActivityLog, showLearningActivity,
  renderRelevantMemories, renderContextDisplay,
  initTabs, setChatTitle, initInputAutoResize,
  showToast, setModelStatus, setSendEnabled, showModal, showConfirmModal,
  clearInput, clearMessages, showWelcome, showStopButton, hideStopButton,
  initBootParticles, escapeHtml
} from "./ui.js";
import {
  getConversations, listenConversations, deleteConversation,
  updateConversationTitle, ensureUserProfile, getUserStats,
  loadPreferences, savePreferences
} from "../firebase/firestore-service.js";

// ── Application State ──────────────────────────────────────
let _shadowCore       = null;
let _syncManager      = null;
let _uid              = null;
let _currentConvId    = null;
let _conversations    = [];
let _convUnsubscribe  = null;
let _allMemories      = [];
let _allKnowledge     = [];
let _generating       = false;
let _streamingMsgEl   = null;
let _activeProject    = null;
let _lastWhyData      = null;
// Checkpoint D: voice transcript buffer (interim)
let _voiceTranscriptBuffer = "";

// ── Diagnostic boot logger ─────────────────────────────────
function bootLog(msg) {
  console.log(`[BOOT] ${msg}`);
}

// ── Promise with timeout ───────────────────────────────────
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${label} did not complete within ${ms}ms`));
    }, ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

// ═══════════════════════════════════════════════════════════
// BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════
async function boot() {
  bootLog("App starting — DOMContentLoaded fired");
  initBootParticles();
  initBootLightning();

  // Clear the static HTML placeholder in boot-log so our dynamic lines take over
  const bootLogEl = document.getElementById("boot-log");
  if (bootLogEl) bootLogEl.innerHTML = "";

  setBootProgress(0, "INITIALIZING");

  // ── Detect file:// protocol immediately ──────────────────────
  if (window.location.protocol === "file:") {
    bootLog("file:// protocol detected — showing LOCAL FILE MODE warning");
    addBootLine("LOCAL FILE MODE DETECTED", "warn");
    setTimeout(() => {
      finalizeBootLine("LOCAL FILE MODE — AI requires HTTP/HTTPS", "warn");
      setBootProgress(100, "LOCAL FILE MODE");
      addBootLine("Open via your GitHub Pages URL or a local HTTP server", "warn");
      addBootLine("Firebase, WebGPU and model loading are disabled on file://", "warn");
      setTimeout(() => {
        hideBootScreen();
        showAuthScreen();
      }, 4000);
    }, 600);
    return;
  }

  addBootLine("Initializing core systems...", "pending");

  // ── Step 1: Firebase ─────────────────────────────────────
  bootLog("Firebase starting");
  let firebaseApp;
  try {
    firebaseApp = initializeApp(firebaseConfig);
    initFirestore(firebaseApp);
    const auth = initAuth(firebaseApp);
    finalizeBootLine("Core systems initialized ✓", "ok");
    bootLog("Firebase ready");
  } catch (err) {
    bootLog(`Firebase FAILED: ${err.message}`);
    finalizeBootLine(`Firebase initialization failed: ${err.message}`, "error");
    setBootProgress(100, "FIREBASE ERROR");
    addBootLine("Continuing in degraded mode — login unavailable", "warn");
    setTimeout(() => {
      hideBootScreen();
      showAuthScreen();
    }, 3000);
    return;
  }

  // ── Step 2: IndexedDB ────────────────────────────────────
  setBootProgress(8, "LOADING LOCAL STORAGE");
  addBootLine("Loading local storage...", "pending");
  bootLog("IndexedDB starting");
  try {
    await withTimeout(initIndexedDB(), 5000, "IndexedDB init");
    finalizeBootLine("Local storage ready ✓", "ok");
    bootLog("IndexedDB ready");
  } catch (err) {
    bootLog(`IndexedDB warning: ${err.message}`);
    finalizeBootLine(`Local storage warning: ${err.message}`, "warn");
    // Non-fatal — continue
  }

  // ── Step 3: Authentication ───────────────────────────────
  setBootProgress(15, "CHECKING AUTHENTICATION");
  addBootLine("Checking authentication...", "pending");
  bootLog("Auth state check starting");

  await new Promise(resolve => {
    // Firebase auth state check has an implicit ~10s SDK timeout;
    // we add our own safety net in case it never fires.
    const safetyTimer = setTimeout(() => {
      bootLog("Auth state check TIMED OUT — forcing unauthenticated path");
      finalizeBootLine("Auth check timed out — please log in", "warn");
      setBootProgress(100, "AUTHENTICATION REQUIRED");
      setTimeout(() => { hideBootScreen(); showAuthScreen(); }, 800);
      resolve();
    }, 12000);

    const unsub = onAuthChange(async (user) => {
      clearTimeout(safetyTimer);
      unsub();
      if (user) {
        bootLog(`Auth state: authenticated as ${user.email}`);
        finalizeBootLine(`Authenticated: ${user.email}`, "ok");
        _uid = user.uid;
        await initializeForUser(user);
      } else {
        bootLog("Auth state: unauthenticated");
        finalizeBootLine("Authentication required", "warn");
        setBootProgress(100, "AUTHENTICATION REQUIRED");
        setTimeout(() => { hideBootScreen(); showAuthScreen(); }, 800);
      }
      resolve();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// USER INITIALIZATION (post-auth)
// ═══════════════════════════════════════════════════════════
async function initializeForUser(user) {
  _uid = user.uid;

  // ── Ensure profile ───────────────────────────────────────
  bootLog("Ensuring user profile");
  try {
    await withTimeout(
      ensureUserProfile(user.uid, user.displayName || "Operator", user.email),
      8000, "ensureUserProfile"
    );
  } catch (e) {
    bootLog(`User profile warning: ${e.message}`);
  }

  // ── Shadow Core ──────────────────────────────────────────
  setBootProgress(20, "LOADING SHADOW CORE");
  addBootLine("Initializing Shadow Reaper architecture...", "pending");
  bootLog("Shadow Core init starting");

  _shadowCore  = new ShadowCore();
  _syncManager = new SyncManager(
    { saveMemory: (...a) => import("../firebase/firestore-service.js").then(m => m.saveMemory(...a)) },
    _uid
  );

  // Load preferences (non-blocking — fall back to empty)
  let prefs = {};
  try {
    prefs = await withTimeout(loadPreferences(_uid), 6000, "loadPreferences") ?? {};
  } catch (e) {
    bootLog(`Preferences load warning: ${e.message}`);
  }

  try {
    await withTimeout(_shadowCore.initializeForUser(_uid, prefs), 10000, "ShadowCore.initializeForUser");
    finalizeBootLine("Shadow Reaper architecture online ✓", "ok");
    bootLog("Shadow Core ready");
  } catch (err) {
    bootLog(`Shadow Core error: ${err.message}`);
    finalizeBootLine(`Shadow Core warning: ${err.message}`, "warn");
    // Continue — may be partial
  }

  // ── Memories + Knowledge ─────────────────────────────────
  setBootProgress(35, "LOADING MEMORIES");
  addBootLine("Loading memories and knowledge...", "pending");
  bootLog("Memory load starting");
  try {
    const data = await withTimeout(_shadowCore.loadContextData(), 10000, "loadContextData");
    _allMemories  = data.memories;
    _allKnowledge = data.knowledge;
    finalizeBootLine(`Memories: ${_allMemories.length} · Knowledge: ${_allKnowledge.length} ✓`, "ok");
    bootLog(`Memory load complete — ${_allMemories.length} memories, ${_allKnowledge.length} knowledge`);
  } catch (err) {
    bootLog(`Memory load warning: ${err.message}`);
    finalizeBootLine(`Memory load warning: ${err.message}`, "warn");
  }

  // ── Wire conversation engine callbacks ───────────────────
  _shadowCore.conversation.on("chunk",           handleStreamChunk);
  _shadowCore.conversation.on("done",            handleStreamDone);
  _shadowCore.conversation.on("error",           handleStreamError);
  _shadowCore.conversation.on("learning",        handleLearning);
  _shadowCore.conversation.on("titleGenerated",  handleTitleGenerated);
  _shadowCore.conversation.on("projectDetected", handleProjectDetected);
  _shadowCore.conversation.on("memoryAction",    handleMemoryAction);

  // ── Conversation watcher ─────────────────────────────────
  _convUnsubscribe?.();
  _convUnsubscribe = listenConversations(_uid, (convs) => {
    _conversations = convs;
    renderConversationList(
      _conversations, _currentConvId,
      loadConversation, promptRenameConversation, promptDeleteConversation
    );
  });

  // ── Show UI immediately — model loads asynchronously ─────
  setBootProgress(75, "LAUNCHING INTERFACE");
  addBootLine("Launching Shadow Reaper interface...", "pending");
  bootLog("UI ready — showing app");

  setTimeout(() => {
    finalizeBootLine("SHADOW REAPER ONLINE ✓", "ok");
    setBootProgress(100, "SHADOW REAPER ONLINE");
    setTimeout(() => {
      hideBootScreen();
      showApp();
      initUI();
      bootLog("App shell visible");
    }, 600);
  }, 400);

  // ── Model initialization — background, does NOT block UI ─
  setModelStatus("loading", "MODEL LOADING");
  setSendEnabled(false);
  bootLog("Model initialization starting (async, background)");
  console.log("[MODEL] Initialization started");

  _shadowCore.model.setProgressCallback(handleModelProgress);
  _shadowCore.initializeModel(handleModelProgress, prefs.preferredModel)
    .then(() => {
      console.log("[MODEL] ONLINE");
      setModelStatus("online", "MODEL ONLINE");
      setSendEnabled(true);
      bootLog("Model ready");
      _showModelRetryButton(false);
    })
    .catch(err => {
      console.error("[MODEL] Initialization FAILED:", err);
      bootLog(`Model error: ${err.message}`);
      // handleModelProgress already set a specific badge; this is a safety fallback
      const currentBadge = document.getElementById("model-status-badge")?.textContent;
      if (!currentBadge || currentBadge === "MODEL LOADING") {
        setModelStatus("error", "MODEL INIT FAILED");
      }
      setSendEnabled(false);
      const footer = document.getElementById("model-info-footer");
      if (footer) footer.textContent = err.message || "Model unavailable — check device/WebGPU support";
      _showModelRetryButton(true);
    });
}

// ── Show/hide RETRY MODEL button ──────────────────────────
function _showModelRetryButton(show) {
  let retryBtn = document.getElementById("btn-retry-model");
  if (show) {
    if (!retryBtn) {
      retryBtn = document.createElement("button");
      retryBtn.id        = "btn-retry-model";
      retryBtn.className = "btn-retry-model";
      retryBtn.textContent = "⟳ RETRY MODEL";
      retryBtn.addEventListener("click", _retryModelLoad);
      const footer = document.querySelector(".input-footer");
      if (footer) footer.appendChild(retryBtn);
    }
    retryBtn.style.display = "";
  } else if (retryBtn) {
    retryBtn.style.display = "none";
  }
}

// ── Retry model initialization ────────────────────────────
async function _retryModelLoad() {
  _showModelRetryButton(false);
  setModelStatus("loading", "MODEL LOADING");
  setSendEnabled(false);
  console.log("[MODEL] Retry initiated");
  bootLog("Model retry initiated");

  try {
    // Reset internal state so ModelManager allows re-init
    if (_shadowCore?.model) {
      _shadowCore.model._status      = "uninitialized";
      _shadowCore.model._error       = null;
      _shadowCore.model._errorCode   = null;
      _shadowCore.model._initPromise = null;  // Clear any stale init promise
      if (_shadowCore.model._provider) {
        await _shadowCore.model._provider.unload().catch(() => {});
        _shadowCore.model._provider = null;
      }
    }

    await _shadowCore.initializeModel(handleModelProgress, null);
    console.log("[MODEL] ONLINE (after retry)");
    setModelStatus("online", "MODEL ONLINE");
    setSendEnabled(true);
    _showModelRetryButton(false);
  } catch (err) {
    console.error("[MODEL] Retry FAILED:", err);
    const footer = document.getElementById("model-info-footer");
    if (footer) footer.textContent = err.message || "Retry failed";
    _showModelRetryButton(true);
  }
}

// ── Model progress handler ────────────────────────────────
let _firstDownloadWarningShown = false;
function handleModelProgress(progress) {
  if (progress.error) {
    // Granular error classification
    const code = progress.errorCode || "MODEL_ERROR";
    let badge = "MODEL ERROR";
    let logMsg = progress.message || "Unknown error";

    let badgeClass = "error";
    if (code === "INSECURE_CONTEXT") {
      badge      = "LOCAL FILE MODE";
      badgeClass = "warn";
      logMsg     = progress.message;
    } else if (code === "WEBGPU_UNAVAILABLE") {
      badge  = "WEBGPU UNAVAILABLE";
    } else if (code === "UNSUPPORTED_DEVICE") {
      badge  = "MODEL UNSUPPORTED";
    } else if (code === "WEBGPU_INIT_FAILED" || progress.message?.includes("WEBGPU_INIT_FAILED")) {
      badge  = "GPU INIT FAILED";
    } else if (code === "ENGINE_LOAD_FAILED") {
      badge  = "ENGINE ERROR";
    } else if (code === "MODEL_DOWNLOAD_FAILED") {
      badge  = "DOWNLOAD FAILED";
    } else if (code === "MODEL_OOM") {
      badge  = "OUT OF MEMORY";
    } else if (code === "MODEL_INIT_FAILED") {
      badge  = "MODEL INIT FAILED";
    }

    console.error(`[MODEL] ERROR [${code}]: ${logMsg}`);
    bootLog(`Model status: ${badge} — ${logMsg}`);
    setModelStatus(badgeClass, badge);
    setSendEnabled(false);

    // Update footer with actionable detail
    const footer = document.getElementById("model-info-footer");
    if (footer) footer.textContent = logMsg;

    _showModelRetryButton(true);
    return;
  }

  if (progress.stage === "ready") {
    // NOTE: Do NOT set MODEL ONLINE or enable the send button here.
    // The "ready" progress fires from inside provider._doInitialize() at the
    // provider level, BEFORE ModelManager sets _status = "online".
    // Enabling the send button here creates a tiny window where isOnline()
    // returns false but the button is enabled.
    // The .then() handler in initializeForUser() is the single authoritative
    // place where MODEL ONLINE is declared and the send button is enabled.
    // We do show "INITIALIZING MODEL" here so the user sees meaningful
    // status during the brief finalisation window between download complete
    // and the ModelManager declaring online.
    console.log("[MODEL] Provider reports ready — awaiting ModelManager status confirmation");
    setModelStatus("loading", "INITIALIZING MODEL");
    finalizeBootLine("Neural core online ✓", "ok");
    bootLog(`Model READY: ${_shadowCore?.model?.getModelId()}`);
    return;
  }

  // First download warning
  if ((progress.stage === "model-download" || progress.stage === "engine-load") && !_firstDownloadWarningShown) {
    _firstDownloadWarningShown = true;
    showToast(
      "Shadow Reaper is downloading its local AI brain. First startup may take several minutes. Future launches use browser cache.",
      "info",
      8000
    );
  }

  // Download progress badge
  if (progress.stage === "model-download" && typeof progress.percent === "number" && progress.percent > 0) {
    const pct = Math.round(progress.percent);
    setModelStatus("loading", `MODEL DOWNLOAD ${pct}%`);
  } else if (progress.stage === "engine-load") {
    setModelStatus("loading", "LOADING ENGINE");
  } else if (progress.stage === "model-select") {
    setModelStatus("loading", "SELECTING MODEL");
  } else if (progress.stage === "device-check") {
    setModelStatus("loading", "CHECKING DEVICE");
  }

  console.log(`[MODEL] ${progress.stage?.toUpperCase() || "PROGRESS"}: ${progress.message || ""} (${progress.percent || 0}%)`);

  const pct = Math.min(99, Math.round(40 + (progress.percent || 0) * 0.55));
  setBootProgress(pct, "LOADING NEURAL CORE");
  finalizeBootLine(progress.message || "Loading...", "pending");
}

// ═══════════════════════════════════════════════════════════
// UI INITIALIZATION
// ═══════════════════════════════════════════════════════════
function initUI() {
  initTabs();
  initInputAutoResize();
  initRightPanelEmotionUpdate();
  bindChatControls();
  bindSidebarControls();
  bindMobileControls();
  initVoiceUI();                   // Checkpoint D
  initPresenceElement();           // Checkpoint D
  initStateController();           // Checkpoint D
  updateControlsUI();              // Checkpoint E
  bindControlsTab();               // Checkpoint E

  // Initial emotion render
  renderEmotionDisplay(_shadowCore.emotion.getState());

  // Focus input
  document.getElementById("message-input")?.focus();
}

// ── Chat Controls ─────────────────────────────────────────
function bindChatControls() {
  document.getElementById("btn-send")?.addEventListener("click", sendMessage);

  document.getElementById("btn-stop")?.addEventListener("click", () => {
    // Checkpoint D: also interrupt voice
    _shadowCore.voice?.interrupt?.();
    _shadowCore.stateController?.setIdle?.();
    _shadowCore.conversation.stop();
    _generating = false;
    hideStopButton();
    if (_streamingMsgEl) {
      finalizeStreamingMessage(_streamingMsgEl, _streamingMsgEl.querySelector(".message-body")?.innerHTML || "");
      _streamingMsgEl = null;
    }
  });
}

// ════════════════════════════════════════════════════════════
// CHECKPOINT D: VOICE UI
// ════════════════════════════════════════════════════════════
function initVoiceUI() {
  const voice = _shadowCore?.voice;
  if (!voice) return;

  // Bind mic button
  const micBtn = document.getElementById("btn-mic");
  if (micBtn) {
    if (!voice.isMicAvailable()) {
      micBtn.style.display = "none";
    } else {
      micBtn.style.display = "";
      micBtn.addEventListener("click", toggleMic);
    }
  }

  // Bind TTS toggle
  const ttsToggle = document.getElementById("btn-tts-toggle");
  if (ttsToggle) {
    if (!voice.isTTSAvailable()) {
      ttsToggle.style.display = "none";
    } else {
      ttsToggle.textContent = voice.isSpeechEnabled() ? "🔊" : "🔇";
      ttsToggle.title = voice.isSpeechEnabled() ? "Disable speech" : "Enable speech";
      ttsToggle.addEventListener("click", toggleTTS);
    }
  }

  // Voice transcript callbacks
  voice.onTranscript((text, isFinal) => {
    _voiceTranscriptBuffer = text;
    const input = document.getElementById("message-input");
    if (input) input.value = text;

    if (isFinal && text.trim()) {
      // Privacy firewall: run transcript through firewall before processing
      const scan = _shadowCore.firewallCheck(text);
      if (!scan.blocked) {
        // Stop listening, then send
        voice.stopListening();
        _shadowCore.stateController?.setThinking();
        sendMessageFromVoice(text);
      }
      _voiceTranscriptBuffer = "";
    }
  });

  voice.onError((err) => {
    showToast(`Mic: ${err.message}`, "warn", 3000);
    _shadowCore.stateController?.setIdle();
    document.getElementById("btn-mic")?.classList.remove("active");
  });

  voice.onStateChange((state) => {
    const micBtn = document.getElementById("btn-mic");
    if (!micBtn) return;
    if (state === "LISTENING") {
      micBtn.classList.add("active");
      micBtn.title = "Stop listening";
    } else {
      micBtn.classList.remove("active");
      micBtn.title = "Start voice input";
    }
  });
}

function toggleMic() {
  const voice = _shadowCore?.voice;
  if (!voice) return;

  if (voice.isListening()) {
    voice.stopListening();
    _shadowCore.stateController?.setIdle();
  } else {
    _shadowCore.stateController?.setListening();
    voice.startListening();
  }
}

function toggleTTS() {
  const voice = _shadowCore?.voice;
  if (!voice) return;

  const newState = !voice.isSpeechEnabled();
  voice.setPreferences({ speechEnabled: newState });

  const btn = document.getElementById("btn-tts-toggle");
  if (btn) {
    btn.textContent = newState ? "🔊" : "🔇";
    btn.title = newState ? "Disable speech" : "Enable speech";
  }

  _shadowCore.saveVoicePreferences(_uid).catch(() => {});
  showToast(newState ? "Voice output enabled" : "Voice output disabled", "info", 2000);
}

// Send a message that came from voice input
async function sendMessageFromVoice(text) {
  const input = document.getElementById("message-input");
  if (input) input.value = text;
  await sendMessage();
  if (input) input.value = "";
}

// ── Checkpoint D: Presence element ───────────────────────
function initPresenceElement() {
  // Wire the state controller to the sigil/presence element
  const presenceEl = document.querySelector(".welcome-sigil-svg, .reaper-sigil");
  if (presenceEl && _shadowCore?.stateController) {
    _shadowCore.stateController.bindPresence(presenceEl);
  }
}

// ── Checkpoint D: State controller integration ────────────
function initStateController() {
  const sc = _shadowCore?.stateController;
  if (!sc) return;

  sc.onStateChange((state) => {
    // Update model status badge secondary indicator
    const badge = document.getElementById("sr-state-badge");
    if (badge) {
      badge.textContent = state;
      badge.setAttribute("data-state", state.toLowerCase());
    }
  });
}

// ── Checkpoint E: Controls UI ─────────────────────────────
function updateControlsUI() {
  const histToggle = document.getElementById("toggle-history");
  if (histToggle) {
    histToggle.checked = _shadowCore?.isHistoryEnabled() ?? true;
  }
  const learnToggle = document.getElementById("toggle-learning");
  if (learnToggle) {
    learnToggle.checked = _shadowCore?.isLearningEnabled() ?? true;
  }
  const speechToggle = document.getElementById("toggle-speech");
  if (speechToggle) {
    speechToggle.checked = _shadowCore?.voice?.isSpeechEnabled() ?? false;
  }
  const autoSpeakToggle = document.getElementById("toggle-autospeak");
  if (autoSpeakToggle) {
    autoSpeakToggle.checked = _shadowCore?.voice?.isAutoSpeak() ?? false;
  }
}

// ── Controls tab bindings (Checkpoint E) ─────────────────
function bindControlsTab() {
  document.getElementById("toggle-learning")?.addEventListener("change", async (e) => {
    await _shadowCore.setLearningEnabled(_uid, e.target.checked);
    showToast(e.target.checked ? "Personal learning enabled" : "Personal learning paused", "info", 2000);
  });

  document.getElementById("toggle-history")?.addEventListener("change", async (e) => {
    await _shadowCore.setHistoryEnabled(_uid, e.target.checked);
    showToast(
      e.target.checked
        ? "Conversation history will be saved"
        : "History paused — this session remains temporary",
      "info", 3000
    );
  });

  document.getElementById("toggle-global-learning")?.addEventListener("change", async (e) => {
    await _shadowCore.setGlobalLearningConsent(_uid, e.target.checked);
    showToast(
      e.target.checked ? "Global learning enabled" : "Global learning disabled",
      "info", 2000
    );
  });

  document.getElementById("toggle-speech")?.addEventListener("change", (e) => {
    _shadowCore.voice?.setPreferences({ speechEnabled: e.target.checked });
    _shadowCore.saveVoicePreferences(_uid).catch(() => {});
    // Sync the TTS toggle button
    const btn = document.getElementById("btn-tts-toggle");
    if (btn) {
      btn.textContent = e.target.checked ? "🔊" : "🔇";
    }
  });

  document.getElementById("toggle-autospeak")?.addEventListener("change", (e) => {
    _shadowCore.voice?.setPreferences({ autoSpeak: e.target.checked });
    _shadowCore.saveVoicePreferences(_uid).catch(() => {});
  });

  const rateSlider = document.getElementById("speech-rate");
  if (rateSlider) {
    rateSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById("speech-rate-val").textContent = val.toFixed(1);
      _shadowCore.voice?.setPreferences({ speechRate: val });
    });
    rateSlider.addEventListener("change", () => {
      _shadowCore.saveVoicePreferences(_uid).catch(() => {});
    });
  }
}

// ── Sidebar Controls ──────────────────────────────────────
function bindSidebarControls() {
  document.getElementById("btn-new-chat")?.addEventListener("click", startNewConversation);

  document.getElementById("search-conversations")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = _conversations.filter(c =>
      (c.title || "").toLowerCase().includes(q)
    );
    renderConversationList(filtered, _currentConvId, loadConversation, promptRenameConversation, promptDeleteConversation);
  });

  document.getElementById("btn-shadow-core")?.addEventListener("click", async () => {
    const { ShadowCoreDashboard } = await import("../admin/shadow-core-dashboard.js");
    new ShadowCoreDashboard(_shadowCore, _uid).open();
  });

  document.getElementById("btn-shadow-brain")?.addEventListener("click", async () => {
    const { ShadowBrainPanel } = await import("../admin/shadow-brain.js");
    new ShadowBrainPanel(_shadowCore, _uid).open();
  });

  document.getElementById("btn-project-brains")?.addEventListener("click", async () => {
    const { ProjectBrainsPanel } = await import("../admin/project-brains.js");
    new ProjectBrainsPanel(_shadowCore, _uid).open();
  });

  document.getElementById("btn-global-learning")?.addEventListener("click", async () => {
    const { GlobalLearningPanel } = await import("../admin/global-learning.js");
    new GlobalLearningPanel(_shadowCore, _uid).open();
  });

  document.getElementById("btn-knowledge-center")?.addEventListener("click", async () => {
    const { KnowledgeCenter } = await import("../admin/knowledge-center.js");
    new KnowledgeCenter(_shadowCore, _uid).open();
  });

  document.getElementById("btn-learning-dashboard")?.addEventListener("click", async () => {
    const { LearningDashboard } = await import("../admin/learning-dashboard.js");
    new LearningDashboard(_shadowCore, _uid).open();
  });

  document.getElementById("btn-sign-out")?.addEventListener("click", async () => {
    if (confirm("Sign out of Shadow Reaper AI?")) {
      _convUnsubscribe?.();
      await _shadowCore.persistEmotionalState().catch(() => {});
      await logout();
      window.location.reload();
    }
  });

  document.getElementById("btn-toggle-right-panel")?.addEventListener("click", () => {
    document.getElementById("right-panel")?.classList.toggle("open");
  });
}

// ── Mobile Controls ───────────────────────────────────────
function bindMobileControls() {
  const sidebar  = document.getElementById("sidebar");
  const overlay  = createSidebarOverlay();

  document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("visible");
  });

  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("visible");
  });
}

function createSidebarOverlay() {
  let overlay = document.querySelector(".sidebar-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    document.body.appendChild(overlay);
  }
  return overlay;
}

// ── Emotion auto-update ───────────────────────────────────
function initRightPanelEmotionUpdate() {
  setInterval(() => {
    if (document.getElementById("tab-state")?.classList.contains("hidden") === false) {
      renderEmotionDisplay(_shadowCore.emotion.getState());
      _updateGlobalLearningStatus();
    }
  }, 5000);
}

// ── Update global learning status in right panel ──────────
function _updateGlobalLearningStatus() {
  const el = document.getElementById("global-learning-status");
  if (!el || !_shadowCore) return;
  const consent = _shadowCore.getGlobalLearningConsent();
  el.textContent = consent ? "ENABLED — Contributing" : "DISABLED";
  el.style.color = consent ? "var(--accent-green)" : "var(--text-dim)";
}

// ── Spawn subtle ambient energy scan line ─────────────────
function initEnergyScanLine() {
  const el = document.createElement("div");
  el.className = "energy-scan-line";
  document.body.appendChild(el);
}

// ── Spawn subtle boot lightning ────────────────────────────
function initBootLightning() {
  const container = document.getElementById("boot-lightning");
  if (!container) return;
  const spawn = () => {
    if (!document.getElementById("boot-screen")?.isConnected) return;
    const bolt = document.createElement("div");
    bolt.className = "lightning-bolt";
    bolt.style.left   = Math.random() * 100 + "%";
    bolt.style.top    = Math.random() * 30 + "%";
    bolt.style.height = (60 + Math.random() * 200) + "px";
    bolt.style.animationDuration = (0.4 + Math.random() * 0.6) + "s";
    container.appendChild(bolt);
    setTimeout(() => bolt.remove(), 800);
  };
  const interval = setInterval(spawn, 2500 + Math.random() * 3000);
  const observer = new MutationObserver(() => {
    if (!document.getElementById("boot-screen")?.isConnected) {
      clearInterval(interval);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

// ═══════════════════════════════════════════════════════════
// CONVERSATION
// ═══════════════════════════════════════════════════════════
async function startNewConversation() {
  clearMessages();
  _currentConvId = null;
  _activeProject = null;
  _lastWhyData   = null;
  setChatTitle("NEW CONVERSATION");
  _shadowCore.conversation._convId  = null;
  _shadowCore.conversation._history = [];
  _shadowCore.conversation._activeProject = null;
  // Reset Integration A session state
  _shadowCore.sessionContext?.reset();
  _shadowCore.memoryIntent?.cancelPendingForgetAll();
  document.getElementById("active-project-display").textContent = "—";

  document.getElementById("sidebar")?.classList.remove("open");
  document.querySelector(".sidebar-overlay")?.classList.remove("visible");
}

async function loadConversation(conv) {
  if (!_shadowCore) return;
  _currentConvId = conv.id;
  clearMessages();
  setChatTitle(conv.title || "Conversation");

  const messages = await _shadowCore.conversation.loadConversation(conv.id);
  for (const msg of messages) {
    appendMessage(msg.role, msg.content, {
      id: msg.id,
      onEdit: msg.role === "user" ? handleEditMessage : null
    });
  }

  document.getElementById("sidebar")?.classList.remove("open");
  document.querySelector(".sidebar-overlay")?.classList.remove("visible");
}

async function sendMessage() {
  if (!_shadowCore || _generating) return;

  const input   = document.getElementById("message-input");
  const message = input?.value.trim();
  if (!message) return;

  if (!_shadowCore.model.isOnline()) {
    showToast("Model not yet loaded. Please wait...", "error");
    return;
  }

  _generating = true;
  clearInput();
  showStopButton();

  // Checkpoint D: set state to THINKING
  _shadowCore.stateController?.setThinking();

  appendMessage("user", message, { onEdit: handleEditMessage });
  const thinkingEl = showThinkingIndicator();

  _shadowCore.emotion.processInteraction({
    question: message.includes("?"),
    longConv: _shadowCore.conversation.getHistory().length > 10
  });

  try {
    if (_allMemories.length === 0 || Date.now() % 5 === 0) {
      const data = await _shadowCore.loadContextData().catch(() => ({ memories: _allMemories, knowledge: _allKnowledge }));
      _allMemories  = data.memories;
      // Merge private learned knowledge with globally-promoted knowledge.
      // globalKnowledgeCache is loaded at boot and holds privacy-filtered
      // cross-user knowledge from the globalKnowledge Firestore collection.
      // Without this merge it never reaches RetrievalEngine → ContextEngine.
      const globalKnowledge = _shadowCore.getGlobalKnowledge?.() ?? [];
      _allKnowledge = globalKnowledge.length > 0
        ? [...data.knowledge, ...globalKnowledge]
        : data.knowledge;
    }

    removeThinkingIndicator();
    _streamingMsgEl = appendMessage("assistant", "", { streaming: true });

    await _shadowCore.conversation.sendMessage(message, _allMemories, _allKnowledge);

  } catch (err) {
    removeThinkingIndicator();
    _generating = false;
    hideStopButton();
    _streamingMsgEl = null;
    _shadowCore.stateController?.setIdle();

    if (err.message?.includes("not online")) {
      showToast("Model not online. Check Shadow Core for status.", "error");
    } else {
      showToast(`Error: ${err.message}`, "error");
    }
    appendMessage("assistant", `⚠ Error: ${err.message}\n\nIf the model failed to load, check Shadow Core for details.`);
  }
}

// ── Stream handlers ───────────────────────────────────────
function handleStreamChunk(delta, accumulated) {
  if (_streamingMsgEl) {
    updateStreamingMessage(_streamingMsgEl, accumulated);
  }
}

function handleStreamDone(fullText, { contextParts, isClarification } = {}) {
  _generating = false;
  hideStopButton();

  if (_streamingMsgEl) {
    finalizeStreamingMessage(_streamingMsgEl, fullText);
    if (_lastWhyData || _shadowCore?.conversation?.getLastWhyData()) {
      _lastWhyData = _shadowCore.conversation.getLastWhyData();
      attachWhyButton(_streamingMsgEl);
    }
    _streamingMsgEl = null;
  }

  // Checkpoint D: auto-speak if enabled
  const voice = _shadowCore?.voice;
  if (voice?.isAutoSpeak() && fullText) {
    _shadowCore.stateController?.setSpeaking();
    voice.speak(fullText, {
      onDone:  () => _shadowCore.stateController?.setIdle(),
      onError: () => _shadowCore.stateController?.setIdle()
    });
  } else {
    _shadowCore.stateController?.setIdle();
  }

  if (contextParts) {
    renderContextDisplay(contextParts);
    renderRelevantMemories(contextParts.memories);

    if (contextParts.projectName || contextParts.activeProject) {
      const proj = contextParts.projectName || contextParts.activeProject;
      _activeProject = proj;
      const el = document.getElementById("active-project-display");
      if (el) el.textContent = proj || "—";
    }
  }

  _shadowCore.persistEmotionalState().catch(() => {});
}

function handleStreamError(err) {
  _generating = false;
  hideStopButton();
  removeThinkingIndicator();
  _streamingMsgEl = null;
  _shadowCore.stateController?.setIdle();
  showToast(`Generation error: ${err.message}`, "error");
}

// ── Learning callback ─────────────────────────────────────
function handleLearning(results, activityLog) {
  if (results.newMemories?.length > 0) {
    _allMemories = [..._allMemories, ...results.newMemories];
  }
  if (results.newKnowledge?.length > 0) {
    _allKnowledge = [..._allKnowledge, ...results.newKnowledge];
  }

  _shadowCore.emotion.processInteraction({
    newInfo:    results.newMemories?.length > 0,
    correction: results.corrections?.length > 0
  });
  renderEmotionDisplay(_shadowCore.emotion.getState());

  const countEl = document.getElementById("session-memory-count");
  if (countEl) countEl.textContent = results.newMemories?.length || 0;

  if (activityLog?.length > 0) {
    renderActivityLog(activityLog);
    const lastStep = activityLog[activityLog.length - 1]?.step;
    if (lastStep) showLearningActivity(lastStep);
  }

  if (_shadowCore.getGlobalLearningConsent() && results.newKnowledge?.length > 0) {
    for (const k of results.newKnowledge) {
      _shadowCore.submitToGlobalLearning(k).catch(() => {});
    }
  }
}

// ── Project detected by conversation engine ───────────────
function handleProjectDetected(projectId, projectName) {
  _activeProject = projectName || projectId;
  const el = document.getElementById("active-project-display");
  if (el) el.textContent = _activeProject || "—";
}

// ── Memory action handler (Integration A) ─────────────────
function handleMemoryAction(intentResult) {
  if (!intentResult) return;
  const intent = intentResult.intent;
  const icons  = {
    REMEMBER:   "🧠",
    FORGET_ONE: "🗑",
    FORGET_ALL: "⚠",
    RECALL:     "🔍",
    SEARCH:     "🔎",
    LIST:       "📋"
  };
  const icon = icons[intent] || "💾";
  // Memory actions are shown as toast notifications (brief, non-intrusive)
  if (intent !== "FORGET_ALL" || intentResult.requiresConfirmation) {
    const count = intentResult.recallResults?.length;
    const detail = count > 0 ? ` (${count} result${count !== 1 ? "s" : ""})` : "";
    showToast(`${icon} Memory: ${intent.replace(/_/g, " ")}${detail}`, "info", 3000);
  }

  // If new memory was stored, update the local cache
  if (intentResult.stored && intentResult.stored.id) {
    _allMemories = [..._allMemories, intentResult.stored];
  }
  // If a memory was deleted, remove from local cache
  if (intentResult.deleted?.id) {
    _allMemories = _allMemories.filter(m => m.id !== intentResult.deleted.id);
  }
}

// ── Attach "Why?" button to a message element ─────────────
function attachWhyButton(msgEl) {
  if (!msgEl) return;
  msgEl.querySelector(".btn-why")?.remove();

  const btn = document.createElement("button");
  btn.className = "msg-action-btn btn-why";
  btn.textContent = "WHY?";
  btn.title = "Why does Shadow Reaper think this?";
  btn.addEventListener("click", showWhyPanel);

  const actions = msgEl.querySelector(".message-actions");
  if (actions) actions.appendChild(btn);
}

// ── Show the "Why do you think that?" panel ───────────────
function showWhyPanel() {
  const data = _shadowCore?.conversation?.getLastWhyData();
  if (!data) {
    showToast("No reasoning data available for this response.", "info");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "admin-overlay";
  overlay.innerHTML = `
    <div class="admin-header">
      <button class="btn-icon" id="why-close">←</button>
      <div class="admin-title">◈ WHY DO I THINK THIS?</div>
    </div>
    <div class="admin-body">
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
        Application-level context used to construct this response.
        This shows stored evidence and reasoning — not model chain-of-thought.
      </p>

      ${data.activeProject ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">PROJECT CONTEXT</div>
        <div style="color:var(--accent-green);font-family:var(--font-mono);font-size:13px;margin-top:6px;">${escapeHtml(data.activeProject)}</div>
      </div>` : ""}

      ${data.projectBrainEntries?.length > 0 ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">PROJECT BRAIN ENTRIES USED (${data.projectBrainEntries.length})</div>
        <div style="margin-top:8px;">${data.projectBrainEntries.map(e => `
          <div style="margin-bottom:8px;padding:8px;background:var(--bg-tertiary);border-radius:4px;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue);text-transform:uppercase;">${escapeHtml(e.type)}</div>
            <div style="font-size:13px;color:var(--text-primary);margin-top:2px;">${escapeHtml(e.title)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(e.content || "")}</div>
          </div>`).join("")}
        </div>
      </div>` : ""}

      ${data.mistakesConsidered?.length > 0 ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">PREVIOUS CORRECTIONS CONSIDERED (${data.mistakesConsidered.length})</div>
        <div style="margin-top:8px;">${data.mistakesConsidered.map(m => `
          <div style="margin-bottom:8px;padding:8px;background:rgba(255,51,85,0.08);border:1px solid rgba(255,51,85,0.2);border-radius:4px;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-red);">PAST MISTAKE${m.confirmed ? " (CONFIRMED)" : ""}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(m.lesson || m.topic || "")}</div>
          </div>`).join("")}
        </div>
      </div>` : ""}

      ${data.memoriesUsed?.length > 0 ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">MEMORIES RETRIEVED (${data.memoriesUsed.length})</div>
        <div style="margin-top:8px;">${data.memoriesUsed.map(m => `
          <div style="margin-bottom:6px;padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;">
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">[${escapeHtml(m.category || "memory")} · ${m.confidence}%${m.knowledgeState ? ` · ${escapeHtml(m.knowledgeState)}` : ""}${m.temporalState && m.temporalState !== "CURRENT" ? ` · ${escapeHtml(m.temporalState)}` : ""}]</span>
            <span style="font-size:12px;color:var(--text-primary);margin-left:6px;">${escapeHtml(m.concept)}: ${escapeHtml(m.fact || "")}</span>
          </div>`).join("")}
        </div>
      </div>` : ""}

      ${data.knowledgeUsed?.length > 0 ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">KNOWLEDGE RETRIEVED (${data.knowledgeUsed.length})</div>
        <div style="margin-top:8px;">${data.knowledgeUsed.map(k => `
          <div style="margin-bottom:6px;padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;">
            <span style="font-family:var(--font-mono);font-size:10px;color:${k.knowledgeState === "IDEA" ? "var(--accent-orange,#f59e0b)" : "var(--text-muted)"};">[${escapeHtml(k.category || "knowledge")} · ${k.confidence}%${k.knowledgeState ? ` · ${escapeHtml(k.knowledgeState)}` : ""}${k.temporalState && k.temporalState !== "CURRENT" ? ` · ${escapeHtml(k.temporalState)}` : ""}]</span>
            <span style="font-size:12px;color:var(--text-primary);margin-left:6px;">${escapeHtml(k.concept)}: ${k.knowledgeState === "IDEA" ? "<em style='color:var(--text-muted)'>(IDEA — unconfirmed)</em> " : ""}${escapeHtml(k.fact || "")}</span>
          </div>`).join("")}
        </div>
      </div>` : ""}

      ${data.preferencesApplied?.length > 0 ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">PREFERENCES APPLIED (${data.preferencesApplied.length})</div>
        <div style="margin-top:8px;">${data.preferencesApplied.map(p => `
          <div style="margin-bottom:6px;padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;">
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue);">[${escapeHtml(p.scope)}]</span>
            <span style="font-size:12px;color:var(--text-primary);margin-left:6px;">${escapeHtml(p.fact || "")}</span>
          </div>`).join("")}
        </div>
      </div>` : ""}

      ${data.curiosityAnalysis ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">KNOWLEDGE GAP ANALYSIS</div>
        <pre style="font-size:11px;color:var(--text-secondary);white-space:pre-wrap;margin-top:8px;">${escapeHtml(data.curiosityAnalysis)}</pre>
      </div>` : ""}

      ${data.budgetLog ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">CONTEXT BUDGET</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">
          Total budget: ${data.budgetLog.total} tokens · Used: ~${data.budgetLog.totalUsed}
          ${Object.entries(data.budgetLog.itemsDropped || {}).some(([,v]) => v > 0)
            ? "<br>Dropped: " + Object.entries(data.budgetLog.itemsDropped)
                .filter(([,v]) => v > 0)
                .map(([k,v]) => `${v} ${k}`)
                .join(", ")
            : ""}
        </div>
      </div>` : ""}

      ${data.sessionSnapshot ? `
      <div class="admin-card" style="margin-bottom:12px;">
        <div class="admin-card-title">SESSION CONTEXT (this conversation)</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">
          ${data.sessionSnapshot.activeProject ? `<div>Project: <span style="color:var(--accent-green)">${escapeHtml(data.sessionSnapshot.activeProject)}</span></div>` : ""}
          ${data.sessionSnapshot.activeTopic    ? `<div>Topic: ${escapeHtml(data.sessionSnapshot.activeTopic)}</div>` : ""}
          ${data.sessionSnapshot.activeFeature  ? `<div>Feature: ${escapeHtml(data.sessionSnapshot.activeFeature)}</div>` : ""}
          ${data.sessionSnapshot.activeProblem  ? `<div>Problem: ${escapeHtml(data.sessionSnapshot.activeProblem)}</div>` : ""}
          ${data.sessionSnapshot.lastDecision   ? `<div>Last decision: ${escapeHtml(data.sessionSnapshot.lastDecision)}</div>` : ""}
          ${data.sessionSnapshot.currentAnswerDepth !== "NORMAL" ? `<div>Answer depth: <span style="color:var(--accent-blue)">${escapeHtml(data.sessionSnapshot.currentAnswerDepth)}</span></div>` : ""}
          ${data.sessionSnapshot.sessionPrefs > 0 ? `<div>Session preferences active: ${data.sessionSnapshot.sessionPrefs}</div>` : ""}
        </div>
      </div>` : ""}

      <div style="color:var(--text-dim);font-size:11px;margin-top:8px;">Generated: ${data.generatedAt || "unknown"}</div>
    </div>`;

  document.getElementById("overlay-container").appendChild(overlay);
  overlay.querySelector("#why-close").addEventListener("click", () => overlay.remove());
}

// ── Title generated ───────────────────────────────────────
function handleTitleGenerated(convId, title) {
  if (convId === _currentConvId) {
    setChatTitle(title);
  }
}

// ── Edit message ──────────────────────────────────────────
function handleEditMessage(content, msgEl) {
  const input = document.getElementById("message-input");
  if (!input) return;

  input.value = content;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  document.getElementById("btn-send").disabled = false;
  input.focus();

  const msgs = document.getElementById("chat-messages");
  let found  = false;
  const toRemove = [];
  for (const child of msgs.children) {
    if (child === msgEl) found = true;
    if (found) toRemove.push(child);
  }
  toRemove.forEach(el => el.remove());

  const history = _shadowCore.conversation.getHistory();
  const idx = history.findIndex(m => m.role === "user" && m.content === content);
  if (idx >= 0) {
    _shadowCore.conversation._history = history.slice(0, idx);
  }
}

// ── Rename / Delete conversation ──────────────────────────
function promptRenameConversation(conv) {
  showModal("RENAME CONVERSATION", conv.title || "", "New title...", async (title) => {
    await updateConversationTitle(_uid, conv.id, title);
    showToast("Renamed", "success");
    if (conv.id === _currentConvId) setChatTitle(title);
  });
}

function promptDeleteConversation(conv) {
  showConfirmModal("DELETE CONVERSATION", `Delete "${conv.title || "this conversation"}"?`, async () => {
    await deleteConversation(_uid, conv.id);
    showToast("Deleted", "info");
    if (conv.id === _currentConvId) startNewConversation();
  });
}

// ═══════════════════════════════════════════════════════════
// AUTH FORM BINDINGS
// ═══════════════════════════════════════════════════════════
function bindAuthForms() {
  document.getElementById("btn-login")?.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value.trim();
    const pass  = document.getElementById("login-password")?.value;
    if (!email || !pass) { showAuthError("Email and password required."); return; }
    clearAuthError();
    const btn = document.getElementById("btn-login");
    btn.disabled = true; btn.textContent = "AUTHENTICATING...";
    try {
      await login(email, pass);
      // onAuthChange global listener will handle transition to app
    } catch (err) {
      showAuthError(err.message.replace("Firebase: ", ""));
      btn.disabled = false; btn.textContent = "ACCESS SYSTEM";
    }
  });

  document.getElementById("btn-register")?.addEventListener("click", async () => {
    const email = document.getElementById("reg-email")?.value.trim();
    const pass  = document.getElementById("reg-password")?.value;
    const name  = document.getElementById("reg-name")?.value.trim();
    if (!email || !pass) { showAuthError("Email and password required."); return; }
    if (pass.length < 8) { showAuthError("Password must be at least 8 characters."); return; }
    clearAuthError();
    const btn = document.getElementById("btn-register");
    btn.disabled = true; btn.textContent = "INITIALIZING...";
    try {
      const user = await register(email, pass, name || "Operator");
      _uid = user.uid;
      hideAuthScreen();
      await initializePostAuth(user);
    } catch (err) {
      showAuthError(err.message.replace("Firebase: ", ""));
      btn.disabled = false; btn.textContent = "INITIALIZE OPERATOR";
    }
  });

  document.getElementById("btn-show-register")?.addEventListener("click", () => {
    clearAuthError();
    document.getElementById("auth-form-login")?.classList.add("hidden");
    document.getElementById("auth-form-register")?.classList.remove("hidden");
  });

  document.getElementById("btn-show-login")?.addEventListener("click", () => {
    clearAuthError();
    document.getElementById("auth-form-register")?.classList.add("hidden");
    document.getElementById("auth-form-reset")?.classList.add("hidden");
    document.getElementById("auth-form-login")?.classList.remove("hidden");
  });

  document.getElementById("btn-show-reset")?.addEventListener("click", () => {
    clearAuthError();
    document.getElementById("auth-form-login")?.classList.add("hidden");
    document.getElementById("auth-form-reset")?.classList.remove("hidden");
    document.getElementById("reset-success")?.classList.add("hidden");
  });

  document.getElementById("btn-back-to-login")?.addEventListener("click", () => {
    clearAuthError();
    document.getElementById("auth-form-reset")?.classList.add("hidden");
    document.getElementById("auth-form-login")?.classList.remove("hidden");
  });

  document.getElementById("btn-send-reset")?.addEventListener("click", async () => {
    const email = document.getElementById("reset-email")?.value.trim();
    if (!email) { showAuthError("Email required."); return; }
    clearAuthError();
    const btn = document.getElementById("btn-send-reset");
    btn.disabled = true; btn.textContent = "SENDING...";
    try {
      await sendPasswordReset(email);
      const successEl = document.getElementById("reset-success");
      if (successEl) {
        successEl.textContent = "Reset link sent. Check your email.";
        successEl.classList.remove("hidden");
      }
    } catch (err) {
      showAuthError(err.message.replace("Firebase: ", ""));
    } finally {
      btn.disabled = false; btn.textContent = "SEND RESET LINK";
    }
  });

  document.getElementById("login-password")?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-login")?.click();
  });
  document.getElementById("reset-email")?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-send-reset")?.click();
  });
}

// Called after registration (no full boot sequence needed)
async function initializePostAuth(user) {
  // Guard against double-init if onAuthChange also fires
  if (_shadowCore) return;

  const bootScreen = document.getElementById("boot-screen");
  if (bootScreen) {
    bootScreen.classList.remove("hidden");
    bootScreen.style.opacity = "1";
  }
  const bootLogEl = document.getElementById("boot-log");
  if (bootLogEl) bootLogEl.innerHTML = "";
  setBootProgress(0, "INITIALIZING");

  addBootLine("Creating operator profile...", "pending");
  await initializeForUser(user);
}

// ═══════════════════════════════════════════════════════════
// ENTRY POINT — always triggered by DOMContentLoaded
// ═══════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  bootLog("DOMContentLoaded fired");
  bindAuthForms();

  boot()
    .then(() => {
      // After boot() completes, register a post-login auth listener so that when
      // the user authenticates via the auth form (unauthenticated boot path), we
      // initialise the app without a full page reload.
      // We register it HERE — AFTER initAuth() has already been called inside boot().
      onAuthChange(async (user) => {
        if (user && !_shadowCore) {
          bootLog(`Post-boot auth change: user=${user.email}`);
          hideAuthScreen();
          const bootScreen = document.getElementById("boot-screen");
          if (bootScreen) {
            bootScreen.classList.remove("hidden");
            bootScreen.style.opacity = "1";
          }
          document.getElementById("app")?.classList.add("hidden");
          const bootLogEl = document.getElementById("boot-log");
          if (bootLogEl) bootLogEl.innerHTML = "";
          setBootProgress(0, "INITIALIZING");
          await initializeForUser(user);
        }
      });
    })
    .catch(err => {
      bootLog(`FATAL boot error: ${err.message}`);
      console.error("[BOOT] Fatal error:", err);
      // Last-resort failsafe: always show something to the user
      try {
        document.getElementById("boot-log").innerHTML =
          `<div class="boot-line error">FATAL ERROR: ${err.message}</div>
           <div class="boot-line warn">Attempting recovery...</div>`;
        document.getElementById("boot-status").textContent = "STARTUP ERROR";
      } catch (_) {}
      setTimeout(() => {
        try { hideBootScreen(); showAuthScreen(); } catch (_) {}
      }, 3000);
    });
});
