/**
 * Logo Color Analysis: Extract dominant colors from partner logos using k-means clustering.
 * Returns three brand colors: primaryBrandColor, secondaryColor, dominantBackgroundColor.
 */
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
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
function rgbToHex(r, g, b) {
    return [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function colorDistance(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
/**
 * K-means clustering to find dominant colors
 */
function kMeansClustering(pixels, k = 8, iterations = 5) {
    if (pixels.length <= k)
        return pixels;
    // Initialize centroids randomly
    let centroids = [];
    for (let i = 0; i < k; i++) {
        centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
    }
    // K-means iterations
    for (let iter = 0; iter < iterations; iter++) {
        const clusters = Array(k).fill(null).map(() => []);
        // Assign each pixel to nearest centroid
        pixels.forEach(pixel => {
            let minDist = Infinity;
            let closestIdx = 0;
            centroids.forEach((centroid, idx) => {
                const dist = colorDistance(pixel, centroid);
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = idx;
                }
            });
            clusters[closestIdx].push(pixel);
        });
        // Recompute centroids
        centroids = clusters.map((cluster, idx) => {
            if (cluster.length === 0)
                return centroids[idx];
            const sum = cluster.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), { r: 0, g: 0, b: 0 });
            return {
                r: Math.round(sum.r / cluster.length),
                g: Math.round(sum.g / cluster.length),
                b: Math.round(sum.b / cluster.length),
            };
        });
    }
    return centroids;
}
/**
 * Filter out near-grayscale colors and very dark/light pixels
 */
function isValidBrandColor(rgb) {
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    // Must have some saturation (not grayscale) and be mid-range lightness
    return hsl.s >= 15 && hsl.l >= 15 && hsl.l <= 85;
}
/**
 * Analyze canvas pixel data and return three dominant brand colors
 */
export function analyzeLogoColors(imageData) {
    const data = imageData.data;
    const pixels = [];
    // Sample every pixel, skip transparent
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        // Skip mostly transparent pixels
        if (a < 200)
            continue;
        pixels.push({ r, g, b });
    }
    if (pixels.length < 10) {
        return {
            primaryBrandColor: "32217C",
            secondaryColor: "B15BE8",
            dominantBackgroundColor: "330A36",
        };
    }
    // Cluster pixels into 8 dominant colors
    const centroids = kMeansClustering(pixels, 8, 5);
    // Separate into categories: vibrant (primary), supporting (secondary), dark (background)
    const vibrант = [];
    const dark = [];
    centroids.forEach(color => {
        const hsl = rgbToHsl(color.r, color.g, color.b);
        // Count how many pixels map to this centroid
        let count = 0;
        pixels.forEach(p => {
            if (colorDistance(p, color) < 50)
                count++;
        });
        if (hsl.l < 35) {
            dark.push({ color, count, hsl });
        }
        else if (isValidBrandColor(color)) {
            vibrант.push({ color, count, hsl });
        }
    });
    // Sort vibrant by saturation (most saturated = most brandable)
    vibrант.sort((a, b) => b.hsl.s - a.hsl.s);
    // Sort dark by frequency
    dark.sort((a, b) => b.count - a.count);
    const primaryBrandColor = vibrант.length > 0
        ? rgbToHex(vibrант[0].color.r, vibrант[0].color.g, vibrант[0].color.b)
        : "32217C";
    const secondaryColor = vibrант.length > 1
        ? rgbToHex(vibrант[1].color.r, vibrант[1].color.g, vibrант[1].color.b)
        : vibrант.length > 0
            ? rgbToHex(vibrант[0].color.r, vibrант[0].color.g, vibrант[0].color.b)
            : "B15BE8";
    const dominantBackgroundColor = dark.length > 0
        ? rgbToHex(dark[0].color.r, dark[0].color.g, dark[0].color.b)
        : "330A36";
    return {
        primaryBrandColor,
        secondaryColor,
        dominantBackgroundColor,
    };
}
