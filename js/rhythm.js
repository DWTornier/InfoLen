/* ============================================================
   InfoLen · 构图节奏分析
   识别高密度区域 → 判断是否「错开 / 大小不一 / 距离不定」且遵循二八定律 → 打分
   区域标注采用凸包多边形；并按视觉显著性（信息密度 / 色彩可见性 /
   局部对比 / 面积 / 位置）排序，给出可能的「视觉引导路径」。

   整体（粗网格，默认 12 列）：决定画面整体节奏感
   局部（细网格，默认 65 列）：主体区域内的高/低密度面积占比
   ============================================================ */

import { clamp } from "./util.js";
import { srgbToOklab, rgbToOklch } from "./color.js";
import { computeDensity } from "./analysis.js";

/* ---------------- 通用小工具 ---------------- */

/** 峰值型打分：越接近 ideal 越高，tol 为衰减尺度 */
export function peakScore(v, ideal, tol) {
  const d = (v - ideal) / tol;
  return clamp(1 / (1 + d * d), 0, 1);
}

/** 基尼系数（0=完全均等，1=极端集中） */
function gini(values) {
  const n = values.length;
  if (n < 2) return 0;
  const arr = Float32Array.from(values).sort();
  let sum = 0;
  let cum = 0;
  for (let i = 0; i < n; i++) sum += arr[i];
  if (sum <= 0) return 0;
  for (let i = 0; i < n; i++) cum += arr[i] * (i + 1);
  return clamp((2 * cum) / (n * sum) - (n + 1) / n, 0, 1);
}

/**
 * 二八系数：前 20% 的元素承担了多少份额，理想 0.8
 * （等价于「约两成元素占据八成总量」，样本量小的时候也连续可测）
 */
function paretoShare(values) {
  const n = values.length;
  if (!n) return 0;
  const arr = Float32Array.from(values).sort().reverse();
  let total = 0;
  for (let i = 0; i < n; i++) total += arr[i];
  if (total <= 0) return 0;
  const k = Math.max(1, Math.round(n * 0.2));
  let top = 0;
  for (let i = 0; i < k; i++) top += arr[i];
  return top / total;
}

/**
 * 二八打分：以「完全均匀」为 0、「前 20% 占 80%」为 1
 * 小样本（如只有 3 个距离）时不会被理论极值过度惩罚
 */
function paretoScore(share, n) {
  if (n < 2) return 0;
  const k = Math.max(1, Math.round(n * 0.2));
  const uniform = k / n;
  const ideal = 0.8;
  if (ideal - uniform <= 1e-6) return clamp(share, 0, 1);
  return Math.sqrt(clamp((share - uniform) / (ideal - uniform), 0, 1));
}

/** 变异系数 */
function cv(values) {
  const n = values.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;
  if (Math.abs(mean) < 1e-9) return 0;
  let v = 0;
  for (let i = 0; i < n; i++) v += (values[i] - mean) ** 2;
  return Math.sqrt(v / n) / mean;
}

/** Otsu 自适应阈值（归一化 0..1 数据） */
export function otsuThreshold(values, bins = 64) {
  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = clamp(values[i], 0, 0.99999);
    hist[(v * bins) | 0]++;
    total++;
  }
  if (!total) return 0.5;
  let sumAll = 0;
  for (let k = 0; k < bins; k++) sumAll += k * hist[k];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let thr = 0.5;
  for (let k = 0; k < bins; k++) {
    wB += hist[k];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += k * hist[k];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = (k + 1) / bins; }
  }
  return clamp(thr, 0.12, 0.88);
}

/* ---------------- 凸包（Andrew monotone chain） ---------------- */

