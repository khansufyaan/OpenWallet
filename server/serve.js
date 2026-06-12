// Serves webapp-live/ and proxies /api/* to the Canton JSON Ledger API,
// so the browser app talks to the ledger without CORS configuration.
const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_DIR = path.join(__dirname, "..", "webapp-live");
const JSON_API_PORT = Number(process.env.JSON_API_PORT || 7575);
const PORT = Number(process.env.PORT || 8080);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const opts = {
      host: "localhost",
      port: JSON_API_PORT,
      path: req.url.slice("/api".length),
      method: req.method,
      headers: { "content-type": "application/json" },
    };
    const upstream = http.request(opts, (up) => {
      res.writeHead(up.statusCode, { "content-type": up.headers["content-type"] || "application/json" });
      up.pipe(res);
    });
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ proxyError: e.message }));
    });
    req.pipe(upstream);
    return;
  }
  let file = req.url.split("?")[0];
  if (file === "/") file = "/index.html";
  const fp = path.join(STATIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (!fp.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`live UI on http://localhost:${PORT} -> JSON API :${JSON_API_PORT}`));
