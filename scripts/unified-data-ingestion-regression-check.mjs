import { readFileSync } from "node:fs";

const admin = readFileSync("public/admin.html", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const importer = readFileSync("src/services/importService.ts", "utf8");

const required = [
  [admin, 'CSV, Excel (.xlsx or .xls) or JSON', 'admin file upload accepts CSV/XLSX/JSON'],
  [admin, 'onclick="setIntegMode(\'API\')"', 'admin API integration remains available'],
  [admin, 'onclick="setIntegMode(\'SQL\')"', 'admin SQL integration remains available'],
  [admin, 'id="file-ingestion"', 'file ingestion remains a first-class destination'],
  [admin, 'id="live-integration"', 'live integrations remain a first-class destination'],
  [server, '/api/admin/reports/:key/upload', 'governed file upload endpoint remains present'],
  [server, '/api/admin/integration/config', 'integration configuration endpoint remains present'],
  [importer, 'detectFormat(opts.filename)', 'file format detection remains active'],
];

for (const [source, needle, label] of required) {
  if (!source.includes(needle)) throw new Error(`FAIL: ${label}`);
}

if (!/accept="\.csv,\.xlsx,\.xls,\.json"/.test(admin)) {
  throw new Error("FAIL: file picker no longer advertises CSV/XLSX/JSON");
}

console.log("PASS: unified data ingestion centre retains file, API and SQL ingestion paths");