export function convexHull(points) {
  const n = points.length;
  if (n < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function bboxPolygon(region, gw, gh, padX, padY) {
  const px = padX / gw;
  const py = padY / gh;
  return [
    [region.x0 - px, region.y0 - py],
    [region.x1 + px, region.y0 - py],
    [region.x1 + px, region.y1 + py],
    [region.x0 - px, region.y1 + py],
  ];
}

/** 由区域单元生成凸包多边形（归一化坐标，并向外扩张半格以包住单元） */
export function regionHull(region, gw, gh, pad = 0.46) {
  const pts = [];
  for (let i = 0; i < region.cells.length; i++) {
    const idx = region.cells[i];
    const gx = idx % gw;
    const gy = (idx / gw) | 0;
    pts.push([(gx + 0.5) / gw, (gy + 0.5) / gh]);
  }
  let hull = convexHull(pts);
  if (hull.length < 3) return bboxPolygon(region, gw, gh, pad, pad);
  const ex = pad / gw;
  const ey = pad / gh;
  const cx = region.cx;
  const cy = region.cy;
  hull = hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx / ex, dy / ey) || 1;
    return [x + (dx / len) * ex, y + (dy / len) * ey];
  });
  return hull;
}

/** 多区域合并后的凸包（用于「主体」） */
function mergedHull(regions, gw, gh, pad = 1.1) {
  const pts = [];
  for (const r of regions) {
    for (let i = 0; i < r.cells.length; i++) {
      const idx = r.cells[i];
      const gx = idx % gw;
      const gy = (idx / gw) | 0;
      pts.push([(gx + 0.5) / gw, (gy + 0.5) / gh]);
    }
  }
  if (pts.length < 3) {
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const r of regions) {
      x0 = Math.min(x0, r.x0);
      y0 = Math.min(y0, r.y0);
      x1 = Math.max(x1, r.x1);
      y1 = Math.max(y1, r.y1);
    }
    return bboxPolygon({ x0, y0, x1, y1 }, gw, gh, pad, pad);
  }
  const hull = convexHull(pts);
  let cx = 0;
  let cy = 0;
  for (const p of hull) { cx += p[0]; cy += p[1]; }
  cx /= hull.length;
  cy /= hull.length;
  const ex = pad / gw;
  const ey = pad / gh;
  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx / ex, dy / ey) || 1;
    return [x + (dx / len) * ex, y + (dy / len) * ey];
  });
}

function hullBounds(poly) {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: clamp(x0, 0, 1), y: clamp(y0, 0, 1), w: clamp(x1 - x0, 0, 1), h: clamp(y1 - y0, 0, 1) };
}

/* ---------------- 连通域（高密度区域） ---------------- */

export function extractRegions(density, gw, gh, threshold, rect = null, minAreaFrac = 0.0015) {
  const cells = gw * gh;
  const mask = new Uint8Array(cells);
  let highCells = 0;
  for (let i = 0; i < cells; i++) {
    if (density[i] >= threshold) { mask[i] = 1; highCells++; }
  }

  const visited = new Uint8Array(cells);
  const stack = new Int32Array(cells);
  const raw = [];
  const minArea = Math.max(1, Math.round(cells * minAreaFrac));

  const inRect = rect
    ? (gx, gy) => {
      const cx = (gx + 0.5) / gw;
      const cy = (gy + 0.5) / gh;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    }
    : null;

  for (let s = 0; s < cells; s++) {
    if (!mask[s] || visited[s]) continue;
    let top = 0;
    stack[top++] = s;
    visited[s] = 1;
    const list = [];
    let sum = 0;
    let sx = 0;
    let sy = 0;
    let max = 0;
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1;
    let y1 = -1;
    while (top > 0) {
      const idx = stack[--top];
      const gx = idx % gw;
      const gy = (idx / gw) | 0;
      const v = density[idx];
      list.push(idx);
      sum += v;
      sx += gx * v;
      sy += gy * v;
      if (v > max) max = v;
      if (gx < x0) x0 = gx;
      if (gx > x1) x1 = gx;
      if (gy < y0) y0 = gy;
      if (gy > y1) y1 = gy;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = gy + dy;
        if (ny < 0 || ny >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = gx + dx;
          if (nx < 0 || nx >= gw) continue;
          const ni = ny * gw + nx;
          if (!mask[ni] || visited[ni]) continue;
          if (inRect && !inRect(nx, ny)) continue;
          visited[ni] = 1;
          stack[top++] = ni;
        }
      }
    }
    const count = list.length;
    if (count < minArea) continue;
    const wsum = sum || 1;
    raw.push({
      area: count,
      mass: sum,
      mean: sum / count,
      max,
      cells: Int32Array.from(list),
      cx: (sx / wsum + 0.5) / gw,
      cy: (sy / wsum + 0.5) / gh,
      x0: (x0 + 0.5) / gw,
      y0: (y0 + 0.5) / gh,
      x1: (x1 + 0.5) / gw,
      y1: (y1 + 0.5) / gh,
      w: (x1 - x0 + 1) / gw,
      h: (y1 - y0 + 1) / gh,
    });
  }

  raw.sort((a, b) => b.mass - a.mass);
  raw.forEach((r, i) => { r.id = i; r.hull = regionHull(r, gw, gh); });
  return { regions: raw, highCells, cells, threshold };
}

