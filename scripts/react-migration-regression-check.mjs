import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const pkg = JSON.parse(read("package.json"));
const frontend = JSON.parse(read("frontend/package.json"));
const vite = read("frontend/vite.config.ts");
const app = read("frontend/src/App.tsx");
const styles = read("frontend/src/styles.css");
const lib = read("frontend/src/lib/utils.ts");
const server = read("src/server.ts");

const files = { package: read("frontend/package.json"), app, styles, lib };

const checks = [
  ["tailwind CSS is the React visual system", files.package.includes("tailwindcss") && files.package.includes("@tailwindcss/vite") && files.styles.includes("@import \"tailwindcss\"") && files.app.includes("./components/ui/card")],
  ["shadcn-style primitives are present", files.app.includes("./components/ui/button") && files.app.includes("./components/ui/select") && files.app.includes("./components/ui/progress") && files.lib.includes("tailwind-merge")],
  ["React dependency present", frontend.dependencies?.react && frontend.dependencies?.["react-dom"]],
  ["Vite React plugin present", frontend.devDependencies?.["@vitejs/plugin-react"] && frontend.devDependencies?.vite],
  ["React TypeScript entrypoint", read("frontend/src/main.tsx").includes("createRoot") && fs.existsSync(path.join(root, "frontend/src/main.tsx"))],
  ["React base path configured", vite.includes('base: "/react/"')],
  ["Root build includes React build", pkg.scripts?.["frontend:build"] && pkg.scripts.build.includes("frontend:build")],
  ["Fastify serves React preview", server.includes('prefix: "/react/"') && server.includes('join(PUBLIC_DIR, "react")')],
  ["Role-aware shell exists", app.includes("roleLabels") && app.includes("VIEWER") && app.includes("SUPERADMIN")],
  ["Responsive React shell exists", files.styles.includes("tailwind") && app.includes("sm:") && app.includes("lg:")],
  ["Financial analytics surfaces migrated", app.includes("Total advanced") && app.includes("Financial problems resolved") && app.includes("creditors") && app.includes("Activated employees by income band")],
  ["Real dashboard filter options used", app.includes("data.filterOptions?.incomes") && read("src/services/snapshotBuilder.ts").includes("incomes: INCOME_VALUES.map")],
  ["Full-value financial trend units", read("src/services/snapshotBuilder.ts").includes("return { key, value: Math.round(rand(cumulative)) }") && !read("src/services/snapshotBuilder.ts").includes("Math.round(rand(cumulative) / 1_000)")],
  ["Period comparison points exposed", read("src/services/snapshotBuilder.ts").includes("monthlySavingRand: Number(rand(cumulativeMonthlySaving))") && read("src/services/snapshotBuilder.ts").includes("totalAdvancedRaw: Number(rand(ewaTotal))")],
  ["Governed period filter endpoint used", app.includes("/api/employers/") && app.includes("/periods") && app.includes("periodOptions")],
  ["Site filter is wired to dashboard query", app.includes('p.set("site",site)') && app.includes("filterOptions?.sites")],
  ["Editorial visual system is active", styles.includes("--font-display") && styles.includes("--brand-accent") && styles.includes("Georgia")],
  ["No generic icon library in React dashboard", !app.includes("lucide-react") && !app.includes("<Icon ")],
  ["No decorative gradient treatment in React dashboard", !app.includes("gradient")],
  ["Neutral-first palette replaces saturated violet utility classes", !/violet-(50|100|200|300|400|500|600|700|800|900|950)/.test(app)],
  ["Full-value typography remains intact", app.includes(`Intl.NumberFormat("en-ZA"`) && !app.includes("/ 1_000")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else { console.error(`FAIL: ${name}`); failed++; }
}
if (failed) process.exit(1);
console.log(`React migration foundation checks passed (${checks.length})`);

checks.push(["Viewer dashboard uses assigned channel-partner logo", app.includes('src={me.theme?.logoDataUrl||"/static/the-fixer-logo.svg?v=4"}') && app.includes('data-custom-logo={me.theme?.logoDataUrl?"1":undefined}')]);
