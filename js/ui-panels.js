/* ============================================================
   InfoLen · 侧栏面板（图层 / 分布 / 密度 / 色彩）
   ============================================================ */

import { el, clamp } from "./util.js";
import { icon } from "./icons.js";
import { createChart } from "./charts.js";
import { COLORMAPS } from "./colormap.js";
import { toneHex, contrastRatio, hexToRgb, rgbToHex } from "./color.js";
import { t } from "./i18n.js";
import {
  section, slider, switchRow, selectField, segmented, chips, statGrid, colorInput, layerCard,
} from "./ui-controls.js";

const blendOptions = () => [
  { value: "source-over", label: t("blend.source-over") },
  { value: "overlay", label: t("blend.overlay") },
  { value: "soft-light", label: t("blend.soft-light") },
  { value: "screen", label: t("blend.screen") },
  { value: "multiply", label: t("blend.multiply") },
  { value: "hard-light", label: t("blend.hard-light") },
  { value: "color-dodge", label: t("blend.color-dodge") },
  { value: "difference", label: t("blend.difference") },
  { value: "lighten", label: t("blend.lighten") },
];

const cmOptions = () => COLORMAPS.map((c) => ({ value: c.id, label: t(`cm.${c.id}`) }));

function layerIcon(id) {
  return {
    base: "image",
    heatmap: "heat",
    grid: "grid",
    contour: "contour",
    edge: "contrast",
    spectrum: "wave",
    profile: "profile",
  }[id] || "layers";
}

const layerDesc = (id) => t(`layer.${id}.desc`);

/* ============================ 图层 ============================ */

function layerControls(app, layer) {
  const p = layer.params;
  const set = (key) => (v) => app.setLayerParam(layer.id, key, v);
  const rows = [];
  rows.push(slider({
    label: t("ctrl.opacity"), min: 0, max: 1, step: 0.01, value: layer.opacity,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => app.setLayer(layer.id, { opacity: v }),
  }));
  rows.push(selectField({
    label: t("ctrl.blend"), options: blendOptions(), value: layer.blend,
    onChange: (v) => app.setLayer(layer.id, { blend: v }),
  }));

  if (layer.id === "base") {
    rows.push(slider({
      label: t("ctrl.blur"), min: 0, max: 12, step: 0.5, value: p.blur ?? 0,
      format: (v) => `${v.toFixed(1)} px`, onInput: set("blur"),
    }));
  }
  if (layer.id === "heatmap") {
    rows.push(selectField({ label: t("ctrl.colormap"), options: cmOptions(), value: p.colormap, onChange: set("colormap") }));
    rows.push(switchRow({ label: t("ctrl.smooth"), desc: t("ctrl.smooth.desc"), value: p.smooth, onChange: set("smooth") }));
    rows.push(segmented({
      options: [
        { value: "uniform", label: t("alpha.uniform") },
        { value: "density", label: t("alpha.density") },
      ],
      value: p.alphaMode, onChange: set("alphaMode"),
    }));
    rows.push(slider({ label: t("ctrl.gamma"), min: 0.4, max: 2.4, step: 0.05, value: p.gamma, format: (v) => v.toFixed(2), onInput: set("gamma") }));
  }
  if (layer.id === "grid") {
    rows.push(selectField({ label: t("ctrl.colormap"), options: cmOptions(), value: p.colormap, onChange: set("colormap") }));
    rows.push(slider({ label: t("ctrl.gridSize"), min: 8, max: 192, step: 1, value: p.size, format: (v) => `${v}`, onInput: set("size") }));
    rows.push(switchRow({ label: t("ctrl.stroke"), value: p.stroke, onChange: set("stroke") }));
    rows.push(switchRow({ label: t("ctrl.labels"), desc: t("ctrl.labels.desc"), value: p.labels, onChange: set("labels") }));
  }
  if (layer.id === "contour") {
    rows.push(slider({ label: t("ctrl.levels"), min: 2, max: 18, step: 1, value: p.levels, format: (v) => `${v}`, onInput: set("levels") }));
    rows.push(slider({ label: t("ctrl.lineWidth"), min: 0.4, max: 6, step: 0.2, value: p.width, format: (v) => `${v.toFixed(1)} px`, onInput: set("width") }));
    rows.push(switchRow({ label: t("ctrl.glow"), value: p.glow, onChange: set("glow") }));
  }
  if (layer.id === "edge") {
    rows.push(selectField({ label: t("ctrl.colormap"), options: cmOptions(), value: p.colormap, onChange: set("colormap") }));
    rows.push(segmented({
      options: [{ value: "grad", label: t("src.grad") }, { value: "hf", label: t("src.hf") }],
      value: p.source, onChange: set("source"),
    }));
    rows.push(slider({ label: t("ctrl.gain"), min: 0.5, max: 5, step: 0.1, value: p.gain, format: (v) => `×${v.toFixed(1)}`, onInput: set("gain") }));
  }
  if (layer.id === "spectrum") {
    rows.push(selectField({ label: t("ctrl.colormap"), options: cmOptions(), value: p.colormap, onChange: set("colormap") }));
    rows.push(slider({ label: t("ctrl.spectrumGain"), min: 0.5, max: 3, step: 0.1, value: p.gain, format: (v) => `×${v.toFixed(1)}`, onInput: set("gain") }));
  }
  if (layer.id === "profile") {
    rows.push(segmented({
      options: [
        { value: "top", label: t("side.top") },
        { value: "left", label: t("side.left") },
        { value: "both", label: t("side.both") },
      ],
      value: p.side, onChange: set("side"),
    }));
    rows.push(slider({ label: t("ctrl.profileHeight"), min: 0.04, max: 0.4, step: 0.01, value: p.height, format: (v) => `${Math.round(v * 100)}%`, onInput: set("height") }));
    rows.push(slider({ label: t("ctrl.profileWidth"), min: 0.03, max: 0.4, step: 0.01, value: p.width, format: (v) => `${Math.round(v * 100)}%`, onInput: set("width") }));
    rows.push(switchRow({ label: t("ctrl.fill"), value: p.fill, onChange: set("fill") }));
  }
  return rows;
}

