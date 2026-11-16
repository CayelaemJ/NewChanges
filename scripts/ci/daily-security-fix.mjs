import {spawnSync} from "node:child_process";
import {writeFileSync, mkdirSync} from "node:fs";

function auditJson() {
  const r = spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
    encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 120000
  });
  let report;
  try { report = JSON.parse(r.stdout || ""); } catch {
    console.error("[daily-security-fix] npm audit returned invalid JSON; failing closed.");
    process.exit(1);
  }
  if (report.error || !report.metadata?.vulnerabilities || (r.status !== 0 && r.status !== 1)) {
    console.error("[daily-security-fix] npm audit unavailable or returned an unexpected error.");
    process.exit(1);
  }
  return report;
}

function countSevere(report) {
  const c = report.metadata?.vulnerabilities || {};
  return (c.high || 0) + (c.critical || 0);
}

console.log("[daily-security-fix] Pre-fix audit...");
const before = auditJson();
const beforeHigh = before.metadata?.vulnerabilities?.high || 0;
const beforeCritical = before.metadata?.vulnerabilities?.critical || 0;
const beforeSevere = beforeHigh + beforeCritical;
console.log(`[daily-security-fix] Pre-fix — high: ${beforeHigh}, critical: ${beforeCritical}, total: ${beforeSevere}`);

if (beforeSevere === 0) {
  console.log("[daily-security-fix] No high or critical vulnerabilities. Nothing to fix.");
  mkdirSync("test-results", {recursive: true});
  writeFileSync("test-results/daily-security-fix.json", JSON.stringify({
    pre: {high: 0, critical: 0}, post: {high: 0, critical: 0}, fixed: 0, remaining: 0
  }, null, 2) + "\n");
  process.exit(0);
}

console.log("[daily-security-fix] Running npm audit fix (non-breaking semver-compatible upgrades only)...");
const repair = spawnSync("npm", ["audit", "fix", "--audit-level=high"], {
  encoding: "utf8", stdio: "inherit", timeout: 120000
});
if (repair.error || repair.signal) {
  console.error("[daily-security-fix] npm audit fix did not complete.");
  process.exit(1);
}

console.log("[daily-security-fix] Post-fix audit...");
const after = auditJson();
const afterHigh = after.metadata?.vulnerabilities?.high || 0;
const afterCritical = after.metadata?.vulnerabilities?.critical || 0;
const afterSevere = afterHigh + afterCritical;
const fixed = beforeSevere - afterSevere;

console.log(`[daily-security-fix] Post-fix — high: ${afterHigh}, critical: ${afterCritical}, total: ${afterSevere}`);
console.log(`[daily-security-fix] Resolved in temporary CI workspace (not deployed): ${fixed}, Remaining: ${afterSevere}`);

if (afterSevere > 0) {
  console.warn(
    `[daily-security-fix] ${afterSevere} high/critical vulnerability(s) remain after non-breaking fixes.` +
    " These may require a major version upgrade or manual intervention."
  );
}

mkdirSync("test-results", {recursive: true});
writeFileSync("test-results/daily-security-fix.json", JSON.stringify({
  pre: {high: beforeHigh, critical: beforeCritical},
  post: {high: afterHigh, critical: afterCritical},
  fixed,
  remaining: afterSevere
}, null, 2) + "\n");
