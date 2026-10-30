/* ============================================================
   InfoLen · 内联图标集（Material Symbols 风格，描边式）
   ============================================================ */

const P = {
  upload: '<path d="M12 15.5V4.5"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4.5v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  layers: '<path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5Z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.8 12 21.3l8.5-4.5"/>',
  chart: '<path d="M4 20.2h16"/><rect x="5.6" y="11" width="3.2" height="6" rx="1.1"/><rect x="10.4" y="6.2" width="3.2" height="10.8" rx="1.1"/><rect x="15.2" y="13.4" width="3.2" height="3.6" rx="1.1"/>',
  tune: '<path d="M4 8h6"/><path d="M14 8h6"/><circle cx="12" cy="8" r="2.2"/><path d="M4 16h9"/><path d="M17 16h3"/><circle cx="15" cy="16" r="2.2"/>',
  palette: '<path d="M12 3.2c4.9 0 8.8 3.7 8.8 8.4 0 3.4-2.4 5.4-5 5.4h-1.4c-1 0-1.7.6-1.7 1.5 0 .7.4 1.1.4 1.7 0 .7-.7 1.3-1.6 1.3-4.4 0-7.5-3.9-7.5-9 0-5.1 3.9-9.3 8-9.3Z"/><circle class="fill" cx="8.2" cy="10.6" r="1.15"/><circle class="fill" cx="12" cy="7.6" r="1.15"/><circle class="fill" cx="16" cy="10.2" r="1.15"/>',
  image: '<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="3.2"/><circle cx="8.6" cy="9.6" r="1.7"/><path d="M4.2 17.6l4.6-4.6 3.2 3.2 3-3 5 5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  wave: '<path d="M2.6 12.4c1.4-7 2.8-7 4.2 0s2.8 7 4.2 0 2.8-7 4.2 0 2.8 7 4.2 0"/>',
  contour: '<path d="M12 3.6c4.6 0 8.4 3.7 8.4 8.4s-3.8 8.4-8.4 8.4-8.4-3.7-8.4-8.4S7.4 3.6 12 3.6Z"/><path d="M12 7.4c2.6 0 4.6 2.1 4.6 4.6s-2 4.6-4.6 4.6-4.6-2.1-4.6-4.6S9.4 7.4 12 7.4Z"/><circle class="fill" cx="12" cy="12" r="1.35"/>',
  contrast: '<circle cx="12" cy="12" r="8.6"/><path class="fill" d="M12 3.4a8.6 8.6 0 0 1 0 17.2Z"/>',
  heat: '<path d="M14 14.2V5.2a2 2 0 1 0-4 0v9a4 4 0 1 0 4 0Z"/><path d="M12 17.4v-5.6"/>',
  profile: '<path d="M3.6 17.4 8 11l3.5 3.2L15 6.6l5.4 7"/><path d="M3.6 20.4h16.8"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5.2"/><path d="M12 7.9h.01"/>',
  close: '<path d="M6.2 6.2 17.8 17.8"/><path d="M17.8 6.2 6.2 17.8"/>',
  play: '<path d="M8.6 5.6v12.8L18.4 12Z"/>',
  colorize: '<path d="M4.6 19.4l1.1-3.9L15 6.2a2.4 2.4 0 0 1 3.4 3.4L9.1 19l-4.5.4Z"/><path d="M14.3 7.2l3.4 3.4"/>',
  lock: '<rect x="5" y="10.6" width="14" height="9.4" rx="2.6"/><path d="M8.2 10.6V8a3.8 3.8 0 0 1 7.6 0v2.6"/>',
  unlock: '<rect x="5" y="10.6" width="14" height="9.4" rx="2.6"/><path d="M8.2 10.6V8a3.8 3.8 0 0 1 7.2-1.5"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6 7.2 7.2M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  dark: '<path d="M20 14.2A8.6 8.6 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2Z"/>',
  sparkle: '<path d="M11 3.5l1.7 4.4 4.4 1.7-4.4 1.7L11 15.7 9.3 11.3 4.9 9.6l4.4-1.7L11 3.5Z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
  pan: '<path d="M12 4v16M4 12h16"/><path d="m12 4-2.4 2.4M12 4l2.4 2.4M12 20l-2.4-2.4M12 20l2.4-2.4M4 12l2.4-2.4M4 12l2.4 2.4M20 12l-2.4-2.4M20 12l-2.4 2.4"/>',
  zoom_in: '<circle cx="11" cy="11" r="6.6"/><path d="M15.8 15.8 20.4 20.4"/><path d="M11 8.4v5.2M8.4 11h5.2"/>',
  add: '<path d="M12 5.5v13M5.5 12h13"/>',
  remove: '<path d="M5.5 12h13"/>',
  fit: '<path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9M20 9V5.6A1.6 1.6 0 0 0 18.4 4H15M4 15v3.4A1.6 1.6 0 0 0 5.6 20H9M20 15v3.4A1.6 1.6 0 0 1 18.4 20H15"/>',
  actual: '<path d="M4 9.5V6a2 2 0 0 1 2-2h3.5M20 9.5V6a2 2 0 0 0-2-2h-3.5M4 14.5V18a2 2 0 0 0 2 2h3.5M20 14.5V18a2 2 0 0 1-2 2h-3.5"/><rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1.2"/>',
  expand_more: '<path d="M6 9.5 12 15.5 18 9.5"/>',
  refresh: '<path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4"/><path d="M20.4 4.6v4.6H15.8"/>',
  eye: '<path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eye_off: '<path d="M4 19.6 20 4.4"/><path d="M9.7 7.5A9.6 9.6 0 0 1 12 7.2c6 0 9.4 4.8 9.4 4.8a16.4 16.4 0 0 1-2.7 3.3M6.4 8.9A16.4 16.4 0 0 0 2.6 12s3.4 4.8 9.4 4.8a9.5 9.5 0 0 0 3-.5"/><path d="M10.2 10.4a2.8 2.8 0 0 0 3.7 3.9"/>',
  video: '<rect x="3" y="5.6" width="13" height="12.8" rx="3"/><path d="M16 11.2l5-2.9v7.4l-5-2.9z"/>',
  timer: '<circle cx="12" cy="13" r="7.8"/><path d="M12 9.4V13l2.4 1.7M9.4 2.6h5.2"/>',
  crop: '<path d="M6.6 2.6v14.8H21.4"/><path d="M2.6 6.6h14.8V21.4"/>',
  logo: '<path d="M6 18.5v-5M10.6 18.5V6.5M15.2 18.5v-7.5M19.8 18.5V9.5"/>',
  seed: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  rhythm: '<path d="M3 12.6h3.1l1.9-4.8 2.6 9.4 2.2-6.6 1.7 2H21"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/>',
};

export function icon(name, { size } = {}) {
  const body = P[name] || P.info;
  const style = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"${style}>${body}</svg>`;
}

export function applyIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    if (node.dataset.iconDone === "1") return;
    node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon));
    node.dataset.iconDone = "1";
  });
}
