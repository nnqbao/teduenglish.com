// Production server: Next.js, plus the self-hosted Convex backend under /_convex on the same origin.
// The site has a single public hostname (teduenglish.com), so the browser reaches Convex — HTTP and
// the realtime websocket — through here: /_convex/api/... → http://127.0.0.1:3280/api/...
import http from "node:http";
import net from "node:net";
import next from "next";

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const PREFIX = "/_convex";
const backendUrl = new URL(process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3280");
const BACKEND = { host: backendUrl.hostname, port: Number(backendUrl.port || 80) };

const app = next({ dev: false, hostname: "localhost", port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

const isConvex = (url = "") => url === PREFIX || url.startsWith(PREFIX + "/");
const backendPath = (url) => url.slice(PREFIX.length) || "/";

function proxyHttp(req, res) {
  const upstream = http.request(
    { ...BACKEND, method: req.method, path: backendPath(req.url), headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("Convex backend unavailable");
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const upstream = net.connect(BACKEND.port, BACKEND.host, () => {
    const lines = [`${req.method} ${backendPath(req.url)} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
      lines.push(k.toLowerCase() === "host" ? `Host: ${BACKEND.host}:${BACKEND.port}` : `${k}: ${v}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
}

const server = http.createServer((req, res) => (isConvex(req.url) ? proxyHttp(req, res) : handle(req, res)));
server.on("upgrade", (req, socket, head) => (isConvex(req.url) ? proxyUpgrade(req, socket, head) : socket.destroy()));
server.keepAliveTimeout = 65_000;
server.listen(PORT, HOST, () => console.log(`> TEDU English on http://${HOST}:${PORT} (Convex at ${PREFIX} → ${backendUrl.origin})`));
