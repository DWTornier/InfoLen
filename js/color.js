/* ============================================================
   InfoLen · Material You 动态取色引擎
   sRGB ⇄ OKLab/OKLCH · 色调调色板(Tonal Palette) · M3 角色映射
   色调语义与 HCT 对齐：tone == CIE L*
   ============================================================ */

import { clamp } from "./util.js";

/* ---------------- 基础转换 ---------------- */

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (!isFinite(n)) return [103, 80, 164];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const f = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB 分量，取值 0..1（可能越界，需 gamutMap） */
function oklchToSrgb01(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const [lr, lg, lb] = oklabToLinearSrgb(L, a, b);
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export function oklchToRgbRaw(L, C, hDeg) {
  const [r, g, b] = oklchToSrgb01(L, C, hDeg);
  return [r * 255, g * 255, b * 255];
}

export function oklchToRgb(L, C, hDeg) {
  const g = gamutMap(L, C, hDeg);
  const rgb = oklchToRgbRaw(g.L, g.C, g.h);
  return [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255)];
}

export function srgbToOklch(r, g, b) {
  const { L, a, b: bb } = srgbToOklab(r, g, b);
  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function rgbToOklch(rgb) { return srgbToOklch(rgb[0], rgb[1], rgb[2]); }

/* ---------------- 色域映射（保 L 与 h，压缩 C） ---------------- */

const EPS = 1e-4;
function inGamut(L, C, h) {
  const [r, g, b] = oklchToSrgb01(L, C, h);
  return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

export function gamutMap(L, C, h) {
  L = clamp(L, 0, 1);
  if (C <= 0) return { L, C: 0, h };
  if (inGamut(L, C, h)) return { L, C, h };
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, h)) lo = mid; else hi = mid;
  }
  return { L, C: lo, h };
}

/* ---------------- 色调(tone) ⇄ OKLab L ---------------- */
/* 对中性色而言 tone(L*) 与 OKLab L 存在精确解析关系 */
export const toneToL = (t) => {
  const tone = clamp(t, 0, 100);
  return tone >= 8 ? (tone + 16) / 116 : Math.cbrt(tone / 903.3);
};
export const lToTone = (L) => {
  const l = clamp(L, 0, 1);
  return l >= 0.2069 ? l * 116 - 16 : l * l * l * 903.3;
};

/* ---------------- 关键色 & 色调调色板 ---------------- */

export function keyColor(rgb, { minChroma = 0.085, maxChroma = 0.21, boost = 1.35 } = {}) {
  const { L, C, h } = rgbToOklch(rgb);
  return { h, C: clamp(C * boost + 0.02, minChroma, maxChroma), L };
}

/** 生成某个关键色在指定 tone 下的 sRGB 颜色 */
export function toneColor(key, tone) {
  const rgb = oklchToRgb(toneToL(tone), key.C, key.h);
  return rgb.map((v) => Math.round(v));
}

export function toneHex(key, tone) { return rgbToHex(toneColor(key, tone)); }

/* ---------------- 方案构建 ---------------- */

export function buildScheme(seedRgb) {
  const seed = rgbToOklch(seedRgb);
  const C = seed.C;
  const h = seed.h;

  const primaryC = clamp(C * 1.35 + 0.022, 0.085, 0.2);
  return {
    seed: { hex: rgbToHex(seedRgb), ...seed },
    primary: { h, C: primaryC },
    secondary: { h, C: clamp(primaryC * 0.36, 0.028, 0.09) },
    tertiary: { h: (h + 58) % 360, C: clamp(primaryC * 0.62, 0.05, 0.145) },
    neutral: { h, C: Math.min(primaryC * 0.12, 0.022) },
    neutralVariant: { h, C: Math.min(primaryC * 0.24, 0.048) },
    error: { h: 27, C: 0.155 },
  };
}

const TONES = [0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100];

const ROLE_TONES = {
  light: {
    primary: [40, 100, 90, 10],
    secondary: [40, 100, 90, 10],
    tertiary: [40, 100, 90, 10],
    error: [40, 100, 90, 10],
    surface: [98, 10, 90, 30, 50, 80],
    container: [100, 96, 94, 92, 90],
    dimBright: [87, 98],
    inverse: [20, 95, 40],
  },
  dark: {
    primary: [80, 20, 30, 90],
    secondary: [80, 20, 30, 90],
    tertiary: [80, 20, 30, 90],
    error: [80, 20, 30, 90],
    surface: [6, 90, 30, 80, 60, 30],
    container: [4, 10, 12, 17, 22],
    dimBright: [6, 24],
    inverse: [90, 20, 80],
  },
};

