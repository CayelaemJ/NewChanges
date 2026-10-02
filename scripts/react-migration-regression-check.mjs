import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const pkg = JSON.parse(read("package.json"));
const frontend = JSON.parse(read("frontend/package.json"));
const vite = read("frontend/vite.config.ts");
const app = read("frontend/src/App.tsx");
const server = read("src/server.ts");

const checks = [
  ["React dependency present", frontend.dependencies?.react && frontend.dependencies?.["react-dom"]],
  ["Vite React plugin present", frontend.devDependencies?.["@vitejs/plugin-react"] && frontend.devDependencies?.vite],
  ["React TypeScript entrypoint", read("frontend/src/main.tsx").includes("createRoot") && fs.existsSync(path.join(root, "frontend/src/main.tsx"))],
  ["React base path configured", vite.includes('base: "/react/"')],
  ["Root build includes React build", pkg.scripts?.["frontend:build"] && pkg.scripts.build.includes("frontend:build")],
  ["Fastify serves React preview", server.includes('prefix: "/react/"') && server.includes('join(PUBLIC_DIR, "react")')],
  ["Role-aware shell exists", app.includes("roleLabels") && app.includes("VIEWER") && app.includes("SUPERADMIN")],
  ["Responsive React shell exists", fs.existsSync(path.join(root, "frontend/src/styles.css")) && read("frontend/src/styles.css").includes("@media")],
  ["Financial analytics surfaces migrated", app.includes("Total advanced") && app.includes("Financial problems resolved") && app.includes("creditors") && app.includes("Activated employees by income band")],
  ["Real dashboard filter options used", app.includes("data.filterOptions?.incomes") && read("src/services/snapshotBuilder.ts").includes("incomes: INCOME_VALUES.map")],
  ["Full-value financial trend units", read("src/services/snapshotBuilder.ts").includes("return { key, value: Math.round(rand(cumulative)) }") && !read("src/services/snapshotBuilder.ts").includes("Math.round(rand(cumulative) / 1_000)")],
  ["Period comparison points exposed", read("src/services/snapshotBuilder.ts").includes("monthlySavingRand: Number(rand(cumulativeMonthlySaving))") && read("src/services/snapshotBuilder.ts").includes("totalAdvancedRaw: Number(rand(ewaTotal))")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else { console.error(`FAIL: ${name}`); failed++; }
}
if (failed) process.exit(1);
console.log(`React migration foundation checks passed (${checks.length})`);
