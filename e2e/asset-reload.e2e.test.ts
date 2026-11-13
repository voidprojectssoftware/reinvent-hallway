// Issue #85: after a web rebuild, `npm run dev` and Aspire kept serving the
// old web app, or a blank page, until wrangler was restarted.
//
// The cause was wrangler's, set off by our config: with a custom "build"
// command in wrangler.jsonc, wrangler's asset watcher sees a change under the
// assets directory but never reloads, so the asset manifest stays as it was at
// startup. A new hashed bundle is then not a known file and gets the SPA
// fallback (index.html, text/html: a blank page), and index.html keeps its old
// ETag, so a browser revalidating it gets 304 and the old page.
//
// This boots `wrangler dev` on the real apps/api/wrangler.jsonc, but over a
// throwaway assets directory (--assets), and writes a rebuild into it the way
// `vite build --watch --no-emptyOutDir` does: index.html overwritten in place,
// a new hashed bundle beside the old one. The rebuild must be served within a
// few seconds. Nothing here touches apps/web, so it is safe beside a running
// dev server.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { freePort, stop } from "./hallway-worker.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "apps/api");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");

// With the fix it lands in about a second (measured 1.3 to 1.4 s through
// `npm run dev`, vite's rebuild included); without it, never.
const withinMs = 8_000;

const shell = (bundle: string) =>
  `<!doctype html>\n<html><head><title>Hallway</title><script type="module" src="/assets/${bundle}"></script></head><body></body></html>\n`;

let dir = "";
let url = "";
let dev: ChildProcess | undefined;
let output = "";

function build(bundle: string, marker: string) {
  writeFileSync(join(dir, "assets", bundle), `console.log(${JSON.stringify(marker)});\n`);
  writeFileSync(join(dir, "index.html"), shell(bundle));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "hallway-assets-"));
  mkdirSync(join(dir, "assets"));
  build("index-aaaa1111.js", "first build");

  const [port, inspectorPort] = [await freePort(), await freePort()];
  url = `http://127.0.0.1:${port}`;
  dev = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      join(dir, ".state"),
      "--assets",
      dir,
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: api,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  dev.stdout!.on("data", (chunk) => (output += chunk));
  dev.stderr!.on("data", (chunk) => (output += chunk));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (dev.exitCode !== null) throw new Error(`wrangler dev exited (${dev.exitCode}):\n${output}`);
    try {
      if ((await fetch(`${url}/index.html`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev did not serve within 60s:\n${output}`);
    await new Promise((done) => setTimeout(done, 250));
  }
});

afterAll(async () => {
  if (dev) await stop(dev);
  rmSync(dir, { recursive: true, force: true });
});

/** The bundle the served shell points at, and what that URL answers with. */
async function served(path: string) {
  const page = await fetch(`${url}${path}`, { headers: { "cache-control": "no-cache" } });
  const html = await page.text();
  const bundle = /\/assets\/[^"]+\.js/.exec(html)?.[0] ?? "";
  const script = bundle ? await fetch(`${url}${bundle}`) : undefined;
  return {
    etag: page.headers.get("etag"),
    bundle,
    type: script?.headers.get("content-type") ?? "",
    body: script ? await script.text() : "",
  };
}

it("serves a rebuild of the web app within seconds, without a restart", async () => {
  const before = await served("/sign-in");
  expect(before.body).toContain("first build");

  // Let wrangler's watchers settle, as a person editing would.
  await new Promise((done) => setTimeout(done, 1_000));
  const started = Date.now();
  build("index-bbbb2222.js", "second build");

  let now = before;
  while (Date.now() - started < withinMs) {
    now = await served("/sign-in");
    if (now.body.includes("second build")) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(now.bundle, `served after ${Date.now() - started} ms\n${output}`).toBe("/assets/index-bbbb2222.js");
  expect(now.type).toMatch(/javascript/);
  expect(now.body).toContain("second build");
  // A browser revalidates index.html by its ETag; an unchanged one answers 304
  // and keeps the old page.
  expect(now.etag).not.toBe(before.etag);
});
