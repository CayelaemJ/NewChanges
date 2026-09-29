import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/dashboard.css"), "utf8");
const failures = [];
const must = (ok, msg) => { if (!ok) failures.push(msg); };

must(/name=["']viewport["'][^>]+width=device-width/i.test(html), "dashboard needs a mobile viewport");
must(/aria-label=/.test(html), "dashboard needs labelled interactive/assistive controls");
must(/focus-visible/.test(css), "dashboard needs visible keyboard focus styling");
must(/prefers-reduced-motion/.test(css), "dashboard needs reduced-motion handling");
must(/button[^>]*type=["']button["']/i.test(html), "dashboard buttons should declare button type");
must(/role=["']dialog["']/.test(html), "dashboard needs an accessible dialog pattern");
must(/max-width:s*640px/.test(css) && /orientation:s*landscape/.test(css), "dashboard needs portrait and landscape mobile handling");
must(/overflow-wrap:s*anywhere/.test(css), "long labels need safe wrapping");
must(!/outline:s*none[^;]*;(?:(?!focus-visible)[\s\S]){0,180}(?=\})/m.test(css), "do not remove focus outlines without replacement");

if (failures.length) {
  console.error("ACCESSIBILITY REGRESSION CHECK FAILED:");
  failures.forEach(x => console.error(" - " + x));
  process.exit(1);
}
console.log("Accessibility regression checks passed.");