export function buildRoles(scheme, mode = "dark") {
  const t = ROLE_TONES[mode];
  const P = (k, tone) => toneHex(k, tone);
  const [p, op, pc, opc] = t.primary.map((x) => P(scheme.primary, x));
  const [s, os, sc, osc] = t.secondary.map((x) => P(scheme.secondary, x));
  const [tr, otr, trc, otrc] = t.tertiary.map((x) => P(scheme.tertiary, x));
  const [e, oe, ec, oec] = t.error.map((x) => P(scheme.error, x));
  const N = scheme.neutral;
  const NV = scheme.neutralVariant;
  const surface = P(N, t.surface[0]);
  const onSurface = P(N, t.surface[1]);
  const surfaceVariant = P(NV, t.surface[2]);
  const onSurfaceVariant = P(NV, t.surface[3]);
  const outline = P(NV, t.surface[4]);
  const outlineVariant = P(NV, t.surface[5]);
  const [lowest, low, container, high, highest] = t.container.map((x) => P(N, x));
  const [dim, bright] = t.dimBright.map((x) => P(N, x));
  const invSurface = P(N, t.inverse[0]);
  const invOnSurface = P(N, t.inverse[1]);
  const invPrimary = P(scheme.primary, t.inverse[2]);

  return {
    primary: p,
    onPrimary: op,
    primaryContainer: pc,
    onPrimaryContainer: opc,
    secondary: s,
    onSecondary: os,
    secondaryContainer: sc,
    onSecondaryContainer: osc,
    tertiary: tr,
    onTertiary: otr,
    tertiaryContainer: trc,
    onTertiaryContainer: otrc,
    error: e,
    onError: oe,
    errorContainer: ec,
    onErrorContainer: oec,
    background: surface,
    onBackground: onSurface,
    surface,
    onSurface,
    surfaceVariant,
    onSurfaceVariant,
    surfaceDim: dim,
    surfaceBright: bright,
    surfaceContainerLowest: lowest,
    surfaceContainerLow: low,
    surfaceContainer: container,
    surfaceContainerHigh: high,
    surfaceContainerHighest: highest,
    outline,
    outlineVariant,
    inverseSurface: invSurface,
    inverseOnSurface: invOnSurface,
    inversePrimary: invPrimary,
    shadow: "#000000",
    scrim: "#000000",
    surfaceTint: p,
  };
}

const CSS_NAME = {
  primary: "primary",
  onPrimary: "on-primary",
  primaryContainer: "primary-container",
  onPrimaryContainer: "on-primary-container",
  secondary: "secondary",
  onSecondary: "on-secondary",
  secondaryContainer: "secondary-container",
  onSecondaryContainer: "on-secondary-container",
  tertiary: "tertiary",
  onTertiary: "on-tertiary",
  tertiaryContainer: "tertiary-container",
  onTertiaryContainer: "on-tertiary-container",
  error: "error",
  onError: "on-error",
  errorContainer: "error-container",
  onErrorContainer: "on-error-container",
  background: "background",
  onBackground: "on-background",
  surface: "surface",
  onSurface: "on-surface",
  surfaceVariant: "surface-variant",
  onSurfaceVariant: "on-surface-variant",
  surfaceDim: "surface-dim",
  surfaceBright: "surface-bright",
  surfaceContainerLowest: "surface-container-lowest",
  surfaceContainerLow: "surface-container-low",
  surfaceContainer: "surface-container",
  surfaceContainerHigh: "surface-container-high",
  surfaceContainerHighest: "surface-container-highest",
  outline: "outline",
  outlineVariant: "outline-variant",
  inverseSurface: "inverse-surface",
  inverseOnSurface: "inverse-on-surface",
  inversePrimary: "inverse-primary",
  surfaceTint: "surface-tint",
};

export function applyRoles(roles, mode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  for (const [key, name] of Object.entries(CSS_NAME)) {
    root.style.setProperty(`--md-sys-color-${name}`, roles[key]);
  }
  root.style.setProperty("--brand-raw", roles.primary);
}

