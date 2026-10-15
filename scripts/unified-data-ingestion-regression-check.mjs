import { readFileSync } from "node:fs";

const admin = readFileSync("public/admin.html", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const importer = readFileSync("src/services/importService.ts", "utf8");
const formats = readFileSync("src/services/reportFormats.ts", "utf8");
const sync = readFileSync("src/services/syncService.ts", "utf8");

const expectedLoadOrder = [
  "employers",
  "workforce_snapshots",
  "employees",
  "platform_users",
  "journeys",
  "debt_accounts",
  "policies",
  "ratings",
  "referrals",
  "salary_advances",
];
const orderMatch = formats.match(/export const LOAD_ORDER = \[([\s\S]*?)\];/);
if (!orderMatch) throw new Error("FAIL: canonical load order is missing");
const actualLoadOrder = [...orderMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (JSON.stringify(actualLoadOrder) !== JSON.stringify(expectedLoadOrder)) {
  throw new Error(`FAIL: canonical load order changed: ${actualLoadOrder.join(" -> ")}`);
}
if (!sync.includes('status: "BLOCKED"') || !sync.includes("downstream step") || !sync.includes("Last successful dashboard remains in place")) {
  throw new Error("FAIL: source sync must stop and block downstream feeds after the first dependency failure");
}

const required = [
  [admin, 'CSV, Excel (.xlsx or .xls) or JSON', 'admin file upload accepts CSV/XLSX/JSON'],
  [admin, 'onclick="setIntegMode(\'API\')"', 'admin API integration remains available'],
  [admin, 'onclick="setIntegMode(\'SQL\')"', 'admin SQL integration remains available'],
  [admin, 'id="file-ingestion"', 'file ingestion remains a first-class destination'],
  [admin, 'id="live-integration"', 'live integrations remain a first-class destination'],
  [admin, 'syncLogFailureDetail', 'admin surfaces the exact failed dependency step from sync history'],
  [admin, 'Blocked downstream:', 'admin exposes downstream steps blocked by a failed dependency'],
  [server, '/api/admin/reports/:key/upload', 'governed file upload endpoint remains present'],
  [server, 'app.get("/api/admin/integration"', 'authenticated integration read endpoint remains present'],
  [server, '"/api/admin/integration",\n  async (req, reply) => {', 'authenticated integration save endpoint remains present'],
  [importer, 'detectFormat(opts.filename)', 'file format detection remains active'],
];

for (const [source, needle, label] of required) {
  if (!source.includes(needle)) throw new Error(`FAIL: ${label}`);
}

if (server.includes('/api/admin/integration/config')) {
  throw new Error('FAIL: obsolete integration config route must remain removed');
}

if (!/accept="\.csv,\.xlsx,\.xls,\.json"/.test(admin)) {
  throw new Error("FAIL: file picker no longer advertises CSV/XLSX/JSON");
}

console.log("PASS: unified data ingestion retains file/API/SQL paths and strict 10-step dependency ordering");
