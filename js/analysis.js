/* ============================================================
   InfoLen · 信息密度分析
   指标：局部熵 · 对比度(std) · 梯度能量(Sobel) · 高频能量(Laplacian)

   拆分为两阶段以获得性能：
     prepare()         —— 缩放 + 灰度 + 梯度/高频 + 积分图（昂贵，可缓存复用）
     computeDensity()  —— 按网格统计（便宜，可换不同网格尺寸反复调用）
   ============================================================ */

import { clamp } from "./util.js";

/* ---------------- 排序缓冲（避免每次分配） ---------------- */
let scratch = new Float32Array(0);
function ensureScratch(n) {
  if (scratch.length < n) scratch = new Float32Array(n);
  return scratch;
}
function percentileOf(arr, p) {
  const n = arr.length;
  if (!n) return 0;
  const buf = ensureScratch(n).subarray(0, n);
  buf.set(arr);
  buf.sort();
  return buf[clamp(Math.floor(n * p), 0, n - 1)];
}

function buildIntegral(src, w, h) {
  const I = new Float32Array((w + 1) * (h + 1));
  const stride = w + 1;
  for (let y = 0; y < h; y++) {
    const row = (y + 1) * stride;
    const prev = y * stride;
    let sum = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      sum += src[base + x];
      I[row + x + 1] = I[prev + x + 1] + sum;
    }
  }
  return I;
}

function boxSum(I, stride, x0, y0, x1, y1) {
  const a = I[y1 * stride + x1];
  const b = I[y0 * stride + x1];
  const c = I[y1 * stride + x0];
  const d = I[y0 * stride + x0];
  return a - b - c + d;
}

function normalize(arr, mode, lo2 = 0.02, hi2 = 0.98) {
  let lo;
  let hi;
  if (mode === "minmax") {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  } else {
    lo = percentileOf(arr, lo2);
    hi = percentileOf(arr, hi2);
  }
  const span = hi - lo;
  if (!(span > 1e-9)) {
    arr.fill(0);
    return;
  }
  const inv = 1 / span;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = clamp((arr[i] - lo) * inv, 0, 1);
  }
}

/* ---------------- 阶段一：预处理 ---------------- */

export function prepare(source, maxDim = 512) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const aw = Math.max(8, Math.round(sw * scale));
  const ah = Math.max(8, Math.round(sh * scale));

  const c = document.createElement("canvas");
  c.width = aw;
  c.height = ah;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(source, 0, 0, aw, ah);
  const data = ctx.getImageData(0, 0, aw, ah).data;
  const n = aw * ah;

  const gray = new Float32Array(n);
  const skin = new Uint8Array(n);
  const histL = new Uint32Array(256);
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  let sum = 0;
  let sumSq = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const v = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    gray[i] = v;
    sum += v;
    sumSq += v * v;
    sr += r;
    sg += g;
    sb += b;
    // 肤色启发式（真实人脸 / 动漫人脸的皮肤都偏暖且 r>g>b）
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    skin[i] =
      r > 95 && g > 40 && b > 20 && mx - mn > 15 && (r - g > 14 || g - b > 12) && r > g && r >= b
        ? 1
        : 0;
    let li = (v * 255 + 0.5) | 0;
    if (li > 255) li = 255;
    histL[li]++;
    histR[r]++;
    histG[g]++;
    histB[b]++;
  }

  const meanLuma = sum / n;
  const lumaStd = Math.sqrt(Math.max(0, sumSq / n - meanLuma * meanLuma));
  const meanRgb = [sr / n, sg / n, sb / n];
  let globalEntropy = 0;
  for (let k = 0; k < 256; k++) {
    if (!histL[k]) continue;
    const pr = histL[k] / n;
    globalEntropy -= pr * Math.log2(pr);
  }
  globalEntropy /= 8;

  /* 梯度 + 高频（单次扫描） */
  const grad = new Float32Array(n);
  const hf = new Float32Array(n);
  for (let y = 1; y < ah - 1; y++) {
    const row = y * aw;
    const up = row - aw;
    const dn = row + aw;
    for (let x = 1; x < aw - 1; x++) {
      const i = row + x;
      const gx =
        (gray[up + x + 1] - gray[up + x - 1]) +
        2 * (gray[i + 1] - gray[i - 1]) +
        (gray[dn + x + 1] - gray[dn + x - 1]);
      const gy =
        (gray[dn + x - 1] - gray[up + x - 1]) +
        2 * (gray[dn + x] - gray[up + x]) +
        (gray[dn + x + 1] - gray[up + x + 1]);
      grad[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 4);
      const lap = 4 * gray[i] - (gray[i - 1] + gray[i + 1] + gray[up + x] + gray[dn + x]);
      const av = lap < 0 ? -lap : lap;
      hf[i] = av > 0.4545 ? 1 : av * 2.2;
    }
  }

  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = gray[i] * gray[i];

  return {
    aw,
    ah,
    scale,
    gray,
    grad,
    hf,
    rgb: data,
    skin,
    meanRgb,
    stride: aw + 1,
    I1: buildIntegral(gray, aw, ah),
    I2: buildIntegral(sq, aw, ah),
    Ig: buildIntegral(grad, aw, ah),
    Ih: buildIntegral(hf, aw, ah),
    histogram: { l: histL, r: histR, g: histG, b: histB },
    stats: { meanLuma, lumaStd, globalEntropy, pixels: n },
  };
}

