/* ============================================================
   InfoLen · 应用主控
   ============================================================ */

import { $, el, clamp, debounce, fmtBytes, fmtTime, downloadFile, canvasToBlob, nextFrame } from "./util.js";
import { applyIcons, icon } from "./icons.js";
import { analyze, prepare, computeDensity } from "./analysis.js";
import { computeRhythm } from "./rhythm.js";
import { computeSpectrum } from "./fft.js";
import { createStage } from "./stage.js";
import { loadMediaFromFile, releaseMedia, grabFrame, createSampleMedia, mediaKindOf } from "./media.js";
import { renderAcrylic, mediaColorStats } from "./background.js";
import { buildScheme, buildRoles, applyRoles, hexToRgb, rgbToHex } from "./color.js";
import { buildLayersPanel, buildDistPanel, buildDensityPanel, buildColorPanel, buildRhythmPanel } from "./ui-panels.js";
import { t, getLocale, setLocale, applyStatic, LOCALES } from "./i18n.js";

/* ---------------- 状态 ---------------- */

// 显示名由 i18n 的 layer.<id> 提供，这里只作为兜底
const DEFAULT_LAYERS = [
  { id: "base", name: "Original media", visible: true, opacity: 1, blend: "source-over", params: { blur: 0 } },
  { id: "heatmap", name: "Heatmap", visible: true, opacity: 0.75, blend: "source-over", params: { colormap: "primary", smooth: true, alphaMode: "uniform", gamma: 1 } },
  { id: "grid", name: "Density grid", visible: false, opacity: 0.6, blend: "source-over", params: { colormap: "primary", size: 48, stroke: true, labels: false } },
  { id: "contour", name: "Contour", visible: false, opacity: 0.85, blend: "source-over", params: { levels: 6, width: 1.4, glow: false } },
  { id: "edge", name: "Edge / high frequency", visible: false, opacity: 0.55, blend: "screen", params: { colormap: "gray", source: "grad", gain: 1.8 } },
  { id: "spectrum", name: "Spectrum overlay", visible: false, opacity: 0.45, blend: "screen", params: { colormap: "primary", gain: 1.2 } },
  { id: "profile", name: "Density profile", visible: false, opacity: 0.9, blend: "source-over", params: { side: "both", height: 0.14, width: 0.12, fill: true } },
  { id: "rhythm", name: "Rhythm markers", visible: false, opacity: 0.95, blend: "source-over", params: { grid: false, subject: true, hull: true, path: true, loop: true, labels: true } },
];

const state = {
  media: null,
  data: null,
  spectrum: null,
  temporal: null,
  colorStats: null,
  layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
  analysisParams: {
    maxDim: 512,
    gridSize: 96,
    radius: 1,
    weights: { entropy: 0.35, contrast: 0.25, gradient: 0.25, hf: 0.15 },
    norm: "percentile",
    gamma: 1,
    borderFade: 2.5,
  },
  hist: { channel: "l", log: false },
  rhythmParams: {
    globalGrid: 12,
    localGrid: 65,
    wGlobal: 0.5,
    wLocal: 0.5,
    thresholdMode: "auto",
    threshold: 0.5,
  },
  rhythm: null,
  faceOverrides: {},
  prep: null,
  prepKey: "",
  spectrumKey: "",
  theme: {
    modeSource: "system",
    mode: "dark",
    strategy: "accent",
    customSeed: null,
    locked: false,
    scheme: null,
    roles: null,
    seedRgb: [103, 80, 164],
    seedHex: "#6750a4",
  },
  tool: "pan",
  panel: null,
};

/* ---------------- DOM ---------------- */

const dom = {
  workspace: $("#workspace"),
  stageSurface: $("#stageSurface"),
  canvas: $("#stage"),
  stageEmpty: $("#stageEmpty"),
  stageLoading: $("#stageLoading"),
  loadingText: $("#loadingText"),
  dropVeil: $("#dropVeil"),
  langSegmented: $("#langSegmented"),
  stageScore: $("#stageScore"),
  stageScoreValue: $("#stageScoreValue"),
  stageScoreGrade: $("#stageScoreGrade"),
  stageHud: $("#stageHud"),
  panel: $("#panel"),
  panelTitle: $("#panelTitle"),
  panelBody: $("#panelBody"),
  railItems: $("#railItems"),
  statusMedia: $("#statusMedia"),
  statusCursor: $("#statusCursor"),
  zoomValue: $("#zoomValue"),
  appBarSubtitle: $("#appBarSubtitle"),
  brandMark: $("#brandMark"),
  themeSegmented: $("#themeSegmented"),
  snackbarHost: $("#snackbarHost"),
  fileInput: $("#fileInput"),
  helpDialog: $("#helpDialog"),
};

