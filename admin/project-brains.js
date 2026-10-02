// ============================================================
// Project Brains Admin Panel
// Displays all project brains with knowledge stats, history,
// and recent entries. Each brain can be expanded for details.
// ============================================================
import { escapeHtml } from "../js/ui.js";
import { BRAIN_ENTRY_TYPES } from "../core/project-brain.js";

const TYPE_LABELS = {
  [BRAIN_ENTRY_TYPES.ARCHITECTURE]:      "Architecture",
  [BRAIN_ENTRY_TYPES.TECHNOLOGY]:        "Technology",
  [BRAIN_ENTRY_TYPES.FEATURE]:           "Feature",
  [BRAIN_ENTRY_TYPES.BUG]:               "Known Issue",
  [BRAIN_ENTRY_TYPES.FIX_SUCCEEDED]:     "Solved",
  [BRAIN_ENTRY_TYPES.FIX_FAILED]:        "Failed Fix",
  [BRAIN_ENTRY_TYPES.FIX_ATTEMPTED]:     "Attempted Fix",
  [BRAIN_ENTRY_TYPES.DECISION]:          "Decision",
  [BRAIN_ENTRY_TYPES.REQUIREMENT]:       "Requirement",
  [BRAIN_ENTRY_TYPES.HISTORY]:           "History",
  [BRAIN_ENTRY_TYPES.RELATIONSHIP]:      "Relationship",
  [BRAIN_ENTRY_TYPES.UNRESOLVED]:        "Unresolved",
  [BRAIN_ENTRY_TYPES.CONVERSATION]:      "Conversation",
  [BRAIN_ENTRY_TYPES.FIREBASE_CONFIG]:   "Firebase Config",
  [BRAIN_ENTRY_TYPES.CLOUDFLARE_CONFIG]: "Cloudflare Config"
};

const TYPE_COLORS = {
  [BRAIN_ENTRY_TYPES.BUG]:           "#ff3355",
  [BRAIN_ENTRY_TYPES.FIX_SUCCEEDED]: "#00ff88",
  [BRAIN_ENTRY_TYPES.FIX_FAILED]:    "#ff9933",
  [BRAIN_ENTRY_TYPES.UNRESOLVED]:    "#ffcc00",
  [BRAIN_ENTRY_TYPES.ARCHITECTURE]:  "#1e6fff",
  [BRAIN_ENTRY_TYPES.DECISION]:      "#7c5cd8",
  [BRAIN_ENTRY_TYPES.TECHNOLOGY]:    "#00d4ff"
};

export class ProjectBrainsPanel {
  constructor(shadowCore, uid) {
    this._core = shadowCore;
    this._uid  = uid;
    this._el   = null;
  }