/* ---------------- 对比度 ---------------- */

export function relLuminance([r, g, b]) {
  const f = (v) => srgbToLinear(v / 255);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(rgbA, rgbB) {
  const a = relLuminance(rgbA);
  const b = relLuminance(rgbB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export function pickOnColor(bgRgb, candidates) {
  let best = candidates[0];
  let bestC = -1;
  for (const c of candidates) {
    const cr = contrastRatio(bgRgb, hexToRgb(c));
    if (cr > bestC) { bestC = cr; best = c; }
  }
  return best;
}

/* ---------------- 从媒体提取种子色 ---------------- */

/**
 * 单次扫描统计：
 *  - dominant：出现频率 + 彩度加权的优势色
 *  - vivid：高彩度优势色
 *  - mean：全体平均色
 *  - luma：平均亮度 / 亮度标准差
 */
export function analyzeImageColors(imageData, maxSamples = 120000) {
  const { data, width, height } = imageData;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / maxSamples));

  const BINS = 32768; // 5 bit / channel
  const cntD = new Float32Array(BINS);
  const cntV = new Float32Array(BINS);
  const cntA = new Float32Array(BINS);
  const cntN = new Uint32Array(BINS);

  let sr = 0, sg = 0, sb = 0, sn = 0;
  let sl = 0, sl2 = 0;

  for (let i = 0, p = 0; i < total; i += step, p += step * 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const chroma = (mx - mn) / 255;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const window = clamp(1.05 - Math.abs(luma - 0.5) * 1.35, 0.14, 1);
    cntD[key] += (0.28 + chroma * 1.6) * window;
    cntV[key] += (chroma * chroma + 0.02) * window;
    // 强调色：彩度三次方 × √数量 —— 小面积的高彩度前景（签名/文字/点缀）能胜过大面积低彩度背景
    const c3 = chroma * chroma * chroma;
    cntA[key] += c3 * window;
    cntN[key]++;
    sr += r; sg += g; sb += b; sn++;
    sl += luma; sl2 += luma * luma;
  }

  const peakOf = (arr) => {
    let best = -1, bi = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > best) { best = arr[i]; bi = i; }
    return bi;
  };
  const peakD = peakOf(cntD);
  const peakV = peakOf(cntV);

  // 强调色：score = Σ(chroma³·w) / √count
  let peakA = -1;
  let bestA = -1;
  for (let i = 0; i < BINS; i++) {
    if (cntN[i] < 12) continue;
    const s = cntA[i] / Math.sqrt(cntN[i]);
    if (s > bestA) { bestA = s; peakA = i; }
  }
  if (peakA < 0) peakA = peakV;

  const refine = (peak, radius = 2) => {
    const pr = (peak >> 10) & 31, pg = (peak >> 5) & 31, pb = peak & 31;
    let ar = 0, ag = 0, ab = 0, aw = 0;
    for (let i = 0, p = 0; i < total; i += step, p += step * 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const r5 = r >> 3, g5 = g >> 3, b5 = b >> 3;
      if (Math.abs(r5 - pr) > radius || Math.abs(g5 - pg) > radius || Math.abs(b5 - pb) > radius) continue;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const w = clamp(1.05 - Math.abs(luma - 0.5) * 1.35, 0.14, 1);
      ar += r * w; ag += g * w; ab += b * w; aw += w;
    }
    if (aw <= 0) return [pr * 8 + 4, pg * 8 + 4, pb * 8 + 4];
    return [ar / aw, ag / aw, ab / aw];
  };

  const mean = [sr / sn, sg / sn, sb / sn];
  const meanLuma = sl / sn;
  const lumaStd = Math.sqrt(Math.max(0, sl2 / sn - meanLuma * meanLuma));

  return {
    accent: refine(peakA, 1).map(Math.round),
    dominant: refine(peakD).map(Math.round),
    vivid: refine(peakV).map(Math.round),
    mean: mean.map(Math.round),
    meanLuma,
    lumaStd,
    samples: sn,
  };
}

/** 生成用于展示的色调阶梯 */
export function toneStrip(key) {
  return TONES.map((t) => ({ tone: t, hex: toneHex(key, t) }));
}

export const PALETTE_TONES = TONES;
