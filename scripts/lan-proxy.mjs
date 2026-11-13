// Presents the local Hallway Worker to the LAN as if it were asked on its own
// loopback address (ADR 0017).
//
// Dev sign-in and the cookie rules trust only a loopback host (ADR 0008):
// a request to http://192.168.0.60:<port> straight at wrangler would get 404
// from /api/dev/sign-in and a Secure cookie the browser drops on plain http.
// This proxy listens on every interface and forwards each request to the
// Worker with the Host header set to the Worker's own loopback address, so the
// Worker sees what `npm run dev` on this machine would see. Nothing else about
// the request changes. A `Location` that points back at the Worker's loopback
// origin is rewritten to the address the browser used, so redirects stay on
// the LAN.
//
// Off unless asked: the AppHost starts it only with HALLWAY_LAN=1, and it is
// a dev tool; it never runs anywhere but this machine.
//
//   node scripts/lan-proxy.mjs                 reads PORT and API_URL
//   node scripts/lan-proxy.mjs <port> <url>    the same, as arguments
import http from "node:http";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * A server (not yet listening) that forwards every request to `target`, an
 * http URL on a loopback host such as http://127.0.0.1:41234.
 */
export function createLanProxy(target) {
  const upstream = new URL(target);
  return http.createServer((request, response) => {
    const forwarded = http.request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: upstream.host },
      },
      (answer) => {
        const headers = { ...answer.headers };
        const location = headers.location;
        if (typeof location === "string" && location.startsWith(upstream.origin) && request.headers.host) {
          headers.location = `http://${request.headers.host}${location.slice(upstream.origin.length)}`;
        }
        response.writeHead(answer.statusCode ?? 502, headers);
        answer.pipe(response);
      },
    );
    forwarded.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Hallway is not answering at ${upstream.origin}.\n`);
    });
    request.pipe(forwarded);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT);
  const target = process.argv[3] ?? process.env.API_URL;
  if (!port || !target) {
    console.error("Usage: node scripts/lan-proxy.mjs <listen-port> <api-url>, or PORT and API_URL in the environment.");
    process.exit(2);
  }
  const server = createLanProxy(target);
  server.listen(port, "0.0.0.0", () => console.log(`LAN proxy on 0.0.0.0:${port} -> ${target}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