/* ---------------- 区域外观（色彩 + 肤色占比） ---------------- */

function regionAppearance(prep, region, gw, gh) {
  const { aw, ah, rgb, skin } = prep;
  if (!rgb) return { rgb: [128, 128, 128], C: 0, ok: { L: 0.5, a: 0, b: 0 }, skinFrac: 0 };
  const cw = aw / gw;
  const ch = ah / gh;
  let r = 0;
  let g = 0;
  let b = 0;
  let sk = 0;
  const step = Math.max(1, Math.floor(region.cells.length / 400));
  let n = 0;
  for (let i = 0; i < region.cells.length; i += step) {
    const idx = region.cells[i];
    const gx = idx % gw;
    const gy = (idx / gw) | 0;
    const px = Math.min(aw - 1, Math.floor((gx + 0.5) * cw));
    const py = Math.min(ah - 1, Math.floor((gy + 0.5) * ch));
    const o = py * aw + px;
    r += rgb[o * 4];
    g += rgb[o * 4 + 1];
    b += rgb[o * 4 + 2];
    sk += skin ? skin[o] : 0;
    n++;
  }
  if (!n) return { rgb: [128, 128, 128], C: 0, ok: { L: 0.5, a: 0, b: 0 }, skinFrac: 0 };
  const mean = [r / n, g / n, b / n];
  const oklch = rgbToOklch(mean);
  return {
    rgb: mean,
    C: oklch.C,
    h: oklch.h,
    ok: srgbToOklab(mean[0], mean[1], mean[2]),
    skinFrac: sk / n,
  };
}

/* ---------------- 视觉显著性排序 ---------------- */

