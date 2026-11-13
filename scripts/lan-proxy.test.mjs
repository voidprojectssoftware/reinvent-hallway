// The LAN proxy (scripts/lan-proxy.mjs) must make a request from another
// machine look, to the Worker, like one asked on loopback: that is all dev
// sign-in and the cookie rules check (ADR 0008, ADR 0017).
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createLanProxy } from "./lan-proxy.mjs";

let worker;
let proxy;
let workerUrl;
let proxyPort;
const seen = [];

const listen = (server, host) =>
  new Promise((done) => server.listen(0, host, () => done(server.address().port)));

before(async () => {
  // Stands in for wrangler dev: records what it was asked, and redirects to
  // its own loopback origin the way a Worker that builds absolute URLs from
  // the request would.
  worker = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, host: request.headers.host, cookie: request.headers.cookie, body });
      if (request.url === "/redirect") {
        response.writeHead(302, { location: `${workerUrl}/after?x=1` });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "set-cookie": "hallway_session=s; Path=/; HttpOnly" });
      response.end(JSON.stringify({ host: request.headers.host }));
    });
  });
  workerUrl = `http://127.0.0.1:${await listen(worker, "127.0.0.1")}`;
  proxy = createLanProxy(workerUrl);
  proxyPort = await listen(proxy, "0.0.0.0");
});

after(() => {
  proxy.close();
  worker.close();
});

test("the Worker sees its own loopback host, and the method, path, body and cookie unchanged", async () => {
  const response = await fetch(`http://localhost:${proxyPort}/api/dev/sign-in?x=1`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "a=b" },
    body: JSON.stringify({ name: "Blake Hastings" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), "hallway_session=s; Path=/; HttpOnly");
  const last = seen.at(-1);
  assert.equal(last.host, new URL(workerUrl).host);
  assert.equal(last.method, "POST");
  assert.equal(last.url, "/api/dev/sign-in?x=1");
  assert.equal(last.cookie, "a=b");
  assert.deepEqual(JSON.parse(last.body), { name: "Blake Hastings" });
});

test("a redirect back to the Worker's loopback origin stays on the address the browser used", async () => {
  const response = await fetch(`http://localhost:${proxyPort}/redirect`, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `http://localhost:${proxyPort}/after?x=1`);
});

test("a Worker that is not answering is a 502 that says so", async () => {
  const dead = createLanProxy("http://127.0.0.1:1");
  const port = await listen(dead, "127.0.0.1");
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /not answering/);
  } finally {
    dead.close();
  }
});
