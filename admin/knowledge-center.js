// ============================================================
// Knowledge Center
// Admin interface for managing projects and knowledge
// ============================================================
import { escapeHtml, showToast } from "../js/ui.js";
import { KnowledgeEngine } from "../core/knowledge-engine.js";

export class KnowledgeCenter {
  constructor(shadowCore, uid) {
    this._core = shadowCore;
    this._uid  = uid;
    this._el   = null;
    this._projects     = [];
    this._knowledge    = [];
    this._activeProject = null;
  }

  async open() {
    this._el = document.createElement("div");
    this._el.className = "admin-overlay";
    this._el.innerHTML = `
      <div class="admin-header">
        <button class="btn-icon" id="kc-close">←</button>
        <div class="admin-title">◎ KNOWLEDGE CENTER</div>
        <button class="btn-primary" id="kc-add-project" style="width:auto;padding:6px 14px;font-size:10px;">+ PROJECT</button>
        <button class="btn-ghost" id="kc-import-json" style="width:auto;padding:6px 14px;font-size:10px;">IMPORT JSON</button>
      </div>
      <div class="admin-body">
        <div style="display:flex;gap:16px;height:calc(100% - 0px);">
          <!-- Project list -->
          <div style="width:220px;flex-shrink:0;">
            <div class="section-label">PROJECTS</div>
            <div id="kc-project-list" style="display:flex;flex-direction:column;gap:4px;margin-top:8px;"></div>
          </div>
          <!-- Knowledge panel -->
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
              <div id="kc-active-project-label" class="section-label" style="flex:1;">ALL KNOWLEDGE</div>
              <input type="text" id="kc-search" placeholder="Search knowledge..." style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;padding:6px 10px;color:var(--text-primary);font-size:12px;outline:none;width:200px;" />
              <button class="btn-primary" id="kc-add-knowledge" style="width:auto;padding:6px 14px;font-size:10px;">+ KNOWLEDGE</button>
            </div>
            <div id="kc-knowledge-list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100vh - 180px);"></div>
          </div>
        </div>
      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);

    await this._loadData();
    this._renderProjects();
    this._renderKnowledge();
    this._bindEvents();
  }

  async _loadData() {
    const [projects, knowledge] = await Promise.all([
      this._core.knowledge.getAllKnowledge(),
      this._core.knowledge.getAllKnowledge()
    ]);
    this._projects  = await this._getProjects();
    this._knowledge = knowledge;
  }

  async _getProjects() {
    // Derive unique projects from knowledge
    const all = await this._core.knowledge.getAllKnowledge();
    const projSet = new Set(all.map(k => k.project).filter(Boolean));
    return [...projSet].map(name => ({ name }));
  }

  _renderProjects() {
    const list = this._el.querySelector("#kc-project-list");
    if (!list) return;

    const allBtn = document.createElement("button");
    allBtn.className = `btn-sidebar-nav${!this._activeProject ? " active-nav" : ""}`;
    allBtn.textContent = "ALL PROJECTS";
    allBtn.style.fontFamily = "var(--font-mono)";
    allBtn.addEventListener("click", () => {
      this._activeProject = null;
      this._renderKnowledge();
      this._el.querySelector("#kc-active-project-label").textContent = "ALL KNOWLEDGE";
    });
    list.appendChild(allBtn);

    for (const p of this._projects) {
      const btn = document.createElement("button");
      btn.className = "btn-sidebar-nav";
      btn.textContent = p.name;
      btn.style.fontFamily = "var(--font-mono)";
      btn.addEventListener("click", () => {
        this._activeProject = p.name;
        this._renderKnowledge();
        this._el.querySelector("#kc-active-project-label").textContent = p.name.toUpperCase();
      });
      list.appendChild(btn);
    }
  }

  _renderKnowledge(searchQuery = "") {
    const list = this._el.querySelector("#kc-knowledge-list");
    if (!list) return;

    let items = this._knowledge;
    if (this._activeProject) items = items.filter(k => k.project === this._activeProject);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(k =>
        (k.concept || "").toLowerCase().includes(q) ||
        (k.fact    || "").toLowerCase().includes(q) ||
        (k.category|| "").toLowerCase().includes(q)
      );
    }

    if (items.length === 0) {
      list.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:20px 0;">No knowledge records found${searchQuery ? " for that search" : ""}.</div>`;
      return;
    }