const POWER_POINTS = [[0.5, 0.5], [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];

/**
 * 综合「信息密度 / 色彩可见性 / 局部对比 / 面积 / 位置」估计被注意到的先后
 */
function computeSalience(regions, prep, grid, aspect, faceOverrides = {}) {
  const { gw, gh, density, maps } = grid;
  const contrastMap = maps?.contrast;
  let gridMean = 0;
  let gridMax = 0;
  for (let i = 0; i < density.length; i++) {
    gridMean += density[i];
    if (density[i] > gridMax) gridMax = density[i];
  }
  gridMean /= Math.max(1, density.length);
  const span = Math.max(1e-6, gridMax - gridMean);
  const imgOk = prep.meanRgb ? srgbToOklab(prep.meanRgb[0], prep.meanRgb[1], prep.meanRgb[2]) : { L: 0.5, a: 0, b: 0 };
  const maxArea = Math.max(1, ...regions.map((r) => r.area));
  const diag = Math.sqrt(aspect * aspect + 1);

  for (const r of regions) {
    const col = regionAppearance(prep, r, gw, gh);
    r.colorRgb = col.rgb;
    r.skinFrac = col.skinFrac;

    // 1. 信息密度
    const densityScore = clamp(r.mean / (gridMax + 1e-6), 0, 1);

    // 2. 色彩可见性：与画面平均色的 OKLab 距离 + 自身彩度
    const dE = Math.sqrt((col.ok.L - imgOk.L) ** 2 + (col.ok.a - imgOk.a) ** 2 + (col.ok.b - imgOk.b) ** 2);
    const colorScore = clamp(0.68 * clamp(dE / 0.26, 0, 1) + 0.32 * clamp(col.C / 0.15, 0, 1), 0, 1);

    // 3. 局部对比：区域内对比度均值 + 相对全局的突出程度
    let mc = 0.5;
    if (contrastMap) {
      let s = 0;
      const step = Math.max(1, Math.floor(r.cells.length / 400));
      let n = 0;
      for (let i = 0; i < r.cells.length; i += step) { s += contrastMap[r.cells[i]]; n++; }
      mc = n ? s / n : 0.5;
    }
    const prominence = clamp((r.mean - gridMean) / span, 0, 1);
    const contrastScore = clamp(0.6 * mc + 0.4 * prominence, 0, 1);

    // 4. 面积（越大越容易被看到，取平方根衰减）
    const areaScore = Math.sqrt(r.area / maxArea);

    // 5. 位置：靠近中心或三分交点更受关注
    let pd = Infinity;
    for (const p of POWER_POINTS) {
      const dx = (r.cx - p[0]) * aspect;
      const dy = r.cy - p[1];
      pd = Math.min(pd, Math.sqrt(dx * dx + dy * dy) / diag);
    }
    const posScore = 1 - clamp(pd / 0.3, 0, 1);

    // 6. 人脸 / 主体可能性：肤色占比高（配合密度）说明很可能是人脸或人物
    //    自动识别结果会预先标记，用户可手动覆盖（全选 / 全不选 / 单个切换）
    r.autoFace = col.skinFrac >= 0.35;
    const override = faceOverrides[r.id];
    r.faceMarked = typeof override === "boolean" ? override : null;
    r.isFace = r.faceMarked === null ? r.autoFace : r.faceMarked;
    const faceScore = r.faceMarked === true
      ? 1
      : r.faceMarked === false
        ? 0
        : clamp((col.skinFrac - 0.18) / 0.42, 0, 1);

    const salience =
      0.3 * densityScore +
      0.22 * colorScore +
      0.17 * contrastScore +
      0.12 * areaScore +
      0.07 * posScore +
      0.12 * faceScore;

    r.factors = {
      density: densityScore,
      color: colorScore,
      contrast: contrastScore,
      area: areaScore,
      position: posScore,
      face: faceScore,
      skin: col.skinFrac,
      chroma: col.C,
      deltaE: dE,
    };
    r.salience = salience;
  }

  const order = regions.slice().sort((a, b) => b.salience - a.salience);
  order.forEach((r, i) => { r.rank = i; });
  return order;
}

/* ---------------- 主体区域 ---------------- */

function findSubject(regions, coarse, aspect) {
  const gw = coarse.gw;
  const gh = coarse.gh;
  if (!regions.length) {
    return { x: 0, y: 0, w: 1, h: 1, hull: [[0, 0], [1, 0], [1, 1], [0, 1]], ids: [] };
  }
  const main = regions[0];
  const group = [main];
  const diag = Math.sqrt(aspect * aspect + 1);
  for (let i = 1; i < regions.length; i++) {
    const r = regions[i];
    const dx = (r.cx - main.cx) * aspect;
    const dy = r.cy - main.cy;
    const d = Math.sqrt(dx * dx + dy * dy) / diag;
    if (d <= 0.3) group.push(r);
  }
  const hull = mergedHull(group, gw, gh, 1.1);
  const bounds = hullBounds(hull);
  return {
    ...bounds,
    hull,
    ids: group.map((r) => r.id),
    areaCells: group.reduce((a, r) => a + r.area, 0),
  };
}

/* ---------------- 节奏指标 ---------------- */

function rhythmMetrics(regions, aspect, coverage) {
  const n = regions.length;
  const areas = regions.map((r) => r.area);

  const diag = Math.sqrt(aspect * aspect + 1);
  const dists = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = (regions[i].cx - regions[j].cx) * aspect;
      const dy = regions[i].cy - regions[j].cy;
      dists.push(Math.sqrt(dx * dx + dy * dy) / diag);
    }
  }

  let aligned = 0;
  const tol = 0.055;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.abs(regions[i].cx - regions[j].cx);
      const dy = Math.abs(regions[i].cy - regions[j].cy);
      if (dx < tol || dy < tol) aligned++;
    }
  }
  const pairs = (n * (n - 1)) / 2 || 1;
  const alignRatio = n >= 2 ? aligned / pairs : 0;
  const alignment = clamp(alignRatio / 0.6, 0, 1);

  let regularity = null;
  if (n >= 3) {
    const gapCv = (key) => {
      const arr = regions.map((r) => r[key]).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < arr.length; i++) gaps.push(arr[i] - arr[i - 1]);
      return cv(gaps);
    };
    regularity = 1 - clamp((gapCv("cx") + gapCv("cy")) / 2 / 0.5, 0, 1);
  }
  // 区域不足 3 个时无法判断「等距栅格」，只按是否同行同列计算错开度
  const stagger = regularity === null
    ? 1 - alignment
    : 1 - clamp(0.55 * alignment + 0.45 * regularity, 0, 1);

  return {
    n,
    coverage,
    sizePareto: n >= 2 ? paretoShare(areas) : 0,
    sizeVariety: n >= 2 ? gini(areas) : 0,
    distPareto: dists.length >= 3 ? paretoShare(dists) : 0,
    distVariety: dists.length >= 3 ? cv(dists) : 0,
    distCountM: dists.length,
    stagger: n >= 2 ? stagger : 0,
    alignRatio,
    regularity: regularity ?? 0.5,
    meanDist: dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0,
    gini: n >= 2 ? gini(areas) : 0,
    dists,
    distCount: dists.length,
  };
}