export function buildLayersPanel(app) {
  const root = el("div", { class: "section", style: "gap:12px" });
  const cards = new Map();

  for (const layer of app.state.layers) {
    const card = layerCard({
      iconName: layerIcon(layer.id),
      title: t(`layer.${layer.id}`),
      subtitle: layerDesc(layer.id),
      visible: layer.visible,
      onToggle: () => app.setLayer(layer.id, { visible: !layer.visible }),
      children: layerControls(app, layer),
    });
    cards.set(layer.id, card);
    root.append(card);
  }

  const hint = el("p", { class: "body-small muted", text: t("hint.layers") });
  root.append(hint);

  return {
    root,
    update() {
      for (const layer of app.state.layers) {
        cards.get(layer.id)?.setEye(layer.visible);
      }
    },
  };
}

/* ============================ 分布 ============================ */

function chartCard(title, hint, chartHost) {
  return el("div", { class: "chart-card" }, [
    el("div", { class: "chart-card__head" }, [
      el("span", { class: "chart-card__title", text: title }),
      el("span", { class: "chart-card__hint", text: hint }),
    ]),
    chartHost,
  ]);
}

const HIST_BINS = 128;

function histSeries(data, channel, log) {
  const src = data.histogram[channel];
  const step = 256 / HIST_BINS;
  const values = new Float32Array(HIST_BINS);
  for (let i = 0; i < HIST_BINS; i++) {
    let s = 0;
    for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k++) s += src[k];
    values[i] = log ? Math.log10(s + 1) : s;
  }
  return values;
}

