// ============================================================
// Global Learning Panel
// Shows non-private global knowledge stats and concepts.
// NEVER reveals source users or private conversations.
// ============================================================
import { escapeHtml, showToast } from "../js/ui.js";
import {
  getAllGlobalKnowledge,
  getAllGlobalCandidates,
  getGlobalLearningStats
} from "../firebase/firestore-service.js";

const CATEGORY_LABELS = {
  firebase:    "Firebase",
  webgpu:      "WebGPU / AI",
  media:       "Media / Playback",
  networking:  "Networking / API",
  storage:     "Storage",
  ui:          "UI / CSS",
  async:       "Async / Concurrency",
  performance: "Performance",
  framework:   "Frameworks",
  cloudflare:  "Cloudflare",
  general:     "General"
};

const CATEGORY_COLORS = {
  firebase: "#ff9933", webgpu: "#00d4ff", media: "#7c5cd8",
  networking: "#1e6fff", storage: "#00ff88", ui: "#ff3355",
  async: "#ffcc00", performance: "#00cc6a", framework: "#3a8fff",
  cloudflare: "#ff6b35", general: "#888"
};

export class GlobalLearningPanel {
  constructor(shadowCore, uid) {
    this._core = shadowCore;
    this._uid  = uid;
    this._el   = null;
    this._view = "knowledge";
  }

  async open() {
    this._el = document.createElement("div");
    this._el.className = "admin-overlay";
    this._el.innerHTML = `
      <div class="admin-header">
        <button class="btn-icon" id="gl-close">←</button>
        <div class="admin-title">◎ GLOBAL LEARNING BRAIN</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-left:auto;padding-right:8px;">PRIVACY-SAFE SHARED KNOWLEDGE</div>
      </div>
      <div class="admin-body">

        <!-- Privacy notice -->
        <div style="background:rgba(30,111,255,0.06);border:1px solid rgba(30,111,255,0.2);border-radius:8px;padding:12px 16px;margin-bottom:16px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue);font-weight:700;margin-bottom:6px;">PRIVACY NOTICE</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">
            Global Learning contains only generalized, privacy-safe technical concepts.
            No raw conversations, no user identities, no private project data, no credentials.
            Each concept was validated through the Privacy Learning Firewall and required
            multiple independent confirmations before promotion.
          </div>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
          <button class="tab-btn active gl-nav" data-view="knowledge">GLOBAL KNOWLEDGE</button>
          <button class="tab-btn gl-nav" data-view="candidates">LEARNING CANDIDATES</button>
          <button class="tab-btn gl-nav" data-view="stats">STATISTICS</button>
        </div>
        <div id="gl-content"></div>
      </div>`;

    document.getElementById("overlay-container").appendChild(this._el);

    this._el.querySelector("#gl-close").addEventListener("click", () => this.close());
    this._el.querySelectorAll(".gl-nav").forEach(btn => {
      btn.addEventListener("click", () => {
        this._el.querySelectorAll(".gl-nav").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._view = btn.dataset.view;
        this._loadView();
      });
    });

    await this._loadView();
  }

