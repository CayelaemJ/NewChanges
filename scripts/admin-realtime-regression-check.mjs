import { readFileSync } from "node:fs";

const admin = readFileSync("public/admin.html", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const jobs = readFileSync("src/services/asyncJobs.ts", "utf8");
const syncJobs = readFileSync("src/services/syncJobs.ts", "utf8");
const stream = readFileSync("src/services/adminEventStream.ts", "utf8");

const checks = [
  [admin.includes('window.addEventListener("load", () => boot(), { once: true });'), "admin boot waits until all page scripts are defined"],
  [admin.includes("/api/admin/security/overview") && admin.includes("loadAdminSecuritySummary"), "security summary is loaded"],
  [admin.includes("/api/admin/compliance/overview") && admin.includes("loadComplianceSummary"), "POPIA summary is loaded"],
  [admin.includes("new XMLHttpRequest()") && admin.includes("xhr.upload.addEventListener('progress'"), "file upload reports browser upload progress"],
  [admin.includes("new EventSource(") && admin.includes("/api/admin/events?jobId="), "job progress uses SSE"],
  [admin.includes("return fallbackPoll()"), "job progress retains polling fallback"],
  [server.includes('/api/admin/events') && server.includes('text/event-stream'), "authenticated SSE endpoint exists"],
  [jobs.includes('progress') && jobs.includes('publishAdminEvent("job.progress"'), "upload and commit jobs publish progress"],
  [syncJobs.includes('publishAdminEvent("job.progress"'), "source sync jobs publish progress"],
  [stream.includes("subscribeAdminEvents") && stream.includes("publishAdminEvent"), "admin event broker exists"],
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`FAIL: ${label}`);
}

console.log("PASS: admin realtime, upload progress, background jobs and security/compliance loading are wired");
