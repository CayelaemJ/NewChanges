import { readFileSync } from "node:fs";

const html = readFileSync("public/admin.html", "utf8");

const required = [
  ['const esc = value =>', 'HTML escaping helper exists'],
  ['async function boot()', 'admin boot exists'],
  ['renderRepList();', 'report selector renders after manifest load'],
  ['Array.isArray(data.loadOrder)', 'manifest response is validated'],
  ['Promise.allSettled', 'secondary admin panels cannot break report loading'],
  ['onclick="selectReport(', 'report rows remain clickable'],
  ['accept=".csv,.xlsx,.xls,.json"', 'report selector opens CSV/XLSX/JSON upload control'],
];

for (const [needle, label] of required) {
  if (!html.includes(needle)) throw new Error(`FAIL: ${label}`);
}

if (html.includes('Could not reach the API. Start the server and reload.')) {
  throw new Error('FAIL: misleading report API fallback is still present');
}

console.log('PASS: admin report selector is independently rendered and clickable');
