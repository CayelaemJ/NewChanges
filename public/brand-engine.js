/*! brand-engine.js — client-side brand colour extraction + theme token generation.
 *
 *  Pipeline (all local, no network, no third-party code):
 *   1. Decode logo pixels at up to 256px, aspect-ratio preserved; higher-resolution uploads get more representative colour sampling.
 *   2. Detect and discard an opaque background (border-pixel clustering in OKLab).
 *   3. Convert every kept pixel to OKLab/OKLCH (perceptually uniform), weight by alpha
 *      (anti-aliased edge blends count for less).
 *   4. Hue-bucket analysis: 36 x 10-degree bins, salience = area * chroma, circular
 *      smoothing, peak detection, watershed assignment -> hue clusters.
 *   5. Score clusters (area^0.55 * chroma^0.9), assign roles, then enforce WCAG contrast
 *      by moving lightness only (hue and as much chroma as fits the sRGB gamut are kept).
 *   6. themeTokens() derives a full light or dark token set from the three stored colours.
 *
 *  Works in browsers (window.BrandEngine) and Node (module.exports) so it can be unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrandEngine = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var ENGINE_VERSION = '1.1.0';
  var TAU = Math.PI * 2, DEG = 180 / Math.PI;
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  /* ───────────── colour maths ───────────── */
  function toLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function fromLin(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  function rgbToOklab(r, g, b) {
    var R = toLin(r), G = toLin(g), B = toLin(b);
    var l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    var m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    var s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function oklabToLinear(L, a, b) {
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  function inGamut(lin) { for (var i = 0; i < 3; i++) if (lin[i] < -0.0005 || lin[i] > 1.0005) return false; return true; }
  function byteHex(v) { var n = Math.round(clamp(v, 0, 1) * 255).toString(16); return n.length < 2 ? '0' + n : n; }

  /** OKLCH -> hex (no '#'), reducing chroma until the colour fits inside sRGB. */
  function lch(L, C, h) {
    L = clamp(L, 0, 1); var hr = h / DEG, lo = 0, hi = Math.max(C, 0), c = hi;
    function lin(cc) { return oklabToLinear(L, cc * Math.cos(hr), cc * Math.sin(hr)); }
    if (!inGamut(lin(hi))) {
      for (var i = 0; i < 18; i++) { c = (lo + hi) / 2; if (inGamut(lin(c))) lo = c; else hi = c; }
      c = lo;
    }
    var rgb = lin(c);
    return (byteHex(fromLin(rgb[0])) + byteHex(fromLin(rgb[1])) + byteHex(fromLin(rgb[2]))).toUpperCase();
  }
  function parseHex(hex) {
    var h = String(hex || '').replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function hexToLch(hex) {
    var rgb = parseHex(hex) || [0, 0, 0], lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
    var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    var h = C < 1e-4 ? 0 : (Math.atan2(lab[2], lab[1]) * DEG + 360) % 360;
    return { L: lab[0], C: C, h: h };
  }
  function luminance(hex) {
    var c = parseHex(hex) || [0, 0, 0];
    return 0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]);
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Move lightness (only) until `hex` reaches `ratio` against `bg`; hue is preserved. */
  function ensureContrast(hex, bg, ratio) {
    if (contrast(hex, bg) >= ratio) return String(hex).replace(/^#/, '').toUpperCase();
    var k = hexToLch(hex), goDarker = luminance(bg) > 0.4, best = hex;
    for (var i = 1; i <= 100; i++) {
      var L = goDarker ? k.L - i * 0.01 : k.L + i * 0.01;
      if (L < 0.02 || L > 0.99) break;
      best = lch(L, k.C, k.h);
      if (contrast(best, bg) >= ratio) return best;
    }
    return String(best).replace(/^#/, '').toUpperCase();
  }
  function mixHex(a, b, t) {
    var x = hexToLch(a), y = hexToLch(b);
    var la = rgbToOklab.apply(null, parseHex(a)), lb = rgbToOklab.apply(null, parseHex(b));
    var L = la[0] + (lb[0] - la[0]) * t, A = la[1] + (lb[1] - la[1]) * t, B = la[2] + (lb[2] - la[2]) * t;
    var C = Math.sqrt(A * A + B * B), h = C < 1e-4 ? x.h : (Math.atan2(B, A) * DEG + 360) % 360;
    return lch(L, C, h);
  }
  var hueDist = function (a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  /* ───────────── pixel analysis ───────────── */
  /**
   * @param {Uint8ClampedArray|number[]} data RGBA bytes
   * @param {number} w @param {number} h
   * @returns {{primaryColor,accentColor,navyColor,palette,confidence,warnings,diagnostics}|null}
   */
  function analyzePixels(data, w, h, learning) {
    var n = w * h, warnings = [], i, x, y;
    if (!n || data.length < n * 4) return null;

    // 1. opaque-background detection from the perimeter
    var border = [], bgLab = null, bgSpread = 0;
    function pushBorder(px) {
      var o = px * 4; if (data[o + 3] < 200) return;
      border.push(rgbToOklab(data[o], data[o + 1], data[o + 2]));
    }
    for (x = 0; x < w; x++) { pushBorder(x); pushBorder((h - 1) * w + x); }
    for (y = 1; y < h - 1; y++) { pushBorder(y * w); pushBorder(y * w + w - 1); }
    var perimeter = 2 * w + 2 * Math.max(0, h - 2);
    if (border.length >= perimeter * 0.6) {
      var mL = 0, mA = 0, mB = 0;
      border.forEach(function (p) { mL += p[0]; mA += p[1]; mB += p[2]; });
      mL /= border.length; mA /= border.length; mB /= border.length;
      var close = 0;
      border.forEach(function (p) { if (Math.hypot(p[0] - mL, p[1] - mA, p[2] - mB) < 0.05) close++; });
      if (close / border.length > 0.85) { bgLab = [mL, mA, mB]; bgSpread = close / border.length; }
    }

    // 2. hue histogram over chromatic pixels; track neutrals separately
    var BINS = 48, bin = [];
    for (i = 0; i < BINS; i++) bin.push({ area: 0, sal: 0, wL: 0, wA: 0, wB: 0, wt: 0 });
    var used = 0, total = 0, neutralDark = 0, neutralLight = 0, darkChromaArea = 0;
    for (i = 0; i < n; i++) {
      var o = i * 4, alpha = data[o + 3];
      if (alpha < 128) continue;
      var lab = rgbToOklab(data[o], data[o + 1], data[o + 2]);
      if (bgLab && Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]) < 0.06) continue;
      var wgt = (alpha / 255) * (alpha / 255); total += wgt; used++;
      var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      if (C < 0.04 || lab[0] > 0.96) { if (lab[0] < 0.45) neutralDark += wgt; else neutralLight += wgt; continue; }
      var hue = (Math.atan2(lab[2], lab[1]) * DEG + 360) % 360, b = bin[Math.floor(hue / (360 / BINS)) % BINS];
      var vivid = wgt * C * C; // emphasise saturated core pixels over muddy blends
      b.area += wgt; b.sal += wgt * C; b.wL += lab[0] * vivid; b.wA += lab[1] * vivid; b.wB += lab[2] * vivid; b.wt += vivid;
      if (lab[0] < 0.4) darkChromaArea += wgt;
    }
    var chromaArea = bin.reduce(function (s, b) { return s + b.area; }, 0);

    if (used < 12) return null;
    var out = { palette: [], warnings: warnings, diagnostics: { pixelsUsed: used, backgroundRemoved: !!bgLab, hueClusters: 0 } };

    // 3. no meaningful chroma -> monochrome logo
    if (chromaArea < total * 0.04 || chromaArea < 3) {
      var ink = neutralDark >= neutralLight ? '1F2937' : '374151';
      warnings.push('This logo is monochrome (black/white/grey), so no brand colour could be detected. A neutral palette with the portal default accent was used; upload a coloured logo for a branded result.');
      var acc = ensureContrast('5F756D', 'FFFFFF', 4.5);
      out.primaryColor = acc; out.accentColor = acc; out.navyColor = ink;
      out.palette = [{ hex: ink, share: 1, role: 'dark' }];
      out.confidence = 0.15; return out;
    }

    // 4. circular smoothing + peak detection
    var sm = [];
    for (i = 0; i < BINS; i++) sm.push((bin[(i + BINS - 1) % BINS].sal + 2 * bin[i].sal + bin[(i + 1) % BINS].sal) / 4);
    var maxSm = Math.max.apply(null, sm), peaks = [];
    for (i = 0; i < BINS; i++) {
      var prev = sm[(i + BINS - 1) % BINS], next = sm[(i + 1) % BINS];
      if (sm[i] >= maxSm * 0.12 && sm[i] >= prev && sm[i] > next) peaks.push(i);
    }
    if (!peaks.length) peaks.push(sm.indexOf(maxSm));

    // 5. watershed: each bin joins the nearest peak within 60 deg
    var clusters = peaks.map(function (p) { return { peak: p, area: 0, wL: 0, wA: 0, wB: 0, wt: 0 }; });
    for (i = 0; i < BINS; i++) {
      if (!bin[i].area) continue;
      var bi = -1, bd = 1e9;
      for (var k = 0; k < peaks.length; k++) {
        var d = Math.min(Math.abs(i - peaks[k]), BINS - Math.abs(i - peaks[k]));
        if (d < bd) { bd = d; bi = k; }
      }
      if (bd * (360 / BINS) > 60) continue;
      var c = clusters[bi]; c.area += bin[i].area; c.wL += bin[i].wL; c.wA += bin[i].wA; c.wB += bin[i].wB; c.wt += bin[i].wt;
    }
    clusters = clusters.filter(function (c) { return c.wt > 0; }).map(function (c) {
      var L = c.wL / c.wt, A = c.wA / c.wt, B = c.wB / c.wt, Cc = Math.sqrt(A * A + B * B);
      var hh = (Math.atan2(B, A) * DEG + 360) % 360, share = c.area / Math.max(total, 1e-9);
      var pen = (L > 0.9 || L < 0.14) ? 0.5 : 1;
      return { L: L, C: Cc, h: hh, share: share,
               score: Math.pow(share, 0.55) * Math.pow(Math.min(Cc / 0.12, 1.6), 0.9) * pen * (learning && Array.isArray(learning.huePrior) ? (0.82 + 0.36 * Number(learning.huePrior[Math.floor(hh / 10) % 36] || 0)) : 1),
               hex: lch(L, Cc, hh) };
    }).sort(function (a, b) { return b.score - a.score; });
    out.diagnostics.hueClusters = clusters.length;

    // 6. roles
    var dom = clusters[0];
    var sec = null;
    for (i = 1; i < clusters.length; i++) {
      if (hueDist(clusters[i].h, dom.h) >= 40 && clusters[i].share >= 0.02 && clusters[i].C >= 0.06) { sec = clusters[i]; break; }
    }
    var derivedSecondary = false;
    if (!sec) { sec = { L: dom.L, C: dom.C, h: (dom.h + 32) % 360, hex: lch(clamp(dom.L + 0.05, 0.3, 0.8), dom.C, (dom.h + 32) % 360), share: 0 }; derivedSecondary = true; }

    // UI accent: dominant hue, forced to >= 4.5:1 against white (buttons carry white text)
    var accent = ensureContrast(dom.hex, 'FFFFFF', 4.5);
    // dark tone: a real dark chromatic cluster if the logo has one, else dominant hue at low lightness
    var darkCl = clusters.filter(function (c) { return c.L < 0.38 && c.share >= 0.08; })[0];
    var navy = darkCl ? darkCl.hex : lch(Math.min(0.3, dom.L * 0.55), Math.min(dom.C * 0.85, 0.11), dom.h);
    navy = ensureContrast(navy, 'FFFFFF', 8); // white text on the brand bar must be AAA

    out.accentColor = accent;
    out.primaryColor = derivedSecondary ? dom.hex.toUpperCase() : ensureContrast(sec.hex, 'FFFFFF', 3);
    out.navyColor = navy;
    out.palette = clusters.slice(0, 5).map(function (c, idx) {
      return { hex: c.hex, share: Math.round(c.share * 1000) / 1000, role: c === dom ? 'dominant' : (c === sec ? 'secondary' : 'minor') };
    });
    if (neutralDark > total * 0.08) out.palette.push({ hex: '1F2937', share: Math.round(neutralDark / total * 1000) / 1000, role: 'ink' });

    // 7. confidence
    var samples = Math.min(used / 1500, 1), sepa = derivedSecondary ? 0.7 : 1, vivid = Math.min(dom.C / 0.1, 1);
    out.confidence = Math.round(clamp(0.25 + 0.35 * samples + 0.2 * vivid + 0.2 * Math.min(dom.share / 0.25, 1), 0, 1) * sepa * 100) / 100;
    if (used < 400 || Math.max(w, h) < 96) warnings.push('The logo is very small, so detection is less precise. A larger image (at least 256px wide) gives better results.');
    if (derivedSecondary) warnings.push('Only one brand hue was found, so the secondary colour was derived from it.');
    if (out.confidence < 0.45) warnings.push('Detection confidence is low. Please check the preview.');
    return out;
  }

  /** Browser: decode an image data URL and run analyzePixels. Resolves null on any failure. */
  function extractFromImage(dataUrl, maxSide, learning) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var iw = img.naturalWidth || 256, ih = img.naturalHeight || 256, m = maxSide || 256;
            var s = Math.min(1, m / Math.max(iw, ih)); if (iw < m && ih < m) s = Math.min(2, m / Math.max(iw, ih));
            var w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            var ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
            var res = analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h, learning);
            if (res && Math.max(iw, ih) < 128 && !res.warnings.some(function (x) { return /very small/.test(x); })) {
              res.warnings.push('The logo is very small (' + iw + 'x' + ih + 'px), so detection is less precise. A larger image (at least 256px wide) gives better results.');
            }
            resolve(res);
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  }

  /* ───────────── theme tokens ───────────── */
  var LIGHT_STATIC = { '--white': '#ffffff', '--ink': '#241536', '--grey': '#5b6b7a', '--grey-l': '#617486', '--line': '#e8e1f7', '--line-soft': '#f0ecfb' };
  var pound = function (h) { return '#' + String(h).replace(/^#/, ''); };

  /**
   * @param {{accentColor?:string,primaryColor?:string,navyColor?:string}} theme
   * @param {'light'|'dark'} mode
   * @returns {Object<string,string>} CSS custom properties
   */
  function themeTokens(theme, mode) {
    theme = theme || {};
    var accent = String(theme.accentColor || theme.primaryColor || 'B15BE8').replace(/^#/, '');
    var navy = String(theme.navyColor || theme.primaryColor || accent).replace(/^#/, '');
    var second = String(theme.primaryColor || accent).replace(/^#/, '');
    if (!parseHex(accent)) accent = '5F756D'; if (!parseHex(navy)) navy = '17212B'; if (!parseHex(second)) second = accent;
    var A = hexToLch(accent), N = hexToLch(navy), t = {};

    if (mode !== 'dark') {
      var a = ensureContrast(accent, 'FFFFFF', 4.5), n = ensureContrast(navy, 'FFFFFF', 7);
      var aL = hexToLch(a);
      t['--blue'] = pound(a); t['--blue-d'] = pound(lch(aL.L - 0.08, aL.C, aL.h));
      t['--brand-primary'] = pound(n); t['--brand-primary-deep'] = pound(lch(hexToLch(n).L - 0.07, hexToLch(n).C, hexToLch(n).h));
      t['--ice'] = pound(lch(0.955, Math.min(A.C * 0.22, 0.04), A.h)); t['--brand-soft'] = pound(lch(0.972, Math.min(A.C * 0.16, 0.03), A.h));
      t['--brand-grad-1'] = pound(n); t['--brand-grad-2'] = pound(n); t['--brand-grad-3'] = pound(a); t['--brand-grad-4'] = pound(a); t['--brand-grad-5'] = pound(a);
      t['--bar-bg'] = pound(n); t['--ent-paper'] = '#f6f4fb'; t['--brand-vivid'] = pound(accent);
      Object.keys(LIGHT_STATIC).forEach(function (k) { t[k] = LIGHT_STATIC[k]; });
      return t;
    }

    // dark: neutral scale tinted with the brand's dark-tone hue (low chroma so it reads as "dark", not "coloured")
    var hue = N.C > 0.02 ? N.h : A.h, tint = Math.min(0.035, Math.max(N.C, A.C * 0.4) * 0.45);
    var bg = lch(0.175, tint, hue), surf = lch(0.225, tint, hue), surf2 = lch(0.265, tint, hue), ice = lch(0.30, tint * 1.2, hue);
    var line = lch(0.36, tint * 1.1, hue), lineSoft = lch(0.29, tint, hue);
    var ink = ensureContrast(lch(0.95, 0.01, hue), surf, 12), grey = ensureContrast(lch(0.80, 0.015, hue), surf, 7), greyL = ensureContrast(lch(0.70, 0.015, hue), surf, 4.6);
    var acc = ensureContrast(accent, surf, 4.5), accL = hexToLch(acc);
    var head = ensureContrast(lch(0.90, Math.min(N.C, 0.05) || 0.03, hue), surf, 9);
    var bar = lch(Math.min(Math.max(N.L * 0.78, 0.25), 0.31), Math.min(N.C * 0.95, 0.10), N.C > 0.02 ? N.h : A.h);
    t['--dm-bg'] = pound(bg); t['--dm-surface'] = pound(surf); t['--dm-surface-2'] = pound(surf2); t['--dm-line'] = pound(line);
    t['--white'] = pound(surf); t['--ent-paper'] = pound(bg); t['--ink'] = pound(ink); t['--grey'] = pound(grey); t['--grey-l'] = pound(greyL);
    t['--line'] = pound(line); t['--line-soft'] = pound(lineSoft); t['--ice'] = pound(ice); t['--ice-2'] = pound(surf2); t['--brand-soft'] = pound(surf2);
    t['--blue'] = pound(acc); t['--blue-d'] = pound(lch(Math.min(accL.L + 0.07, 0.92), accL.C, accL.h));
    t['--brand-primary'] = pound(head); t['--brand-primary-deep'] = pound(bar); t['--bar-bg'] = pound(bar); t['--brand-vivid'] = pound(ensureContrast(accent, bar, 3));
    t['--dm-on-accent'] = contrast('FFFFFF', accent) >= 4.5 ? '#ffffff' : '#0b0f19';
    t['--brand-grad-1'] = pound(bar); t['--brand-grad-2'] = pound(bar); t['--brand-grad-3'] = pound(acc); t['--brand-grad-4'] = pound(acc); t['--brand-grad-5'] = pound(acc);
    t['--green-soft'] = '#153d2e'; t['--amber-soft'] = '#41321a'; t['--red-soft'] = '#45262a';
    return t;
  }


  /**
   * Derive a semantic chart palette from extracted brand colours.
   * Uses OKLCH hue separation and contrast guards so enterprise charts remain
   * harmonious, distinct and readable across light/dark surfaces.
   */
  function deriveChartPalette(theme) {
    theme = theme || {};
    var accent = String(theme.accentColor || theme.primaryColor || '5F756D').replace(/^#/, '');
    var primary = String(theme.primaryColor || accent).replace(/^#/, '');
    if (!parseHex(accent)) accent = '5F756D';
    if (!parseHex(primary)) primary = accent;
    var a = hexToLch(accent), p = hexToLch(primary);
    var hue = a.C > 0.035 ? a.h : p.h;
    var baseC = Math.min(Math.max(a.C, 0.055), 0.16);
    var defs = {
      engagement:[150,0.50,0.78], cashflow:[175,0.58,0.70],
      debt:[25,0.50,0.62], insurance:[285,0.48,0.78],
      workforce:[205,0.54,0.72], low:[150,0.58,0.68],
      mid:[65,0.58,0.62], high:[5,0.55,0.62]
    };
    var out = {};
    Object.keys(defs).forEach(function (key) {
      var d = defs[key], cc = Math.min(d[2] * baseC, 0.18);
      out[key] = '#' + ensureContrast(lch(d[1], cc, (hue + d[0] + 360) % 360), 'FFFFFF', 3.4);
    });
    var seen = {};
    Object.keys(out).forEach(function (key, idx) {
      var bare = out[key].replace(/^#/,'').toUpperCase();
      if (seen[bare]) out[key] = '#' + ensureContrast(lch(0.54, 0.075, (hue + idx * 43) % 360), 'FFFFFF', 3.4);
      seen[out[key].replace(/^#/,'').toUpperCase()] = true;
    });
    return out;
  }

  /**
   * Browser controller: owns the <html> inline custom properties and re-renders whenever the
   * page toggles the `portal-dark` class, so light/dark always derive from the same brand.
   *   set({ brand, light, charts })
   *     brand  : { accentColor, primaryColor, navyColor }
   *     light  : 'engine' (derive light tokens) | {--var:value} (fixed palette, e.g. the admin's original) | null (page CSS)
   *     charts : { '--chart-x': '#hex' } light-mode chart colours, lifted automatically for dark
   */
  function themeController() {
    var st = { brand: null, light: null, charts: {} }, applied = [], started = false;
    function render() {
      var docEl = document.documentElement, dark = docEl.classList.contains('portal-dark'), set = {}, k;
      if (dark) set = themeTokens(st.brand, 'dark');
      else if (st.light === 'engine') set = themeTokens(st.brand, 'light');
      else if (st.light) for (k in st.light) set[k] = st.light[k];
      var surface = dark ? set['--white'] : null;
      for (k in st.charts) set[k] = dark ? forDark(st.charts[k], surface) : st.charts[k];
      applied.forEach(function (a) { if (!(a in set)) docEl.style.removeProperty(a); });
      Object.keys(set).forEach(function (a) { docEl.style.setProperty(a, set[a]); });
      applied = Object.keys(set);
    }
    return {
      set: function (o) {
        st.brand = o.brand || {}; st.light = o.light === undefined ? null : o.light; st.charts = o.charts || {};
        render();
        if (!started && typeof MutationObserver !== 'undefined') {
          started = true; new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
      },
      render: render
    };
  }

  /** Lift any (chart) colour so it stays legible on a dark surface. */
  function forDark(hex, surfaceHex) { return '#' + ensureContrast(String(hex).replace(/^#/, ''), String(surfaceHex).replace(/^#/, ''), 3.2); }

  return {
    VERSION: ENGINE_VERSION, analyzePixels: analyzePixels, extractFromImage: extractFromImage, deriveChartPalette: deriveChartPalette, themeTokens: themeTokens, themeController: themeController, forDark: forDark,
    contrast: contrast, ensureContrast: ensureContrast, mixHex: mixHex, hexToLch: hexToLch, lch: lch, luminance: luminance
  };
});