export function buildDistPanel(app) {
  const root = el("div", { class: "section", style: "gap:16px" });

  /* --- 亮度直方图 --- */
  const histHost = el("div");
  const histChart = createChart(histHost, {
    type: "bar",
    length: HIST_BINS,
    xLabel: (i) => String(Math.round((i / HIST_BINS) * 255)),
    yLabel: (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)),
    tipFormat: (v, i) => t("tip.luma", { v: Math.round((i / HIST_BINS) * 255), c: Math.round(v) }),
    colors: app.chartColors(),
  });
  const channelChips = chips({
    options: [
      { value: "l", label: t("dist.ch.l") },
      { value: "r", label: "R" },
      { value: "g", label: "G" },
      { value: "b", label: "B" },
    ],
    value: app.state.hist.channel,
    onChange: (v) => { app.state.hist.channel = v; app.refreshDistribution(); },
  });
  const logSwitch = switchRow({
    label: t("dist.log"),
    value: app.state.hist.log,
    onChange: (v) => { app.state.hist.log = v; app.refreshDistribution(); },
  });
  root.append(section(t("dist.histogram"), "chart", [channelChips, logSwitch, chartCard("", t("dist.brushHint"), histHost)]));

  /* --- 密度分布 --- */
  const densHost = el("div");
  const DENS_BINS = 64;
  const densChart = createChart(densHost, {
    type: "bar",
    length: DENS_BINS,
    xLabel: (i) => (i / DENS_BINS).toFixed(2),
    yLabel: (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)),
    tipFormat: (v, i) => t("tip.density", { v: (i / DENS_BINS).toFixed(2), c: Math.round(v) }),
    colors: app.chartColors(),
  });
  root.append(section(t("dist.densityDist"), "heat", [chartCard("", t("dist.densityHint"), densHost)]));

  /* --- 频谱 --- */
  const specHost = el("div");
  const specChart = createChart(specHost, {
    type: "line",
    length: 128,
    xLabel: (i) => (i / 256).toFixed(2),
    yLabel: (v) => `${Math.round(v * 100)}%`,
    tipFormat: (v, i, series) => {
      const db = series?.[0]?.extra?.db?.[i];
      return `f=${(i / 256).toFixed(3)} c/px · ${db !== undefined ? db.toFixed(1) : "—"} dB`;
    },
    colors: app.chartColors(),
  });
  const specStats = statGrid([
    { label: t("stat.peakFreq"), value: "—", small: true },
    { label: t("stat.peakPower"), value: "—", small: true },
    { label: t("stat.anisotropy"), value: "—", small: true },
    { label: t("stat.spectralEntropy"), value: "—", small: true },
  ]);
  root.append(section(t("dist.spectrum"), "wave", [
    chartCard("", t("dist.spectrumHint"), specHost),
    specStats,
  ]));

  /* --- 行列剖面 --- */
  const profHost = el("div");
  const profChart = createChart(profHost, {
    type: "line",
    length: 96,
    xLabel: (i) => `${Math.round((i / 95) * 100)}%`,
    yLabel: (v) => v.toFixed(2),
    tipFormat: (v, i) => t("tip.profile", { p: Math.round((i / 95) * 100), d: v.toFixed(3) }),
    colors: app.chartColors(),
  });
  root.append(section(t("dist.profile"), "profile", [chartCard("", t("dist.profileHint"), profHost)]));

  /* --- 视频时间轴密度 --- */
  const tempHost = el("div");
  const tempChart = createChart(tempHost, {
    type: "area",
    length: 2,
    xLabel: (i) => `${i}`,
    yLabel: (v) => v.toFixed(2),
    tipFormat: (v, i, series) => {
      const tt = series?.[0]?.extra?.times?.[i];
      return t("tip.temporal", { t: tt !== undefined ? tt.toFixed(2) : i, d: v.toFixed(3) });
    },
    colors: app.chartColors(),
  });
  const scanBtn = el("button", { class: "button button--tonal", style: "align-self:flex-start" }, [
    el("span", { class: "button__icon", html: icon("timer"), "aria-hidden": "true" }),
    el("span", { text: t("dist.scan") }),
  ]);
  scanBtn.addEventListener("click", () => app.scanTemporal());
  const tempSection = section(t("dist.temporal"), "video", [
    el("p", { class: "body-small muted", text: t("dist.temporalDesc") }),
    scanBtn,
    chartCard("", t("dist.brushHint"), tempHost),
  ]);
  tempSection.hidden = true;
  root.append(tempSection);

  function update() {
    const data = app.state.data;
    const colors = app.chartColors();
    histChart.setColors(colors);
    densChart.setColors(colors);
    specChart.setColors(colors);
    profChart.setColors(colors);
    tempChart.setColors(colors);
    if (!data) return;

    histChart.setSeries([{ values: histSeries(data, app.state.hist.channel, app.state.hist.log), color: colors.primary }]);
    densChart.setSeries([{ values: densityBins(data.density, DENS_BINS), color: colors.tertiary }]);

    const sp = app.state.spectrum;
    if (sp) {
      const n = sp.radial.norm.length;
      specChart.setSeries([{ values: Float32Array.from(sp.radial.norm), color: colors.secondary, extra: sp.radial }], n);
      specStats.setValue(0, sp.peak.freq.toFixed(3));
      specStats.setValue(1, `${sp.peak.db.toFixed(1)} dB`);
      specStats.setValue(2, `${(sp.anisotropy * 100).toFixed(0)}%`);
      specStats.setValue(3, spectralEntropy(sp.radial.norm).toFixed(3));
    }

    profChart.setSeries([
      { values: resampleProfile(data.rowProfile, 96), color: colors.tertiary, type: "line" },
      { values: resampleProfile(data.colProfile, 96), color: colors.primary, type: "line" },
    ], 96);

    const temporal = app.state.temporal;
    if (temporal) {
      tempSection.hidden = false;
      const n = temporal.values.length;
      tempChart.setSeries([{
        values: temporal.values,
        color: colors.primary,
        extra: { times: temporal.times },
      }], n);
      tempChart.setOption("xLabel", (i) => `${(temporal.times?.[Math.round(i)] ?? 0).toFixed(1)}s`);
    } else {
      tempSection.hidden = app.state.media?.kind !== "video";
    }
  }

  return { root, update };
}

function densityBins(density, bins) {
  const out = new Float32Array(bins);
  for (let i = 0; i < density.length; i++) {
    out[clamp(Math.floor(density[i] * bins), 0, bins - 1)]++;
  }
  return out;
}

