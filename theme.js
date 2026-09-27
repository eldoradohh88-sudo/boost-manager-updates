// =====================================================================
//  Thème automatique : lit les couleurs de src/logo.png et en déduit
//  toutes les couleurs de l'app (fond, cartes, accent, texte…).
//  Change le logo → l'app change de couleurs toute seule.
// =====================================================================

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const hsl = (h, s, l, a) => (a == null
  ? `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
  : `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}% / ${a})`);

// histogramme des teintes (36 cases de 10°) ; renvoie la case la plus lourde
function peak(hist, exclude = [], minGap = 0) {
  let best = -1; let bw = 0;
  hist.forEach((b, i) => {
    if (!b.w) return;
    const h = i * 10 + 5;
    if (exclude.some((x) => hueDist(x, h) < minGap)) return;
    if (b.w > bw) { bw = b.w; best = i; }
  });
  if (best < 0) return null;
  const b = hist[best];
  // teinte moyenne précise dans la case (moyenne circulaire)
  const h = (Math.atan2(b.y, b.x) * 180 / Math.PI + 360) % 360;
  return { h, s: b.s / b.n, l: b.l / b.n, w: bw };
}

/**
 * @param {Buffer} bgra  pixels BGRA (comme nativeImage.toBitmap())
 * @param {number} width
 * @param {number} height
 * @returns {object|null} variables CSS
 */
function paletteFromBitmap(bgra, width, height) {
  const tone = Array.from({ length: 36 }, () => ({ w: 0, n: 0, x: 0, y: 0, s: 0, l: 0 }));
  const vivid = Array.from({ length: 36 }, () => ({ w: 0, n: 0, x: 0, y: 0, s: 0, l: 0 }));
  let count = 0; let sumS = 0;
  for (let i = 0; i + 3 < bgra.length && i < width * height * 4; i += 4) {
    const b = bgra[i]; const g = bgra[i + 1]; const r = bgra[i + 2]; const a = bgra[i + 3];
    if (a < 180) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    count++; sumS += s;
    if (s < 0.1 || l < 0.08 || l > 0.94) continue;
    const bin = Math.floor(h / 10) % 36;
    const rad = h * Math.PI / 180;
    const add = (hist, w) => { const o = hist[bin]; o.w += w; o.n += 1; o.x += Math.cos(rad) * w; o.y += Math.sin(rad) * w; o.s += s; o.l += l; };
    add(tone, 1);                                               // couleur la plus présente
    if (l > 0.28 && l < 0.85) add(vivid, s * s * (1 - Math.abs(l - 0.58))); // couleur la plus « pétante »
  }
  if (!count) return null;
  const main = peak(tone);
  if (!main || sumS / count < 0.06) return null; // logo en noir et blanc : thème par défaut
  let acc = peak(vivid) || main;
  let accB = peak(vivid, [acc.h], 35) || peak(tone, [acc.h], 35) || { h: (acc.h + 40) % 360, s: acc.s, l: acc.l };
  // les jaunes tirant sur le vert font « maladif » à l'écran : on les ramène vers l'or
  const gold = (h) => (h > 55 && h < 85 ? h - 15 : h);
  acc = { ...acc, h: gold(acc.h) };
  accB = { ...accB, h: gold(accB.h) };

  const bgH = main.h;
  const bgS = clamp(main.s * 0.55, 0.12, 0.42);
  const aS = clamp(acc.s, 0.55, 0.92);
  const aL = clamp(acc.l, 0.56, 0.7);
  const bS = clamp(accB.s, 0.45, 0.85);
  const ink = aL > 0.6 ? hsl(acc.h, 0.45, 0.12) : '#ffffff';
  return {
    '--bg-1': hsl(bgH, bgS, 0.075),
    '--bg-2': hsl(bgH, bgS, 0.13),
    '--panel': hsl(bgH, bgS, 0.145, 0.86),
    '--panel-2': hsl(bgH, bgS, 0.2, 0.75),
    '--field': hsl(bgH, bgS, 0.07, 0.8),
    '--line': hsl(bgH, 0.3, 0.75, 0.13),
    '--line-2': hsl(bgH, 0.3, 0.75, 0.26),
    '--text': hsl(bgH, 0.25, 0.96),
    '--text-2': hsl(bgH, 0.18, 0.84),
    '--muted': hsl(bgH, 0.16, 0.66),
    '--accent': hsl(acc.h, aS, aL),
    '--accent-2': hsl(acc.h, aS, clamp(aL + 0.14, 0, 0.9)),
    '--accent-ink': ink,
    '--accent-soft': hsl(acc.h, aS, aL, 0.14),
    '--accent-line': hsl(acc.h, aS, aL, 0.45),
    '--accent-glow': hsl(acc.h, aS, aL, 0.32),
    '--accent-b': hsl(accB.h, bS, 0.62),
    '--accent-b-soft': hsl(accB.h, bS, 0.62, 0.16),
  };
}

module.exports = { paletteFromBitmap, rgbToHsl };