/* ---------------- 局部（主体内细网格） ---------------- */

function localMetrics(fine, subject) {
  const { gw, gh, density } = fine;
  const vals = [];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const cx = (i + 0.5) / gw;
      const cy = (j + 0.5) / gh;
      if (cx < subject.x || cx > subject.x + subject.w) continue;
      if (cy < subject.y || cy > subject.y + subject.h) continue;
      vals.push(density[j * gw + i]);
    }
  }
  const arr = Float32Array.from(vals);
  if (!arr.length) {
    return { cells: 0, highRatio: 0, threshold: 0.5, regions: 0, pareto: 0, subjectCells: 0 };
  }
  // 焦点密度阈值：全图细网格的 P85 —— 主体内应只有约两成属于这种极致细节
  const sorted = Float32Array.from(density).sort();
  const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))];
  let high = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] >= thr) high++;
  const res = extractRegions(density, gw, gh, thr, subject, 0.004);
  return {
    cells: arr.length,
    highCells: high,
    highRatio: high / arr.length,
    threshold: thr,
    regions: res.regions.length,
    pareto: res.regions.length >= 2 ? paretoShare(res.regions.map((r) => r.area)) : 0,
    subjectCells: arr.length,
  };
}

/* ---------------- 主入口 ---------------- */

const WEIGHTS = {
  coverage: 0.2,
  sizePareto: 0.18,
  sizeVariety: 0.12,
  distPareto: 0.15,
  distVariety: 0.11,
  stagger: 0.16,
  loop: 0.08,
};