/** 线性插值重采样（避免 round/floor 带来的系统性偏移） */
function resampleProfile(src, n) {
  const out = new Float32Array(n);
  const m = src.length;
  if (m === 0) return out;
  if (m === 1) { out.fill(src[0]); return out; }
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (m - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(m - 1, i0 + 1);
    const f = t - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

function spectralEntropy(norm) {
  let sum = 0;
  for (let i = 0; i < norm.length; i++) sum += norm[i];
  if (sum <= 0) return 0;
  let e = 0;
  for (let i = 0; i < norm.length; i++) {
    const p = norm[i] / sum;
    if (p > 0) e -= p * Math.log2(p);
  }
  return e / Math.log2(norm.length);
}

/* ============================ 节奏 ============================ */

const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;

function scoreRow(part) {
  const fill = el("div", { class: `score-bar__fill${part.score < 0.5 ? " is-low" : ""}`, style: `width:${Math.round(part.score * 100)}%` });
  const valueNode = el("span", { class: "score-row__value mono", text: fmtMetric(part.key, part.value) });
  const row = el("div", { class: "score-row", title: t(`part.${part.key}.hint`) }, [
    el("div", { class: "score-row__head" }, [
      el("span", { text: t(`part.${part.key}`) }),
      valueNode,
    ]),
    el("div", { class: "score-bar" }, [fill]),
    el("span", { class: "score-row__hint", text: t(`part.${part.key}.hint`) }),
  ]);
  row.update = (p) => {
    const na = p.applicable === false;
    row.classList.toggle("is-na", na);
    fill.style.width = na ? "0%" : `${Math.round(p.score * 100)}%`;
    fill.classList.toggle("is-low", p.score < 0.5);
    valueNode.textContent = na ? t("rhythm.na", { n: p.need || 2 }) : fmtMetric(p.key, p.value);
  };
  return row;
}

const METRIC_PCT = new Set(["stagger", "coverage", "localRatio", "sizePareto", "distPareto", "localPareto"]);
function fmtMetric(key, v) {
  if (METRIC_PCT.has(key)) return pct(v);
  if (key === "sizeVariety" || key === "distVariety") return v.toFixed(2);
  return v.toFixed(3);
}

export function buildRhythmPanel(app) {
  const root = el("div", { class: "section", style: "gap:16px" });
  const rp = app.state.rhythmParams;

  /* 总分 */
  const totalValue = el("div", { class: "score-hero__value", text: "—" });
  const gradeChip = el("span", { class: "score-hero__grade", text: t("rhythm.pending") });
  const subText = el("span", { class: "body-small muted", text: "—" });
  const hero = el("div", { class: "score-hero" }, [
    el("div", { class: "score-hero__main" }, [
      el("span", { class: "label-medium muted", text: t("rhythm.scoreLabel") }),
      el("div", { class: "score-hero__row" }, [totalValue, gradeChip]),
      subText,
    ]),
  ]);

  /* 判定 */
  const verdicts = el("div", { class: "chips" });
  const verdictNote = el("p", { class: "body-small muted", text: t("rhythm.verdictDesc") });

  /* 分项 */
  const globalRows = el("div", { class: "score-list" });
  const localRows = el("div", { class: "score-list" });
  const rowMap = new Map();

  const stats = statGrid([
    { label: t("stat.regionCount"), value: "—", small: true },
    { label: t("stat.coverage"), value: "—", small: true },
    { label: t("stat.subject"), value: "—", small: true },
    { label: t("stat.meanDist"), value: "—", small: true },
    { label: t("stat.stagger"), value: "—", small: true },
    { label: t("stat.localHigh"), value: "—", small: true },
  ]);

  /* 控制 */
  const globalSlider = slider({
    label: t("rhythm.globalGrid"), min: 4, max: 48, step: 1, value: rp.globalGrid,
    format: (v) => `${v}`,
    onInput: (v) => app.setRhythmParam("globalGrid", v),
  });
  const localSlider = slider({
    label: t("rhythm.localGrid"), min: 16, max: 192, step: 1, value: rp.localGrid,
    format: (v) => `${v}`,
    onInput: (v) => app.setRhythmParam("localGrid", v),
  });
  const weightSlider = slider({
    label: t("rhythm.weight"), min: 0, max: 1, step: 0.05, value: rp.wGlobal,
    format: (v) => t("rhythm.weightValue", { a: Math.round(v * 100), b: Math.round((1 - v) * 100) }),
    onInput: (v) => app.setRhythmParam("wGlobal", v),
  });
  const thrMode = segmented({
    options: [{ value: "auto", label: t("thr.auto") }, { value: "manual", label: t("thr.manual") }],
    value: rp.thresholdMode,
    onChange: (v) => app.setRhythmParam("thresholdMode", v),
  });
  const thrSlider = slider({
    label: t("rhythm.threshold"), min: 0.1, max: 0.9, step: 0.01, value: rp.threshold,
    format: (v) => v.toFixed(2),
    onInput: (v) => app.setRhythmParam("threshold", v),
  });

  const recalcBtn = el("button", { class: "button button--tonal", style: "align-self:flex-start" }, [
    el("span", { class: "button__icon", html: icon("refresh"), "aria-hidden": "true" }),
    el("span", { text: t("rhythm.recalc") }),
  ]);
  recalcBtn.addEventListener("click", () => app.computeRhythm());

  const rhythmLayer = () => app.state.layers.find((l) => l.id === "rhythm");
  const gridSwitch = switchRow({
    label: t("rhythm.grid"),
    value: rhythmLayer()?.params.grid !== false,
    onChange: (v) => app.setLayerParam("rhythm", "grid", v),
  });
  const hullSwitch = switchRow({
    label: t("rhythm.hull"),
    desc: t("rhythm.hull.desc"),
    value: rhythmLayer()?.params.hull !== false,
    onChange: (v) => app.setLayerParam("rhythm", "hull", v),
  });
  const subjectSwitch = switchRow({
    label: t("rhythm.subject"),
    value: rhythmLayer()?.params.subject !== false,
    onChange: (v) => app.setLayerParam("rhythm", "subject", v),
  });
  const pathSwitch = switchRow({
    label: t("rhythm.path"),
    desc: t("rhythm.path.desc"),
    value: rhythmLayer()?.params.path !== false,
    onChange: (v) => app.setLayerParam("rhythm", "path", v),
  });
  const labelSwitch = switchRow({
    label: t("rhythm.rankLabels"),
    value: rhythmLayer()?.params.labels !== false,
    onChange: (v) => app.setLayerParam("rhythm", "labels", v),
  });
  const loopSwitch = switchRow({
    label: t("rhythm.loop"),
    desc: t("rhythm.loop.desc"),
    value: rhythmLayer()?.params.loop !== false,
    onChange: (v) => app.setLayerParam("rhythm", "loop", v),
  });

  /* 视觉引导顺序 */
  const orderList = el("div", { class: "order-list" });
  const batchNote = el("span", { class: "order-batch__note" });
  const batchRow = el("div", { class: "order-batch" }, [
    batchNote,
    el("span", { class: "order-batch__spacer" }),
    el("button", { class: "chip", type: "button", text: t("rhythm.selectAll"), title: t("rhythm.allFacesOn") }),
    el("button", { class: "chip", type: "button", text: t("rhythm.selectNone"), title: t("rhythm.allFacesOff") }),
  ]);
  const [selectAllBtn, selectNoneBtn] = batchRow.querySelectorAll("button");
  selectAllBtn.addEventListener("click", () => app.setAllFaces(true));
  selectNoneBtn.addEventListener("click", () => app.setAllFaces(false));

  const skipNote = el("p", { class: "body-small muted" });

  root.append(
    hero,
    section(t("rhythm.verdict"), "rhythm", [verdictNote, verdicts, skipNote]),
    section(t("rhythm.order"), "target", [
      el("p", { class: "body-small muted", text: t("rhythm.orderDesc") }),
      batchRow,
      orderList,
    ]),
    section(t("rhythm.global"), "grid", [globalRows]),
    section(t("rhythm.local"), "contour", [localRows]),
    section(t("rhythm.stats"), "chart", [stats]),
    section(t("rhythm.params"), "tune", [
      globalSlider,
      localSlider,
      weightSlider,
      el("div", { class: "field" }, [el("span", { class: "field__label", text: t("rhythm.threshold") }), thrMode]),
      thrSlider,
      recalcBtn,
      el("div", { class: "divider" }),
      hullSwitch,
      subjectSwitch,
      pathSwitch,
      labelSwitch,
      loopSwitch,
      gridSwitch,
    ])
  );

  function syncOrder(r) {
    orderList.innerHTML = "";
    if (!r.order?.length) {
      batchRow.hidden = true;
      orderList.append(el("p", { class: "body-small muted", text: t("rhythm.empty") }));
      return;
    }
    batchRow.hidden = false;
    const total = r.totalCells || 1;
    const autoCount = r.regions.filter((x) => x.autoFace).length;
    batchNote.textContent = autoCount
      ? t("rhythm.batchNote", { n: autoCount })
      : t("rhythm.batchNone");
    r.order.forEach((reg, i) => {
      const f = reg.factors || {};
      const hex = rgbToHex(reg.colorRgb || [128, 128, 128]);
      const faceBtn = el("button", {
        class: `order-face${reg.isFace ? " is-on" : ""}`,
        type: "button",
        title: t("tip.hint"),
        text: t("rhythm.faceBtn"),
      });
      faceBtn.addEventListener("click", () => app.setRegionFace(reg.id, !reg.isFace));
      const factorsText = t("rhythm.factors", {
        a: (f.density ?? 0).toFixed(2),
        b: (f.color ?? 0).toFixed(2),
        c: (f.contrast ?? 0).toFixed(2),
        d: (f.area ?? 0).toFixed(2),
        e: (f.position ?? 0).toFixed(2),
        f: (f.face ?? 0).toFixed(2),
      });
      orderList.append(el("div", { class: "order-item" }, [
        el("span", { class: "order-rank", text: String(i + 1) }),
        el("span", { class: "order-swatch", style: `background:${hex}`, title: hex }),
        el("div", { class: "order-meta" }, [
          el("span", { class: "label-medium", text: t("rhythm.areaDensity", { a: pct(reg.area / total), d: reg.mean.toFixed(2) }) }),
          el("span", { class: "order-factors", title: factorsText, text: factorsText }),
          el("div", { class: "order-badges" }, [
            reg.autoFace ? el("span", { class: "order-badge is-auto", text: t("rhythm.badgeAuto") }) : null,
            reg.faceMarked === false ? el("span", { class: "order-badge", text: t("rhythm.badgeManualOff") }) : null,
            reg.faceMarked === true && !reg.autoFace ? el("span", { class: "order-badge is-auto", text: t("rhythm.badgeManualOn") }) : null,
          ]),
          el("div", { class: "score-bar" }, [
            el("div", { class: "score-bar__fill", style: `width:${Math.round((reg.salience || 0) * 100)}%` }),
          ]),
        ]),
        el("span", { class: "order-score mono", text: (reg.salience || 0).toFixed(2) }),
        faceBtn,
      ]));
    });
  }

  function syncRows(container, list) {
    container.innerHTML = "";
    for (const part of list) {
      const row = scoreRow(part);
      rowMap.set(part.key, row);
      container.append(row);
    }
  }

  function update() {
    const r = app.state.rhythm;
    const rl = rhythmLayer();
    gridSwitch.setValue(rl?.params.grid !== false);
    hullSwitch.setValue(rl?.params.hull !== false);
    subjectSwitch.setValue(rl?.params.subject !== false);
    pathSwitch.setValue(rl?.params.path !== false);
    labelSwitch.setValue(rl?.params.labels !== false);
    loopSwitch.setValue(rl?.params.loop !== false);
    thrMode.setValue(rp.thresholdMode);
    globalSlider.setValue(rp.globalGrid);
    localSlider.setValue(rp.localGrid);
    weightSlider.setValue(rp.wGlobal);
    if (!r) {
      totalValue.textContent = "—";
      gradeChip.textContent = t("rhythm.pending");
      return;
    }
    totalValue.textContent = r.total.toFixed(1);
    gradeChip.textContent = t(`grade.${r.grade}`);
    subText.textContent = t("rhythm.sub", {
      g: (r.globalScore * 100).toFixed(0),
      l: (r.localScore * 100).toFixed(0),
      t: r.thresholdGlobal.toFixed(2),
      mode: rp.thresholdMode === "auto" ? t("thr.otsu") : t("thr.manualMode"),
    });

    verdicts.innerHTML = "";
    const all = [...r.parts, ...r.localParts].filter((p) => p.applicable !== false);
    for (const p of all) {
      const ok = p.score >= 0.6;
      verdicts.append(el("span", {
        class: `verdict ${ok ? "is-ok" : "is-bad"}`,
        text: `${ok ? t("rhythm.verdictOk") : t("rhythm.verdictBad")} · ${t(`part.${p.key}`)} ${fmtMetric(p.key, p.value)}`,
        title: t(`part.${p.key}.hint`),
      }));
    }
    skipNote.textContent = r.skippedNote ? t("rhythm.skipped", r.skippedNote) : "";
    syncOrder(r);

    if (!rowMap.has(r.parts[0]?.key)) syncRows(globalRows, r.parts);
    if (!rowMap.has(r.localParts[0]?.key)) syncRows(localRows, r.localParts);
    for (const p of r.parts) rowMap.get(p.key)?.update?.(p);
    for (const p of r.localParts) rowMap.get(p.key)?.update?.(p);

    const m = r.metrics;
    stats.setValue(0, String(m.n));
    stats.setValue(1, pct(r.coverage));
    stats.setValue(2, `${Math.round(r.subject.w * 100)}×${Math.round(r.subject.h * 100)}%`);
    stats.setValue(3, m.meanDist ? m.meanDist.toFixed(3) : "—");
    stats.setValue(4, pct(m.stagger));
    stats.setValue(5, t("rhythm.localCells", { a: pct(r.local.highRatio), c: r.local.cells }));
  }

  return { root, update };
}

/* ============================ 密度 ============================ */

export function buildDensityPanel(app) {
  const root = el("div", { class: "section", style: "gap:16px" });
  const ap = app.state.analysisParams;

  /* 视频抽帧 */
  const frameSection = section(t("density.source"), "video", []);
  const frameStrip = el("div", { class: "frame-strip" });
  const frameSlider = slider({
    label: t("density.frameTime"), min: 0, max: 1, step: 0.01, value: 0,
    format: (v) => `${v.toFixed(2)} s`,
    onInput: (v) => app.seekFrame(v),
  });
  frameSection.append(
    el("p", { class: "body-small muted", text: t("density.sourceDesc") }),
    frameSlider,
    frameStrip
  );
  frameSection.hidden = true;
  root.append(frameSection);

  const stats = statGrid([
    { label: t("stat.meanDensity"), value: "—" },
    { label: t("stat.maxDensity"), value: "—" },
    { label: t("stat.p95"), value: "—" },
    { label: t("stat.p50"), value: "—" },
    { label: t("stat.globalEntropy"), value: "—", small: true },
    { label: t("stat.meanLuma"), value: "—", small: true },
    { label: t("stat.peakPos"), value: "—", small: true },
    { label: t("stat.grid"), value: "—", small: true },
  ]);

  const weights = el("div", { class: "section", style: "gap:10px" }, [
    slider({ label: t("density.wEntropy"), min: 0, max: 1, step: 0.05, value: ap.weights.entropy, format: (v) => v.toFixed(2), onInput: (v) => app.setAnalysisParam("weights", { ...ap.weights, entropy: v }) }),
    slider({ label: t("density.wContrast"), min: 0, max: 1, step: 0.05, value: ap.weights.contrast, format: (v) => v.toFixed(2), onInput: (v) => app.setAnalysisParam("weights", { ...ap.weights, contrast: v }) }),
    slider({ label: t("density.wGradient"), min: 0, max: 1, step: 0.05, value: ap.weights.gradient, format: (v) => v.toFixed(2), onInput: (v) => app.setAnalysisParam("weights", { ...ap.weights, gradient: v }) }),
    slider({ label: t("density.wHf"), min: 0, max: 1, step: 0.05, value: ap.weights.hf, format: (v) => v.toFixed(2), onInput: (v) => app.setAnalysisParam("weights", { ...ap.weights, hf: v }) }),
  ]);

  root.append(section(t("density.metrics"), "tune", [
    el("p", { class: "body-small muted", text: t("density.metricsDesc") }),
    weights,
  ]));

  root.append(section(t("density.sampling"), "grid", [
    slider({ label: t("density.gridSize"), min: 16, max: 192, step: 1, value: ap.gridSize, format: (v) => `${v} × ${Math.round((v * (app.state.data?.ah || 9)) / (app.state.data?.aw || 16))}`, onInput: (v) => app.setAnalysisParam("gridSize", v) }),
    segmented({
      options: [{ value: 0, label: t("nb.0") }, { value: 1, label: t("nb.1") }, { value: 2, label: t("nb.2") }],
      value: ap.radius,
      onChange: (v) => app.setAnalysisParam("radius", Number(v)),
    }),
    slider({ label: t("density.maxDim"), min: 256, max: 768, step: 32, value: ap.maxDim, format: (v) => `${v} px`, onInput: (v) => app.setAnalysisParam("maxDim", v) }),
    slider({ label: t("density.borderFade"), min: 0, max: 8, step: 0.5, value: ap.borderFade, format: (v) => (v === 0 ? t("density.borderFade.off") : t("density.borderFade.value", { v: v.toFixed(1) })), onInput: (v) => app.setAnalysisParam("borderFade", v) }),
    selectField({
      label: t("density.norm"),
      options: [
        { value: "percentile", label: t("norm.percentile") },
        { value: "minmax", label: t("norm.minmax") },
      ],
      value: ap.norm,
      onChange: (v) => app.setAnalysisParam("norm", v),
    }),
    slider({ label: t("ctrl.gamma"), min: 0.4, max: 2.4, step: 0.05, value: ap.gamma, format: (v) => v.toFixed(2), onInput: (v) => app.setAnalysisParam("gamma", v) }),
  ]));

  root.append(section(t("rhythm.stats"), "chart", [stats]));

  function update() {
    const d = app.state.data;
    const media = app.state.media;
    frameSection.hidden = media?.kind !== "video";
    if (media?.kind === "video") {
      const input = frameSlider.querySelector("input");
      if (input) {
        input.max = String(media.duration || 1);
        input.step = String(Math.max(0.01, (media.duration || 1) / 200));
      }
      frameSlider.setValue(media.frameTime || 0);
      if (frameStrip.children.length === 0) app.buildFrameStrip();
    }
    if (!d) return;
    const s = d.stats;
    stats.setValue(0, s.meanDensity.toFixed(3));
    stats.setValue(1, s.maxDensity.toFixed(3));
    stats.setValue(2, s.p95.toFixed(3));
    stats.setValue(3, s.p50.toFixed(3));
    stats.setValue(4, s.globalEntropy.toFixed(3));
    stats.setValue(5, s.meanLuma.toFixed(3));
    stats.setValue(6, `${(s.peak.x * 100).toFixed(0)}%, ${(s.peak.y * 100).toFixed(0)}%`);
    stats.setValue(7, `${d.gw} × ${d.gh}`);
  }

  const panel = { root, update };
  panel.frameStrip = frameStrip;
  return panel;
}

/* ============================ 色彩 ============================ */

const SHOW_TONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 100];

export function buildColorPanel(app) {
  const root = el("div", { class: "section", style: "gap:16px" });
  const theme = app.state.theme;

  const hero = el("div", { class: "palette-hero" }, [
    el("div", { class: "palette-hero__dot" }),
    el("div", { class: "palette-hero__meta" }, [
      el("span", { class: "body-small", text: t("color.hero") }),
      el("span", { class: "palette-hero__hex", text: "#000000" }),
      el("span", { class: "body-small muted", text: t("color.heroHint") }),
    ]),
  ]);
  const dot = hero.firstChild;
  const hexText = hero.querySelector(".palette-hero__hex");
  const seedMeta = hero.querySelector(".body-small.muted");

  const lockRow = switchRow({
    label: t("color.lock"),
    desc: t("color.lock.desc"),
    value: theme.locked,
    onChange: (v) => app.setThemePref({ locked: v }),
  });

  const strategy = segmented({
    options: [
      { value: "accent", label: t("strat.accent") },
      { value: "dominant", label: t("strat.dominant") },
      { value: "vivid", label: t("strat.vivid") },
      { value: "mean", label: t("strat.mean") },
      { value: "custom", label: t("strat.custom") },
    ],
    value: theme.strategy,
    onChange: (v) => app.setThemePref({ strategy: v }),
  });

  const customRow = el("div", { class: "field" }, [
    el("span", { class: "field__label", text: t("color.customSeed") }),
    colorInput({
      label: t("color.customSeed"),
      value: theme.customSeed || "#6750a4",
      onChange: (v) => app.setThemePref({ customSeed: v, strategy: "custom" }),
    }),
  ]);

  const thumb = el("div", { class: "seed-thumb" });
  const thumbCanvas = el("canvas", { width: 320, height: 180 });
  thumb.append(thumbCanvas);
  thumb.addEventListener("click", (ev) => {
    const r = thumbCanvas.getBoundingClientRect();
    const nx = clamp((ev.clientX - r.left) / r.width, 0, 1);
    const ny = clamp((ev.clientY - r.top) / r.height, 0, 1);
    app.pickSeedAt(nx, ny);
  });

  const modeSeg = segmented({
    options: [
      { value: "system", label: t("mode.system") },
      { value: "media", label: t("mode.media") },
      { value: "light", label: t("mode.light") },
      { value: "dark", label: t("mode.dark") },
    ],
    value: theme.modeSource,
    onChange: (v) => app.setThemePref({ modeSource: v }),
  });

  const contrastStats = statGrid([
    { label: t("stat.primaryContrast"), value: "—", small: true },
    { label: t("stat.containerContrast"), value: "—", small: true },
    { label: t("stat.mediaLuma"), value: "—", small: true },
    { label: t("stat.mediaChroma"), value: "—", small: true },
  ]);

  const paletteRoot = el("div", { class: "section", style: "gap:10px" });

  root.append(
    section(t("panel.color"), "palette", [
      hero,
      lockRow,
      el("div", { class: "field" }, [el("span", { class: "field__label", text: t("color.strategy") }), strategy]),
      customRow,
      el("div", { class: "field" }, [
        el("span", { class: "field__label", text: t("color.pickFromImage") }),
        thumb,
      ]),
    ]),
    section(t("color.mode"), "contrast", [modeSeg]),
    section(t("color.tonal"), "layers", [paletteRoot]),
    section(t("color.contrast"), "info", [contrastStats])
  );

  function update() {
    const th = app.state.theme;
    const scheme = th.scheme;
    if (!scheme) return;
    dot.style.background = th.roles?.primary || "#6750a4";
    hexText.textContent = rgbToHex(th.seedRgb || [103, 80, 164]);
    seedMeta.textContent = t("color.seedMeta", { h: Math.round(scheme.seed.h), c: scheme.seed.C.toFixed(3), hex: scheme.seed.hex });
    strategy.setValue(th.strategy);
    modeSeg.setValue(th.modeSource);
    lockRow.setValue(th.locked);
    customRow.querySelector("input[type=color]").value = th.customSeed || th.seedHex || "#6750a4";
    customRow.querySelector("input[type=text]").value = th.customSeed || th.seedHex || "#6750a4";

    // 缩略图
    const media = app.state.media;
    if (media?.canvas) {
      const c = thumbCanvas;
      const ctx = c.getContext("2d");
      const ratio = media.canvas.height / media.canvas.width;
      c.width = 320;
      c.height = Math.max(1, Math.round(320 * ratio));
      ctx.drawImage(media.canvas, 0, 0, c.width, c.height);
    }

    // 色调阶梯
    paletteRoot.innerHTML = "";
    const groups = [
      [t("palette.primary"), scheme.primary],
      [t("palette.secondary"), scheme.secondary],
      [t("palette.tertiary"), scheme.tertiary],
      [t("palette.neutral"), scheme.neutral],
      [t("palette.neutralVariant"), scheme.neutralVariant],
    ];
    for (const [name, key] of groups) {
      const row = el("div", { class: "palette-row" });
      for (const tone of SHOW_TONES) {
        const hex = toneHex(key, tone);
        const sw = el("button", {
          class: "palette-swatch",
          style: `background:${hex}`,
          title: `${name} · tone ${tone} · ${hex} · ${t("color.heroHint")}`,
          "aria-label": `${name} tone ${tone}`,
        });
        sw.addEventListener("click", () => app.copyHex(hex));
        row.append(sw);
      }
      paletteRoot.append(el("div", { class: "palette-group" }, [
        el("div", { class: "palette-group__name" }, [
          el("span", { text: name }),
          el("span", { class: "mono", text: `C ${key.C.toFixed(3)}` }),
        ]),
        row,
      ]));
    }

    if (th.roles) {
      const bg = hexToRgb(th.roles.surface);
      const p = hexToRgb(th.roles.primary);
      const pc = hexToRgb(th.roles.primaryContainer);
      const opc = hexToRgb(th.roles.onPrimaryContainer);
      contrastStats.setValue(0, `${contrastRatio(p, bg).toFixed(2)}:1`);
      contrastStats.setValue(1, `${contrastRatio(pc, opc).toFixed(2)}:1`);
      const cs = app.state.colorStats;
      contrastStats.setValue(2, cs ? cs.meanLuma.toFixed(3) : "—");
      contrastStats.setValue(3, scheme.seed.C.toFixed(3));
    }
  }

  return { root, update };
}