/* ---------------- 阶段二：网格密度 ---------------- */

export function computeDensity(prep, params = {}) {
  const {
    gridSize = 96,
    radius = 1,
    weights = { entropy: 0.35, contrast: 0.25, gradient: 0.25, hf: 0.15 },
    norm = "percentile",
    gamma = 1,
    borderFade = 2.5,
  } = params;

  const { aw, ah, stride, I1, I2, Ig, Ih, gray } = prep;

  const gw = Math.max(4, Math.round(gridSize));
  const gh = Math.max(4, Math.round((gridSize * ah) / aw));
  const cells = gw * gh;
  const mStd = new Float32Array(cells);
  const mEnt = new Float32Array(cells);
  const mGrad = new Float32Array(cells);
  const mHf = new Float32Array(cells);
  const mLuma = new Float32Array(cells);

  const hist = new Int32Array(16);
  const cellH = ah / gh;
  const cellW = aw / gw;
  const padY = Math.max(0, Math.round(cellH * radius));
  const padX = Math.max(0, Math.round(cellW * radius));

  for (let gy = 0; gy < gh; gy++) {
    const cy0 = Math.floor(gy * cellH);
    const cy1 = Math.max(cy0 + 1, Math.floor((gy + 1) * cellH));
    const y0 = clamp(cy0 - padY, 0, ah - 1);
    const y1 = clamp(cy1 + padY, 1, ah);
    for (let gx = 0; gx < gw; gx++) {
      const cx0 = Math.floor(gx * cellW);
      const cx1 = Math.max(cx0 + 1, Math.floor((gx + 1) * cellW));
      const x0 = clamp(cx0 - padX, 0, aw - 1);
      const x1 = clamp(cx1 + padX, 1, aw);
      const area = (x1 - x0) * (y1 - y0);
      const idx = gy * gw + gx;

      const mean = boxSum(I1, stride, x0, y0, x1, y1) / area;
      const meanSq = boxSum(I2, stride, x0, y0, x1, y1) / area;
      const variance = Math.max(0, meanSq - mean * mean);
      mStd[idx] = Math.sqrt(variance);
      mGrad[idx] = boxSum(Ig, stride, x0, y0, x1, y1) / area;
      mHf[idx] = boxSum(Ih, stride, x0, y0, x1, y1) / area;
      mLuma[idx] = mean;

      // 局部熵：16 级抽样直方图（最多 14×14 个采样点）
      hist.fill(0);
      const bw = x1 - x0;
      const bh = y1 - y0;
      const stepX = Math.max(1, Math.ceil(bw / 14));
      const stepY = Math.max(1, Math.ceil(bh / 14));
      let count = 0;
      for (let y = y0; y < y1; y += stepY) {
        const row = y * aw;
        for (let x = x0; x < x1; x += stepX) {
          hist[(gray[row + x] * 15.999) | 0]++;
          count++;
        }
      }
      let e = 0;
      if (count > 0) {
        const inv = 1 / count;
        for (let k = 0; k < 16; k++) {
          if (!hist[k]) continue;
          const p = hist[k] * inv;
          e -= p * Math.log2(p);
        }
        e *= 0.25; // /log2(16)
      }
      mEnt[idx] = e;
    }
  }

  normalize(mStd, norm);
  normalize(mEnt, norm);
  normalize(mGrad, norm);
  normalize(mHf, norm);

  const we = weights.entropy ?? 0.35;
  const wc = weights.contrast ?? 0.25;
  const wg = weights.gradient ?? 0.25;
  const wh = weights.hf ?? 0.15;
  const wsum = we + wc + wg + wh || 1;
  const density = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    let d = (we * mEnt[i] + wc * mStd[i] + wg * mGrad[i] + wh * mHf[i]) / wsum;
    if (gamma !== 1) d = Math.pow(clamp(d, 0, 1), gamma);
    density[i] = clamp(d, 0, 1);
  }

  /* 边缘衰减：画面边框带来的强梯度观众根本不会注意，向内平滑淡出 */
  const fade = Math.max(0, borderFade);
  if (fade > 0) {
    for (let gy = 0; gy < gh; gy++) {
      const wy = Math.min(gy + 0.5, gh - gy - 0.5) / fade;
      for (let gx = 0; gx < gw; gx++) {
        const wx = Math.min(gx + 0.5, gw - gx - 0.5) / fade;
        const t = clamp(Math.min(wx, wy), 0, 1);
        if (t >= 1) continue;
        const w = t * t * (3 - 2 * t);
        density[gy * gw + gx] *= w;
      }
    }
  }

  /* 剖面 */
  const rowProfile = new Float32Array(gh);
  const colProfile = new Float32Array(gw);
  for (let gy = 0; gy < gh; gy++) {
    let s = 0;
    const row = gy * gw;
    for (let gx = 0; gx < gw; gx++) s += density[row + gx];
    rowProfile[gy] = s / gw;
  }
  for (let gx = 0; gx < gw; gx++) {
    let s = 0;
    for (let gy = 0; gy < gh; gy++) s += density[gy * gw + gx];
    colProfile[gx] = s / gh;
  }

  /* 统计 */
  let peakIdx = 0;
  let peakVal = -1;
  let sum = 0;
  for (let i = 0; i < cells; i++) {
    sum += density[i];
    if (density[i] > peakVal) { peakVal = density[i]; peakIdx = i; }
  }
  const peakGx = peakIdx % gw;
  const peakGy = (peakIdx / gw) | 0;

  return {
    gw,
    gh,
    maps: { entropy: mEnt, contrast: mStd, gradient: mGrad, hf: mHf },
    luma: mLuma,
    density,
    rowProfile,
    colProfile,
    stats: {
      meanDensity: sum / cells,
      maxDensity: peakVal,
      p50: percentileOf(density, 0.5),
      p95: percentileOf(density, 0.95),
      peak: { x: (peakGx + 0.5) / gw, y: (peakGy + 0.5) / gh, gx: peakGx, gy: peakGy },
      cells,
    },
    params: { gridSize: gw, radius, weights: { ...weights }, norm, gamma, borderFade },
  };
}

/** 便捷入口：一次性完成预处理 + 网格统计 */
export function analyze(source, params = {}) {
  const maxDim = params.maxDim ?? 512;
  const prep = prepare(source, maxDim);
  const d = computeDensity(prep, params);
  return {
    ...d,
    aw: prep.aw,
    ah: prep.ah,
    scale: prep.scale,
    gray: prep.gray,
    grad: prep.grad,
    hf: prep.hf,
    histogram: prep.histogram,
    stats: { ...d.stats, ...prep.stats },
    prep,
  };
}
