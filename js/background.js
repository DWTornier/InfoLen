/* ============================================================
   InfoLen · 磨砂亚克力背景
   媒体 → 单色化 → 主色渐变映射明暗 → 高斯模糊
   模糊在极小画布上用「三次盒式滤波」完成（近似高斯），
   避免让浏览器对全屏元素做 70+ px 的高斯模糊（性能杀手）。
   ============================================================ */

import { toneColor, analyzeImageColors, rgbToHex } from "./color.js";
import { clamp, smoothstep } from "./util.js";

function buildRamp(key, mode) {
  const lut = new Uint8Array(256 * 3);
  const lo = mode === "light" ? 52 : 4;
  const hi = mode === "light" ? 97 : 66;
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    const curved = clamp((u - 0.5) * 1.28 + 0.5, 0, 1);
    const tone = lo + smoothstep(curved) * (hi - lo);
    const rgb = toneColor(key, tone);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return lut;
}

/** 单色化 + 主色渐变映射 */
function monochrome(sourceCanvas, key, mode, targetW = 128) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const w = Math.max(16, targetW);
  const h = Math.max(16, Math.round((targetW * sh) / sw));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lut = buildRamp(key, mode);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const luma = clamp((0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) | 0, 0, 255);
    const o = luma * 3;
    d[p] = lut[o];
    d[p + 1] = lut[o + 1];
    d[p + 2] = lut[o + 2];
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------------- 快速盒式模糊（3 次 ≈ 高斯） ---------------- */

function blurAxis(src, dst, w, h, r, horizontal) {
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const win = 2 * r + 1;
  const winInv = 1 / win;
  for (let o = 0; o < outer; o++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const idx = k < 0 ? 0 : k > inner - 1 ? inner - 1 : k;
        sum += src[(horizontal ? o * inner + idx : idx * inner + o) * 3 + c];
      }
      for (let i = 0; i < inner; i++) {
        const outIdx = horizontal ? o * inner + i : i * inner + o;
        dst[outIdx * 3 + c] = sum * winInv;
        let a = i + r + 1;
        let b = i - r;
        if (a > inner - 1) a = inner - 1;
        if (b < 0) b = 0;
        const addIdx = horizontal ? o * inner + a : a * inner + o;
        const remIdx = horizontal ? o * inner + b : b * inner + o;
        sum += src[addIdx * 3 + c] - src[remIdx * 3 + c];
      }
    }
  }
}

function boxBlur(canvas, radius = 8, passes = 3) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  let a = new Float32Array(n * 3);
  let b = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    a[i * 3] = d[p];
    a[i * 3 + 1] = d[p + 1];
    a[i * 3 + 2] = d[p + 2];
  }
  for (let k = 0; k < passes; k++) {
    blurAxis(a, b, w, h, radius, true);
    blurAxis(b, a, w, h, radius, false);
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    d[p] = a[i * 3];
    d[p + 1] = a[i * 3 + 1];
    d[p + 2] = a[i * 3 + 2];
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  a = null;
  b = null;
}

/* ---------------- 对外接口 ---------------- */

export function renderAcrylic(sourceCanvas, scheme, mode) {
  const root = document.getElementById("acrylic");
  const base = document.getElementById("acrylicBase");
  const accent = document.getElementById("acrylicAccent");
  if (!root || !base || !accent) return;

  const mono = monochrome(sourceCanvas, scheme.primary, mode, 128);
  boxBlur(mono, 10, 3);
  base.width = mono.width;
  base.height = mono.height;
  base.getContext("2d").drawImage(mono, 0, 0);

  const monoAlt = monochrome(sourceCanvas, scheme.tertiary, mode, 72);
  boxBlur(monoAlt, 7, 3);
  accent.width = monoAlt.width;
  accent.height = monoAlt.height;
  accent.getContext("2d").drawImage(monoAlt, 0, 0);

  root.classList.add("is-ready");
}

export function clearAcrylic() {
  const root = document.getElementById("acrylic");
  if (root) root.classList.remove("is-ready");
}

/** 读取媒体色彩统计（用于自动明暗 / 取色策略） */
export function mediaColorStats(sourceCanvas, maxDim = 220) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * scale));
  const h = Math.max(8, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const stats = analyzeImageColors(ctx.getImageData(0, 0, w, h));
  return {
    accent: stats.accent,
    dominant: stats.dominant,
    vivid: stats.vivid,
    mean: stats.mean,
    meanLuma: stats.meanLuma,
    lumaStd: stats.lumaStd,
    accentHex: rgbToHex(stats.accent),
    dominantHex: rgbToHex(stats.dominant),
    vividHex: rgbToHex(stats.vivid),
    meanHex: rgbToHex(stats.mean),
  };
}
