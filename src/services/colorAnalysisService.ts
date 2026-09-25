// ─────────────────────────────────────────────────────────────────────────
// Logo Color Analysis: Extract dominant colors from partner logos
// Returns the three primary brand colors: primaryBrandColor, secondaryColor,
// and dominantBackgroundColor, suitable for UI theming.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Simple color distance calculation (Euclidean in RGB space)
 */
function colorDistance(c1: RGB, c2: RGB): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * Convert RGB to HSL for better color analysis (saturation/lightness matter for brand colors)
 */
function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Simple color quantization: group pixels into dominant colors
 * Returns top N colors by frequency
 */
function getDominantColors(pixels: Uint8ClampedArray, count: number = 5): RGB[] {
  const colorMap = new Map<string, number>();

  // Quantize to 5-bit color (reduce from 8-bit to ~32k possible colors)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = Math.round((pixels[i] / 255) * 31) * 8;
    const g = Math.round((pixels[i + 1] / 255) * 31) * 8;
    const b = Math.round((pixels[i + 2] / 255) * 31) * 8;
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  // Sort by frequency and take top N
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  return sorted.map(([key]) => {
    const [r, g, b] = key.split(",").map(Number);
    return { r, g, b };
  });
}

/**
 * Score a color for brand potential: vibrant, saturated colors > muted/grayscale
 * Prefer mid-range lightness (not too dark, not too light)
 */
function scoreBrandColor(hsl: HSL): number {
  const saturationBoost = hsl.s > 40 ? hsl.s : 0; // Only saturated colors
  const lightnessBoost = hsl.l > 20 && hsl.l < 80 ? 100 - Math.abs(hsl.l - 50) : 0; // Prefer mid-range
  return saturationBoost * 0.6 + lightnessBoost * 0.4;
}

/**
 * Analyze a logo image (from canvas data) and extract three brand colors:
 * - primaryBrandColor: most vibrant, saturated color (signature identity)
 * - secondaryColor: complementary or supporting color
 * - dominantBackgroundColor: darkest common color (canvas/background)
 */
export function analyzeLogoColors(imageData: ImageData): {
  primaryBrandColor: string;
  secondaryColor: string;
  dominantBackgroundColor: string;
} {
  const colors = getDominantColors(imageData.data, 8);

  if (colors.length === 0) {
    // Fallback: return default empower-fin palette
    return {
      primaryBrandColor: "32217C",
      secondaryColor: "B15BE8",
      dominantBackgroundColor: "330A36",
    };
  }

  // Score colors for brand potential
  const scored = colors
    .map((rgb) => ({
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
    }))
    .map((c) => ({
      ...c,
      brandScore: scoreBrandColor(c.hsl),
    }));

  // Primary brand color: highest brand score (vibrant & saturated)
  const primaryColor = scored.reduce((best, c) => (c.brandScore > best.brandScore ? c : best));

  // Secondary: next highest brand score, but different hue from primary
  const primaryHue = primaryColor.hsl.h;
  const secondary = scored
    .filter((c) => Math.abs(c.hsl.h - primaryHue) > 30) // Different hue
    .sort((a, b) => b.brandScore - a.brandScore)[0] || scored[1] || primaryColor;

  // Dominant background: darkest color (usually black/dark grays in logos)
  const dominantBg = scored.reduce((darkest, c) =>
    c.hsl.l < darkest.hsl.l ? c : darkest
  );

  const toHex = (rgb: RGB) =>
    [rgb.r, rgb.g, rgb.b]
      .map((x) => x.toString(16).padStart(2, "0").toUpperCase())
      .join("");

  return {
    primaryBrandColor: toHex(primaryColor.rgb),
    secondaryColor: toHex(secondary.rgb),
    dominantBackgroundColor: toHex(dominantBg.rgb),
  };
}

