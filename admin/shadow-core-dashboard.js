// ============================================================
// Shadow Core Dashboard
// Real-time system status, stats, model info
// Now includes all five intelligence systems:
// Mistake Memory, Project Brains, Reflection, Confidence,
// Curiosity Engine
// ============================================================
import { escapeHtml } from "../js/ui.js";
import { getUserStats, checkFirestoreHealth } from "../firebase/firestore-service.js";
import { getAuthInstance } from "../js/auth.js";

export class ShadowCoreDashboard {
  constructor(shadowCore, uid) {
    this._core = shadowCore;
    this._uid  = uid;
    this._el   = null;
    this._infraPollTimer = null;
  }

  async open() {
    const stats  = await getUserStats(this._uid);
    const status = this._core.getSystemStatus();
    const webgpu = this._core.model.getWebGPU();
    const caps   = this._core.model.getCapabilities();
    const emo    = this._core.emotion.getState();

    this._el = document.createElement("div");
    this._el.className = "admin-overlay";
    this._el.innerHTML = `
      <div class="admin-header">
        <button class="btn-icon" id="sc-close">←</button>
        <div class="admin-title">◈ SHADOW CORE</div>
      </div>
      <div class="admin-body">

        <!-- ── Infrastructure Status Panel ─────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title">INFRASTRUCTURE STATUS</div>
          <div id="sc-infra-grid" style="
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:8px;
            margin-top:10px;
          ">
            ${this._renderInfraPlaceholders()}
          </div>
          <div style="margin-top:10px;text-align:right;">
            <button class="btn-ghost" id="sc-refresh-infra" style="font-size:11px;padding:4px 10px;">REFRESH</button>
          </div>
        </div>

        <!-- ── AI Engine Status Grid ──────────────────────── -->
        <div class="system-status-grid" id="sc-status-grid">
          ${this._renderStatusItems(status, webgpu)}
        </div>

        <!-- ── Core Stats ────────────────────────────────────── -->
        <div class="admin-grid">
          <div class="admin-card">
            <div class="admin-card-title">MEMORIES</div>
            <div class="admin-card-value" id="sc-mem-count">${stats.memoryCount}</div>
            <div class="stat-label">Stored across all types</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">LEARNED CONCEPTS</div>
            <div class="admin-card-value" id="sc-know-count">${stats.knowledgeCount}</div>
            <div class="stat-label">High-confidence knowledge</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">RELATIONSHIPS</div>
            <div class="admin-card-value" id="sc-rel-count">${stats.relationshipCount}</div>
            <div class="stat-label">Concept connections</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">REFLECTIONS</div>
            <div class="admin-card-value" id="sc-ref-count">${stats.reflectionCount}</div>
            <div class="stat-label">Consolidation passes</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">PROJECT BRAINS</div>
            <div class="admin-card-value">${stats.projectBrainCount || 0}</div>
            <div class="stat-label">Active project memories</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">MISTAKES LEARNED</div>
            <div class="admin-card-value">${stats.mistakeCount || 0}</div>
            <div class="stat-label">Corrections recorded</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">CONVERSATIONS</div>
            <div class="admin-card-value">${stats.conversationCount}</div>
            <div class="stat-label">Total sessions</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">CORRECTIONS</div>
            <div class="admin-card-value">${stats.correctionCount || 0}</div>
            <div class="stat-label">Correction events</div>
          </div>
        </div>

        <!-- ── Model Info ─────────────────────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title">MODEL CONFIGURATION</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">
            <div><span style="color:var(--text-muted);">MODEL:</span><br/>${escapeHtml(caps.label || caps.modelId || "—")}</div>
            <div><span style="color:var(--text-muted);">STATUS:</span><br/><span style="color:${status.model === 'online' ? 'var(--accent-green)' : 'var(--accent-red)'}">${status.model.toUpperCase()}</span></div>
            <div><span style="color:var(--text-muted);">CONTEXT LENGTH:</span><br/>${caps.contextLength || "—"} tokens</div>
            <div><span style="color:var(--text-muted);">WEBGPU:</span><br/>${webgpu?.available ? '<span style="color:var(--accent-green)">AVAILABLE</span>' : '<span style="color:var(--text-muted)">UNAVAILABLE</span>'}</div>
          </div>
          ${status.modelError ? `<div style="color:var(--accent-red);margin-top:10px;font-size:12px;">ERROR: ${escapeHtml(status.modelError)}</div>` : ""}
        </div>

        <!-- ── Model Diagnostic Panel ────────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title" style="display:flex;align-items:center;justify-content:space-between;">
            MODEL DIAGNOSTIC
            <button class="btn-ghost" id="sc-refresh-diag" style="font-size:10px;padding:3px 8px;">REFRESH</button>
          </div>
          <div id="sc-model-diag" style="margin-top:10px;font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);">
            ${this._renderModelDiag()}
          </div>
        </div>

        <!-- ── Emotional State ──────────────────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title">EMOTIONAL STATE</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
            ${this._renderEmotionBars(emo)}
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
            ${Object.keys(emo).filter(k => k !== 'updatedAt').map(dim => `
              <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);width:80px;">${dim}</label>
                <input type="range" min="0" max="100" value="${Math.round((emo[dim]||0)*100)}" class="emotion-slider" data-dim="${dim}" style="width:120px;" />
              </div>`).join("")}
          </div>
          <button class="btn-primary" id="sc-save-emotions" style="margin-top:12px;">SAVE EMOTIONAL STATE</button>
        </div>

        <!-- ── Reflection Engine ─────────────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title" style="display:flex;align-items:center;gap:10px;">
            REFLECTION ENGINE
            <span id="sc-reflecting-badge" class="status-badge ${status.reflecting ? 'reflecting' : 'online'}" style="font-size:10px;">
              ${status.reflecting ? 'REFLECTING...' : 'IDLE'}
            </span>
          </div>
          <p style="color:var(--text-secondary);font-size:13px;margin:8px 0 12px;">
            Consolidates recent memories into structured knowledge. Detects patterns,
            duplicates, and contradictions.
          </p>
          <button class="btn-primary" id="sc-run-reflection">RUN REFLECTION PASS</button>
          <div id="sc-reflection-result" style="margin-top:10px;font-size:12px;color:var(--text-secondary);"></div>
        </div>

        <!-- ── Confidence Engine Stats ─────────────────────── -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title">CONFIDENCE ENGINE</div>
          <div id="sc-confidence-stats" style="margin-top:8px;font-size:12px;color:var(--text-secondary);">Loading...</div>
        </div>

      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);

    // ── Bind events ───────────────────────────────────────────
    this._el.querySelector("#sc-close").addEventListener("click", () => this.close());

    this._el.querySelector("#sc-refresh-infra")?.addEventListener("click", () => {
      this._refreshInfraStatus();
    });

    this._el.querySelector("#sc-refresh-diag")?.addEventListener("click", () => {
      const diagEl = this._el?.querySelector("#sc-model-diag");
      if (diagEl) diagEl.innerHTML = this._renderModelDiag();
    });

    this._el.querySelector("#sc-save-emotions")?.addEventListener("click", () => {
      const sliders = this._el.querySelectorAll(".emotion-slider");
      sliders.forEach(s => {
        this._core.emotion.forceSet(s.dataset.dim, parseInt(s.value) / 100);
      });
      this._core.emotion.persist();
      this._showResult("sc-reflection-result", "Emotional state saved.");
    });

    this._el.querySelector("#sc-run-reflection")?.addEventListener("click", async () => {
      const btn    = this._el.querySelector("#sc-run-reflection");
      const badge  = this._el.querySelector("#sc-reflecting-badge");
      btn.disabled = true;
      btn.textContent = "REFLECTING...";
      if (badge) { badge.textContent = "REFLECTING..."; badge.className = "status-badge reflecting"; }
      try {
        const results = await this._core.runReflection();
        this._showResult("sc-reflection-result",
          `Reflection complete. ${results.length} project(s) consolidated.`);
      } catch (err) {
        this._showResult("sc-reflection-result", `Error: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "RUN REFLECTION PASS";
        if (badge) { badge.textContent = "IDLE"; badge.className = "status-badge online"; }
      }
    });

    // Run real infra status check
    this._refreshInfraStatus();

    // Load confidence stats
    this._loadConfidenceStats();
  }

  // ── Infrastructure Status (real probes) ──────────────────────
  async _refreshInfraStatus() {
    const grid = this._el?.querySelector("#sc-infra-grid");
    if (!grid) return;

    grid.innerHTML = this._renderInfraPlaceholders();

    // Probe 1: Firebase Auth
    const authUser   = getAuthInstance()?.currentUser;
    const authStatus = authUser ? "CONNECTED" : "DISCONNECTED";
    const authClass  = authUser ? "online" : "offline";

    // Probe 2: Firestore
    let fsStatus = "CHECKING";
    let fsClass  = "loading";
    try {
      const health = await checkFirestoreHealth(this._uid);
      if (health.connected) {
        fsStatus = `CONNECTED (${health.latencyMs}ms)`;
        fsClass  = "online";
      } else {
        fsStatus = "DISCONNECTED";
        fsClass  = "offline";
      }
    } catch {
      fsStatus = "ERROR";
      fsClass  = "offline";
    }

    // Probe 3: Cloudflare
    const cfStatus = this._detectCloudflare();
    const cfClass  = cfStatus === "ONLINE" ? "online" : "loading";

    // Probe 4: R2 Model Source
    let r2Status = "UNKNOWN";
    let r2Class  = "loading";
    try {
      const manifest = await this._checkR2Availability();
      r2Status = manifest ? "AVAILABLE" : "UNAVAILABLE";
      r2Class  = manifest ? "online" : "offline";
    } catch {
      r2Status = "UNAVAILABLE";
      r2Class  = "offline";
    }

    // Probe 5: WebGPU
    const webgpu    = this._core.model.getWebGPU();
    const gpuStatus = webgpu?.available ? "AVAILABLE" : "UNAVAILABLE";
    const gpuClass  = webgpu?.available ? "online" : "offline";

    // Probe 6: Local Model
    const modelSysStatus  = this._core.getSystemStatus();
    const modelStatusText = modelSysStatus.model === "online"  ? "ONLINE"
                          : modelSysStatus.model === "loading" ? "LOADING"
                          : modelSysStatus.model === "error"   ? "ERROR"
                          : "OFFLINE";
    const modelClass = modelSysStatus.model === "online"  ? "online"
                     : modelSysStatus.model === "loading" ? "loading"
                     : "offline";

    // Get stats for real counts
    const stats = await getUserStats(this._uid).catch(() => ({}));

    const globalConsent = modelSysStatus.globalConsent;
    const glStatus = modelSysStatus.globalLearning;
    const items = [
      { name: "SHADOW REAPER AI",   status: modelSysStatus.initialized ? "ONLINE" : "LOADING", cls: modelSysStatus.initialized ? "online" : "loading" },
      { name: "LOCAL MODEL",        status: modelStatusText,        cls: modelClass },
      { name: "WEBGPU",             status: gpuStatus,              cls: gpuClass   },
      { name: "PRIVATE BRAIN",      status: modelSysStatus.memory === "active" ? `ACTIVE (${stats.memoryCount || 0})` : "OFFLINE", cls: modelSysStatus.memory === "active" ? "online" : "offline" },
      { name: "PROJECT BRAIN",      status: modelSysStatus.projectBrain === "active" ? `ACTIVE (${stats.projectBrainCount || 0})` : "OFFLINE", cls: modelSysStatus.projectBrain === "active" ? "online" : "offline" },
      { name: "LEARNING ADAPTER",   status: modelSysStatus.learning === "active" ? "ACTIVE" : "OFFLINE", cls: modelSysStatus.learning === "active" ? "online" : "offline" },
      { name: "MISTAKE MEMORY",     status: modelSysStatus.mistakeMemory === "active" ? `ACTIVE (${stats.mistakeCount || 0})` : "OFFLINE", cls: modelSysStatus.mistakeMemory === "active" ? "online" : "offline" },
      { name: "REFLECTION ENGINE",  status: modelSysStatus.reflecting ? "REFLECTING..." : "IDLE", cls: modelSysStatus.reflecting ? "reflecting" : "online" },
      { name: "CONFIDENCE ENGINE",  status: modelSysStatus.confidence === "active" ? "ACTIVE" : "OFFLINE", cls: modelSysStatus.confidence === "active" ? "online" : "offline" },
      { name: "CURIOSITY ENGINE",   status: modelSysStatus.curiosity === "active" ? "ACTIVE" : "OFFLINE",  cls: modelSysStatus.curiosity === "active" ? "online" : "offline" },
      { name: "PRIVACY FIREWALL",   status: modelSysStatus.privacyFirewall === "active" ? "ACTIVE" : "OFFLINE", cls: modelSysStatus.privacyFirewall === "active" ? "online" : "offline" },
      { name: "GLOBAL LEARNING",    status: glStatus === "enabled" ? "ENABLED" : "DISABLED", cls: glStatus === "enabled" ? "online" : "offline" },
      { name: "FIRESTORE",          status: fsStatus,               cls: fsClass    },
      { name: "CLOUDFLARE / R2",    status: cfStatus === "ONLINE" ? (r2Status === "AVAILABLE" ? "CONNECTED" : cfStatus) : cfStatus, cls: cfClass },
      { name: "FIREBASE AUTH",      status: authStatus,             cls: authClass  }
    ];

    grid.innerHTML = items.map(item => `
      <div class="system-status-item">
        <span class="status-name">${item.name}</span>
        <span class="status-badge ${item.cls}">${item.status}</span>
      </div>`).join("");
  }

  _renderInfraPlaceholders() {
    const labels = [
      "SHADOW REAPER AI", "LOCAL MODEL", "WEBGPU", "PRIVATE BRAIN",
      "PROJECT BRAIN", "LEARNING ADAPTER", "MISTAKE MEMORY", "REFLECTION ENGINE",
      "CONFIDENCE ENGINE", "CURIOSITY ENGINE", "PRIVACY FIREWALL",
      "GLOBAL LEARNING", "FIRESTORE", "CLOUDFLARE / R2", "FIREBASE AUTH"
    ];
    return labels.map(name => `
      <div class="system-status-item">
        <span class="status-name">${name}</span>
        <span class="status-badge loading">CHECKING</span>
      </div>`).join("");
  }

  _detectCloudflare() {
    const hostname = window.location.hostname;
    if (hostname.endsWith(".pages.dev") || hostname === "localhost") {
      return hostname === "localhost" ? "LOCAL" : "ONLINE";
    }
    return navigator.onLine ? "ONLINE" : "OFFLINE";
  }

  async _checkR2Availability() {
    try {
      const res = await fetch("/model-manifest.json", { method: "HEAD", cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── AI Engine Status Grid ────────────────────────────────────
  _renderStatusItems(status, webgpu) {
    const items = [
      { name: "LANGUAGE MODEL",    key: "model" },
      { name: "MEMORY ENGINE",     key: "memory" },
      { name: "KNOWLEDGE ENGINE",  key: "knowledge" },
      { name: "LEARNING ADAPTER",  key: "learning" },
      { name: "REFLECTION ENGINE", key: "reflection" },
      { name: "EMOTION ENGINE",    key: "emotion" },
      { name: "MISTAKE MEMORY",    key: "mistakeMemory" },
      { name: "PROJECT BRAIN",     key: "projectBrain" },
      { name: "CONFIDENCE ENGINE", key: "confidence" },
      { name: "CURIOSITY ENGINE",  key: "curiosity" },
      { name: "WEBGPU",            key: "webgpu" }
    ];

    return items.map(item => {
      let val = status[item.key];
      if (item.key === "webgpu") val = webgpu?.available ? "available" : "unavailable";
      const cls = (val === "online" || val === "active" || val === "available" || val === "idle") ? "online"
                : (val === "loading" || val === "reflecting") ? (val === "reflecting" ? "reflecting" : "loading")
                : "offline";
      const displayVal = val === "idle" ? "IDLE" : String(val || "offline").toUpperCase();
      return `
        <div class="system-status-item">
          <span class="status-name">${item.name}</span>
          <span class="status-badge ${cls}">${displayVal}</span>
        </div>`;
    }).join("");
  }

  _renderEmotionBars(emo) {
    const COLORS = {
      curiosity: "#00d4ff", confidence: "#00ff88", concern: "#ff9933",
      excitement: "#7c5cd8", frustration: "#ff3355", calm: "#1e6fff", familiarity: "#00cc6a"
    };
    return Object.entries(emo).filter(([k]) => k !== "updatedAt").map(([k, v]) => {
      if (typeof v !== "number") return "";
      const pct = Math.round(v * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);width:80px;text-transform:uppercase;">${k}</span>
          <div style="flex:1;height:3px;background:var(--border-subtle);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${COLORS[k]||'#888'};transition:width 1s;"></div>
          </div>
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);width:26px;text-align:right;">${pct}%</span>
        </div>`;
    }).join("");
  }

  async _loadConfidenceStats() {
    const el = this._el?.querySelector("#sc-confidence-stats");
    if (!el) return;
    try {
      const stats = await this._core.confidence.getStats();
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;">
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:var(--accent-green);">${stats.tiers.KNOWN || 0}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">KNOWN</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:var(--accent-blue);">${stats.tiers.LIKELY || 0}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">LIKELY</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:#ff9933;">${stats.tiers.UNCERTAIN || 0}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">UNCERTAIN</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:var(--accent-red);">${stats.tiers.CONFLICTED || 0}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">CONFLICTED</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:var(--text-dim);">${stats.tiers.OUTDATED || 0}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">OUTDATED</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:var(--font-mono);font-size:18px;color:var(--text-secondary);">${Math.round((stats.avgConf || 0) * 100)}%</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">AVG CONF</div>
          </div>
        </div>`;
    } catch {
      el.textContent = "Confidence data unavailable.";
    }
  }

  _showResult(id, text) {
    const el = this._el?.querySelector(`#${id}`);
    if (el) el.textContent = text;
  }

  // ── Model Diagnostic (Language Model section) ────────────────
  _renderModelDiag() {
    const model   = this._core.model;
    const status  = model.getStatus();
    const caps    = model.getCapabilities();
    const webgpu  = model.getWebGPU();
    const proto   = model.getProtocol();
    const err     = model.getError();
    const errCode = model.getErrorCode();
    const modelId = model.getModelId();

    const statusColor = status === "online"  ? "var(--accent-green)"
                      : status === "loading" ? "var(--accent-blue)"
                      : status === "error"   ? "var(--accent-red)"
                      : "var(--text-muted)";

    const row = (label, value, color = null) =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle);">
         <span style="color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;min-width:130px;">${label}</span>
         <span style="${color ? `color:${color}` : ""};text-align:right;word-break:break-all;">${escapeHtml(String(value ?? "—"))}</span>
       </div>`;

    // ── INFERENCE READY: true only if the engine's pipeline map contains
    // the model AND ModelManager reports online AND caps.loaded is set.
    // This is the authoritative "ready for inference" flag — it catches the
    // silent-abort case where reload() returned without actually loading.
    const loadedIds = model.getLoadedModelIds();
    const reloadCompleted = caps.engine === "transformers.js"
      ? (caps.loaded ? true : false)
      : (loadedIds.length > 0 ? loadedIds.includes(modelId || "") : false);

    // Engine state description
    const provider  = model._provider;
    const hasPipe   = caps.engine === "transformers.js" ? !!provider?._pipe : false;
    const hasEngine = caps.engine !== "transformers.js" ? !!(provider?._engine) : false;
    const engineState = loadedIds.length > 0
      ? "PIPELINE ACTIVE"
      : hasPipe ? "TRANSFORMERS PIPE ACTIVE"
      : (hasEngine || provider?._engine) ? "ENGINE EXISTS / NOT LOADED"
      : (provider ? "PROVIDER EXISTS / NOT LOADED" : "NO PROVIDER");

    const modelState = caps.loaded
      ? "LOADED"
      : caps.loading ? "LOADING" : "NOT LOADED";

    // Load progress (last known percent from caps if available)
    const loadPct = caps.loading ? "IN PROGRESS" : (caps.loaded ? "100%" : "—");

    // Inference truly ready: engine status + pipeline map verification
    const inferenceReady = status === "online" && caps.loaded && (reloadCompleted !== false);

    // Determine which engine is active
    const engineType = caps.engine === "transformers.js"
      ? "Transformers.js (CPU/WASM)"
      : modelId ? "WebLLM (WebGPU)" : "—";

    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const modelTierNote = webgpu?.available
      ? (isMobile ? "Mobile/WebGPU path" : "Desktop/WebGPU path")
      : (isMobile ? "Mobile — CPU/WASM fallback" : "No WebGPU — CPU/WASM fallback");

    return [
      // ── Section header
      `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);padding:6px 0 4px;letter-spacing:.1em;border-bottom:2px solid var(--border-subtle);margin-bottom:4px;">LANGUAGE MODEL DIAGNOSTICS</div>`,
      row("Model ID",        modelId || "— (not selected yet)"),
      row("Model Label",     caps.label || "—"),
      row("Context Length",  caps.contextLength ? caps.contextLength + " tokens" : "—"),
      row("Engine State",    engineState,
          reloadCompleted ? "var(--accent-green)"
          : (hasEngine || hasPipe) ? "var(--accent-red)" : "var(--text-muted)"),
      row("Model State",     modelState,
          caps.loaded ? "var(--accent-green)" : caps.loading ? "var(--accent-blue)" : "var(--text-muted)"),
      row("Engine Status",   status.toUpperCase(), statusColor),
      row("Load State",      status === "loading" ? "LOADING" : caps.loaded ? "COMPLETE" : status === "error" ? "FAILED" : "NOT STARTED",
          caps.loaded ? "var(--accent-green)" : status === "loading" ? "var(--accent-blue)" : "var(--text-muted)"),
      row("Load Progress",   loadPct),
      row("Reload Completed",
          reloadCompleted === null ? "N/A (CPU path)" : reloadCompleted ? "YES" : "NO",
          reloadCompleted === null ? null : reloadCompleted ? "var(--accent-green)" : "var(--accent-red)"),
      row("Inference Ready", inferenceReady ? "YES" : "NO",
          inferenceReady ? "var(--accent-green)" : "var(--accent-red)"),
      // ── Section divider
      `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);padding:6px 0 4px;letter-spacing:.1em;border-bottom:2px solid var(--border-subtle);margin:4px 0;">ENVIRONMENT</div>`,
      row("WebGPU",          webgpu?.available ? "AVAILABLE" : ("UNAVAILABLE — " + (webgpu?.stage || "unknown")),
          webgpu?.available ? "var(--accent-green)" : "var(--text-muted)"),
      row("WebGPU Stage",    webgpu?.stage || "—"),
      row("Inference Engine",engineType),
      row("Protocol",        proto?.protocol || window.location.protocol),
      row("Secure Context",  proto?.isSecure ?? window.isSecureContext ? "YES" : "NO",
          (proto?.isSecure ?? window.isSecureContext) ? "var(--accent-green)" : "var(--accent-red)"),
      row("Device Type",     isMobile ? "MOBILE" : "DESKTOP"),
      row("Model Tier Note", modelTierNote),
      // ── Section divider
      `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);padding:6px 0 4px;letter-spacing:.1em;border-bottom:2px solid var(--border-subtle);margin:4px 0;">ERROR STATE</div>`,
      row("Last Init Error", err ? (errCode ? errCode + ": " : "") + err.slice(0, 120) : "none",
          err ? "var(--accent-red)" : "var(--text-muted)"),
      row("Error Code",      errCode || "none",
          errCode ? "var(--accent-red)" : "var(--text-muted)"),
    ].join("");
  }

  close() {
    if (this._infraPollTimer) clearInterval(this._infraPollTimer);
    this._el?.remove();
    this._el = null;
  }
}
