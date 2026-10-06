(() => {
  const ENDPOINT = "/api/admin/integration";
  const ID = "efs-admin-source-status";
  let timer = null;

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
    el.innerHTML = `
      <div class="efs-source-row">
        <span class="efs-source-dot" aria-hidden="true"></span>
        <strong>Connected source: ${esc(sourceLabel(config))}</strong>
        <span class="efs-source-state">${esc(current.label)}</span>
      </div>
      <div class="efs-source-meta">Last successful: ${esc(when(config.lastSuccessfulSyncAt))}${configured}${lock}${note}</div>
    `;
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
  function start() {
    refresh();
    timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    window.addEventListener("efs:source-status-refresh", refresh);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
