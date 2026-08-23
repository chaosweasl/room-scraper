import { createServer } from "http";
import { getStats } from "./monitor";

/**
 * Minimal HTTP server exposing a /health endpoint with per-source stats,
 * consumed by Docker healthchecks and (optionally) the dashboard.
 */
export function startHealthServer(port = 8080) {
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          uptime: process.uptime(),
          sources: getStats(),
        }),
      );
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`💚 Health server listening on http://0.0.0.0:${port}/health`);
  });

  return server;
}