  async _loadView() {
    const content = this._el.querySelector("#gl-content");
    if (!content) return;
    content.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Loading...</div>';
    try {
      switch (this._view) {
        case "knowledge":   await this._renderKnowledge(content); break;
        case "candidates":  await this._renderCandidates(content); break;
        case "stats":       await this._renderStats(content); break;
      }
    } catch (err) {
      content.innerHTML = `<div style="color:var(--accent-red);font-size:12px;">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  async _renderKnowledge(content) {
    const knowledge = await getAllGlobalKnowledge(100);

    if (!knowledge.length) {
      content.innerHTML = `
        <div style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">No global knowledge promoted yet.</div>
        <p style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Global Knowledge grows as privacy-safe concepts are confirmed by multiple independent sources.
          Concepts must pass the Privacy Firewall and meet evidence thresholds before promotion.
        </p>`;
      return;
    }

    // Group by category
    const byCategory = {};
    for (const k of knowledge) {
      const cat = k.category || "general";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(k);
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:14px;">${knowledge.length} PROMOTED CONCEPTS</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" id="gl-cat-filter">
        <button class="modal-btn gl-cat active" data-cat="">ALL</button>
        ${Object.keys(byCategory).map(cat => `
          <button class="modal-btn gl-cat" data-cat="${cat}" style="border-color:${CATEGORY_COLORS[cat]||'#888'};color:${CATEGORY_COLORS[cat]||'#888'};">
            ${CATEGORY_LABELS[cat] || cat.toUpperCase()}
          </button>`).join("")}
      </div>
      <div id="gl-knowledge-list"></div>`;

    const renderKList = (list) => {
      const container = content.querySelector("#gl-knowledge-list");
      container.innerHTML = list.map(k => `
        <div class="admin-card" style="padding:14px;margin-bottom:10px;border-left:3px solid ${CATEGORY_COLORS[k.category]||'#333'};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <span style="font-family:var(--font-mono);font-size:9px;color:${CATEGORY_COLORS[k.category]||'#888'};text-transform:uppercase;">
              ${CATEGORY_LABELS[k.category] || k.category || 'GENERAL'}
            </span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <span style="font-family:var(--font-mono);font-size:9px;color:var(--accent-green);background:rgba(0,255,136,0.08);border:1px solid rgba(0,255,136,0.2);padding:2px 8px;border-radius:20px;">
                ${Math.round((k.confidence||0.7)*100)}% CONFIDENCE
              </span>
              <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);background:var(--bg-surface);border:1px solid var(--border-default);padding:2px 8px;border-radius:20px;">
                ${k.evidenceCount||0} EVIDENCE
              </span>
            </div>
          </div>
          <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${escapeHtml(k.concept||k.summary||'')}</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;">
            <span>v${k.version||1}</span>
            ${k.confirmationCount ? `<span>✓${k.confirmationCount} confirmed</span>` : ""}
            ${k.contradictionCount ? `<span style="color:var(--accent-red);">✗${k.contradictionCount} contradicted</span>` : ""}
            ${k.lastValidatedAt ? `<span>validated ${new Date(k.lastValidatedAt).toLocaleDateString()}</span>` : ""}
          </div>
        </div>`).join("");
    };

    renderKList(knowledge);

    content.querySelectorAll(".gl-cat").forEach(btn => {
      btn.addEventListener("click", () => {
        content.querySelectorAll(".gl-cat").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const cat = btn.dataset.cat;
        renderKList(cat ? knowledge.filter(k => k.category === cat) : knowledge);
      });
    });
  }

  async _renderCandidates(content) {
    const candidates = await getAllGlobalCandidates(50);

    if (!candidates.length) {
      content.innerHTML = `
        <div style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">No learning candidates yet.</div>
        <p style="font-size:12px;color:var(--text-muted);line-height:1.6;">
          Candidates are generalized patterns waiting for sufficient independent confirmation 
          before promotion to Global Knowledge.
        </p>`;
      return;
    }

    content.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:12px;">${candidates.length} LEARNING CANDIDATES</div>
      ${candidates.map(c => {
        const statusColor = c.privacyScanStatus === 'passed' ? 'var(--accent-green)'
                          : c.privacyScanStatus === 'rejected' ? 'var(--accent-red)'
                          : 'var(--accent-yellow)';
        const statusText  = c.privacyScanStatus === 'passed'   ? 'PASSED'
                          : c.privacyScanStatus === 'rejected'  ? 'REJECTED'
                          : 'PENDING';
        return `
          <div class="admin-card" style="padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              <span style="font-family:var(--font-mono);font-size:9px;color:${CATEGORY_COLORS[c.category]||'#888'};text-transform:uppercase;">
                ${CATEGORY_LABELS[c.category] || c.category || 'GENERAL'}
              </span>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <span style="font-family:var(--font-mono);font-size:9px;color:${statusColor};border:1px solid ${statusColor};padding:1px 7px;border-radius:20px;">
                  FIREWALL: ${statusText}
                </span>
                <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);">
                  ${Math.round((c.confidence||0)*100)}% conf · ${c.independentEvidenceCount||0} evidence
                </span>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${escapeHtml(c.generalizedConcept||'')}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">
              ${c.confirmationCount ? `<span>✓${c.confirmationCount}</span>` : ""}
              ${c.contradictionCount ? `<span>✗${c.contradictionCount}</span>` : ""}
              <span>${c.createdAt ? 'Created ' + new Date(c.createdAt).toLocaleDateString() : ''}</span>
            </div>
          </div>`;
      }).join("")}`;
  }

  async _renderStats(content) {
    const globalStats = await getGlobalLearningStats();
    const allKnow     = await getAllGlobalKnowledge(200);

    // Category breakdown
    const catCounts = {};
    for (const k of allKnow) {
      const cat = k.category || "general";
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    const avgConf = allKnow.length
      ? Math.round(allKnow.reduce((s, k) => s + (k.confidence||0.7), 0) / allKnow.length * 100)
      : 0;

    content.innerHTML = `
      <div style="max-width:640px;">
        <div class="admin-grid" style="margin-bottom:20px;">
          <div class="admin-card">
            <div class="admin-card-title">GLOBAL KNOWLEDGE</div>
            <div class="admin-card-value">${globalStats.promotedCount}</div>
            <div class="stat-label">Promoted concepts</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">CANDIDATES</div>
            <div class="admin-card-value">${globalStats.candidateCount}</div>
            <div class="stat-label">Pending validation</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">AVG CONFIDENCE</div>
            <div class="admin-card-value">${avgConf}%</div>
            <div class="stat-label">Across all concepts</div>
          </div>
          <div class="admin-card">
            <div class="admin-card-title">CATEGORIES</div>
            <div class="admin-card-value">${Object.keys(catCounts).length}</div>
            <div class="stat-label">Knowledge domains</div>
          </div>
        </div>

        ${Object.keys(catCounts).length ? `
        <div class="admin-card">
          <div class="admin-card-title">KNOWLEDGE BY CATEGORY</div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
            ${Object.entries(catCounts).sort(([,a],[,b]) => b-a).map(([cat, count]) => {
              const pct = Math.round(count / allKnow.length * 100);
              return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px;">
                    <span>${CATEGORY_LABELS[cat] || cat.toUpperCase()}</span>
                    <span>${count} (${pct}%)</span>
                  </div>
                  <div style="height:4px;background:var(--border-subtle);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${CATEGORY_COLORS[cat]||'#888'};border-radius:2px;transition:width 0.8s;"></div>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>` : ""}

        <div class="admin-card" style="margin-top:16px;border-color:rgba(30,111,255,0.2);">
          <div class="admin-card-title">HOW GLOBAL LEARNING WORKS</div>
          <ol style="font-size:12px;color:var(--text-secondary);line-height:1.9;padding-left:16px;margin-top:8px;">
            <li>A user's private learning event is analyzed by the Generalization Engine</li>
            <li>The generalized concept (without any identifying info) enters the Privacy Firewall</li>
            <li>If it passes all checks, it becomes a Global Learning Candidate</li>
            <li>Multiple independent confirmations are required before promotion</li>
            <li>Only after passing confidence and evidence thresholds does it become Global Knowledge</li>
            <li>All users benefit from the generalized concept — no one's private data is exposed</li>
          </ol>
        </div>
      </div>`;
  }

  close() {
    this._el?.remove();
    this._el = null;
  }
}
