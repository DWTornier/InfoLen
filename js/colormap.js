/* ============================================================
   InfoLen · 色图（含跟随主色的动态色图）
   ============================================================ */

import { toneColor } from "./color.js";
import { clamp } from "./util.js";

const STOPS = {
  turbo: [
    [0.0, 48, 18, 59], [0.1, 65, 68, 180], [0.2, 56, 124, 224], [0.3, 35, 175, 225],
    [0.4, 75, 210, 170], [0.5, 140, 230, 110], [0.6, 205, 235, 80], [0.7, 245, 200, 60],
    [0.8, 250, 140, 40], [0.9, 225, 70, 25], [1.0, 122, 4, 3],
  ],
  viridis: [
    [0.0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1.0, 253, 231, 37],
  ],
  magma: [
    [0.0, 8, 4, 20], [0.25, 80, 18, 123], [0.5, 182, 54, 121], [0.75, 247, 137, 55], [1.0, 252, 253, 191],
  ],
  inferno: [
    [0.0, 6, 4, 18], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1.0, 252, 255, 164],
  ],
  cividis: [
    [0.0, 0, 32, 76], [0.25, 60, 74, 107], [0.5, 124, 124, 116], [0.75, 202, 157, 74], [1.0, 255, 233, 69],
  ],
  emerald: [
    [0.0, 4, 26, 22], [0.25, 6, 78, 59], [0.5, 16, 140, 100], [0.75, 90, 200, 140], [1.0, 220, 250, 228],
  ],
  azure: [
    [0.0, 4, 20, 42], [0.25, 8, 66, 120], [0.5, 20, 130, 190], [0.75, 110, 200, 235], [1.0, 226, 248, 255],
  ],
  gray: [
    [0.0, 10, 10, 14], [0.5, 128, 128, 134], [1.0, 250, 250, 252],
  ],
};

// 显示文案由 i18n 的 cm.<id> 提供，这里只作为兜底
export const COLORMAPS = [
  { id: "primary", label: "Primary (follows media)" },
  { id: "turbo", label: "Turbo" },
  { id: "viridis", label: "Viridis" },
  { id: "magma", label: "Magma" },
  { id: "inferno", label: "Inferno" },
  { id: "cividis", label: "Cividis (CVD safe)" },
  { id: "emerald", label: "Emerald" },
  { id: "azure", label: "Azure" },
  { id: "gray", label: "Neutral grayscale" },
];

function sampleStops(stops, t) {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const k = clamp((t - a[0]) / (b[0] - a[0] || 1), 0, 1);
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** 由动态配色生成的「主色」色图：中性 → 主色 → 高光 */
function primaryStops(scheme, mode) {
  if (mode === "light") {
    return [
      [0.0, ...toneColor(scheme.neutral, 98)],
      [0.18, ...toneColor(scheme.neutralVariant, 92)],
      [0.36, ...toneColor(scheme.primary, 85)],
      [0.56, ...toneColor(scheme.primary, 68)],
      [0.76, ...toneColor(scheme.primary, 50)],
      [1.0, ...toneColor(scheme.primary, 28)],
    ];
  }
  return [
    [0.0, ...toneColor(scheme.neutral, 12)],
    [0.18, ...toneColor(scheme.neutral, 22)],
    [0.36, ...toneColor(scheme.primary, 34)],
    [0.56, ...toneColor(scheme.primary, 52)],
    [0.76, ...toneColor(scheme.primary, 72)],
    [1.0, ...toneColor(scheme.primary, 94)],
  ];
}

/** 生成 256 级 LUT：Uint8Array(768) */
export function buildLut(id, scheme, mode = "dark") {
  const lut = new Uint8Array(768);
  const stops = id === "primary"
    ? primaryStops(scheme, mode)
    : STOPS[id] || STOPS.turbo;
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = sampleStops(stops, i / 255);
    lut[i * 3] = clamp(r, 0, 255);
    lut[i * 3 + 1] = clamp(g, 0, 255);
    lut[i * 3 + 2] = clamp(b, 0, 255);
  }
  return lut;
}

/** 供 UI 预览的 CSS 渐变 */
export function lutToCss(lut) {
  const parts = [];
  for (let i = 0; i <= 8; i++) {
    const idx = Math.round((i / 8) * 255) * 3;
    parts.push(`rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]}) ${(i / 8) * 100}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
