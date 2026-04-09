import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const PREFERRED_PORT = Number(process.env.PORT ?? 4173);
const MAX_PORT_TRIES = 10;
const ROOT = process.cwd();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function resolvePath(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let targetPath = path.join(ROOT, normalized);

  if (requested === "/" || requested === "") {
    targetPath = path.join(ROOT, "web", "index.html");
  }

  try {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return path.join(targetPath, "index.html");
    }
  } catch {
    if (requested.startsWith("/web/")) return targetPath;
    return path.join(ROOT, "web", "index.html");
  }

  return targetPath;
}

async function requestHandler(req, res) {
  try {
    const filePath = await resolvePath(req.url ?? "/");
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function listenWithFallback(startPort) {
  let port = startPort;
  let tries = 0;

  const tryListen = () => {
    const server = http.createServer(requestHandler);

    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" && tries < MAX_PORT_TRIES - 1) {
        port += 1;
        tries += 1;
        tryListen();
        return;
      }
      throw error;
    });

    server.once("listening", () => {
      console.log(`Serving ${ROOT} at http://localhost:${port}`);
      if (port !== startPort) {
        console.log(`Preferred port ${startPort} was in use, using ${port} instead.`);
      }
    });

    server.listen(port);
  };

  tryListen();
}

listenWithFallback(PREFERRED_PORT);