    list.innerHTML = items.map(k => `
      <div class="admin-card" data-id="${k.id}" style="padding:14px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);margin-bottom:4px;">
              ${escapeHtml(k.concept || "—")}
              ${k.project ? `<span style="color:var(--accent-blue);margin-left:8px;">[${escapeHtml(k.project)}]</span>` : ""}
              <span style="color:var(--text-muted);margin-left:8px;">${escapeHtml(k.category || "general")}</span>
            </div>
            <div style="font-size:13px;color:var(--text-secondary);">${escapeHtml((k.fact || "").slice(0, 200))}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:6px;">
              confidence: ${Math.round((k.confidence || 0.5)*100)}% ·
              confirmations: ${k.confirmationCount || 1} ·
              contradictions: ${k.contradictionCount || 0}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
            <button class="modal-btn kc-confirm-btn" data-id="${k.id}">+CONF</button>
            <button class="modal-btn kc-decrease-btn" data-id="${k.id}">-CONF</button>
            <button class="modal-btn kc-edit-btn" data-id="${k.id}" data-fact="${escapeHtml(k.fact||"")}">EDIT</button>
            <button class="modal-btn danger kc-delete-btn" data-id="${k.id}">DELETE</button>
          </div>
        </div>
      </div>`).join("");

    // Bind knowledge item actions
    list.querySelectorAll(".kc-confirm-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await this._core.knowledge.confirmKnowledge(btn.dataset.id);
        showToast("Confidence increased", "success");
        await this._refresh();
      });
    });
    list.querySelectorAll(".kc-decrease-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await this._core.knowledge.decreaseConfidence(btn.dataset.id);
        showToast("Confidence decreased", "info");
        await this._refresh();
      });
    });
    list.querySelectorAll(".kc-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const fact = btn.dataset.fact;
        const id   = btn.dataset.id;
        this._showEditModal(id, fact);
      });
    });
    list.querySelectorAll(".kc-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this knowledge record?")) {
          await this._core.knowledge.deleteKnowledge(btn.dataset.id);
          showToast("Deleted", "info");
          await this._refresh();
        }
      });
    });
  }

  _showEditModal(id, currentFact) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">EDIT KNOWLEDGE</div>
        <textarea class="modal-input admin-textarea" style="min-height:100px;">${escapeHtml(currentFact)}</textarea>
        <div class="modal-actions">
          <button class="modal-btn cancel-btn">CANCEL</button>
          <button class="modal-btn confirm confirm-btn">SAVE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector(".confirm-btn").addEventListener("click", async () => {
      const newFact = overlay.querySelector("textarea").value.trim();
      if (newFact) {
        await this._core.knowledge.updateKnowledge(id, { fact: newFact });
        showToast("Updated", "success");
        await this._refresh();
      }
      overlay.remove();
    });
  }

  _bindEvents() {
    this._el.querySelector("#kc-close").addEventListener("click", () => this.close());

    this._el.querySelector("#kc-search")?.addEventListener("input", e => {
      this._renderKnowledge(e.target.value);
    });

    this._el.querySelector("#kc-add-knowledge")?.addEventListener("click", () => {
      this._showAddKnowledgeModal();
    });

    this._el.querySelector("#kc-add-project")?.addEventListener("click", () => {
      this._showAddProjectModal();
    });

    this._el.querySelector("#kc-import-json")?.addEventListener("click", () => {
      this._showImportModal();
    });
  }

  _showAddKnowledgeModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <div class="modal-title">ADD KNOWLEDGE</div>
        <div class="form-group">
          <label>CONCEPT</label>
          <input type="text" id="ak-concept" class="modal-input" placeholder="Concept name" />
        </div>
        <div class="form-group">
          <label>FACT / DETAIL</label>
          <textarea class="modal-input admin-textarea" id="ak-fact" placeholder="The fact or knowledge to store..."></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>CATEGORY</label>
            <input type="text" id="ak-category" class="modal-input" placeholder="e.g. project-fact, solution" />
          </div>
          <div class="form-group">
            <label>PROJECT</label>
            <input type="text" id="ak-project" class="modal-input" placeholder="Project name (optional)" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="modal-btn cancel-btn">CANCEL</button>
          <button class="modal-btn confirm confirm-btn">SAVE KNOWLEDGE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector(".confirm-btn").addEventListener("click", async () => {
      const concept  = overlay.querySelector("#ak-concept").value.trim();
      const fact     = overlay.querySelector("#ak-fact").value.trim();
      const category = overlay.querySelector("#ak-category").value.trim() || "general";
      const project  = overlay.querySelector("#ak-project").value.trim() || null;
      if (concept && fact) {
        await this._core.knowledge.storeKnowledge({ concept, fact, category, project, importance: 0.8, confidence: 0.9 });
        showToast("Knowledge saved", "success");
        await this._refresh();
        overlay.remove();
      }
    });
  }

  _showAddProjectModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">ADD PROJECT</div>
        <div class="form-group">
          <label>PROJECT NAME</label>
          <input type="text" id="ap-name" class="modal-input" placeholder="Project name" />
        </div>
        <div class="form-group">
          <label>DESCRIPTION</label>
          <textarea class="modal-input admin-textarea" id="ap-desc" placeholder="Brief project description..."></textarea>
        </div>
        <div class="modal-actions">
          <button class="modal-btn cancel-btn">CANCEL</button>
          <button class="modal-btn confirm confirm-btn">CREATE PROJECT</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector(".confirm-btn").addEventListener("click", async () => {
      const name = overlay.querySelector("#ap-name").value.trim();
      const desc = overlay.querySelector("#ap-desc").value.trim();
      if (name) {
        await this._core.knowledge.storeKnowledge({
          concept: name, category: "project-description",
          fact: desc || `Project: ${name}`, project: name,
          importance: 0.9, confidence: 1.0
        });
        showToast(`Project "${name}" created`, "success");
        await this._refresh();
        overlay.remove();
      }
    });
  }

  _showImportModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <div class="modal-title">IMPORT PROJECT KNOWLEDGE (JSON)</div>
        <p style="color:var(--text-secondary);font-size:12px;margin-bottom:12px;">
          Paste a JSON object matching the import schema:
        </p>
        <pre style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;padding:10px;font-size:11px;color:var(--text-secondary);margin-bottom:12px;overflow-x:auto;">${escapeHtml(`{
  "project": "My Project",
  "description": "...",
  "features": [],
  "technologies": [],
  "decisions": [],
  "knownIssues": [],
  "solutions": [],
  "relationships": []
}`)}</pre>
        <textarea class="modal-input admin-textarea" id="import-json" style="min-height:120px;font-family:var(--font-mono);font-size:12px;" placeholder="Paste JSON here..."></textarea>
        <div id="import-error" style="color:var(--accent-red);font-size:12px;margin-top:6px;"></div>
        <div class="modal-actions">
          <button class="modal-btn cancel-btn">CANCEL</button>
          <button class="modal-btn confirm confirm-btn">IMPORT</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector(".confirm-btn").addEventListener("click", async () => {
      const raw = overlay.querySelector("#import-json").value.trim();
      const errEl = overlay.querySelector("#import-error");
      try {
        const data = JSON.parse(raw);
        if (!data.project) throw new Error("Missing 'project' field");
        const results = await this._core.knowledge.importProjectKnowledge(this._uid, data);
        showToast(`Imported ${results.length} knowledge records`, "success");
        await this._refresh();
        overlay.remove();
      } catch (err) {
        errEl.textContent = `Error: ${err.message}`;
      }
    });
  }

  async _refresh() {
    this._knowledge = await this._core.knowledge.getAllKnowledge();
    this._projects  = await this._getProjects();
    const list = this._el?.querySelector("#kc-project-list");
    if (list) { list.innerHTML = ""; this._renderProjects(); }
    this._renderKnowledge();
  }

  close() {
    this._el?.remove();
    this._el = null;
  }
}