  async open() {
    const brains = await this._core.projectBrain.getAllBrains();
    const mistakes = await this._core.mistakeMemory.getAllMistakes();

    // Build mistake count map per project
    const mistakesByProject = {};
    for (const m of mistakes) {
      const k = m.projectId || "_general";
      mistakesByProject[k] = (mistakesByProject[k] || 0) + 1;
    }

    this._el = document.createElement("div");
    this._el.className = "admin-overlay";
    this._el.innerHTML = `
      <div class="admin-header">
        <button class="btn-icon" id="pb-close">←</button>
        <div class="admin-title">◈ PROJECT BRAINS</div>
      </div>
      <div class="admin-body">
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
          Individual evolving knowledge bases for each project.
          Shadow Reaper automatically identifies and retrieves project-specific knowledge
          during conversations.
        </p>

        ${brains.length === 0 ? `
          <div style="text-align:center;padding:40px;color:var(--text-dim);">
            <div style="font-size:32px;margin-bottom:12px;">◌</div>
            <div style="font-family:var(--font-mono);font-size:12px;">NO PROJECT BRAINS YET</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:8px;">
              Project brains are created automatically when you discuss a project.
            </div>
          </div>` : `
          <div id="pb-brains-list">
            ${brains.map(brain => this._renderBrainCard(brain, mistakesByProject[brain.projectId] || 0)).join("")}
          </div>`}

        <!-- ── Known Projects Registry ─────────────────────── -->
        <div class="admin-card" style="margin-top:16px;">
          <div class="admin-card-title">KNOWN PROJECT REGISTRY</div>
          <p style="color:var(--text-secondary);font-size:12px;margin:8px 0 12px;">
            Projects Shadow Reaper can automatically identify in conversations.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${this._core.projectBrain.getKnownProjects().map(p => `
              <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:4px;padding:6px 12px;font-family:var(--font-mono);font-size:11px;color:var(--accent-green);">
                ${escapeHtml(p.name)}
              </div>`).join("")}
          </div>
        </div>

      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);
    this._el.querySelector("#pb-close").addEventListener("click", () => this.close());

    // Bind expand/details clicks
    this._el.querySelectorAll(".pb-brain-card-expand").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const projectId = btn.dataset.projectId;
        await this._expandBrain(projectId);
      });
    });
  }

  _renderBrainCard(brain, mistakeCount) {
    const stats = brain.stats || {};
    const lastLearned = stats.lastLearnedAt
      ? new Date(stats.lastLearnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Never";

    return `
      <div class="project-brain-card" id="pb-card-${escapeHtml(brain.projectId)}">
        <div class="project-brain-card-title">${escapeHtml(brain.name || brain.projectId)}</div>
        <div class="brain-stats-grid">
          <div class="brain-stat">
            <div class="brain-stat-value">${stats.knowledgeCount || 0}</div>
            <div class="brain-stat-label">Knowledge</div>
          </div>
          <div class="brain-stat">
            <div class="brain-stat-value">${stats.experienceCount || 0}</div>
            <div class="brain-stat-label">Experiences</div>
          </div>
          <div class="brain-stat">
            <div class="brain-stat-value" style="color:#ff3355;">${stats.knownIssues || 0}</div>
            <div class="brain-stat-label">Known Issues</div>
          </div>
          <div class="brain-stat">
            <div class="brain-stat-value" style="color:#00ff88;">${stats.solvedIssues || 0}</div>
            <div class="brain-stat-label">Solved Issues</div>
          </div>
          <div class="brain-stat">
            <div class="brain-stat-value" style="color:#ff9933;">${mistakeCount}</div>
            <div class="brain-stat-label">Mistakes Learned</div>
          </div>
          <div class="brain-stat">
            <div class="brain-stat-value" style="color:#ffcc00;">${stats.unresolvedCount || 0}</div>
            <div class="brain-stat-label">Unresolved</div>
          </div>
        </div>
        <div class="brain-last-learned">Last learned: ${escapeHtml(lastLearned)}</div>
        <button class="btn-ghost pb-brain-card-expand" data-project-id="${escapeHtml(brain.projectId)}"
          style="margin-top:10px;width:100%;font-size:11px;">
          VIEW KNOWLEDGE HISTORY
        </button>
        <div class="pb-brain-entries hidden" id="pb-entries-${escapeHtml(brain.projectId)}">
        </div>
      </div>`;
  }

  async _expandBrain(projectId) {
    const entriesContainer = this._el?.querySelector(`#pb-entries-${CSS.escape(projectId)}`);
    if (!entriesContainer) return;

    if (!entriesContainer.classList.contains("hidden")) {
      entriesContainer.classList.add("hidden");
      return;
    }

    entriesContainer.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Loading...</div>`;
    entriesContainer.classList.remove("hidden");

    try {
      const entries = await this._core.projectBrain.getEntries(projectId);

      if (entries.length === 0) {
        entriesContainer.innerHTML = `
          <div style="color:var(--text-dim);font-size:12px;padding:8px 0;text-align:center;">
            No entries yet. Start a conversation about this project.
          </div>`;
        return;
      }

      // Group by type
      const byType = {};
      for (const e of entries) {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      }

      let html = `<div style="margin-top:12px;border-top:1px solid var(--border-subtle);padding-top:12px;">`;

      for (const [type, items] of Object.entries(byType)) {
        const label = TYPE_LABELS[type] || type;
        const color = TYPE_COLORS[type] || "var(--text-secondary)";
        html += `
          <div style="margin-bottom:12px;">
            <div style="font-family:var(--font-mono);font-size:10px;color:${color};text-transform:uppercase;margin-bottom:6px;">
              ${escapeHtml(label)} (${items.length})
            </div>`;

        for (const entry of items.slice(0, 5)) {
          const conf = Math.round((entry.confidence || 0.7) * 100);
          const date = entry.createdAt
            ? new Date(typeof entry.createdAt === "object" ? entry.createdAt.toDate?.() || entry.createdAt : entry.createdAt)
                .toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "";

          html += `
            <div style="padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;margin-bottom:4px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div style="font-size:12px;color:var(--text-primary);flex:1;">${escapeHtml(entry.title)}</div>
                <div style="font-size:10px;color:var(--text-dim);margin-left:8px;white-space:nowrap;">${conf}% · ${date}</div>
              </div>
              ${entry.content ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(entry.content.slice(0, 120))}</div>` : ""}
            </div>`;
        }

        if (items.length > 5) {
          html += `<div style="font-size:10px;color:var(--text-dim);text-align:center;">+${items.length - 5} more</div>`;
        }

        html += `</div>`;
      }

      html += `</div>`;
      entriesContainer.innerHTML = html;

    } catch (err) {
      entriesContainer.innerHTML = `<div style="color:var(--accent-red);font-size:12px;padding:8px 0;">Error loading entries: ${escapeHtml(err.message)}</div>`;
    }
  }

  close() {
    this._el?.remove();
    this._el = null;
  }
}
