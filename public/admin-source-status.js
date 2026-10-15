(() => {
  const ENDPOINT = "/api/admin/integration";
  const ID = "efs-admin-source-status";
  const DB_ENDPOINT = "/api/admin/database-status";
  let timer = null;
  let collapsed = true;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
  }
  function when(value) {
    if (!value) return "Never";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString("en-ZA");
  }
  function sourceLabel(config) {
    const mode = String(config.effectiveSourceMode || config.sourceMode || "API").toUpperCase();
    if (mode === "SQL") {
      const dialect = String(config.effectiveSqlDialect || config.sqlDialect || "SQL").toUpperCase();
      const database = config.effectiveSqlDatabase || config.sqlDatabase || "database not selected";
      return `${dialect} · ${database}`;
    }
    try {
      const url = new URL(config.effectiveApiBaseUrl || config.baseUrl || "", location.origin);
      return `API · ${url.host || "configured endpoint"}`;
    } catch {
      return "API";
    }
  }
  function state(config) {
    const raw = String(config.lastSyncStatus || (config.configured ? "READY" : "INCOMPLETE")).toUpperCase();
    if (raw === "OK") return { label: "COMPLETE", tone: "ok" };
    if (raw === "PROCESSING" || raw === "RUNNING" || raw === "REBUILDING") return { label: raw === "REBUILDING" ? "REBUILDING" : "IN PROGRESS", tone: "busy" };
    if (["FAILED","PARTIAL","FULL_REFRESH_FAILED","FULL_REFRESH_PRECHECK_FAILED"].includes(raw)) return { label: raw, tone: "err" };
    return { label: raw, tone: config.configured ? "ready" : "err" };
  }
  function ensure() {
    let el = document.getElementById(ID);
    if (el) return el;
    const style = document.createElement("style");
    style.textContent = `
      #${ID}{position:fixed;right:18px;bottom:18px;z-index:120;max-width:min(560px,calc(100vw - 36px));font:600 12px/1.45 Manrope,system-ui,sans-serif;color:#243746;background:rgba(255,255,255,.97);border:1px solid #d7cde9;border-radius:12px;box-shadow:0 10px 30px rgba(15,36,56,.14);padding:10px 12px;backdrop-filter:blur(10px)}
      #${ID} .efs-toggle{border:1px solid currentColor;border-radius:6px;padding:2px 8px;font:inherit;color:inherit;background:transparent;cursor:pointer;margin-left:auto}
      #${ID} .efs-help{font-size:11px;font-weight:400;line-height:1.55;margin-top:7px;color:inherit;opacity:.85}
      #${ID} .efs-source-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #${ID} .efs-source-dot{width:8px;height:8px;border-radius:50%;background:#64748b;flex:0 0 auto}
      #${ID}[data-tone="ok"] .efs-source-dot{background:#187a4d}
      #${ID}[data-tone="busy"] .efs-source-dot{background:#b7791f;animation:efs-source-pulse 1.2s ease-in-out infinite}
      #${ID}[data-tone="err"] .efs-source-dot{background:#b5391f}
      #${ID} strong{color:#2b1b68;font-weight:800}
      #${ID} .efs-source-state{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:850;padding:2px 6px;border-radius:6px;background:#eef2f6;color:#425466}
      #${ID}[data-tone="ok"] .efs-source-state{background:#dff3e8;color:#137a47}
      #${ID}[data-tone="busy"] .efs-source-state{background:#fcedd4;color:#8a5a10}
      #${ID}[data-tone="err"] .efs-source-state{background:#fbe4df;color:#b5391f}
      #${ID} .efs-source-meta{margin-top:3px;color:#617486;font-size:10.5px}
      #${ID} .efs-db-panel{margin-top:9px;padding-top:9px;border-top:1px solid #d7cde9}
      #${ID} .efs-db-dot{width:8px;height:8px;border-radius:50%;background:#64748b;flex:0 0 auto}
      #${ID} .efs-db-panel[data-db-status="green"] .efs-db-dot{background:#187a4d}
      #${ID} .efs-db-panel[data-db-status="yellow"] .efs-db-dot{background:#b7791f}
      #${ID} .efs-db-panel[data-db-status="red"] .efs-db-dot{background:#b5391f}
      #${ID} .efs-db-panel[data-db-status="green"] .efs-source-state{background:#dff3e8;color:#137a47}
      #${ID} .efs-db-panel[data-db-status="yellow"] .efs-source-state{background:#fcedd4;color:#8a5a10}
      #${ID} .efs-db-panel[data-db-status="red"] .efs-source-state{background:#fbe4df;color:#b5391f}
      @media(prefers-color-scheme:dark){#${ID}{background:rgba(23,30,44,.97);color:#e6edf6;border-color:#46516a}#${ID} strong{color:#e6d9ff}#${ID} .efs-source-meta{color:#acbacb}#${ID} .efs-db-panel{border-color:#46516a}}
      @keyframes efs-source-pulse{50%{opacity:.35}}
      @media(max-width:640px){#${ID}{left:12px;right:12px;bottom:12px;max-width:none}}
    `;
    document.head.appendChild(style);
    el = document.createElement("aside");
    el.id = ID;
    el.setAttribute("aria-live","polite");
    el.setAttribute("aria-label","Admin connected data source status");
    document.body.appendChild(el);
    return el;
  }
  function render(config) {
    const el = ensure();
    const current = state(config);
    el.dataset.tone = current.tone;
    const lock = config.environmentLocked ? " · Railway env locked" : "";
    const configured = config.configured ? "" : " · incomplete";
    const note = config.lastSyncNote ? ` · ${esc(config.lastSyncNote)}` : "";
    const previousDb = document.getElementById("efs-db-status")?.outerHTML;
    el.innerHTML = `
      <div class="efs-source-row">
        <span class="efs-source-dot" aria-hidden="true"></span>
        <strong>Connected source: ${esc(sourceLabel(config))}</strong>
        <span class="efs-source-state">${esc(current.label)}</span>
        <button class="efs-toggle" type="button" aria-expanded="${!collapsed}" aria-controls="efs-status-detail">${collapsed ? "Details ▾" : "Collapse ▴"}</button>
      </div>
      <div id="efs-status-detail" ${collapsed ? "hidden" : ""}>
      <div class="efs-source-meta">Last successful: ${esc(when(config.lastSuccessfulSyncAt))}${configured}${lock}${note}</div>
      <div class="efs-help">Source = external SQL/API reporting data. COMPLETE = last import succeeded, not proof that the source is up to date. PostgreSQL = the shared Neon application database that stores dashboards and users; HEALTHY means its connection check succeeded. A healthy database does not guarantee successful source sync.</div>
      <div class="efs-db-panel" data-db-status="yellow" id="efs-db-status"><div class="efs-source-row"><span class="efs-db-dot" aria-hidden="true"></span><strong>PostgreSQL: Checking connection…</strong><span class="efs-source-state">CHECKING</span></div></div>
      </div>
    `;
    el.querySelector(".efs-toggle")?.addEventListener("click", () => { collapsed = !collapsed; const detail = document.getElementById("efs-status-detail"); if(detail) detail.hidden = collapsed; const btn = el.querySelector(".efs-toggle"); if(btn){btn.textContent = collapsed ? "Details ▾" : "Collapse ▴";btn.setAttribute("aria-expanded",String(!collapsed));} });
    if (previousDb) document.getElementById("efs-db-status")?.replaceWith(document.createRange().createContextualFragment(previousDb));
  }
  async function refresh() {
    try {
      const response = await fetch(ENDPOINT, { credentials:"same-origin", cache:"no-store" });
      if (response.status === 401 || response.status === 403) {
        document.getElementById(ID)?.remove();
        if (timer) clearInterval(timer);
        timer = null;
        return;
      }
      if (!response.ok) return;
      render(await response.json());
    } catch {}
  }
  async function refreshDatabase() {
    let status;
    try {
      const response = await fetch(DB_ENDPOINT, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) throw new Error("Health endpoint unavailable");
      status = await response.json();
    } catch {
      status = { status: "red", provider: "Unknown", database: "Unverified", message: "Status check unavailable" };
    }
    const panel = document.getElementById("efs-db-status");
    if (!panel) return;
    const tone = ["green", "yellow", "red"].includes(status.status) ? status.status : "red";
    panel.dataset.dbStatus = tone;
    const checked = status.checkedAt ? when(status.checkedAt) : "Unavailable";
    const duration = Number.isFinite(status.latencyMs) ? ` · ${status.latencyMs} ms` : "";
    panel.innerHTML = `<div class="efs-source-row"><span class="efs-db-dot" aria-hidden="true"></span>
      <strong>PostgreSQL: ${esc(status.provider || "Unknown")} · ${esc(status.database || "Unknown")}</strong>
      <span class="efs-source-state">${tone === "green" ? "HEALTHY" : tone === "yellow" ? "DEGRADED" : "ERROR"}</span></div>
      <div class="efs-source-meta">${esc(status.message || "Unknown")}${duration} · Checked: ${esc(checked)}</div>`;
  }
  function start() {
    refresh().then(refreshDatabase);
    timer = setInterval(() => { refresh().then(refreshDatabase); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh().then(refreshDatabase); });
    window.addEventListener("efs:source-status-refresh", refresh);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
