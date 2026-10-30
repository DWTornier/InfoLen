/* InfoLen · 零依赖本地静态服务器（ES Module 需要 http 协议，不能直接 file:// 打开） */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const parsed = url.parse(req.url);
    let pathname = decodeURIComponent(parsed.pathname || "/");
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ""));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(buf);
    });
  })
  .listen(PORT, () => {
    console.log(`InfoLen running at http://localhost:${PORT}`);
  });
