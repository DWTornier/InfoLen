/* ============================================================
   InfoLen · 轻量图表引擎（支持框选缩放 / 滚轮缩放 / 悬停读数）
   ============================================================ */

import { clamp, rafThrottle } from "./util.js";

const PAD = { l: 36, r: 10, t: 12, b: 20 };

export function createChart(host, opts = {}) {
  host.classList.add("chart", "chart--zoomable");
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "chart__tooltip";
  const badge = document.createElement("div");
  badge.className = "chart__zoom-badge";
  host.append(canvas, tip, badge);
  const ctx = canvas.getContext("2d");

  const S = {
    series: opts.series || [],
    length: opts.length || (opts.series?.[0]?.values.length ?? 1),
    type: opts.type || "bar",
    colors: { primary: "#c8c0ff", secondary: "#c9c3dc", tertiary: "#efb8c8", outline: "#948f99", text: "#cac4d0" },
    xLabel: opts.xLabel || ((i) => String(Math.round(i))),
    yLabel: opts.yLabel || ((v) => v.toFixed(0)),
    tipFormat: opts.tipFormat || ((v, i) => `${Math.round(i)} · ${v.toFixed(1)}`),
    yMax: opts.yMax ?? null,
    stacked: false,
    view: [0, (opts.length || (opts.series?.[0]?.values.length ?? 2)) - 1],
    brush: null,
    hoverIdx: -1,
    onZoom: opts.onZoom || null,
  };

  let W = 1;
  let H = 1;
  let dpr = 1;

  function resize() {
    const rect = host.getBoundingClientRect();
    W = Math.max(40, rect.width);
    H = Math.max(40, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    render();
  }
  const ro = new ResizeObserver(rafThrottle(resize));
  ro.observe(host);

  const plotW = () => W - PAD.l - PAD.r;
  const plotH = () => H - PAD.t - PAD.b;

  function idxToX(i) {
    const [a, b] = S.view;
    return PAD.l + ((i - a) / Math.max(1e-6, b - a)) * plotW();
  }
  function xToIdx(x) {
    const [a, b] = S.view;
    return a + ((x - PAD.l) / Math.max(1, plotW())) * (b - a);
  }

  function visibleMax() {
    let m = 0;
    const [a, b] = S.view;
    const i0 = Math.max(0, Math.floor(a));
    const i1 = Math.min(S.length - 1, Math.ceil(b));
    for (const s of S.series) {
      for (let i = i0; i <= i1; i++) {
        const v = s.values[i];
        if (v > m) m = v;
      }
    }
    return m || 1;
  }

  function drawSeries(s, yMax) {
    const [a, b] = S.view;
    const i0 = Math.max(0, Math.floor(a));
    const i1 = Math.min(S.length - 1, Math.ceil(b));
    const color = s.color || S.colors.primary;
    const ph = plotH();
    const type = s.type || S.type;

    if (type === "bar") {
      const n = i1 - i0 + 1;
      const bw = Math.max(1, plotW() / Math.max(1, b - a + 1));
      ctx.fillStyle = color;
      for (let i = i0; i <= i1; i++) {
        const v = clamp(s.values[i] / yMax, 0, 1);
        const x = idxToX(i - 0.5);
        const h = Math.max(v > 0 ? 1 : 0, v * ph);
        ctx.fillRect(x, PAD.t + ph - h, Math.max(1, bw - (n > 90 ? 0 : 1)), h);
      }
      return;
    }

    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const x = idxToX(i);
      const y = PAD.t + ph - clamp(s.values[i] / yMax, 0, 1) * ph;
      if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (type === "area") {
      ctx.lineTo(idxToX(i1), PAD.t + ph);
      ctx.lineTo(idxToX(i0), PAD.t + ph);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function render() {
    if (!canvas.width) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const yMax = S.yMax ?? visibleMax() * 1.08;
    const ph = plotH();

    // 网格
    ctx.strokeStyle = S.colors.outline;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    ctx.font = '10px "Roboto Flex", system-ui, sans-serif';
    ctx.fillStyle = S.colors.text;
    for (let k = 0; k <= 3; k++) {
      const y = PAD.t + (ph * k) / 3;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(W - PAD.r, y);
      ctx.stroke();
      ctx.globalAlpha = 0.65;
      ctx.textAlign = "right";
      ctx.textBaseline = k === 3 ? "bottom" : "middle";
      ctx.fillText(S.yLabel((yMax * (3 - k)) / 3), PAD.l - 6, y);
      ctx.globalAlpha = 0.22;
    }
    ctx.globalAlpha = 1;

    // 数据
    for (const s of S.series) drawSeries(s, yMax);

    // x 轴刻度
    ctx.globalAlpha = 0.75;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = 4;
    for (let k = 0; k <= ticks; k++) {
      const i = S.view[0] + ((S.view[1] - S.view[0]) * k) / ticks;
      ctx.fillText(S.xLabel(i), idxToX(i), PAD.t + ph + 4);
    }
    ctx.globalAlpha = 1;

    // 悬停
    if (S.hoverIdx >= 0 && S.hoverIdx < S.length) {
      const x = idxToX(S.hoverIdx);
      ctx.strokeStyle = S.colors.primary;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 框选
    if (S.brush) {
      const a = S.brush[0];
      const b = S.brush[1];
      ctx.fillStyle = S.colors.primary;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(a, PAD.t, b - a, ph);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = S.colors.primary;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a, PAD.t, b - a, ph);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  const renderT = rafThrottle(render);

  function updateBadge() {
    const full = [0, S.length - 1];
    const zoomed = S.view[0] > full[0] + 0.5 || S.view[1] < full[1] - 0.5;
    badge.textContent = `${S.xLabel(S.view[0])} – ${S.xLabel(S.view[1])}`;
    badge.classList.toggle("is-visible", !!zoomed);
  }

  function setView(a, b, notify = true) {
    const lo = 0;
    const hi = Math.max(1, S.length - 1);
    let na = clamp(a, lo, hi);
    let nb = clamp(b, lo, hi);
    if (nb - na < 1) {
      const mid = (na + nb) / 2;
      na = Math.max(lo, mid - 0.5);
      nb = Math.min(hi, na + 1);
    }
    S.view = [na, nb];
    updateBadge();
    render();
    if (notify && S.onZoom) S.onZoom([...S.view]);
  }

  /* 交互 */
  let drag = null;

  host.addEventListener("pointerdown", (ev) => {
    host.setPointerCapture(ev.pointerId);
    const rect = host.getBoundingClientRect();
    drag = { start: ev.clientX - rect.left, cur: ev.clientX - rect.left };
    S.brush = [drag.start, drag.start];
    render();
  });

  host.addEventListener("pointermove", (ev) => {
    const rect = host.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const idx = Math.round(xToIdx(x));
    if (drag) {
      drag.cur = x;
      S.brush = [Math.min(drag.start, x), Math.max(drag.start, x)];
      renderT();
    }
    if (y >= PAD.t && y <= PAD.t + plotH() && idx >= 0 && idx < S.length) {
      S.hoverIdx = idx;
      const v = S.series[0]?.values[idx] ?? 0;
      tip.textContent = S.tipFormat(v, idx, S.series);
      tip.style.left = `${clamp(idxToX(idx), 40, W - 40)}px`;
      tip.style.top = `${PAD.t + 8}px`;
      tip.classList.add("is-visible");
      renderT();
    } else {
      S.hoverIdx = -1;
      tip.classList.remove("is-visible");
      renderT();
    }
  });

  host.addEventListener("pointerup", (ev) => {
    if (!drag) return;
    const a = Math.min(drag.start, drag.cur);
    const b = Math.max(drag.start, drag.cur);
    drag = null;
    S.brush = null;
    if (b - a > 6) setView(xToIdx(a), xToIdx(b));
    else render();
    if (ev.pointerId !== undefined && host.hasPointerCapture(ev.pointerId)) host.releasePointerCapture(ev.pointerId);
  });

  host.addEventListener("pointerleave", () => {
    S.hoverIdx = -1;
    tip.classList.remove("is-visible");
    renderT();
  });

  host.addEventListener("dblclick", () => setView(0, S.length - 1));

  host.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = host.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const anchor = xToIdx(x);
    const f = ev.deltaY > 0 ? 1.25 : 0.8;
    const [a, b] = S.view;
    setView(anchor - (anchor - a) * f, anchor + (b - anchor) * f);
  }, { passive: false });

  return {
    setSeries(series, length) {
      S.series = series;
      S.length = length ?? series[0]?.values.length ?? 1;
      S.view = [0, Math.max(1, S.length - 1)];
      updateBadge();
      render();
    },
    setColors(colors) {
      S.colors = { ...S.colors, ...colors };
      render();
    },
    setOption(key, value) {
      S[key] = value;
      render();
    },
    resetZoom() { setView(0, S.length - 1); },
    get view() { return [...S.view]; },
    render,
    destroy() { ro.disconnect(); canvas.remove(); tip.remove(); badge.remove(); },
  };
}
