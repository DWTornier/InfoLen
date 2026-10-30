/* ============================================================
   InfoLen · 画布舞台：图层叠加合成 + 平移缩放
   图层顺序：底图 → 热力图 → 网格 → 等高线 → 边缘 → 频谱 → 剖面
   ============================================================ */

import { clamp, createBus, rafThrottle } from "./util.js";
import { buildLut } from "./colormap.js";
import { t } from "./i18n.js";

const MAX_DPR = 2;

function offscreen(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * 面积加权重采样：彻底消除 nearest + floor 带来的系统性右下偏移，
 * 缩小时为盒式平均、放大时为面积权重插值。
 */
function resample(src, gw, gh, gw2, gh2) {
  const out = new Float32Array(gw2 * gh2);
  const acc = new Float32Array(gw2 * gh2);
  for (let j = 0; j < gh; j++) {
    const y0 = (j * gh2) / gh;
    const y1 = ((j + 1) * gh2) / gh;
    for (let i = 0; i < gw; i++) {
      const v = src[j * gw + i];
      const x0 = (i * gw2) / gw;
      const x1 = ((i + 1) * gw2) / gw;
      const tj0 = Math.max(0, Math.floor(y0));
      const tj1 = Math.min(gh2 - 1, Math.ceil(y1) - 1);
      const ti0 = Math.max(0, Math.floor(x0));
      const ti1 = Math.min(gw2 - 1, Math.ceil(x1) - 1);
      for (let tj = tj0; tj <= tj1; tj++) {
        const oy = Math.min(y1, tj + 1) - Math.max(y0, tj);
        if (oy <= 0) continue;
        for (let ti = ti0; ti <= ti1; ti++) {
          const ox = Math.min(x1, ti + 1) - Math.max(x0, ti);
          if (ox <= 0) continue;
          const w = ox * oy;
          out[tj * gw2 + ti] += v * w;
          acc[tj * gw2 + ti] += w;
        }
      }
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = acc[k] > 1e-9 ? out[k] / acc[k] : 0;
  return out;
}

export function createStage(canvas, host) {
  const bus = createBus();
  let ctx = canvas.getContext("2d");
  const S = {
    media: null,
    data: null,
    spectrum: null,
    layers: [],
    colors: {
      primary: "#c8c0ff",
      onPrimary: "#322263",
      secondary: "#c9c3dc",
      tertiary: "#efb8c8",
      outline: "#948f99",
      surface: "#14121b",
    },
    mode: "dark",
    scheme: null,
    view: { scale: 1, tx: 0, ty: 0 },
    tool: "pan",
    fitScale: 1,
    viewInitialized: false,
    interacting: false,
    rhythm: null,
    dataVersion: 0,
    marquee: null,
    showMarquee: null,
  };

  let dpr = 1;
  let cssW = 1;
  let cssH = 1;
  const cache = new Map();

  /* ---------------- 尺寸 ---------------- */
  function measure() {
    const rect = host.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function resize() {
    measure();
    if (S.media && !S.viewInitialized) fit();
    else render();
  }
  const ro = new ResizeObserver(rafThrottle(resize));
  ro.observe(host);

  /* ---------------- 视图 ---------------- */
  function imageSize() {
    if (!S.media) return { w: 1, h: 1 };
    return { w: S.media.canvas.width, h: S.media.canvas.height };
  }

  function rect() {
    const { w, h } = imageSize();
    return { x: S.view.tx, y: S.view.ty, w: w * S.view.scale, h: h * S.view.scale };
  }

  function computeFit(pad = 40) {
    const { w, h } = imageSize();
    return Math.min((cssW - pad) / w, (cssH - pad) / h);
  }

  function fit(pad = 40) {
    if (!S.media) return;
    measure();
    const { w, h } = imageSize();
    const s = Math.max(0.0008, computeFit(pad));
    S.viewInitialized = true;
    S.fitScale = s;
    S.view.scale = s;
    S.view.tx = (cssW - w * s) / 2;
    S.view.ty = (cssH - h * s) / 2;
    render();
    emitView();
  }

  function clampView() {
    const { w, h } = imageSize();
    const min = Math.min(S.fitScale * 0.12, 0.02);
    S.view.scale = clamp(S.view.scale, min, 96);
    const rw = w * S.view.scale;
    const rh = h * S.view.scale;
    const mx = Math.min(cssW * 0.6, rw * 0.8);
    const my = Math.min(cssH * 0.6, rh * 0.8);
    S.view.tx = clamp(S.view.tx, cssW * 0.4 - rw, mx);
    S.view.ty = clamp(S.view.ty, cssH * 0.4 - rh, my);
  }

  function zoomAt(cx, cy, factor) {
    S.viewInitialized = true;
    const prev = S.view.scale;
    const next = clamp(prev * factor, Math.min(S.fitScale * 0.12, 0.02), 96);
    const k = next / prev;
    S.view.tx = cx - (cx - S.view.tx) * k;
    S.view.ty = cy - (cy - S.view.ty) * k;
    S.view.scale = next;
    clampView();
    render();
    emitView();
  }

  function setZoom(z) {
    zoomAt(cssW / 2, cssH / 2, z / S.view.scale);
  }

  function zoomToRect(r) {
    S.viewInitialized = true;
    const { w, h } = imageSize();
    const s = clamp(Math.min(cssW / r.w, cssH / r.h), Math.min(S.fitScale * 0.12, 0.02), 96);
    const k = s / S.view.scale;
    S.view.tx = cssW / 2 - (r.x + r.w / 2 - S.view.tx) * k;
    S.view.ty = cssH / 2 - (r.y + r.h / 2 - S.view.ty) * k;
    S.view.scale = s;
    clampView();
    render();
    emitView();
  }

  function emitView() {
    bus.emit("view", { scale: S.view.scale, percent: Math.round(S.view.scale * 100) });
  }

  /* ---------------- 图层缓存 ---------------- */
  function cached(key, sig, build) {
    const hit = cache.get(key);
    if (hit && hit.sig === sig) return hit.value;
    const value = build();
    cache.set(key, { sig, value });
    return value;
  }

  function lutFor(id) {
    return cached(`lut:${id}:${S.mode}:${S.scheme ? S.scheme.seed.hex : "x"}`,
      `${id}|${S.mode}|${S.scheme ? S.scheme.seed.hex : "x"}`,
      () => buildLut(id, S.scheme, S.mode));
  }

  function densityImage(layer) {
    const d = S.data;
    const p = layer.params;
    const sig = `d:${S.dataVersion}|${p.colormap}|${p.alphaMode}|${p.gamma}|${S.mode}|${S.scheme?.seed.hex}`;
    return cached("img:heat", sig, () => {
      const lut = lutFor(p.colormap);
      const { gw, gh, density } = d;
      const c = offscreen(gw, gh);
      const cctx = c.getContext("2d");
      const img = cctx.createImageData(gw, gh);
      for (let i = 0; i < gw * gh; i++) {
        let v = clamp(density[i], 0, 1);
        if (p.gamma && p.gamma !== 1) v = Math.pow(v, p.gamma);
        const o = Math.round(v * 255) * 3;
        img.data[i * 4] = lut[o];
        img.data[i * 4 + 1] = lut[o + 1];
        img.data[i * 4 + 2] = lut[o + 2];
        img.data[i * 4 + 3] = p.alphaMode === "density" ? Math.round(255 * Math.pow(v, 0.7)) : 255;
      }
      cctx.putImageData(img, 0, 0);
      return c;
    });
  }

  function edgeImage(layer) {
    const d = S.data;
    const p = layer.params;
    const sig = `e:${S.dataVersion}|${p.colormap}|${p.source}|${p.gain}|${S.mode}|${S.scheme?.seed.hex}`;
    return cached("img:edge", sig, () => {
      const lut = lutFor(p.colormap);
      const src = p.source === "hf" ? d.hf : d.grad;
      const { aw, ah } = d;
      const c = offscreen(aw, ah);
      const cctx = c.getContext("2d");
      const img = cctx.createImageData(aw, ah);
      for (let i = 0; i < aw * ah; i++) {
        const v = clamp(src[i] * (p.gain ?? 1), 0, 1);
        const o = Math.round(v * 255) * 3;
        img.data[i * 4] = lut[o];
        img.data[i * 4 + 1] = lut[o + 1];
        img.data[i * 4 + 2] = lut[o + 2];
        img.data[i * 4 + 3] = 255;
      }
      cctx.putImageData(img, 0, 0);
      return c;
    });
  }

  function gridImage(layer) {
    const d = S.data;
    const p = layer.params;
    const size = clamp(Math.round(p.size || d.gw), 4, 256);
    const gw2 = size;
    const gh2 = Math.max(4, Math.round((size * d.ah) / d.aw));
    const sig = `g:${S.dataVersion}|${p.colormap}|${gw2}x${gh2}|${S.mode}|${S.scheme?.seed.hex}`;
    return cached("img:grid", sig, () => {
      const lut = lutFor(p.colormap);
      const vals = resample(d.density, d.gw, d.gh, gw2, gh2);
      const c = offscreen(gw2, gh2);
      const cctx = c.getContext("2d");
      const img = cctx.createImageData(gw2, gh2);
      for (let i = 0; i < gw2 * gh2; i++) {
        const o = Math.round(clamp(vals[i], 0, 1) * 255) * 3;
        img.data[i * 4] = lut[o];
        img.data[i * 4 + 1] = lut[o + 1];
        img.data[i * 4 + 2] = lut[o + 2];
        img.data[i * 4 + 3] = 255;
      }
      cctx.putImageData(img, 0, 0);
      return { canvas: c, gw: gw2, gh: gh2, vals };
    });
  }

  function spectrumImage(layer) {
    const sp = S.spectrum;
    const p = layer.params;
    const sig = `s:${S.dataVersion}|${p.colormap}|${p.gain}|${S.mode}|${S.scheme?.seed.hex}`;
    return cached("img:spec", sig, () => {
      const lut = lutFor(p.colormap);
      const N = sp.size;
      const c = offscreen(N, N);
      const cctx = c.getContext("2d");
      const img = cctx.createImageData(N, N);
      const gain = p.gain ?? 1;
      for (let i = 0; i < N * N; i++) {
        const v = clamp((sp.image[i] - 0.5) * gain + 0.5, 0, 1);
        const o = Math.round(v * 255) * 3;
        img.data[i * 4] = lut[o];
        img.data[i * 4 + 1] = lut[o + 1];
        img.data[i * 4 + 2] = lut[o + 2];
        img.data[i * 4 + 3] = 255;
      }
      cctx.putImageData(img, 0, 0);
      return c;
    });
  }

  function contourSegments(layer) {
    const d = S.data;
    const levels = clamp(Math.round(layer.params.levels || 6), 2, 18);
    const sig = `c:${S.dataVersion}|${levels}`;
    return cached("segs:contour", sig, () => {
      const { gw, gh, density } = d;
      const segs = [];
      const px = (i) => (i + 0.5) / gw;
      const py = (j) => (j + 0.5) / gh;
      for (let li = 0; li < levels; li++) {
        const L = 0.1 + ((li + 0.5) / levels) * 0.85;
        const ip = (v0, v1, p0, p1) => p0 + (p1 - p0) * ((L - v0) / (v1 - v0 || 1e-9));
        for (let j = 0; j < gh - 1; j++) {
          for (let i = 0; i < gw - 1; i++) {
            const a = density[j * gw + i];
            const b = density[j * gw + i + 1];
            const c = density[(j + 1) * gw + i + 1];
            const e = density[(j + 1) * gw + i];
            const idx = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (e > L ? 8 : 0);
            if (idx === 0 || idx === 15) continue;
            const x0 = px(i);
            const x1 = px(i + 1);
            const y0 = py(j);
            const y1 = py(j + 1);
            const T = [ip(a, b, x0, x1), y0];
            const R = [x1, ip(b, c, y0, y1)];
            const B = [ip(e, c, x0, x1), y1];
            const Lp = [x0, ip(a, e, y0, y1)];
            const push = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
            switch (idx) {
              case 1: case 14: push(Lp, T); break;
              case 2: case 13: push(T, R); break;
              case 3: case 12: push(Lp, R); break;
              case 4: case 11: push(R, B); break;
              case 6: case 9: push(T, B); break;
              case 7: case 8: push(Lp, B); break;
              case 5: push(Lp, T); push(R, B); break;
              case 10: push(T, R); push(B, Lp); break;
              default: break;
            }
          }
        }
      }
      return Float32Array.from(segs);
    });
  }

  /* ---------------- 绘制 ---------------- */
  function drawImageLayer(src, r, layer, smooth = true) {
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend || "source-over";
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = "high";
    const blur = layer.params?.blur || 0;
    if (blur > 0) {
      try { ctx.filter = `blur(${blur}px)`; } catch { /* 忽略 */ }
    }
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function drawGridLayer(layer, r) {
    const { canvas: c, gw, gh, vals } = gridImage(layer);
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend || "source-over";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, r.x, r.y, r.w, r.h);
    const cw = r.w / gw;
    const ch = r.h / gh;
    if (layer.params.stroke && cw > 3) {
      ctx.strokeStyle = S.colors.outline;
      ctx.globalAlpha = clamp(layer.opacity * 0.35, 0, 1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < gw; i++) {
        const x = r.x + i * cw;
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
      }
      for (let j = 1; j < gh; j++) {
        const y = r.y + j * ch;
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w, y);
      }
      ctx.stroke();
    }
    if (layer.params.labels && !S.interacting && cw > 26 && ch > 18 && gw * gh <= 3600) {
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      ctx.font = `${Math.min(12, ch * 0.36)}px "Roboto Flex", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const v = vals[j * gw + i];
          ctx.fillStyle = v > 0.55 ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.72)";
          ctx.fillText(v.toFixed(2), r.x + (i + 0.5) * cw, r.y + (j + 0.5) * ch);
        }
      }
    }
    ctx.restore();
  }

  function drawContourLayer(layer, r) {
    const segs = contourSegments(layer);
    if (!segs.length) return;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend || "source-over";
    ctx.strokeStyle = S.colors.primary;
    ctx.lineWidth = clamp(layer.params.width ?? 1.4, 0.4, 6);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (layer.params.glow && !S.interacting) {
      ctx.shadowColor = S.colors.primary;
      ctx.shadowBlur = ctx.lineWidth * 3.5;
    }
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(r.x + segs[i] * r.w, r.y + segs[i + 1] * r.h);
      ctx.lineTo(r.x + segs[i + 2] * r.w, r.y + segs[i + 3] * r.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawProfileLayer(layer, r) {
    const d = S.data;
    const p = layer.params;
    const side = p.side || "both";
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend || "source-over";
    ctx.strokeStyle = S.colors.primary;
    ctx.lineJoin = "round";

    if (side === "top" || side === "both") {
      const H = r.h * clamp(p.height ?? 0.14, 0.04, 0.4);
      const n = d.colProfile.length;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + H);
      for (let i = 0; i < n; i++) {
        const x = r.x + ((i + 0.5) / n) * r.w;
        const y = r.y + H - d.colProfile[i] * H;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(r.x + r.w, r.y + H);
      ctx.closePath();
      if (p.fill !== false) {
        ctx.fillStyle = S.colors.primary;
        ctx.globalAlpha = clamp(layer.opacity * 0.28, 0, 1);
        ctx.fill();
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      }
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    if (side === "left" || side === "both") {
      const W = r.w * clamp(p.width ?? 0.12, 0.03, 0.4);
      const n = d.rowProfile.length;
      ctx.beginPath();
      ctx.moveTo(r.x + W, r.y);
      for (let j = 0; j < n; j++) {
        const y = r.y + ((j + 0.5) / n) * r.h;
        const x = r.x + W - d.rowProfile[j] * W;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(r.x + W, r.y + r.h);
      ctx.closePath();
      if (p.fill !== false) {
        ctx.fillStyle = S.colors.primary;
        ctx.globalAlpha = clamp(layer.opacity * 0.28, 0, 1);
        ctx.fill();
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      }
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRhythmLayer(layer, r) {
    const R = S.rhythm;
    if (!R) return;
    const p = layer.params;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = layer.blend || "source-over";
    const X = (nx) => r.x + nx * r.w;
    const Y = (ny) => r.y + ny * r.h;

    // 整体粗网格
    if (p.grid) {
      ctx.strokeStyle = S.colors.outline;
      ctx.globalAlpha = clamp(layer.opacity * 0.22, 0, 1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < R.coarse.gw; i++) {
        const x = r.x + (i / R.coarse.gw) * r.w;
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
      }
      for (let j = 1; j < R.coarse.gh; j++) {
        const y = r.y + (j / R.coarse.gh) * r.h;
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w, y);
      }
      ctx.stroke();
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    }

    const polyPath = (poly) => {
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const x = X(poly[i][0]);
        const y = Y(poly[i][1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    // 主体区域（凸包虚线）
    if (p.subject !== false && R.subject?.hull?.length >= 3) {
      polyPath(R.subject.hull);
      ctx.strokeStyle = S.colors.primary;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([9, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!S.interacting) {
        ctx.font = '11px "Roboto Flex", system-ui, sans-serif';
        ctx.fillStyle = S.colors.primary;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(t("canvas.subject"), X(R.subject.x) + 4, Y(R.subject.y) - 5);
      }
    }

    // 高密度区域（凸包多边形）
    if (p.hull !== false) {
      ctx.lineJoin = "round";
      for (const reg of R.regions) {
        if (!reg.hull || reg.hull.length < 3) continue;
        polyPath(reg.hull);
        ctx.fillStyle = S.colors.primary;
        ctx.globalAlpha = clamp(layer.opacity * 0.14, 0, 1);
        ctx.fill();
        ctx.globalAlpha = clamp(layer.opacity * 0.92, 0, 1);
        ctx.strokeStyle = S.colors.primary;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    }

    // 视觉引导路径（按显著性排序）
    if (p.path !== false && R.order && R.order.length > 1) {
      const pts = R.order.map((reg) => [X(reg.cx), Y(reg.cy)]);
      ctx.strokeStyle = S.colors.tertiary;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        ctx.bezierCurveTo(
          p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
          p2[0], p2[1]
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // 箭头
      ctx.fillStyle = S.colors.tertiary;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const t = 0.62;
        const ax = x1 + (x2 - x1) * t;
        const ay = y1 + (y2 - y1) * t;
        const s = 9;
        ctx.beginPath();
        ctx.moveTo(ax + s * Math.cos(ang), ay + s * Math.sin(ang));
        ctx.lineTo(ax + s * Math.cos(ang + 2.5), ay + s * Math.sin(ang + 2.5));
        ctx.lineTo(ax + s * Math.cos(ang - 2.5), ay + s * Math.sin(ang - 2.5));
        ctx.closePath();
        ctx.fill();
      }
    }

    // 人脸标记（自动识别或手动标注）
    if (!S.interacting) {
      ctx.font = '600 11px "Roboto Flex", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const reg of R.regions) {
        if (!reg.isFace) continue;
        const cx = X(reg.cx);
        const cy = Y(reg.cy) - 24;
        const label = reg.faceMarked === null
          ? t("canvas.faceAuto")
          : reg.faceMarked
            ? t("canvas.faceOn")
            : t("canvas.faceOff");
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - 10, w, 20, 10);
        else ctx.rect(cx - w / 2, cy - 10, w, 20);
        ctx.fill();
        ctx.fillStyle = S.colors.tertiary;
        ctx.fillText(label, cx, cy);
      }
    }

    // 视线循环：从最后一个区域绕回第一个（加分项的可视化）
    if (p.loop !== false && R.order && R.order.length >= 3) {
      const pts = R.order.map((reg) => [X(reg.cx), Y(reg.cy)]);
      let mx = 0;
      let my = 0;
      for (const pt of pts) { mx += pt[0]; my += pt[1]; }
      mx /= pts.length;
      my /= pts.length;
      const a = pts[pts.length - 1];
      const z = pts[0];
      const vx = (a[0] + z[0]) / 2 - mx;
      const vy = (a[1] + z[1]) / 2 - my;
      const k = 1.9;
      const c1 = [a[0] + vx * k, a[1] + vy * k];
      const c2 = [z[0] + vx * k, z[1] + vy * k];
      ctx.strokeStyle = S.colors.tertiary;
      ctx.globalAlpha = clamp(layer.opacity * 0.5, 0, 1);
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], z[0], z[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    }

    // 注意力顺序编号
    if (p.labels !== false && !S.interacting) {
      const rad = 13;
      ctx.font = '600 12px "Roboto Flex", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      R.order.forEach((reg, i) => {
        const cx = X(reg.cx);
        const cy = Y(reg.cy);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = S.colors.primary;
        ctx.fill();
        ctx.fillStyle = S.colors.onPrimary;
        ctx.fillText(String(i + 1), cx, cy + 0.5);
      });
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!S.media) return;

    const r = rect();
    const layers = S.layers;

    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.opacity <= 0.001) continue;
      switch (layer.id) {
        case "base":
          drawImageLayer(S.media.canvas, r, layer, true);
          break;
        case "heatmap":
          if (S.data) drawImageLayer(densityImage(layer), r, layer, layer.params.smooth !== false);
          break;
        case "grid":
          if (S.data) drawGridLayer(layer, r);
          break;
        case "contour":
          if (S.data) drawContourLayer(layer, r);
          break;
        case "edge":
          if (S.data) drawImageLayer(edgeImage(layer), r, layer, true);
          break;
        case "spectrum":
          if (S.spectrum) drawImageLayer(spectrumImage(layer), r, layer, true);
          break;
        case "profile":
          if (S.data) drawProfileLayer(layer, r);
          break;
        case "rhythm":
          if (S.rhythm) drawRhythmLayer(layer, r);
          break;
        default:
          break;
      }
    }

    if (S.showMarquee) {
      const m = S.showMarquee;
      ctx.save();
      ctx.strokeStyle = S.colors.primary;
      ctx.fillStyle = S.colors.primary;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.restore();
    }
  }

  const renderThrottled = rafThrottle(render);

  /* ---------------- 指针交互 ---------------- */
  let drag = null;

  function localPoint(ev) {
    const rectHost = host.getBoundingClientRect();
    return { x: ev.clientX - rectHost.left, y: ev.clientY - rectHost.top };
  }

  function toImage(pt) {
    const r = rect();
    return { x: (pt.x - r.x) / r.w, y: (pt.y - r.y) / r.h };
  }

  function densityAt(nx, ny) {
    if (!S.data) return null;
    const { gw, gh } = S.data;
    const i = clamp(Math.floor(nx * gw), 0, gw - 1);
    const j = clamp(Math.floor(ny * gh), 0, gh - 1);
    return S.data.density[j * gw + i];
  }

  /* 射线法：点是否在凸包多边形内 */
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 光标下的高密度区域（仅在节奏图层可见时） */
  function regionAt(nx, ny) {
    const R = S.rhythm;
    if (!R || !R.regions?.length) return null;
    const layer = S.layers.find((l) => l.id === "rhythm");
    if (!layer || !layer.visible) return null;
    let hit = null;
    for (const reg of R.regions) {
      if (!reg.hull || reg.hull.length < 3) continue;
      if (pointInPoly(nx, ny, reg.hull)) {
        if (!hit || reg.area < hit.area) hit = reg; // 取更小的（更局部的）区域
      }
    }
    return hit;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!S.media) return;
    canvas.setPointerCapture(ev.pointerId);
    const pt = localPoint(ev);
    const wantMarquee = S.tool === "zoom" || ev.altKey;
    if (S.tool === "pick" && ev.button === 0) {
      const im = toImage(pt);
      if (im.x >= 0 && im.x <= 1 && im.y >= 0 && im.y <= 1) bus.emit("pick", im);
      return;
    }
    if (wantMarquee && ev.button === 0) {
      drag = { mode: "marquee", start: pt, cur: pt };
    } else {
      drag = { mode: "pan", start: pt, origin: { ...S.view } };
      canvas.classList.add("is-panning");
    }
    S.interacting = true;
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!S.media) return;
    const pt = localPoint(ev);
    const im = toImage(pt);
    if (im.x >= 0 && im.x <= 1 && im.y >= 0 && im.y <= 1) {
      const d = densityAt(im.x, im.y);
      bus.emit("hover", {
        nx: im.x,
        ny: im.y,
        sx: pt.x,
        sy: pt.y,
        px: Math.round(im.x * S.media.canvas.width),
        py: Math.round(im.y * S.media.canvas.height),
        density: d,
        region: regionAt(im.x, im.y),
      });
    } else {
      bus.emit("hover", null);
    }

    if (!drag) return;
    if (drag.mode === "pan") {
      if (Math.abs(pt.x - drag.start.x) + Math.abs(pt.y - drag.start.y) > 4) S.interactingMoved = true;
      S.view.tx = drag.origin.tx + (pt.x - drag.start.x);
      S.view.ty = drag.origin.ty + (pt.y - drag.start.y);
      clampView();
      renderThrottled();
    } else if (drag.mode === "marquee") {
      drag.cur = pt;
      const x = Math.min(drag.start.x, pt.x);
      const y = Math.min(drag.start.y, pt.y);
      S.showMarquee = { x, y, w: Math.abs(pt.x - drag.start.x), h: Math.abs(pt.y - drag.start.y) };
      renderThrottled();
    }
  });

  function endDrag(ev) {
    if (!drag) return;
    if (drag.mode === "marquee" && S.showMarquee) {
      const m = S.showMarquee;
      if (m.w > 8 && m.h > 8) zoomToRect(m);
    } else if (drag.mode === "pan" && !S.interactingMoved) {
      // 单击（未拖动）：若落在高密度区域上则切换其人脸标记
      const pt = localPoint(ev);
      const im = toImage(pt);
      const reg = regionAt(im.x, im.y);
      if (reg) bus.emit("regionClick", reg);
    }
    S.interactingMoved = false;
    drag = null;
    S.showMarquee = null;
    S.interacting = false;
    canvas.classList.remove("is-panning");
    if (ev && ev.pointerId !== undefined && canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    render();
    emitView();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => bus.emit("hover", null));

  canvas.addEventListener("wheel", (ev) => {
    if (!S.media) return;
    ev.preventDefault();
    const pt = localPoint(ev);
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
    const factor = Math.exp(-ev.deltaY * unit * 0.0016);
    zoomAt(pt.x, pt.y, factor);
  }, { passive: false });

  canvas.addEventListener("dblclick", (ev) => {
    if (!S.media) return;
    const pt = localPoint(ev);
    if (ev.altKey || ev.shiftKey) zoomAt(pt.x, pt.y, 1 / 1.8);
    else zoomAt(pt.x, pt.y, 1.8);
  });

  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  /* ---------------- 对外 API ---------------- */
  const api = {
    bus,
    get view() { return { ...S.view }; },
    setMedia(media, { keepView = false } = {}) {
      S.media = media;
      S.dataVersion++;
      cache.clear();
      if (!keepView) fit();
      else render();
    },
    setData(data) {
      S.data = data;
      S.dataVersion++;
      render();
    },
    setSpectrum(spectrum) {
      S.spectrum = spectrum;
      S.dataVersion++;
      render();
    },
    setRhythm(rhythm) {
      S.rhythm = rhythm;
      render();
    },
    setLayers(layers) {
      S.layers = layers;
      render();
    },
    setColors(colors, mode, scheme) {
      S.colors = { ...S.colors, ...colors };
      S.mode = mode;
      S.scheme = scheme;
      render();
    },
    setTool(tool) {
      S.tool = tool;
      canvas.className = "";
      canvas.classList.add(`tool-${tool}`);
    },
    fit,
    setZoom,
    zoomAtCenter(factor) { zoomAt(cssW / 2, cssH / 2, factor); },
    render,
    requestRender: renderThrottled,
    invalidate() { cache.clear(); render(); },
    screenToImage(pt) { return toImage(pt); },
    /** 以更高倍率重绘当前视图用于导出 */
    exportCanvas(scale = 2) {
      const r = rect();
      const W = Math.max(1, Math.round(r.w * scale));
      const H = Math.max(1, Math.round(r.h * scale));
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const savedCtx = ctx;
      const savedW = cssW;
      const savedH = cssH;
      const savedDpr = dpr;
      const savedView = { ...S.view };

      ctx = out.getContext("2d");
      cssW = W;
      cssH = H;
      dpr = 1;
      S.view = { scale: savedView.scale * scale, tx: 0, ty: 0 };
      render();

      ctx = savedCtx;
      cssW = savedW;
      cssH = savedH;
      dpr = savedDpr;
      S.view = savedView;
      render();
      return out;
    },
  };

  return api;
}
