/* ============================================================
   InfoLen · 媒体载入（图片 / 视频首帧 / 示例生成）
   ============================================================ */

import { el } from "./util.js";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i;

export function mediaKindOf(file) {
  if (file.type.startsWith("image/") || IMAGE_EXT.test(file.name)) return "image";
  if (file.type.startsWith("video/") || VIDEO_EXT.test(file.name)) return "video";
  return null;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function canvasFromImage(img) {
  const c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function loadImage(url) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = url;
  });
  if (img.decode) {
    try { await img.decode(); } catch { /* 失败时仍可用已解码内容 */ }
  }
  if (!img.naturalWidth) throw new Error("图片解码失败");
  return img;
}

function once(target, evt, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("媒体载入超时")); }, timeout);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("媒体载入失败")); };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(evt, onOk);
      target.removeEventListener("error", onErr);
    }
    target.addEventListener(evt, onOk, { once: true });
    target.addEventListener("error", onErr, { once: true });
  });
}

async function loadVideo(url) {
  const video = el("video", { muted: true, playsinline: true, preload: "auto" });
  video.muted = true;
  video.src = url;
  await once(video, "loadedmetadata");
  return video;
}

/** 抽取视频指定时刻的帧 */
export async function grabFrame(media, time = 0) {
  const video = media.video;
  if (!video) return media.canvas;
  const t = Math.max(0, Math.min(time, Math.max(0, (media.duration || 0) - 0.001)));
  if (video.readyState < 2) await once(video, "loadeddata");
  if (Math.abs(video.currentTime - t) > 0.004) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      video.addEventListener("seeked", finish, { once: true });
      setTimeout(finish, 2500);
      try { video.currentTime = t; } catch { finish(); }
    });
  }
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  if (!media.canvas || media.canvas.width !== w || media.canvas.height !== h) {
    media.canvas = makeCanvas(w, h);
    media.width = w;
    media.height = h;
  }
  const ctx = media.canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, media.canvas.width, media.canvas.height);
  media.frameTime = t;
  return media.canvas;
}

export async function loadMediaFromFile(file) {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error(`不支持的文件类型：${file.name}`);

  const url = URL.createObjectURL(file);
  const media = {
    kind,
    name: file.name,
    size: file.size,
    type: file.type || kind,
    url,
    file,
    video: null,
    canvas: null,
    width: 0,
    height: 0,
    duration: 0,
    frameTime: 0,
  };

  try {
    if (kind === "image") {
      const img = await loadImage(url);
      media.canvas = canvasFromImage(img);
      media.width = media.canvas.width;
      media.height = media.canvas.height;
      media.image = img;
    } else {
      const video = await loadVideo(url);
      media.video = video;
      media.duration = video.duration || 0;
      media.width = video.videoWidth || 1280;
      media.height = video.videoHeight || 720;
      await grabFrame(media, 0);
    }
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return media;
}

export function releaseMedia(media) {
  if (!media) return;
  if (media.video) { media.video.pause(); media.video.removeAttribute("src"); media.video.load(); }
  if (media.url) URL.revokeObjectURL(media.url);
}

/* ---------------- 示例媒体（程序化生成） ---------------- */

export function createSampleMedia() {
  const W = 1440;
  const H = 810;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true });

  // 平滑渐变背景（低信息密度）
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#1b2436");
  g.addColorStop(0.5, "#2f3f63");
  g.addColorStop(1, "#4a3f6b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 柔和光斑
  const radial = ctx.createRadialGradient(W * 0.7, H * 0.3, 20, W * 0.7, H * 0.3, 420);
  radial.addColorStop(0, "rgba(255,220,180,0.85)");
  radial.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  // 高频棋盘格（极高密度）
  const cell = 10;
  for (let y = 40; y < 300; y += cell) {
    for (let x = 60; x < 460; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) | 0) % 2 ? "#f4f4f8" : "#141420";
      ctx.fillRect(x, y, cell, cell);
    }
  }

  // 条纹渐变（中高频，方向性强）
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.92)" : "rgba(20,20,32,0.92)";
    ctx.fillRect(520 + i * 5, 60, 3.4, 200);
  }

  // 文本块（中高密度）
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "600 30px 'Segoe UI', system-ui, sans-serif";
  const lines = ["Information Density", "信息密度分布 · InfoLen", "Entropy · Contrast · Gradient"];
  lines.forEach((t, i) => ctx.fillText(t, 60, 380 + i * 40));
  ctx.font = "400 15px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 8; i++) {
    ctx.fillText("局部熵与梯度的加权归一结果，用于衡量画面承载的细节量。", 60, 520 + i * 22);
  }

  // 噪声块（最高熵）
  const img = ctx.getImageData(980, 380, 380, 300);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 40 + Math.random() * 215;
    img.data[i] = v * 1.05;
    img.data[i + 1] = v;
    img.data[i + 2] = v * 0.95;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 980, 380);

  // 同心圆（中密度，结构清晰）
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  for (let r = 12; r < 150; r += 12) {
    ctx.lineWidth = r % 24 === 0 ? 3 : 1;
    ctx.beginPath();
    ctx.arc(700, 620, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 平滑色块（低密度对照）
  ["#7ad3ff", "#ffb27a", "#c9a7ff"].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(1120 + i * 100, 70, 90, 220);
  });

  return {
    kind: "image",
    name: "InfoLen-Sample.png",
    size: 0,
    type: "image/png",
    url: "",
    file: null,
    video: null,
    canvas: c,
    width: W,
    height: H,
    duration: 0,
    frameTime: 0,
  };
}
