// ============================================================
// UI Module
// DOM manipulation, rendering, markdown, particles
// ============================================================

// ── Markdown renderer (no external deps) ──────────────────
export function renderMarkdown(text) {
  if (!text) return "";

  let html = text
    // Escape HTML first (only &, <, > — preserve content structure)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (must come before inline code)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang || "code";
    return `<pre><div class="code-block-header"><span class="code-lang">${langLabel.toUpperCase()}</span><button class="msg-action-btn copy-code-btn" onclick="navigator.clipboard.writeText(this.closest('pre').querySelector('code').textContent)">COPY</button></div><code class="language-${langLabel}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^#{1}\s+(.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/^#{2}\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#{3}\s+(.+)$/gm, "<h3>$1</h3>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Horizontal rule
  html = html.replace(/^---+$/gm, "<hr/>");

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^[\*\-]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Line breaks → paragraphs
  const blocks = html.split(/\n\n+/);
  html = blocks.map(b => {
    b = b.trim();
    if (!b) return "";
    if (/^<(?:h[123]|ul|ol|li|pre|blockquote|hr)/.test(b)) return b;
    return `<p>${b.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");

  return html;
}

// ── Boot Screen ───────────────────────────────────────────
export function addBootLine(message, status = "pending") {
  const log = document.getElementById("boot-log");
  if (!log) return;

  // Update existing "pending" line or add new line
  const existing = [...log.querySelectorAll(".boot-line.pending")];
  if (existing.length > 0) {
    existing[existing.length - 1].className = `boot-line ${status}`;
    existing[existing.length - 1].textContent = message;
  }

  const line = document.createElement("div");
  line.className = "boot-line pending";
  line.textContent = "...";
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

export function finalizeBootLine(message, status = "ok") {
  const log = document.getElementById("boot-log");
  if (!log) return;
  const pending = log.querySelector(".boot-line.pending");
  if (pending) {
    pending.className = `boot-line ${status}`;
    pending.textContent = message;
  }
}

export function setBootProgress(percent, statusText = null) {
  const bar = document.getElementById("boot-progress");
  if (bar) bar.style.width = `${percent}%`;

  const status = document.getElementById("boot-status");
  if (status && statusText) status.textContent = statusText;
}

export function hideBootScreen() {
  const boot = document.getElementById("boot-screen");
  if (!boot) return;
  boot.style.transition = "opacity 0.6s ease";
  boot.style.opacity    = "0";
  setTimeout(() => { boot.classList.add("hidden"); }, 650);
}

// ── Auth Screen ───────────────────────────────────────────
export function showAuthScreen() {
  document.getElementById("auth-screen")?.classList.remove("hidden");
}

export function hideAuthScreen() {
  const el = document.getElementById("auth-screen");
  if (!el) return;
  el.style.transition = "opacity 0.4s ease";
  el.style.opacity    = "0";
  setTimeout(() => { el.classList.add("hidden"); el.style.opacity = ""; }, 450);
}

export function showApp() {
  document.getElementById("app")?.classList.remove("hidden");
}

// ── Auth error ────────────────────────────────────────────
export function showAuthError(message) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

export function clearAuthError() {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ── Toast notifications ───────────────────────────────────
export function showToast(message, type = "info", duration = 3500) {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease";
    toast.style.opacity    = "0";
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ── Model status badge ────────────────────────────────────
export function setModelStatus(status, text) {
  const badge = document.getElementById("model-status-badge");
  const footer = document.getElementById("model-info-footer");
  if (!badge) return;

  badge.className = `model-status ${status}`;
  badge.textContent = text.toUpperCase();
  if (footer) footer.textContent = text;

  // Update textarea placeholder to reflect model state
  const input = document.getElementById("message-input");
  if (input) {
    if (status === "online") {
      input.placeholder = "Speak to Shadow Reaper AI...";
      input.disabled = false;
    } else if (status === "loading") {
      input.placeholder = "Model loading — please wait...";
    } else if (status === "error" || status === "warn") {
      input.placeholder = "Model unavailable — see status badge above";
    }
  }
}

// ── Conversation list ─────────────────────────────────────
export function renderConversationList(conversations, activeId, onSelect, onRename, onDelete) {
  const list = document.getElementById("conversation-list");
  if (!list) return;

  list.innerHTML = "";

  if (conversations.length === 0) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:12px;text-align:center;">No conversations yet</div>';
    return;
  }

  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = `conv-item${conv.id === activeId ? " active" : ""}`;
    item.dataset.id = conv.id;

    const ts = conv.updatedAt?.toDate?.()
      ? formatRelativeTime(conv.updatedAt.toDate())
      : "—";

    item.innerHTML = `
      <div class="conv-title">${escapeHtml(conv.title || "Conversation")}</div>
      <div class="conv-meta">${ts}</div>
      <div class="conv-actions">
        <button class="conv-action-btn rename-btn" title="Rename">✎</button>
        <button class="conv-action-btn delete-btn" title="Delete">✕</button>
      </div>`;

    item.querySelector(".rename-btn").addEventListener("click", e => {
      e.stopPropagation();
      onRename(conv);
    });
    item.querySelector(".delete-btn").addEventListener("click", e => {
      e.stopPropagation();
      onDelete(conv);
    });
    item.addEventListener("click", () => onSelect(conv));

    list.appendChild(item);
  }
}

// ── Messages ──────────────────────────────────────────────
export function appendMessage(role, content, options = {}) {
  const messagesEl = document.getElementById("chat-messages");
  if (!messagesEl) return null;

  // Hide welcome screen
  const welcome = document.getElementById("chat-welcome");
  if (welcome) welcome.style.display = "none";

  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  if (options.id) msgEl.dataset.id = options.id;

  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const roleLabel = role === "user" ? "OPERATOR" : "SHADOW REAPER";

  const bodyClass = role === "assistant" && options.streaming ? "message-body streaming-cursor" : "message-body";
  const bodyContent = role === "assistant" ? renderMarkdown(content) : escapeHtml(content);

  msgEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">${roleLabel}</span>
      <span class="message-time">${now}</span>
    </div>
    <div class="${bodyClass}">${bodyContent}</div>
    <div class="message-actions">
      ${role === "assistant" ? '<button class="msg-action-btn copy-btn">COPY</button>' : ""}
      ${role === "user" && options.onEdit ? '<button class="msg-action-btn edit-btn">EDIT</button>' : ""}
    </div>`;

  // Copy button
  const copyBtn = msgEl.querySelector(".copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(content).then(() => showToast("Copied", "success", 1500));
    });
  }

  // Edit button
  if (options.onEdit) {
    const editBtn = msgEl.querySelector(".edit-btn");
    if (editBtn) editBtn.addEventListener("click", () => options.onEdit(content, msgEl));
  }

  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

export function updateStreamingMessage(msgEl, content) {
  if (!msgEl) return;
  const body = msgEl.querySelector(".message-body");
  if (!body) return;
  body.innerHTML = renderMarkdown(content);
}

export function finalizeStreamingMessage(msgEl, content) {
  if (!msgEl) return;
  const body = msgEl.querySelector(".message-body");
  if (!body) return;
  body.className = "message-body";
  body.innerHTML = renderMarkdown(content);
}

export function showThinkingIndicator() {
  const messagesEl = document.getElementById("chat-messages");
  if (!messagesEl) return null;

  const el = document.createElement("div");
  el.className = "thinking-indicator";
  el.id        = "thinking-indicator";
  el.innerHTML = `
    <div class="thinking-dots">
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
    </div>
    <span class="thinking-label">SHADOW REAPER PROCESSING</span>`;

  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

export function removeThinkingIndicator() {
  document.getElementById("thinking-indicator")?.remove();
}

// ── Emotion display ───────────────────────────────────────
export function renderEmotionDisplay(emotionState) {
  const container = document.getElementById("emotion-display");
  if (!container || !emotionState) return;

  const EMOTION_COLORS = {
    curiosity:   "#00d4ff",
    confidence:  "#00ff88",
    concern:     "#ff9933",
    excitement:  "#7c5cd8",
    frustration: "#ff3355",
    calm:        "#1e6fff",
    familiarity: "#00cc6a"
  };

  container.innerHTML = Object.entries(emotionState)
    .filter(([k]) => k !== "updatedAt")
    .map(([key, value]) => {
      if (typeof value !== "number") return "";
      const pct   = Math.round(value * 100);
      const color = EMOTION_COLORS[key] || "#888";
      return `
        <div class="emotion-bar">
          <span class="emotion-label">${key}</span>
          <div class="emotion-track">
            <div class="emotion-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="emotion-value">${pct}%</span>
        </div>`;
    }).join("");
}

// ── Activity log ──────────────────────────────────────────
export function renderActivityLog(steps) {
  const container = document.getElementById("learning-activity-display");
  if (!container) return;

  container.innerHTML = steps.map((step, i) => `
    <div class="activity-step complete">
      <span class="activity-icon">✓</span>
      <span>${step.step}${step.detail ? `: ${step.detail.slice(0, 40)}` : ""}</span>
    </div>`
  ).join("");
}

// ── Learning activity bar ──────────────────────────────────
export function showLearningActivity(text) {
  const bar = document.getElementById("learning-activity-bar");
  if (!bar) return;
  bar.textContent = `◉ ${text}`;
  bar.classList.add("visible");
  setTimeout(() => bar.classList.remove("visible"), 4000);
}

// ── Memory display ────────────────────────────────────────
export function renderRelevantMemories(memories) {
  const container = document.getElementById("relevant-memories-display");
  if (!container) return;

  if (!memories?.length) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">No relevant memories found</div>';
    return;
  }

  container.innerHTML = memories.slice(0, 6).map(m => `
    <div class="memory-item">
      <div class="mem-concept">${escapeHtml(m.concept || "Memory")}</div>
      <div>${escapeHtml((m.fact || "").slice(0, 100))}</div>
      <div class="mem-confidence">confidence: ${Math.round((m.confidence || 0.5) * 100)}% · ${m.category || "general"}</div>
    </div>`
  ).join("");
}

// ── Context display ───────────────────────────────────────
export function renderContextDisplay(contextParts) {
  const container = document.getElementById("context-display");
  if (!container || !contextParts) return;
  container.textContent =
    `System: ${(contextParts.systemPrompt || "").slice(0, 120)}...\n\n` +
    `Memories: ${contextParts.memories?.length || 0} loaded\n` +
    `Knowledge: ${contextParts.knowledge?.length || 0} loaded\n` +
    `Relationships: ${contextParts.relationships ? "yes" : "no"}`;
}

// ── Tabs ──────────────────────────────────────────────────
export function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const tabName = btn.dataset.tab;
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      document.getElementById(`tab-${tabName}`)?.classList.remove("hidden");
    });
  });
}

// ── Chat title ────────────────────────────────────────────
export function setChatTitle(title) {
  const el = document.getElementById("chat-title");
  if (el) el.textContent = (title || "NEW CONVERSATION").toUpperCase();
}

// ── Input auto-resize ─────────────────────────────────────
export function initInputAutoResize() {
  const input = document.getElementById("message-input");
  if (!input) return;
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";

    const count = document.getElementById("char-count");
    if (count) count.textContent = `${input.value.length} / 8000`;

    // Only enable send when model is online AND input is non-empty
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) {
      const modelOnline = document.getElementById("model-status-badge")
        ?.classList.contains("online");
      sendBtn.disabled = input.value.trim().length === 0 || !modelOnline;
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("btn-send")?.click();
    }
  });
}

// ── Scroll ────────────────────────────────────────────────
export function scrollToBottom() {
  const msgs = document.getElementById("chat-messages");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ── Particles ────────────────────────────────────────────
export function initBootParticles() {
  const container = document.getElementById("boot-particles");
  if (!container) return;

  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement("div");
    p.className = "particle boot-particle";
    p.style.cssText = `
      left:  ${Math.random() * 100}%;
      top:   ${Math.random() * 100}%;
      animation-duration: ${3 + Math.random() * 6}s;
      animation-delay:    ${Math.random() * 4}s;
      opacity: 0;
      width:  ${1 + Math.random() * 2}px;
      height: ${1 + Math.random() * 2}px;
      background: ${Math.random() > 0.5 ? "var(--accent-green)" : "var(--accent-blue)"};
    `;
    container.appendChild(p);
  }
}

// ── Modal helpers ─────────────────────────────────────────
export function showModal(title, inputDefault = "", placeholder = "", onConfirm = null) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${escapeHtml(title)}</div>
      <input type="text" class="modal-input" value="${escapeHtml(inputDefault)}" placeholder="${escapeHtml(placeholder)}" />
      <div class="modal-actions">
        <button class="modal-btn cancel-btn">CANCEL</button>
        <button class="modal-btn confirm confirm-btn">CONFIRM</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const input = overlay.querySelector(".modal-input");
  input?.focus();
  input?.select();

  overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".confirm-btn").addEventListener("click", () => {
    const val = input?.value.trim();
    if (val) onConfirm?.(val);
    overlay.remove();
  });

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

export function showConfirmModal(title, message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${escapeHtml(title)}</div>
      <p style="color:var(--text-secondary);margin-bottom:20px;">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="modal-btn cancel-btn">CANCEL</button>
        <button class="modal-btn danger confirm-btn">CONFIRM DELETE</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".confirm-btn").addEventListener("click", () => { onConfirm?.(); overlay.remove(); });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// ── Helpers ───────────────────────────────────────────────
export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatRelativeTime(date) {
  const now    = Date.now();
  const diffMs = now - date.getTime();
  const diffMin  = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay  = Math.floor(diffMs / 86400000);

  if (diffMin < 1)   return "Just now";
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7)   return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function setSendEnabled(enabled) {
  const btn = document.getElementById("btn-send");
  if (!btn) return;
  if (enabled) {
    // Only enable if there's also text in the input
    const input = document.getElementById("message-input");
    btn.disabled = !input || input.value.trim().length === 0;
  } else {
    btn.disabled = true;
  }
}

export function showStopButton() {
  document.getElementById("btn-send")?.classList.add("hidden");
  document.getElementById("btn-stop")?.classList.remove("hidden");
}

export function hideStopButton() {
  document.getElementById("btn-stop")?.classList.add("hidden");
  document.getElementById("btn-send")?.classList.remove("hidden");
}

export function clearInput() {
  const input = document.getElementById("message-input");
  if (!input) return;
  input.value = "";
  input.style.height = "auto";
  const count = document.getElementById("char-count");
  if (count) count.textContent = "0 / 8000";
  setSendEnabled(false);
}

export function showWelcome() {
  const welcome = document.getElementById("chat-welcome");
  const msgs    = document.getElementById("chat-messages");
  if (!welcome || !msgs) return;

  // Clear messages but show welcome
  msgs.querySelectorAll(".message, .thinking-indicator").forEach(el => el.remove());
  welcome.style.display = "";
}

export function clearMessages() {
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return;
  msgs.querySelectorAll(".message, .thinking-indicator").forEach(el => el.remove());
  const welcome = document.getElementById("chat-welcome");
  if (welcome) welcome.style.display = "";
}
