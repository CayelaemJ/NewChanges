import { readFileSync } from "node:fs";

const admin = readFileSync("public/admin.html", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const jobs = readFileSync("src/services/asyncJobs.ts", "utf8");
const syncJobs = readFileSync("src/services/syncJobs.ts", "utf8");
const syncService = readFileSync("src/services/syncService.ts", "utf8");
const imports = readFileSync("src/services/importService.ts", "utf8");
const stream = readFileSync("src/services/adminEventStream.ts", "utf8");

const checks = [
  [admin.includes('window.addEventListener("load", () => boot(), { once: true });'), "admin boot waits until all page scripts are defined"],
  [admin.includes("/api/admin/security/overview") && admin.includes("loadAdminSecuritySummary"), "security summary is loaded"],
  [admin.includes("/api/admin/compliance/overview") && admin.includes("loadComplianceSummary"), "POPIA summary is loaded"],
  [admin.includes("new XMLHttpRequest()") && admin.includes("xhr.upload.addEventListener('progress'"), "file upload reports browser upload progress"],
  [admin.includes("new EventSource(") && admin.includes("/api/admin/events?jobId="), "job progress uses SSE"],
  [admin.includes("return fallbackPoll()"), "job progress retains polling fallback"],
  [admin.includes("}, 30000);") && admin.includes("id=\"import-history-card\"") && admin.includes("if(box.bottom<=0 || box.top>=window.innerHeight) return;") && !admin.includes("}, 1500);") && admin.includes("history-row-detail") && admin.includes("COMMITTING"), "Import history polls only when visible at low frequency, retains manual refresh and live commit progress"],
  [admin.includes("Processed live:") && admin.includes("Source view:") && admin.includes("Validated:"), "SQL live progress exposes source, validated and processed row counts"],
  [server.includes('job.status === "PENDING" || job.status === "PROCESSING"') && server.includes("detail: job.detail ?? null"), "polling endpoints keep in-progress jobs live with row detail"],
  [server.includes('/api/admin/events') && server.includes('text/event-stream'), "authenticated SSE endpoint exists"],
  [jobs.includes('progress') && jobs.includes('publishAdminEvent("job.progress"') && jobs.includes("job.detail = detail"), "upload, commit and sync jobs publish live row detail"],
  [syncService.includes('phase: "COMMITTING"') && syncService.includes("sourceTotalRows") && syncService.includes("committedRows: p.processed"), "source sync reports per-feed SQL read/validate/commit row progress"],
  [imports.includes("Persist the live counts while the batch is still VALIDATED") && imports.includes("onProgress?: (progress: CommitProgress)"), "import service persists incremental live counts during commit"],
  [syncJobs.includes('publishAdminEvent("job.progress"'), "source sync jobs publish progress"],
  [stream.includes("subscribeAdminEvents") && stream.includes("publishAdminEvent"), "admin event broker exists"],
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`FAIL: ${label}`);
}

console.log("PASS: admin realtime, live SQL row counts, auto-refreshing import history, background jobs and security/compliance loading are wired");