applyIcons();
dom.brandMark.innerHTML = icon("logo");

/* ---------------- 舞台 ---------------- */

const stage = createStage(dom.canvas, dom.stageSurface);
stage.setLayers(state.layers);
stage.setTool(state.tool);

stage.bus.on("view", ({ percent }) => { dom.zoomValue.textContent = `${percent}%`; });
stage.bus.on("hover", (info) => {
  if (!info) { dom.statusCursor.textContent = ""; return; }
  const d = info.density;
  dom.statusCursor.textContent =
    `x ${info.px} · y ${info.py} · 密度 ${d === null ? "—" : d.toFixed(3)}`;
});
stage.bus.on("pick", ({ x, y }) => pickSeedAt(x, y));

/* 高密度区域悬浮提示 + 单击切换人脸标记 */
const regionTip = el("div", { class: "region-tip", id: "regionTip", hidden: true });
dom.stageSurface.append(regionTip);

stage.bus.on("hover", (info) => {
  if (!info || !info.region) { regionTip.hidden = true; return; }
  const reg = info.region;
  const total = state.rhythm?.totalCells || 1;
  const faceText = reg.faceMarked === true
    ? t("tip.faceMarked")
    : reg.faceMarked === false
      ? t("tip.faceExcluded")
      : reg.autoFace
        ? t("tip.faceAuto")
        : t("tip.faceNone");
  regionTip.innerHTML = `
    <div class="region-tip__head"><b>#${reg.rank + 1}</b> ${t("tip.region")} · ${t("tip.area", { a: `${Math.round((reg.area / total) * 100)}%` })}</div>
    <div class="region-tip__row">${t("tip.densitySal", { d: reg.mean.toFixed(2), s: (reg.salience ?? 0).toFixed(2) })}</div>
    <div class="region-tip__row">${t("tip.faceLabel")} <b>${faceText}</b>${reg.faceMarked === null && reg.autoFace ? ` <span class="region-tip__auto">${t("tip.autoTag")}</span>` : ""}</div>
    <div class="region-tip__hint">${t("tip.hint")}</div>`;
  regionTip.hidden = false;
  const tipRect = regionTip.getBoundingClientRect();
  const hostRect = dom.stageSurface.getBoundingClientRect();
  const x = clamp(info.sx + 14, 8, hostRect.width - tipRect.width - 8);
  const y = clamp(info.sy - tipRect.height - 12, 8, hostRect.height - tipRect.height - 8);
  regionTip.style.left = `${x}px`;
  regionTip.style.top = `${y}px`;
});
stage.bus.on("regionClick", (reg) => appApi.setRegionFace(reg.id, !reg.isFace));

/* ---------------- 主题 ---------------- */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartColors() {
  return {
    primary: cssVar("--md-sys-color-primary") || "#c8c0ff",
    secondary: cssVar("--md-sys-color-secondary") || "#c9c3dc",
    tertiary: cssVar("--md-sys-color-tertiary") || "#efb8c8",
    outline: cssVar("--md-sys-color-outline-variant") || "#49454f",
    text: cssVar("--md-sys-color-on-surface-variant") || "#cac4d0",
  };
}