export function computeRhythm(prep, baseParams, opts = {}) {
  const {
    globalGrid = 12,
    localGrid = 65,
    wGlobal = 0.5,
    wLocal = 0.5,
    thresholdMode = "auto",
    threshold = 0.5,
  } = opts;

  const aspect = prep.aw / prep.ah;

  // 整体：粗网格（邻域为 0，保留大块结构）
  const coarse = computeDensity(prep, { ...baseParams, gridSize: globalGrid, radius: 0 });
  const autoThr = otsuThreshold(coarse.density);
  const thrGlobal = thresholdMode === "manual" ? clamp(threshold, 0.05, 0.95) : autoThr;
  const globalRes = extractRegions(coarse.density, coarse.gw, coarse.gh, thrGlobal);
  const coverage = globalRes.highCells / globalRes.cells;
  const metrics = rhythmMetrics(globalRes.regions, aspect, coverage);
  const subject = findSubject(globalRes.regions, coarse, aspect);
  const order = computeSalience(globalRes.regions, prep, coarse, aspect, opts.faceOverrides || {});

  // 局部：细网格 + 主体区域
  const fine = computeDensity(prep, { ...baseParams, gridSize: localGrid });
  const local = localMetrics(fine, subject);

  /* 适用性：区域数不足时，关系型指标不参与计分（而不是记 0 分） */
  const n = metrics.n;
  const applicable = {
    coverage: true,
    sizePareto: n >= 2,
    sizeVariety: n >= 2,
    distPareto: metrics.distCount >= 3,
    distVariety: metrics.distCount >= 3,
    stagger: n >= 2,
    loop: n >= 3,
  };

  // 视线循环：显著的最后一个区域离第一个足够近，视线能「绕回来」形成闭环
  let loop = 0;
  if (n >= 3 && order.length >= 3) {
    const first = order[0];
    const last = order[order.length - 1];
    const dx = (last.cx - first.cx) * aspect;
    const dy = last.cy - first.cy;
    const d = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(aspect * aspect + 1);
    loop = 1 - clamp(d / 0.8, 0, 1);
  }

  // 文案只保留 key，展示时由 i18n 翻译（part.<key> / part.<key>.hint）
  const parts = [
    { key: "coverage", value: coverage, ideal: 0.2, score: peakScore(coverage, 0.2, 0.16), weight: WEIGHTS.coverage, applicable: applicable.coverage },
    { key: "sizePareto", value: metrics.sizePareto, ideal: 0.8, score: paretoScore(metrics.sizePareto, n), weight: WEIGHTS.sizePareto, applicable: applicable.sizePareto, need: 2 },
    { key: "sizeVariety", value: metrics.sizeVariety, ideal: 0.5, score: peakScore(metrics.sizeVariety, 0.5, 0.28), weight: WEIGHTS.sizeVariety, applicable: applicable.sizeVariety, need: 2 },
    { key: "distPareto", value: metrics.distPareto, ideal: 0.8, score: paretoScore(metrics.distPareto, metrics.distCount), weight: WEIGHTS.distPareto, applicable: applicable.distPareto, need: 3 },
    { key: "distVariety", value: metrics.distVariety, ideal: 0.38, score: clamp(metrics.distVariety / 0.38, 0, 1), weight: WEIGHTS.distVariety, applicable: applicable.distVariety, need: 3 },
    { key: "stagger", value: metrics.stagger, ideal: 1, score: metrics.stagger, weight: WEIGHTS.stagger, applicable: applicable.stagger, need: 2 },
    { key: "loop", value: loop, ideal: 1, score: loop, weight: WEIGHTS.loop, applicable: applicable.loop, need: 3 },
  ];

  let globalScore = 0;
  let wsum = 0;
  for (const p of parts) {
    if (!p.applicable) continue;
    globalScore += p.score * p.weight;
    wsum += p.weight;
  }
  globalScore = wsum ? globalScore / wsum : 0;

  const localParts = [
    { key: "localRatio", value: local.highRatio, ideal: 0.2, score: peakScore(local.highRatio, 0.2, 0.2), weight: 0.62, applicable: true },
    { key: "localPareto", value: local.pareto, ideal: 0.8, score: local.regions >= 2 ? paretoScore(local.pareto, local.regions) : 0.5, weight: 0.38, applicable: local.regions >= 2 },
  ];
  let localScore = 0;
  let lw = 0;
  for (const p of localParts) {
    if (!p.applicable) continue;
    localScore += p.score * p.weight;
    lw += p.weight;
  }
  localScore = lw ? localScore / lw : 0;

  const gw = wGlobal + wLocal || 1;
  const total = ((globalScore * wGlobal + localScore * wLocal) / gw) * 100;
  // 档位只返回 key，展示时由 i18n 翻译
  const grade = total >= 85 ? "excellent" : total >= 75 ? "great" : total >= 64 ? "good" : total >= 52 ? "fair" : "poor";

  const skipped = parts.filter((p) => !p.applicable).map((p) => p.need);
  void skipped;

  return {
    coarse,
    fine,
    aspect,
    loop,
    thresholdGlobal: thrGlobal,
    thresholdAuto: autoThr,
    regions: globalRes.regions,
    order,
    faceOverrides: { ...(opts.faceOverrides || {}) },
    highCells: globalRes.highCells,
    totalCells: globalRes.cells,
    coverage,
    subject,
    metrics,
    local,
    parts,
    localParts,
    globalScore,
    localScore,
    total,
    grade,
    skippedNote: skipped.length ? { n, need: Math.max(...skipped) } : null,
    params: { globalGrid, localGrid, wGlobal, wLocal, thresholdMode, threshold },
  };
}
