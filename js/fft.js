/* ============================================================
   InfoLen · 2D FFT 频谱分析（空间频率分布）
   ============================================================ */

import { clamp } from "./util.js";

function bitReverse(n, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | ((n >> i) & 1);
  }
  return r;
}

/** 原位 1D FFT（跨步访问） */
function fft1d(re, im, n, stride, offset) {
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      const a = i * stride + offset;
      const b = j * stride + offset;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = (i + k) * stride + offset;
        const b = (i + k + half) * stride + offset;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function sampleBilinear(src, w, h, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = clamp(x0, 0, w - 1);
  const xb = clamp(x0 + 1, 0, w - 1);
  const ya = clamp(y0, 0, h - 1);
  const yb = clamp(y0 + 1, 0, h - 1);
  const v00 = src[ya * w + xa];
  const v10 = src[ya * w + xb];
  const v01 = src[yb * w + xa];
  const v11 = src[yb * w + xb];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

/**
 * 计算中心方形区域的频谱
 * @returns {{size:number, image:Float32Array, radial:{freq:Float32Array, db:Float32Array, norm:Float32Array}, peak:object, dc:number}}
 */
export function computeSpectrum(gray, w, h, N = 256) {
  const side = Math.min(w, h);
  const ox = Math.floor((w - side) / 2);
  const oy = Math.floor((h - side) / 2);
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);

  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));

  let mean = 0;
  const raw = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const sy = oy + ((y + 0.5) * side) / N;
    for (let x = 0; x < N; x++) {
      const sx = ox + ((x + 0.5) * side) / N;
      const v = sampleBilinear(gray, w, h, sx, sy);
      raw[y * N + x] = v;
      mean += v;
    }
  }
  mean /= N * N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      re[y * N + x] = (raw[y * N + x] - mean) * hann[y] * hann[x];
    }
  }

  for (let y = 0; y < N; y++) fft1d(re, im, N, 1, y * N);
  for (let x = 0; x < N; x++) fft1d(re, im, N, N, x);

  /* 幅度（fftshift 后的可视化矩阵） */
  const mag = new Float32Array(N * N);
  let maxMag = 1e-9;
  for (let i = 0; i < N * N; i++) {
    const m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    mag[i] = m;
    if (m > maxMag) maxMag = m;
  }

  /* fftshift：低频移到中心 */
  const half = N / 2;
  const shifted = new Float32Array(N * N);
  const image = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (x + half) % N;
      const sy = (y + half) % N;
      const m = mag[sy * N + sx];
      shifted[y * N + x] = m;
      const db = 20 * Math.log10(m / maxMag + 1e-9); // [-180, 0]
      image[y * N + x] = clamp((db + 78) / 78, 0, 1);
    }
  }

  /* 径向平均功率谱（以直流分量为中心） */
  const R = half;
  const sumDb = new Float64Array(R);
  const cnt = new Float64Array(R);
  const cx = half;
  const cy = half;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ri = Math.floor(r);
      if (ri >= R) continue;
      const db = 20 * Math.log10(shifted[y * N + x] / maxMag + 1e-9);
      sumDb[ri] += db;
      cnt[ri]++;
    }
  }
  const freq = new Float32Array(R);
  const db = new Float32Array(R);
  for (let i = 0; i < R; i++) {
    freq[i] = i / N; // cycles / pixel
    db[i] = cnt[i] ? sumDb[i] / cnt[i] : -78;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < R; i++) { if (db[i] < lo) lo = db[i]; if (db[i] > hi) hi = db[i]; }
  const norm = new Float32Array(R);
  const span = hi - lo || 1;
  for (let i = 0; i < R; i++) norm[i] = clamp((db[i] - lo) / span, 0, 1);

  // 主频（跳过 DC 附近）
  let peakIdx = 1;
  let peakVal = -Infinity;
  for (let i = 2; i < R; i++) {
    if (db[i] > peakVal) { peakVal = db[i]; peakIdx = i; }
  }

  // 方向能量：沿中心行的水平频率 / 沿中心列的垂直频率
  let eh = 0;
  let ev = 0;
  for (let i = 2; i < R; i++) {
    eh += shifted[cy * N + (cx + i)] + shifted[cy * N + (cx - i)];
    ev += shifted[(cy + i) * N + cx] + shifted[(cy - i) * N + cx];
  }

  return {
    size: N,
    image,
    radial: { freq, db, norm },
    peak: { freq: peakIdx / N, db: peakVal, index: peakIdx },
    anisotropy: eh + ev > 0 ? (eh - ev) / (eh + ev) : 0,
    dc: mag[0],
  };
}