function resolveMode() {
  const src = state.theme.modeSource;
  if (src === "light" || src === "dark") return src;
  if (src === "media") {
    const luma = state.colorStats?.meanLuma ?? 0.5;
    return luma < 0.42 ? "dark" : "light";
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function pickSeedRgb() {
  const cs = state.colorStats;
  const t = state.theme;
  switch (t.strategy) {
    case "accent": return cs?.accent || cs?.dominant || [103, 80, 164];
    case "vivid": return cs?.vivid || cs?.accent || cs?.dominant || [103, 80, 164];
    case "mean": return cs?.mean || [103, 80, 164];
    case "custom": return hexToRgb(t.customSeed || t.seedHex || "#6750a4");
    default: return cs?.dominant || [103, 80, 164];
  }
}

function applyTheme({ forceSeed = false } = {}) {
  const t = state.theme;
  if (forceSeed || !t.locked) {
    t.seedRgb = pickSeedRgb();
    t.seedHex = rgbToHex(t.seedRgb);
  }
  const mode = resolveMode();
  t.mode = mode;
  t.scheme = buildScheme(t.seedRgb);
  t.roles = buildRoles(t.scheme, mode);
  applyRoles(t.roles, mode);
  if (state.media?.canvas) renderAcrylic(state.media.canvas, t.scheme, mode);
  stage.setColors(
    {
      primary: t.roles.primary,
      onPrimary: t.roles.onPrimary,
      secondary: t.roles.secondary,
      tertiary: t.roles.tertiary,
      outline: t.roles.outlineVariant,
      surface: t.roles.surface,
    },
    mode,
    t.scheme
  );
  updatePanels();
}

/* ---------------- 面板管理 ---------------- */

const PANELS = [
  { id: "layers", labelKey: "panel.layers", shortKey: "panel.layers", icon: "layers" },
  { id: "rhythm", labelKey: "panel.rhythm", shortKey: "panel.rhythm", icon: "rhythm" },
  { id: "dist", labelKey: "panel.dist", shortKey: "panel.dist", icon: "chart" },
  { id: "density", labelKey: "panel.density", shortKey: "panel.density", icon: "tune" },
  { id: "color", labelKey: "panel.color", shortKey: "panel.color", icon: "palette" },
];

const BUILDERS = {
  layers: buildLayersPanel,
  rhythm: buildRhythmPanel,
  dist: buildDistPanel,
  density: buildDensityPanel,
  color: buildColorPanel,
};

const builtPanels = new Map();

function buildRail() {
  dom.railItems.innerHTML = "";
  for (const p of PANELS) {
    const item = el("button", { class: "nav-rail__item", type: "button", "data-id": p.id, title: t(p.labelKey) }, [
      el("span", { class: "nav-rail__indicator" }),
      el("span", { html: icon(p.icon), "aria-hidden": "true" }),
      el("span", { text: t(p.shortKey) }),
    ]);
    item.addEventListener("click", () => togglePanel(p.id));
    dom.railItems.append(el("li", {}, [item]));
  }
}

function syncRail() {
  dom.railItems.querySelectorAll(".nav-rail__item").forEach((n) => {
    n.classList.toggle("is-active", n.dataset.id === state.panel);
  });
}

function togglePanel(id) {
  if (state.panel === id) { closePanel(); return; }
  openPanel(id);
}

function openPanel(id) {
  state.panel = id;
  const meta = PANELS.find((p) => p.id === id);
  dom.panelTitle.textContent = meta ? t(meta.labelKey) : "";
  dom.panel.hidden = false;
  dom.workspace.classList.add("has-panel");
  if (id === "dist") ensureSpectrum();
  if (id === "rhythm") {
    const layer = state.layers.find((l) => l.id === "rhythm");
    if (layer && !layer.visible) appApi.setLayer("rhythm", { visible: true });
    if (!state.rhythm) computeRhythmNow();
  }
  if (!builtPanels.has(id)) builtPanels.set(id, BUILDERS[id](appApi));
  const built = builtPanels.get(id);
  dom.panelBody.innerHTML = "";
  dom.panelBody.append(built.root);
  built.update?.();
  syncRail();
}

function closePanel() {
  state.panel = null;
  dom.panel.hidden = true;
  dom.workspace.classList.remove("has-panel");
  syncRail();
}

function updatePanels() {
  builtPanels.forEach((p) => p.update?.());
}

/* ---------------- 分析 ---------------- */

function showLoading(on, textKey = "load.analysis") {
  dom.stageLoading.hidden = !on;
  dom.loadingText.textContent = t(textKey);
}

/* 预处理缓存：缩放 / 灰度 / 梯度 / 积分图只做一次，多个网格尺寸复用 */
let mediaSeq = 0;
let frameSeq = 0;

function ensurePrep() {
  if (!state.media) return null;
  const key = `${mediaSeq}|${frameSeq}|${state.analysisParams.maxDim}`;
  if (!state.prep || state.prepKey !== key) {
    state.prep = prepare(state.media.canvas, state.analysisParams.maxDim);
    state.prepKey = key;
  }
  return state.prep;
}

function ensureSpectrum(force = false) {
  if (!state.prep) return null;
  if (!force && state.spectrum && state.spectrumKey === state.prepKey) return state.spectrum;
  const sp = computeSpectrum(state.prep.gray, state.prep.aw, state.prep.ah, 256);
  state.spectrum = sp;
  state.spectrumKey = state.prepKey;
  stage.setSpectrum(sp);
  return sp;
}

function computeRhythmNow() {
  const prep = ensurePrep();
  if (!prep) return null;
  state.rhythm = computeRhythm(prep, state.analysisParams, {
    ...state.rhythmParams,
    faceOverrides: state.faceOverrides,
  });
  stage.setRhythm(state.rhythm);
  updateScoreBadge();
  return state.rhythm;
}

function updateScoreBadge() {
  const badge = dom.stageScore;
  if (!badge) return;
  const r = state.rhythm;
  badge.hidden = !r;
  if (!r) return;
  dom.stageScoreValue.textContent = r.total.toFixed(1);
  dom.stageScoreGrade.textContent = t(`grade.${r.grade}`);
}

async function runAnalysis({ spectrum: withSpectrum = false } = {}) {
  if (!state.media) return;
  const prep = ensurePrep();
  if (!prep) return;
  const d = computeDensity(prep, state.analysisParams);
  state.data = {
    ...d,
    aw: prep.aw,
    ah: prep.ah,
    scale: prep.scale,
    gray: prep.gray,
    grad: prep.grad,
    hf: prep.hf,
    histogram: prep.histogram,
    stats: { ...d.stats, ...prep.stats },
  };
  stage.setData(state.data);
  if (withSpectrum) ensureSpectrum(true);
  computeRhythmNow();
  updatePanels();
}

const requestAnalysis = debounce(() => runAnalysis({ spectrum: false }), 180);
const requestRhythm = debounce(() => { computeRhythmNow(); updatePanels(); }, 220);

/* ---------------- 媒体载入 ---------------- */

async function loadFile(file) {
  if (!file) return;
  if (!mediaKindOf(file)) { toast(t("toast.unsupported", { name: file.name })); return; }
  showLoading(true, "load.media");
  try {
    const media = await loadMediaFromFile(file);
    adoptMedia(media);
    toast(t("toast.loaded", { name: media.name }));
  } catch (err) {
    toast(t("toast.loadFailed", { msg: err.message }));
  } finally {
    showLoading(false);
  }
}

async function adoptMedia(media) {
  if (state.media && state.media !== media) releaseMedia(state.media);
  state.media = media;
  state.temporal = null;
  state.data = null;
  state.spectrum = null;
  state.rhythm = null;
  state.faceOverrides = {};
  state.spectrumKey = "";
  state.prep = null;
  state.prepKey = "";
  mediaSeq++;
  frameSeq = 0;

  dom.stageEmpty.classList.add("is-hidden");
  dom.stageHud.hidden = false;
  stage.setMedia(media);
  stage.setLayers(state.layers);

  state.colorStats = mediaColorStats(media.canvas);
  applyTheme({ forceSeed: !state.theme.locked });

  updateMediaInfo();
  await runAnalysis({ spectrum: false });

  if (media.kind === "video") {
    await buildFrameStrip();
    frameSeq++;
    state.prepKey = "";
    await runAnalysis({ spectrum: false });
  }
  if (!state.panel) openPanel("layers");
}

async function loadSample() {
  showLoading(true, "load.sample");
  await nextFrame();
  const media = createSampleMedia();
  adoptMedia(media);
  showLoading(false);
  toast(t("toast.sampleReady"));
}

function invalidateFrame() {
  frameSeq++;
  state.prepKey = "";
  state.spectrumKey = "";
}

async function seekFrame(t) {
  const media = state.media;
  if (!media?.video) return;
  await grabFrame(media, t);
  invalidateFrame();
  state.colorStats = mediaColorStats(media.canvas);
  applyTheme({ forceSeed: !state.theme.locked });
  await runAnalysis({ spectrum: false });
}

const requestSeek = debounce((t) => seekFrame(t), 260);

let stripBuilding = false;

async function buildFrameStrip() {
  if (stripBuilding) return;
  const built = builtPanels.get("density");
  const strip = built?.frameStrip;
  const media = state.media;
  if (!strip || !media?.video) return;
  stripBuilding = true;
  try {
    const current = media.frameTime || 0;
    strip.innerHTML = "";
    const dur = Math.max(0.001, (media.duration || 1) - 0.02);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const t = (dur * i) / (count - 1);
      // eslint-disable-next-line no-await-in-loop
      await grabFrame(media, t);
      const c = el("canvas", { width: 96 });
      c.height = Math.max(1, Math.round((96 * media.canvas.height) / media.canvas.width));
      c.getContext("2d").drawImage(media.canvas, 0, 0, c.width, c.height);
      const item = el("button", { class: "frame-strip__item", type: "button", title: `t=${t.toFixed(2)}s` }, [c]);
      item.addEventListener("click", () => { seekFrame(t); syncStrip(t); });
      strip.append(item);
      strip.dataset.dur = String(dur);
    }
    await grabFrame(media, current);
  } finally {
    stripBuilding = false;
  }
}

function syncStrip(t) {
  const strip = builtPanels.get("density")?.frameStrip;
  if (!strip) return;
  const dur = Number(strip.dataset.dur || 1) || 1;
  Array.from(strip.children).forEach((child, i) => {
    const ct = (dur * i) / Math.max(1, strip.children.length - 1);
    child.classList.toggle("is-active", Math.abs(ct - t) < dur * 0.06);
  });
}

async function scanTemporal() {
  const media = state.media;
  if (!media?.video) { toast(t("toast.videoOnly")); return; }
  const saved = media.frameTime || 0;
  const N = 24;
  const values = new Float32Array(N);
  const times = new Float32Array(N);
  showLoading(true, "load.scan");
  const dur = Math.max(0.001, (media.duration || 1) - 0.02);
  for (let i = 0; i < N; i++) {
    const t = (dur * i) / (N - 1);
    // eslint-disable-next-line no-await-in-loop
    await grabFrame(media, t);
    const d = analyze(media.canvas, { ...state.analysisParams, maxDim: 256, gridSize: 48 });
    values[i] = d.stats.meanDensity;
    times[i] = t;
    // eslint-disable-next-line no-await-in-loop
    await nextFrame();
  }
  state.temporal = { values, times };
  await grabFrame(media, saved);
  invalidateFrame();
  await runAnalysis({ spectrum: false });
  showLoading(false);
  openPanel("dist");
  toast(t("toast.scanDone"));
}

/* ---------------- 动作 API（供面板调用） ---------------- */

const appApi = {
  state,
  setLayer(id, patch) {
    const layer = state.layers.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    if (id === "spectrum" && layer.visible) ensureSpectrum();
    stage.setLayers(state.layers);
    builtPanels.get("layers")?.update?.();
  },
  setLayerParam(id, key, value) {
    const layer = state.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.params[key] = value;
    stage.setLayers(state.layers);
  },
  setAnalysisParam(key, value) {
    state.analysisParams[key] = value;
    if (key === "maxDim") requestAnalysisHeavy();
    else requestAnalysis();
  },
  setThemePref(patch) {
    Object.assign(state.theme, patch);
    applyTheme();
    syncThemeSegmented();
  },
  setRhythmParam(key, value) {
    state.rhythmParams[key] = value;
    if (key === "wGlobal") state.rhythmParams.wLocal = 1 - value;
    requestRhythm();
  },
  computeRhythm() { computeRhythmNow(); updatePanels(); },
  setRegionFace(id, isFace) {
    state.faceOverrides[id] = !!isFace;
    computeRhythmNow();
    updatePanels();
    toast(t(isFace ? "toast.faceOn" : "toast.faceOff", { n: id + 1 }));
    return state.rhythm?.regions.find((x) => x.id === id);
  },
  setAllFaces(isFace) {
    const regions = state.rhythm?.regions || [];
    for (const r of regions) state.faceOverrides[r.id] = !!isFace;
    computeRhythmNow();
    updatePanels();
    toast(t(isFace ? "toast.allFacesOn" : "toast.allFacesOff"));
  },
  refreshDistribution() { builtPanels.get("dist")?.update?.(); },
  chartColors,
  seekFrame(t) { requestSeek(t); },
  buildFrameStrip,
  scanTemporal,
  pickSeedAt,
  copyHex(hex) {
    navigator.clipboard?.writeText(hex).then(
      () => toast(t("toast.copied", { hex })),
      () => toast(hex)
    );
  },
};

const requestAnalysisHeavy = debounce(() => runAnalysis({ spectrum: true }), 320);

function pickSeedAt(nx, ny) {
  const media = state.media;
  if (!media?.canvas) return;
  const c = media.canvas;
  const x = clamp(Math.round(nx * c.width), 0, c.width - 1);
  const y = clamp(Math.round(ny * c.height), 0, c.height - 1);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const px = ctx.getImageData(x, y, 1, 1).data;
  const hex = rgbToHex([px[0], px[1], px[2]]);
  state.theme.customSeed = hex;
  state.theme.strategy = "custom";
  applyTheme({ forceSeed: true });
  toast(t("toast.picked", { hex }));
}

/* ---------------- 顶部 / 状态栏 ---------------- */

function updateMediaInfo() {
  const m = state.media;
  if (!m) {
    dom.statusMedia.textContent = t("status.none");
    dom.appBarSubtitle.textContent = t("app.subtitle");
    return;
  }
  const size = m.size ? ` · ${fmtBytes(m.size)}` : "";
  const dur = m.kind === "video" ? ` · ${fmtTime(m.duration)}` : "";
  dom.statusMedia.textContent = `${m.name} · ${m.width}×${m.height}${size}${dur}`;
  dom.appBarSubtitle.textContent = `${m.name} · ${m.width}×${m.height}${dur}`;
}

function syncThemeSegmented() {
  const v = state.theme.modeSource === "media" ? "system" : state.theme.modeSource;
  dom.themeSegmented.setValue?.(v);
}

function buildLangSegmented() {
  dom.langSegmented.innerHTML = "";
  const buttons = LOCALES.map((loc) => {
    const b = el("button", {
      class: "segmented__item",
      type: "button",
      title: loc.label,
      "aria-label": `${t("action.language")} ${loc.label}`,
      text: loc.label,
    });
    b.addEventListener("click", () => changeLocale(loc.value));
    return b;
  });
  dom.langSegmented.append(...buttons);
  syncLangSegmented();
}

function syncLangSegmented() {
  const cur = getLocale();
  Array.from(dom.langSegmented.children).forEach((b, i) => {
    b.classList.toggle("is-selected", LOCALES[i].value === cur);
  });
}

function changeLocale(locale) {
  if (locale === getLocale()) return;
  setLocale(locale);
  applyStatic();
  syncLangSegmented();
  updateMediaInfo();
  updateScoreBadge();
  // 面板内容含大量文案：丢弃缓存后重建
  builtPanels.clear();
  const current = state.panel;
  state.panel = null;
  if (current) openPanel(current);
  else syncRail();
  buildRail();
}

function buildThemeSegmented() {
  const opts = [
    { value: "system", label: t("mode.system"), icon: "contrast" },
    { value: "light", label: t("mode.light"), icon: "light" },
    { value: "dark", label: t("mode.dark"), icon: "dark" },
  ];
  const items = opts.map((o) => {
    const b = el("button", {
      class: "segmented__item",
      type: "button",
      title: o.label,
      "aria-label": o.label,
      html: icon(o.icon),
    });
    b.addEventListener("click", () => {
      state.theme.modeSource = o.value;
      applyTheme();
      items.forEach((n) => n.classList.toggle("is-selected", n === b));
    });
    return b;
  });
  dom.themeSegmented.append(...items);
  dom.themeSegmented.setValue = (v) => items.forEach((n, i) => n.classList.toggle("is-selected", opts[i].value === v));
  syncThemeSegmented();
}

/* ---------------- Snackbar ---------------- */

function toast(message) {
  const bar = el("div", { class: "snackbar" }, [el("span", { text: message })]);
  dom.snackbarHost.append(bar);
  setTimeout(() => {
    bar.classList.add("is-leaving");
    setTimeout(() => bar.remove(), 260);
  }, 2600);
}

/* ---------------- 拖放 ---------------- */

let dragDepth = 0;

function setupDnd() {
  const show = (on) => { dom.dropVeil.hidden = !on; };
  window.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    dragDepth++;
    show(true);
  });
  window.addEventListener("dragover", (ev) => { ev.preventDefault(); });
  window.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) show(false);
  });
  window.addEventListener("drop", (ev) => {
    ev.preventDefault();
    dragDepth = 0;
    show(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
}

/* ---------------- 导出 ---------------- */

async function exportPng() {
  if (!state.media) { toast(t("toast.noMedia")); return; }
  const specLayer = state.layers.find((l) => l.id === "spectrum");
  if (specLayer?.visible) ensureSpectrum();
  const canvas = stage.exportCanvas(2);
  const blob = await canvasToBlob(canvas);
  const base = (state.media.name || "infolen").replace(/\.[^.]+$/, "");
  downloadFile(`infolen-${base}-${Date.now()}.png`, blob);
  toast(t("toast.exportedPng"));
}

function exportTheme() {
  const theme = state.theme;
  if (!theme.roles) { toast(t("toast.noMedia")); return; }
  const payload = {
    name: "InfoLen Dynamic Theme",
    source: "Material You (dynamic color from media)",
    seed: { hex: theme.seedHex, rgb: theme.seedRgb, strategy: theme.strategy },
    mode: theme.mode,
    modeSource: theme.modeSource,
    keyColors: {
      primary: theme.scheme.primary,
      secondary: theme.scheme.secondary,
      tertiary: theme.scheme.tertiary,
      neutral: theme.scheme.neutral,
      neutralVariant: theme.scheme.neutralVariant,
    },
    roles: theme.roles,
  };
  downloadFile(`infolen-theme-${Date.now()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  toast(t("toast.exportedTheme"));
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  $("#btnOpen").addEventListener("click", () => dom.fileInput.click());
  $("#fabOpen").addEventListener("click", () => dom.fileInput.click());
  $("#btnEmptyOpen").addEventListener("click", () => dom.fileInput.click());
  $("#btnEmptySample").addEventListener("click", loadSample);
  $("#btnSample").addEventListener("click", loadSample);
  $("#btnExportPng").addEventListener("click", exportPng);
  $("#btnExportTheme").addEventListener("click", exportTheme);
  $("#btnHelp").addEventListener("click", () => dom.helpDialog.showModal());
  $("#helpClose").addEventListener("click", () => dom.helpDialog.close());
  $("#panelClose").addEventListener("click", closePanel);
  dom.stageScore?.addEventListener("click", () => {
    if (state.panel === "rhythm") closePanel();
    else openPanel("rhythm");
  });
  $("#zoomIn").addEventListener("click", () => stage.zoomAtCenter(1.3));
  $("#zoomOut").addEventListener("click", () => stage.zoomAtCenter(1 / 1.3));
  $("#zoomFit").addEventListener("click", () => stage.fit());
  $("#zoomOne").addEventListener("click", () => stage.setZoom(1));
  $("#zoomValue").addEventListener("click", () => stage.fit());
  dom.fileInput.addEventListener("change", () => {
    const f = dom.fileInput.files?.[0];
    if (f) loadFile(f);
    dom.fileInput.value = "";
  });

  const toolButtons = { toolPan: "pan", toolZoom: "zoom", toolPick: "pick" };
  for (const [id, tool] of Object.entries(toolButtons)) {
    $(`#${id}`).addEventListener("click", () => setTool(tool));
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === "o") { ev.preventDefault(); dom.fileInput.click(); return; }
    if (ctrl && ev.key.toLowerCase() === "s") { ev.preventDefault(); exportPng(); return; }
    switch (ev.key) {
      case "0": stage.fit(); break;
      case "1": stage.setZoom(1); break;
      case "+": case "=": stage.zoomAtCenter(1.25); break;
      case "-": stage.zoomAtCenter(1 / 1.25); break;
      case "h": case "H": setTool("pan"); break;
      case "z": case "Z": setTool("zoom"); break;
      case "i": case "I": setTool("pick"); break;
      case "Escape": if (state.panel) closePanel(); break;
      default: break;
    }
  });

  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (state.theme.modeSource === "system") applyTheme();
  });
}

function setTool(tool) {
  state.tool = tool;
  stage.setTool(tool);
  const map = { pan: "#toolPan", zoom: "#toolZoom", pick: "#toolPick" };
  Object.values(map).forEach((sel) => $(sel).classList.remove("is-active"));
  $(map[tool])?.classList.add("is-active");
}

/* ---------------- 启动 ---------------- */

setLocale(getLocale());
applyStatic();
buildRail();
buildThemeSegmented();
buildLangSegmented();
bind();
setupDnd();
applyTheme();
setTool("pan");

window.InfoLen = { state, stage, appApi, loadFile, loadSample };

// 支持 ?sample 直接进入示例，便于演示与调试
if (/[?&]sample\b/.test(location.search)) loadSample();
