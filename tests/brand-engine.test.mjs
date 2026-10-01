import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
await import("../public/brand-engine.js");
const BE = globalThis.BrandEngine;
const load = (n) => { const j = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url))); return BE.analyzePixels(Buffer.from(j.data, "base64"), j.w, j.h); };
const hue = (hex) => BE.hexToLch(hex).h, hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
ok(BE.VERSION === "1.1.0", "brand engine exposes a version for MLOps telemetry");

// every result: valid hex, WCAG targets met
for (const n of ["teal_orange_transparent", "red_on_white", "mono_black", "navy_gold_aa", "tiny_purple", "white_yellow_on_navy", "pastel_mint"]) {
  const r = load(n); ok(r, n + ": result"); 
  for (const k of ["primaryColor", "accentColor", "navyColor"]) ok(/^[0-9A-F]{6}$/.test(r[k]), `${n}.${k} is 6-digit hex (${r[k]})`);
  ok(BE.contrast(r.accentColor, "FFFFFF") >= 4.5, `${n}: accent >= 4.5:1 on white (${BE.contrast(r.accentColor, "FFFFFF").toFixed(2)})`);
  ok(BE.contrast(r.navyColor, "FFFFFF") >= 7, `${n}: brand bar >= 7:1 for white text (${BE.contrast(r.navyColor, "FFFFFF").toFixed(2)})`);
}
// ground truth
let r = load("teal_orange_transparent");
ok(hd(hue(r.accentColor), 195) < 25, `FNB-style: dominant is teal, got hue ${hue(r.accentColor).toFixed(0)}`);
ok(hd(hue(r.primaryColor), 60) < 30, `FNB-style: secondary is orange, got hue ${hue(r.primaryColor).toFixed(0)}`);
r = load("red_on_white");
ok(r.diagnostics.backgroundRemoved, "opaque white background detected and removed");
ok(hd(hue(r.accentColor), 25) < 20, `red logo -> red accent, got hue ${hue(r.accentColor).toFixed(0)}`);
r = load("white_yellow_on_navy");
ok(r.diagnostics.backgroundRemoved, "opaque navy background removed");
ok(hd(hue(r.accentColor), 95) < 30, `yellow mark drives accent (hue ${hue(r.accentColor).toFixed(0)}), not the navy background`);
r = load("navy_gold_aa");
ok(hd(hue(r.navyColor), 265) < 30, `navy_gold: dark tone is blue (hue ${hue(r.navyColor).toFixed(0)})`);
r = load("mono_black");
ok(r.warnings.some((w) => /monochrome/.test(w)) && r.confidence < 0.3, "monochrome logo warns and reports low confidence");
r = load("tiny_purple"); ok(hd(hue(r.accentColor), 310) < 30, "tiny icon still resolves purple"); ok(r.warnings.some((w) => /small/.test(w)), "tiny icon warns about resolution");
r = load("pastel_mint"); ok(BE.contrast(r.accentColor, "FFFFFF") >= 4.5, "pastel logo is darkened to a legible accent");

// speed: 128x128 well under a frame budget
const big = Buffer.alloc(128 * 128 * 4); for (let i = 0; i < big.length; i += 4) { big[i] = (i * 7) & 255; big[i + 1] = (i * 13) & 255; big[i + 2] = (i * 3) & 255; big[i + 3] = 255; }
const t0 = performance.now(); BE.analyzePixels(big, 128, 128); const ms = performance.now() - t0; ok(ms < 200, `128x128 analysed in ${ms.toFixed(1)}ms`);

// semantic chart palette: distinct, contrast-safe enterprise series derived from the same brand.
for (const th of [{accentColor:"009DA5",primaryColor:"FF8000",navyColor:"0B3C40"},{accentColor:"B15BE8",primaryColor:"B15BE8",navyColor:"330A36"}]) {
  const p=BE.deriveChartPalette(th);
  const keys=["engagement","cashflow","debt","insurance","workforce","low","mid","high"];
  ok(keys.every(k=>/^#[0-9A-F]{6}$/i.test(p[k])), "chart palette returns valid colours");
  ok(new Set(keys.map(k=>p[k].toUpperCase())).size>=7, "chart palette keeps series visually distinct");
  ok(keys.every(k=>BE.contrast(p[k].replace(/^#/,""),"FFFFFF")>=3.4), "chart palette maintains readable contrast on light surfaces");
}

// theme tokens
for (const th of [{ accentColor: "009DA5", primaryColor: "FF8000", navyColor: "0B3C40" }, { accentColor: "B15BE8", navyColor: "330A36" }, { accentColor: "FFC800", navyColor: "0C235A" }, {}]) {
  const L = BE.themeTokens(th, "light"), D = BE.themeTokens(th, "dark");
  ok(BE.contrast(L["--brand-primary"], "FFFFFF") >= 7, "light: brand colour reads on white");
  ok(BE.contrast(L["--blue"], "FFFFFF") >= 4.5, "light: accent reads on white");
  ok(BE.contrast(D["--ink"], D["--white"]) >= 12, "dark: body text >= 12:1");
  ok(BE.contrast(D["--grey"], D["--white"]) >= 7, "dark: secondary text >= 7:1");
  ok(BE.contrast(D["--grey-l"], D["--white"]) >= 4.5, "dark: muted text >= 4.5:1");
  ok(BE.contrast(D["--blue"], D["--white"]) >= 4.5, "dark: accent >= 4.5:1 on surface");
  ok(BE.contrast(D["--brand-primary"], D["--white"]) >= 9, "dark: headings >= 9:1");
  ok(BE.contrast("FFFFFF", D["--bar-bg"]) >= 12, "dark: white text on brand bar >= 12:1");
  ok(BE.contrast(D["--brand-vivid"], D["--bar-bg"]) >= 3, "dark: brand accent rule stays visible on the bar");
  ok(BE.contrast(L["--brand-vivid"] , "FFFFFF") > 1 && L["--brand-vivid"].toLowerCase() === "#" + (th.accentColor || "B15BE8").toLowerCase(), "light: decorative accent keeps the brand's true colour");
  ok(BE.hexToLch(D["--white"]).L < 0.3 && BE.hexToLch(D["--ent-paper"]).L < 0.22, "dark: surfaces are actually dark");
}
console.log(`Brand engine tests passed (${pass} assertions).`);
