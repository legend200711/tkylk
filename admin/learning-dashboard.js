// ============================================================
// Learning Dashboard
// Inspect memories, corrections, activity, emotion history
// ============================================================
import { escapeHtml, showToast } from "../js/ui.js";

export class LearningDashboard {
  constructor(shadowCore, uid) {
    this._core = shadowCore;
    this._uid  = uid;
    this._el   = null;
    this._view = "memories";
  }

  async open() {
    this._el = document.createElement("div");
    this._el.className = "admin-overlay";
    this._el.innerHTML = `
      <div class="admin-header">
        <button class="btn-icon" id="ld-close">←</button>
        <div class="admin-title">◉ LEARNING DASHBOARD</div>
      </div>
      <div class="admin-body">
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          <button class="tab-btn active ld-nav" data-view="memories">MEMORIES</button>
          <button class="tab-btn ld-nav" data-view="knowledge">KNOWLEDGE</button>
          <button class="tab-btn ld-nav" data-view="relationships">RELATIONSHIPS</button>
          <button class="tab-btn ld-nav" data-view="reflections">REFLECTIONS</button>
          <button class="tab-btn ld-nav" data-view="emotion">EMOTION</button>
        </div>
        <div id="ld-content"></div>
      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);

    this._el.querySelector("#ld-close").addEventListener("click", () => this.close());
    this._el.querySelectorAll(".ld-nav").forEach(btn => {
      btn.addEventListener("click", () => {
        this._el.querySelectorAll(".ld-nav").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._view = btn.dataset.view;
        this._loadView();
      });
    });

    await this._loadView();
  }

  async _loadView() {
    const content = this._el.querySelector("#ld-content");
    if (!content) return;
    content.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading...</div>';

    switch (this._view) {
      case "memories":      await this._renderMemories(content); break;
      case "knowledge":     await this._renderKnowledge(content); break;
      case "relationships": await this._renderRelationships(content); break;
      case "reflections":   await this._renderReflections(content); break;
      case "emotion":       this._renderEmotion(content); break;
    }
  }

  async _renderMemories(content) {
    const memories = await this._core.memory.getAllMemories();
    if (!memories.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No memories stored yet.</div>';
      return;
    }

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">${memories.length} MEMORIES</span>
        <input type="text" id="ld-mem-search" placeholder="Search..." style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:5px;padding:5px 8px;color:var(--text-primary);font-size:12px;outline:none;width:180px;" />
      </div>
      <div id="ld-mem-list"></div>`;

    this._renderMemoryList(memories, content.querySelector("#ld-mem-list"));

    content.querySelector("#ld-mem-search")?.addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      const filtered = memories.filter(m =>
        (m.concept||"").toLowerCase().includes(q) ||
        (m.fact||"").toLowerCase().includes(q)
      );
      this._renderMemoryList(filtered, content.querySelector("#ld-mem-list"));
    });
  }

  _renderMemoryList(memories, container) {
    if (!container) return;
    if (!memories.length) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">No results</div>';
      return;
    }

    const TYPE_COLORS = {
      working: "#888", episodic: "#7c5cd8", semantic: "#1e6fff",
      procedural: "#00ff88", preference: "#ff9933", relationship: "#00d4ff"
    };

    container.innerHTML = memories.slice(0, 100).map(m => `
      <div class="admin-card" data-id="${m.id}" style="padding:12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:var(--font-mono);font-size:10px;margin-bottom:4px;display:flex;gap:8px;flex-wrap:wrap;">
              <span style="color:${TYPE_COLORS[m.memoryType]||'#888'}">${m.memoryType||'memory'}</span>
              <span style="color:var(--text-muted)">${escapeHtml(m.category||'general')}</span>
              ${m.project ? `<span style="color:var(--accent-blue)">${escapeHtml(m.project)}</span>` : ""}
            </div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--accent-cyan);margin-bottom:3px;">${escapeHtml(m.concept||'—')}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml((m.fact||'').slice(0,160))}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:5px;">
              conf: ${Math.round((m.confidence||0.5)*100)}% · 
              imp: ${Math.round((m.importance||0.5)*100)}% · 
              ✓${m.confirmationCount||1} ✗${m.contradictionCount||0}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;">
            <button class="modal-btn ld-confirm-mem" data-id="${m.id}">+CONF</button>
            <button class="modal-btn danger ld-delete-mem" data-id="${m.id}">DEL</button>
          </div>
        </div>
      </div>`).join("");

    container.querySelectorAll(".ld-confirm-mem").forEach(btn => {
      btn.addEventListener("click", async () => {
        await this._core.memory.confirmMemory(btn.dataset.id);
        showToast("Memory confirmed", "success");
        await this._loadView();
      });
    });
    container.querySelectorAll(".ld-delete-mem").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this memory?")) {
          await this._core.memory.deleteMemory(btn.dataset.id);
          showToast("Memory deleted", "info");
          await this._loadView();
        }
      });
    });
  }

  async _renderKnowledge(content) {
    const knowledge = await this._core.knowledge.getAllKnowledge();
    if (!knowledge.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No learned knowledge yet.</div>';
      return;
    }

    content.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${knowledge.length} KNOWLEDGE RECORDS</div>` +
      knowledge.slice(0, 100).map(k => `
        <div class="admin-card" style="padding:12px;margin-bottom:8px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);">${escapeHtml(k.concept||'—')}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin:4px 0;">${escapeHtml((k.fact||'').slice(0,160))}</div>
          <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">
              ${k.project ? `[${escapeHtml(k.project)}] ` : ""}conf: ${Math.round((k.confidence||0.5)*100)}%
            </span>
            <div style="display:flex;gap:4px;">
              <button class="modal-btn ld-del-know" data-id="${k.id}">DEL</button>
            </div>
          </div>
        </div>`).join("");

    content.querySelectorAll(".ld-del-know").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this knowledge record?")) {
          await this._core.knowledge.deleteKnowledge(btn.dataset.id);
          showToast("Deleted", "info");
          await this._loadView();
        }
      });
    });
  }

  async _renderRelationships(content) {
    const rels = await this._core.graph.getAllRelationships();
    if (!rels.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No relationships yet.</div>';
      return;
    }

    content.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${rels.length} RELATIONSHIPS</div>` +
      rels.slice(0, 200).map(r => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-surface);border-radius:5px;margin-bottom:4px;font-family:var(--font-mono);font-size:11px;justify-content:space-between;">
          <span>${escapeHtml(r.fromConcept||'?')} <span style="color:var(--accent-blue)">→[${escapeHtml(r.type||'relates-to')}]→</span> ${escapeHtml(r.toConcept||'?')}</span>
          <button class="modal-btn danger ld-del-rel" data-id="${r.id}" style="font-size:9px;padding:2px 6px;">DEL</button>
        </div>`).join("");

    content.querySelectorAll(".ld-del-rel").forEach(btn => {
      btn.addEventListener("click", async () => {
        await this._core.graph.deleteRelationship(btn.dataset.id);
        showToast("Relationship deleted", "info");
        await this._loadView();
      });
    });
  }

  async _renderReflections(content) {
    const { getReflections } = await import("../firebase/firestore-service.js");
    const reflections = await getReflections(this._uid);
    if (!reflections.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No reflections yet. Run a reflection pass from Shadow Core.</div>';
      return;
    }

    content.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${reflections.length} REFLECTIONS</div>` +
      reflections.map(r => `
        <div class="admin-card" style="padding:14px;margin-bottom:8px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-green);margin-bottom:6px;">${escapeHtml(r.project||'General')} · ${r.type||'consolidation'}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(r.summary||'')}</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:6px;">
            ${r.memoryCount || 0} memories consolidated · ${r.conceptsFound?.length || 0} concepts
          </div>
        </div>`).join("");
  }

  _renderEmotion(content) {
    const emo    = this._core.emotion.getState();
    const COLORS = {
      curiosity: "#00d4ff", confidence: "#00ff88", concern: "#ff9933",
      excitement: "#7c5cd8", frustration: "#ff3355", calm: "#1e6fff", familiarity: "#00cc6a"
    };

    content.innerHTML = `
      <div style="max-width:400px;">
        <div class="section-label" style="margin-bottom:16px;">CURRENT EMOTIONAL STATE</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${Object.entries(emo).filter(([k]) => k !== "updatedAt" && typeof emo[k] === "number").map(([key, val]) => {
            const pct = Math.round(val * 100);
            return `
              <div>
                <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:4px;">
                  <span>${key.toUpperCase()}</span><span>${pct}%</span>
                </div>
                <div style="height:6px;background:var(--border-subtle);border-radius:3px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${COLORS[key]||'#888'};border-radius:3px;transition:width 0.8s;"></div>
                </div>
              </div>`;
          }).join("")}
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:16px;font-style:italic;">
          These are simulated computational state dimensions — not claims of biological consciousness.
          They influence conversational style and response generation.
        </p>
      </div>`;
  }

  close() {
    this._el?.remove();
    this._el = null;
  }
}
