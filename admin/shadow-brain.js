// ============================================================
// MY SHADOW BRAIN — Memory Control Center
// Lets users inspect, correct, archive, and delete their
// private brain data. Personalization is inspectable and
// correctable — not an invisible black box.
// ============================================================
import { escapeHtml, showToast } from "../js/ui.js";

export class ShadowBrainPanel {
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
        <button class="btn-icon" id="sb-close">←</button>
        <div class="admin-title">◈ MY SHADOW BRAIN</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-left:auto;padding-right:8px;">YOUR PRIVATE ADAPTIVE BRAIN</div>
      </div>
      <div class="admin-body">
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
          <button class="tab-btn active sb-nav" data-view="memories">MEMORIES</button>
          <button class="tab-btn sb-nav" data-view="preferences">PREFERENCES</button>
          <button class="tab-btn sb-nav" data-view="projects">PROJECT BRAINS</button>
          <button class="tab-btn sb-nav" data-view="corrections">CORRECTIONS</button>
          <button class="tab-btn sb-nav" data-view="procedures">PROCEDURES</button>
          <button class="tab-btn sb-nav" data-view="relationships">RELATIONSHIPS</button>
          <button class="tab-btn sb-nav" data-view="settings">PRIVACY SETTINGS</button>
        </div>
        <div id="sb-content"></div>
      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);

    this._el.querySelector("#sb-close").addEventListener("click", () => this.close());
    this._el.querySelectorAll(".sb-nav").forEach(btn => {
      btn.addEventListener("click", () => {
        this._el.querySelectorAll(".sb-nav").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._view = btn.dataset.view;
        this._loadView();
      });
    });

    await this._loadView();
  }

  async _loadView() {
    const content = this._el.querySelector("#sb-content");
    if (!content) return;
    content.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Loading...</div>';
    try {
      switch (this._view) {
        case "memories":      await this._renderMemories(content); break;
        case "preferences":   await this._renderPreferences(content); break;
        case "projects":      await this._renderProjectBrains(content); break;
        case "corrections":   await this._renderCorrections(content); break;
        case "procedures":    await this._renderProcedures(content); break;
        case "relationships": await this._renderRelationships(content); break;
        case "settings":      await this._renderPrivacySettings(content); break;
      }
    } catch (err) {
      content.innerHTML = `<div style="color:var(--accent-red);font-size:12px;">Error loading view: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ── MEMORIES ────────────────────────────────────────────────
  async _renderMemories(content) {
    const memories = await this._core.memory.getAllMemories();

    const TYPE_COLORS = {
      working: "#888", episodic: "#7c5cd8", semantic: "#1e6fff",
      procedural: "#00ff88", preference: "#ff9933", relationship: "#00d4ff"
    };

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">${memories.length} MEMORIES STORED</span>
        <div style="display:flex;gap:8px;">
          <input type="text" id="sb-mem-search" placeholder="Search memories..." 
            style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:5px;padding:5px 10px;color:var(--text-primary);font-size:12px;outline:none;width:200px;" />
          <select id="sb-mem-type" style="font-size:11px;padding:5px 8px;">
            <option value="">ALL TYPES</option>
            <option value="episodic">EPISODIC</option>
            <option value="semantic">SEMANTIC</option>
            <option value="procedural">PROCEDURAL</option>
            <option value="preference">PREFERENCE</option>
            <option value="relationship">RELATIONSHIP</option>
          </select>
        </div>
      </div>
      <div id="sb-mem-list"></div>`;

    const renderList = (list) => {
      const container = content.querySelector("#sb-mem-list");
      if (!list.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No memories match.</div>';
        return;
      }
      container.innerHTML = list.slice(0, 80).map(m => `
        <div class="admin-card" data-id="${m.id}" style="padding:13px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
                <span style="font-family:var(--font-mono);font-size:9px;color:${TYPE_COLORS[m.memoryType]||'#888'};text-transform:uppercase;">${m.memoryType||'memory'}</span>
                <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);">${escapeHtml(m.category||'general')}</span>
                ${m.project ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent-blue);">[${escapeHtml(m.project)}]</span>` : ""}
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--accent-cyan);margin-bottom:4px;">${escapeHtml(m.concept||'—')}</div>
              <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${escapeHtml((m.fact||'').slice(0,200))}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">
                <span>conf: ${Math.round((m.confidence||0.5)*100)}%</span>
                <span>imp: ${Math.round((m.importance||0.5)*100)}%</span>
                <span>✓${m.confirmationCount||1}</span>
                <span>✗${m.contradictionCount||0}</span>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
              <button class="modal-btn sb-confirm-mem" data-id="${m.id}" title="Confirm this is still accurate">+CONFIRM</button>
              <button class="modal-btn sb-edit-mem" data-id="${m.id}" data-fact="${escapeHtml(m.fact||'')}" title="Edit memory fact">EDIT</button>
              <button class="modal-btn danger sb-delete-mem" data-id="${m.id}" title="Delete this memory">DELETE</button>
            </div>
          </div>
        </div>`).join("");

      container.querySelectorAll(".sb-confirm-mem").forEach(btn => {
        btn.addEventListener("click", async () => {
          await this._core.memory.confirmMemory(btn.dataset.id);
          showToast("Memory confirmed ✓", "success");
          await this._loadView();
        });
      });

      container.querySelectorAll(".sb-edit-mem").forEach(btn => {
        btn.addEventListener("click", async () => {
          const newFact = prompt("Edit memory:", btn.dataset.fact);
          if (newFact && newFact.trim()) {
            await this._core.memory.updateMemory(btn.dataset.id, { fact: newFact.trim() });
            showToast("Memory updated", "success");
            await this._loadView();
          }
        });
      });

      container.querySelectorAll(".sb-delete-mem").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (confirm("Delete this memory? This cannot be undone.")) {
            await this._core.memory.deleteMemory(btn.dataset.id);
            showToast("Memory deleted", "info");
            await this._loadView();
          }
        });
      });
    };

    renderList(memories);

    const searchInput  = content.querySelector("#sb-mem-search");
    const typeSelect   = content.querySelector("#sb-mem-type");

    const filter = () => {
      const q  = searchInput.value.toLowerCase();
      const t  = typeSelect.value;
      renderList(memories.filter(m =>
        (!q || (m.concept||"").toLowerCase().includes(q) || (m.fact||"").toLowerCase().includes(q)) &&
        (!t || m.memoryType === t)
      ));
    };

    searchInput?.addEventListener("input", filter);
    typeSelect?.addEventListener("change", filter);
  }

  // ── PREFERENCES ─────────────────────────────────────────────
  async _renderPreferences(content) {
    const prefs = await this._core.memory.getMemoriesByType("preference").catch(() => []);

    if (!prefs.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">No learned preferences yet. Shadow Reaper AI adapts to your communication style over time.</div>';
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${prefs.length} LEARNED PREFERENCES</div>
      ${prefs.map(p => `
        <div class="admin-card" style="padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);margin-bottom:4px;">${escapeHtml(p.concept||'preference')}</div>
            <div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(p.fact||'')}</div>
          </div>
          <button class="modal-btn danger sb-del-pref" data-id="${p.id}" style="flex-shrink:0;">DELETE</button>
        </div>`).join("")}`;

    content.querySelectorAll(".sb-del-pref").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Remove this preference?")) {
          await this._core.memory.deleteMemory(btn.dataset.id);
          showToast("Preference removed", "info");
          await this._loadView();
        }
      });
    });
  }

  // ── PROJECT BRAINS ──────────────────────────────────────────
  async _renderProjectBrains(content) {
    const brains = await this._core.projectBrain.getAllBrains().catch(() => []);

    if (!brains.length) {
      content.innerHTML = `
        <div style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">No Project Brains created yet.</div>
        <p style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Create Project Brains for websites, apps, music projects, or business contexts.
          Each brain learns its own architecture, requirements, and solutions — kept strictly private.
        </p>`;
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${brains.length} PROJECT BRAINS</div>
      ${brains.map(b => `
        <div class="project-brain-card" data-id="${b.id}">
          <div class="project-brain-card-title">${escapeHtml(b.name||b.id)}</div>
          <div class="brain-stats-grid">
            <div class="brain-stat">
              <div class="brain-stat-value">${b.knowledgeCount||0}</div>
              <div class="brain-stat-label">KNOWLEDGE</div>
            </div>
            <div class="brain-stat">
              <div class="brain-stat-value">${b.entryCount||0}</div>
              <div class="brain-stat-label">ENTRIES</div>
            </div>
            <div class="brain-stat">
              <div class="brain-stat-value">${Math.round((b.confidence||0.5)*100)}%</div>
              <div class="brain-stat-label">CONFIDENCE</div>
            </div>
          </div>
          <div class="brain-last-learned">${b.lastLearned ? 'Last learned: ' + new Date(b.lastLearned).toLocaleDateString() : 'No activity yet'}</div>
        </div>`).join("")}`;
  }

  // ── CORRECTIONS ─────────────────────────────────────────────
  async _renderCorrections(content) {
    const { getCorrections } = await import("../firebase/firestore-service.js");
    const corrections = await getCorrections(this._uid).catch(() => []);

    if (!corrections.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No corrections recorded yet.</div>';
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${corrections.length} CORRECTIONS RECORDED</div>
      ${corrections.slice(0, 50).map(c => `
        <div class="admin-card" style="padding:12px;margin-bottom:8px;">
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent-red);margin-bottom:4px;">CORRECTED</div>
          <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml((c.originalFact||c.incorrectAnswer||'').slice(0,140))}</div>
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent-green);margin:8px 0 4px;">CORRECTED TO</div>
          <div style="font-size:12px;color:var(--text-primary);">${escapeHtml((c.correctedFact||c.correction||'').slice(0,200))}</div>
        </div>`).join("")}`;
  }

  // ── PROCEDURES ──────────────────────────────────────────────
  async _renderProcedures(content) {
    const procs = await this._core.memory.getMemoriesByType("procedural").catch(() => []);

    if (!procs.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No procedures learned yet. Shadow Reaper AI learns workflows and step-by-step processes from your conversations.</div>';
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${procs.length} PROCEDURES</div>
      ${procs.map(p => `
        <div class="admin-card" style="padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--accent-green);margin-bottom:4px;">${escapeHtml(p.concept||'procedure')}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${escapeHtml((p.fact||'').slice(0,200))}</div>
          </div>
          <button class="modal-btn danger sb-del-proc" data-id="${p.id}">DELETE</button>
        </div>`).join("")}`;

    content.querySelectorAll(".sb-del-proc").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this procedure?")) {
          await this._core.memory.deleteMemory(btn.dataset.id);
          showToast("Procedure deleted", "info");
          await this._loadView();
        }
      });
    });
  }

  // ── RELATIONSHIPS ────────────────────────────────────────────
  async _renderRelationships(content) {
    const rels = await this._core.graph.getAllRelationships().catch(() => []);

    if (!rels.length) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No concept relationships mapped yet.</div>';
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${rels.length} CONCEPT RELATIONSHIPS</div>
      ${rels.slice(0,100).map(r => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-surface);border-radius:5px;margin-bottom:4px;font-family:var(--font-mono);font-size:11px;justify-content:space-between;flex-wrap:wrap;">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.fromConcept||'?')} <span style="color:var(--accent-blue);">→[${escapeHtml(r.type||'relates-to')}]→</span> ${escapeHtml(r.toConcept||'?')}</span>
          <button class="modal-btn danger sb-del-rel" data-id="${r.id}" style="font-size:9px;padding:2px 6px;flex-shrink:0;">DEL</button>
        </div>`).join("")}`;

    content.querySelectorAll(".sb-del-rel").forEach(btn => {
      btn.addEventListener("click", async () => {
        await this._core.graph.deleteRelationship(btn.dataset.id);
        showToast("Relationship deleted", "info");
        await this._loadView();
      });
    });
  }

  // ── PRIVACY SETTINGS ────────────────────────────────────────
  async _renderPrivacySettings(content) {
    const consentEnabled = this._core.getGlobalLearningConsent();

    content.innerHTML = `
      <div style="max-width:560px;">

        <!-- Global Learning Consent -->
        <div class="admin-card" style="margin-bottom:16px;">
          <div class="admin-card-title" style="color:var(--accent-green);">HELP IMPROVE SHADOW REAPER AI</div>
          <p style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin:10px 0 14px;">
            When enabled, Shadow Reaper AI may use <strong>privacy-filtered, generalized patterns</strong> 
            from your interactions to improve its shared knowledge.<br/><br/>
            <strong>What this means:</strong><br/>
            • Only technical patterns and general concepts are candidates — never raw conversations.<br/>
            • Every candidate passes a multi-layer Privacy Firewall before consideration.<br/>
            • Personal information, credentials, private business data, and identifiers are automatically blocked.<br/>
            • Your private brain continues working the same way whether this is enabled or not.<br/><br/>
            <span style="color:var(--text-muted);font-size:12px;">
              Private personal information and raw conversations are never intentionally added to Global Learning.
            </span>
          </p>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <label class="toggle-switch" style="position:relative;display:inline-block;width:48px;height:26px;">
              <input type="checkbox" id="sb-global-consent" ${consentEnabled ? 'checked' : ''} 
                style="opacity:0;width:0;height:0;" />
              <span style="
                position:absolute;cursor:pointer;inset:0;
                background:${consentEnabled ? 'var(--accent-green)' : 'var(--border-default)'};
                border-radius:26px;transition:0.2s;
              " id="sb-consent-track"></span>
              <span style="
                position:absolute;top:3px;left:${consentEnabled ? '25px' : '3px'};
                width:20px;height:20px;background:#fff;border-radius:50%;transition:0.2s;
              " id="sb-consent-thumb"></span>
            </label>
            <span id="sb-consent-label" style="font-family:var(--font-mono);font-size:12px;color:${consentEnabled ? 'var(--accent-green)' : 'var(--text-muted)'};">
              ${consentEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <button class="btn-primary" id="sb-save-consent" style="max-width:200px;">SAVE SETTING</button>
          <div id="sb-consent-msg" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>
        </div>

        <!-- Private Brain Notice -->
        <div class="admin-card" style="margin-bottom:16px;border-color:rgba(30,111,255,0.3);">
          <div class="admin-card-title">PRIVATE BRAIN — ALWAYS ACTIVE</div>
          <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:8px;">
            Your private memory, preferences, project brains, corrections, and personalization 
            are always active and always strictly private to your account — regardless of the 
            Global Learning setting above.
          </p>
        </div>

        <!-- Data Control -->
        <div class="admin-card" style="border-color:rgba(255,51,85,0.2);">
          <div class="admin-card-title" style="color:var(--accent-red);">DATA CONTROL</div>
          <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin:8px 0 12px;">
            Use the MEMORIES, PREFERENCES, CORRECTIONS, and PROCEDURES tabs above to inspect and delete 
            any data you wish to remove from your private brain. Deleted memories are removed from your 
            active private context immediately.
          </p>
        </div>
      </div>`;

    const checkbox = content.querySelector("#sb-global-consent");
    const track    = content.querySelector("#sb-consent-track");
    const thumb    = content.querySelector("#sb-consent-thumb");
    const label    = content.querySelector("#sb-consent-label");

    checkbox?.addEventListener("change", () => {
      const v = checkbox.checked;
      track.style.background = v ? "var(--accent-green)" : "var(--border-default)";
      thumb.style.left       = v ? "25px" : "3px";
      label.style.color      = v ? "var(--accent-green)" : "var(--text-muted)";
      label.textContent      = v ? "ENABLED" : "DISABLED";
    });

    content.querySelector("#sb-save-consent")?.addEventListener("click", async () => {
      const enabled = checkbox?.checked ?? false;
      await this._core.setGlobalLearningConsent(this._uid, enabled);
      const msg = content.querySelector("#sb-consent-msg");
      if (msg) msg.textContent = enabled
        ? "✓ Global learning contribution enabled."
        : "✓ Global learning contribution disabled.";
      showToast(enabled ? "Global learning enabled" : "Global learning disabled", "success");
    });
  }

  close() {
    this._el?.remove();
    this._el = null;
  }
}
