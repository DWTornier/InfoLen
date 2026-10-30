# InfoLen

A browser-based viewer for **media information density mapping**. Drop in an image or video and InfoLen computes the frame's *local information density* in real time, then overlays it as heatmap, contour, grid, edge, spectrum and profile views — every chart is zoomable.

The interface follows **Material You (M3)** strictly: it extracts a seed color from the current media (the first frame for video), builds a full tonal palette from it, and drives the whole UI with that palette. The media itself is monochrome-mapped through the primary gradient and blurred into a frosted acrylic background.

UI language: **English by default**, switchable to 简体中文 (top-right `EN / 中`), persisted in `localStorage`.

## Run

```bash
node server.cjs      # or: python -m http.server 5173
# open http://localhost:5173        (?sample=1 loads a generated sample)
```

> It uses native ES modules, so it must be served over http — opening `index.html` directly will not work.

## Information density algorithm

Four metrics are measured per grid cell, each normalised and then blended by weight:

| Metric | Meaning | Implementation |
| --- | --- | --- |
| Local entropy | How disordered the luminance distribution is | Shannon entropy of a 16-level sampled histogram |
| Contrast | Local variation | Neighbourhood standard deviation (integral images) |
| Gradient energy | Edge strength | Mean Sobel magnitude |
| High-frequency energy | Detail / texture | Mean absolute Laplacian |

Normalisation supports **percentile (2%–98%)** and **min–max**, plus a γ response curve.

### Performance design

- Analysis is split into two stages: `prepare()` (resize / luminance / gradient / integral images, ≈13 ms) runs once and is cached; `computeDensity()` for another grid size costs only 0.3–8 ms, so sliders stay responsive.
- The FFT spectrum is computed lazily (when the spectrum layer is enabled or the distribution panel is opened) and cached.
- The acrylic background blur is done with three box-blur passes on a 128 px canvas (≈Gaussian); the browser only applies a light 9 px blur. The stage canvas no longer sits under a live `backdrop-filter`.
- Panning / zooming enters a fast mode: numeric cell labels and contour glow are suspended while interacting.

## Composition rhythm (80/20 scoring)

The **Rhythm** panel detects high-density regions (8-connectivity + Otsu auto threshold) and produces a reference score of 0–100.

**Overall (coarse grid, default 12 columns)** — the rhythm of the whole frame:

| Metric | Ideal | Meaning |
| --- | --- | --- |
| High-density area share | ≈ 20% | High / low density area 80/20 |
| Region size · 80/20 | Top 20% hold 80% of area | Clear primary / secondary hierarchy |
| Uneven sizes | Gini ≈ 0.5 | Region areas clearly uneven |
| Region spacing · 80/20 | Top 20% hold 80% of distance | Dense vs sparse contrast |
| Uneven spacing | CV ≥ 0.38 | Gaps vary |
| Staggered layout | Low alignment / regularity | Not in rows, columns or an even lattice |
| Gaze loop | Head and tail close | The eye can return to the start — a bonus |

**Local (fine grid, default 65 columns)** — inside the subject area (the densest cluster found by the overall pass, auto-outlined), it measures the share of focal density (top-tier P85 detail of the whole frame, ideally ≈20%) and the internal hierarchy.

**Applicability**: when there are too few regions (1–2), relational metrics such as "uneven spacing" are meaningless — they are marked **N/A and excluded from the score** instead of scoring 0, and the panel explains how many regions would be needed. The 80/20 judgement is normalised between "perfectly uniform" (0) and "top 20% hold 80%" (1) so small samples are not crushed by the theoretical extreme.

**Visual salience ranking and guidance path**: each region is ranked by **density 0.30 · color visibility 0.22 (OKLab distance from the frame's mean color + own chroma) · local contrast 0.17 · area 0.12 · face 0.12 · position 0.07 (near the centre or a thirds intersection)**. The panel lists the ranking with all factors; the canvas draws an arrowed "visual guidance path".

**Face / subject likelihood**: pixels are labelled with a cheap skin-tone heuristic (warm, r>g>b — works for both real and anime skin); regions with ≥35% skin are **auto-marked as "face detected"**. Marking is fully overridable:

- Every row in the guidance list has a **face toggle** plus badges (detected / manually marked / manually excluded)
- **Select all / Clear all** batch buttons at the top of the list
- Hovering a region on the canvas shows a detail tooltip; **clicking the region toggles its face mark**
- Marks immediately change salience and the guidance path

All O(pixels), with no model and no extra dependency.

**Border fade**: the frame border creates gradients that viewers never notice, so density fades inward with smoothstep (default 2.5 cells, adjustable 0–8 or off).

**Markers**: regions and the subject are drawn as **convex-hull polygons** (Andrew monotone chain, expanded half a cell to enclose the cells). The rhythm layer can be hidden entirely, or per element: hulls / subject / path / gaze loop / order numbers / coarse grid.

**Always-on score**: a "Composition rhythm XX.X · grade" badge floats at the top-right of the stage; clicking it opens the rhythm panel.

## Seed color strategies

Default is **Accent**: `chroma³ × √count` weighting, so a small high-chroma foreground (signature, title, accent) beats a large low-chroma background — e.g. yellow handwriting on a blue sky. Alternatives: Dominant (frequency weighted), Vivid (pure highest chroma), Average, Custom, and Pick-from-image.

## Overlay layers (panel → Layers)

- **Original media** — base image, opacity and background blur
- **Heatmap** — continuous shading, uniform / density-driven alpha, smooth interpolation, γ curve
- **Density grid** — discrete cells with optional grid lines and numeric labels
- **Contour** — marching-squares iso-density lines, adjustable levels / width / glow
- **Edge / high frequency** — gradient or Laplacian energy, screen blend
- **Spectrum overlay** — 2D FFT log magnitude
- **Density profile** — row / column curves
- **Rhythm markers** — convex hulls, subject outline, guidance path, gaze loop, order numbers

Each layer has its own opacity and blend mode (normal / overlay / soft light / screen / multiply / hard light / color dodge / difference / lighten).

## Zoom

- Canvas: wheel zoom at pointer, drag to pan, `Alt+drag` marquee zoom, double-click zoom, `0` fit, `1` actual pixels, `+/-`
- Charts: drag to brush a range, wheel zoom, double-click to reset

## Distribution charts (panel → Distribution)

Luminance histogram (Luma / R / G / B, optional log counts), information-density histogram, spatial frequency spectrum (radially averaged power spectrum + peak frequency / anisotropy), row & column profiles — and for video, a temporal density scan.

## Dynamic color

`sRGB ⇄ OKLab/OKLCH` conversions with gamut mapping generate the tonal palettes (tone semantics aligned with HCT's L\*). Seed strategies are listed above. Light/dark mode supports System / By media / Light / Dark. The panel shows 5 groups × 12 tones (click to copy) and a contrast check.

## Shortcuts

`Ctrl+O` open · `Ctrl+S` export · `0` fit · `1` actual pixels · `+/-` zoom · `H/Z/I` pan / marquee / pick · `Esc` collapse panel

## Layout

```
index.html
css/     tokens.css (M3 design tokens) · base.css · components.css · layout.css
js/      app.js shell · stage.js layer compositing · analysis.js density · rhythm.js rhythm
         fft.js spectrum · color.js dynamic color · colormap.js · charts.js · media.js
         background.js · ui-controls.js · ui-panels.js · i18n.js · icons.js · util.js
server.cjs
```
