import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dashboard = fs.readFileSync(path.join(root, "public/dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/dashboard.css"), "utf8");
const failures = [];
const must = (ok, msg) => { if (!ok) failures.push(msg); };

const dashboardKb = Buffer.byteLength(dashboard, "utf8") / 1024;
const cssKb = Buffer.byteLength(css, "utf8") / 1024;

must(dashboardKb < 900, `dashboard.html is ${dashboardKb.toFixed(0)} KB; keep the initial document under 900 KB`);
must(cssKb < 450, `dashboard.css is ${cssKb.toFixed(0)} KB; keep the canonical stylesheet under 450 KB`);
must(/function safeRender/.test(dashboard), "dashboard visuals must be isolated behind safeRender");
must(/cache:s*['"]no-store['"]/.test(dashboard), "live dashboard fetches must explicitly avoid stale financial payloads");
const snapshotSource=fs.readFileSync(path.join(root, "src/services/snapshotBuilder.ts"), "utf8");
must(snapshotSource.includes("dashboardCache") && snapshotSource.includes("DASHBOARD_CACHE_TTL_MS"), "dashboard should use a bounded server-side cohort cache");

if (failures.length) {
  console.error("PERFORMANCE REGRESSION CHECK FAILED:");
  failures.forEach(x => console.error(" - " + x));
  process.exit(1);
}
console.log("Performance regression checks passed.");
