import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
await import("../public/brand-engine.js");
const BE = globalThis.BrandEngine;
const load = (n) => { const j = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url))); return BE.analyzePixels(Buffer.from(j.data, "base64"), j.w, j.h); };
const hue = (hex) => BE.hexToLch(hex).h, hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
ok(BE.VERSION === "1.4.0", "brand engine exposes a version for MLOps telemetry");

// every result: valid hex, WCAG targets met
for (const n of ["teal_orange_transparent", "red_on_white", "mono_black", "navy_gold_aa", "tiny_purple", "white_yellow_on_navy", "pastel_mint"]) {
  const r = load(n); ok(r, n + ": result"); 
  for (const k of ["primaryColor", "accentColor", "navyColor"]) ok(/^[0-9A-F]{6}$/.test(r[k]), `${n}.${k} is 6-digit hex (${r[k]})`);
  ok(BE.contrast(BE.themeTokens(r,"light")["--blue"], "FFFFFF") >= 4.5, `${n}: rendered UI accent >= 4.5:1 on white`);
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
r = load("pastel_mint"); ok(BE.contrast(BE.themeTokens(r,"light")["--blue"], "FFFFFF") >= 4.5, "pastel logo renders a contrast-safe UI accent");


// The Fixer-style role model: a large dark structural colour plus a smaller
// bright accent must map to primary/navy + accent rather than being reversed.
{
  // Transparent perimeter mirrors the supplied SVG/PNG artwork. The previous
  // synthetic fixture filled the entire perimeter violet, so background
  // detection quite reasonably stripped the structural colour as a backdrop.
  const w=120,h=60,p=Buffer.alloc(w*h*4);
  // Large violet wordmark body.
  for(let y=10;y<50;y++){
    for(let x=8;x<104;x++){
      const i=y*w+x,o=i*4;
      p[o]=0x2B;p[o+1]=0x1D;p[o+2]=0x73;p[o+3]=255;
    }
  }
  // Distinct mint accent, matching the real logo's separate bar/full-stop role.
  for(let y=18;y<42;y++){
    for(let x=104;x<114;x++){
      const i=y*w+x,o=i*4;
      p[o]=0x0F;p[o+1]=0xC7;p[o+2]=0x9B;p[o+3]=255;
    }
  }
  const fx=BE.analyzePixels(p,w,h);
  ok(["dark-structural-plus-vivid-accent","dominant-accent"].includes(fx.diagnostics.roleModel),"The Fixer-like logo reports a valid role model");
  ok(hd(hue(fx.primaryColor),hue("2B1D73"))<12,`The Fixer-like primary stays violet (${fx.primaryColor})`);
  ok(hd(hue(fx.accentColor),hue("0FC79B"))<12,`The Fixer-like accent stays mint (${fx.accentColor})`);
  ok(BE.contrast(BE.themeTokens(fx,"light")["--blue"],"FFFFFF")>=4.5,"The Fixer mint derives a contrast-safe interactive accent");
}

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
  for (const k of ["--brand-secondary","--brand-bridge","--brand-accent-soft","--brand-primary-soft","--surface-brand","--line-brand","--surface-0","--surface-1","--surface-2","--surface-3","--surface-raised","--surface-subtle","--surface-mix-base","--text-strong","--text-muted"]) {
    ok(/^#[0-9A-F]{6}$/i.test(L[k]), `light: tonal token ${k} is a valid derived colour`);
    ok(/^#[0-9A-F]{6}$/i.test(D[k]), `dark: tonal token ${k} is a valid derived colour`);
  }
  ok(BE.contrast(L["--brand-primary"], "FFFFFF") >= 7, "light: brand colour reads on white");
  ok(BE.contrast(L["--blue"], "FFFFFF") >= 4.5, "light: accent reads on white");
  ok(BE.contrast(D["--ink"], D["--white"]) >= 12, "dark: body text >= 12:1");
  ok(BE.contrast(D["--grey"], D["--white"]) >= 7, "dark: secondary text >= 7:1");
  ok(BE.contrast(D["--grey-l"], D["--white"]) >= 4.5, "dark: muted text >= 4.5:1");
  ok(BE.contrast(D["--blue"], D["--white"]) >= 4.5, "dark: accent >= 4.5:1 on surface");
  ok(BE.contrast(D["--dm-on-accent"], D["--blue"]) >= 4.5, "dark: text/icon foreground remains readable on the rendered accent");
  ok(BE.hexToLch(D["--dm-loading-bg"]).L >= 0.36 && BE.hexToLch(D["--dm-loading-surface"]).L >= 0.44, "dark: loading surfaces stay visibly lighter than near-black app chrome");
  ok(BE.contrast(D["--dm-loading-ink"], D["--dm-loading-surface"]) >= 5, "dark: loading heading remains strongly readable on the lighter surface");
  ok(BE.contrast(D["--dm-loading-muted"], D["--dm-loading-surface"]) >= 4.5, "dark: loading supporting text remains accessible on the lighter surface");
  ok(BE.contrast(D["--brand-primary"], D["--white"]) >= 9, "dark: headings >= 9:1");
  ok(BE.contrast("FFFFFF", D["--bar-bg"]) >= 12, "dark: white text on brand bar >= 12:1");
  ok(BE.contrast(D["--brand-vivid"], D["--bar-bg"]) >= 3, "dark: brand accent rule stays visible on the bar");
  ok(BE.contrast(L["--brand-vivid"] , "FFFFFF") > 1 && L["--brand-vivid"].toLowerCase() === "#" + (th.accentColor || "0FC79B").toLowerCase(), "light: decorative accent keeps the brand's true colour");
  ok(BE.hexToLch(D["--white"]).L < 0.3 && BE.hexToLch(D["--ent-paper"]).L < 0.22, "dark: surfaces are actually dark");
}
console.log(`Brand engine tests passed (${pass} assertions).`);
