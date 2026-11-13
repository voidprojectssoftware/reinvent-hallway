// Vitest global setup for `npm run test:e2e`: Hallway as the real Worker
// (`wrangler dev`, the same as `npm run dev` serves), on free ports and over a
// fresh local D1 in a temporary directory, so it shares nothing with a dev
// server or another worktree's suite.
//
// wrangler runs in its own process group (`detached`), and teardown signals
// the whole group: wrangler starts workerd as a child, and killing wrangler
// alone can leave workerd holding the port. Teardown runs when the tests fail
// too, and the `exit` hook covers a run that dies before teardown.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    hallwayUrl: string;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "apps/api");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
// No prompts, no telemetry: the suite runs offline.
const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };

/** A port the OS says is free right now. */
export const freePort = () =>
  new Promise<number>((done, fail) => {
    const probe = createServer().once("error", fail).listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    process.kill(-child.pid!, signal);
  } catch {
    // ESRCH: the group is already gone, which is what we wanted.
  }
}

export async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  signalGroup(child, "SIGTERM");
  const timedOut = await Promise.race([exited.then(() => false), new Promise((done) => setTimeout(done, 5000, true))]);
  if (timedOut) signalGroup(child, "SIGKILL");
  // workerd may outlive wrangler by a moment; SIGKILL whatever is left.
  signalGroup(child, "SIGKILL");
}

async function waitUntilServing(url: string, child: ChildProcess, log: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}):\n${log()}`);
    try {
      // Answers 200 only once migrations have seeded the event.
      if ((await fetch(`${url}/api/events/reinvent2026`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`wrangler dev did not serve ${url} within 60s:\n${log()}`);
}

export default async function setup(project: TestProject) {
  const state = mkdtempSync(join(tmpdir(), "hallway-e2e-"));
  // wrangler refuses a missing assets directory; the suite needs no web app,
  // only a shell for the link preview to put its tags in (person-page.ts). A
  // real build's index.html is left alone.
  const dist = join(root, "apps/web/dist");
  mkdirSync(dist, { recursive: true });
  if (!existsSync(join(dist, "index.html"))) {
    writeFileSync(join(dist, "index.html"), "<!doctype html>\n<html><head><title>Hallway</title></head><body></body></html>\n");
  }

  // The share card's fonts (ADR 0012), copied by whatever starts wrangler, not
  // by a wrangler "build" command (#85, apps/api/wrangler.jsonc).
  const fonts = spawnSync(process.execPath, [join(api, "scripts/copy-card-fonts.mjs")], { cwd: api, env, encoding: "utf8" });
  if (fonts.status !== 0) throw new Error(`Copying the share card fonts failed:\n${fonts.stdout}${fonts.stderr}`);

  const migrated = spawnSync(
    process.execPath,
    [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    { cwd: api, env, encoding: "utf8" },
  );
  if (migrated.status !== 0) throw new Error(`Migrations failed:\n${migrated.stdout}${migrated.stderr}`);

  const [port, inspectorPort] = [await freePort(), await freePort()];
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  const dev = spawn(
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
      state,
      "--show-interactive-dev-session=false",
      // Dev sign-in, whatever this checkout's .dev.vars says.
      "--var",
      "DEV_SIGN_IN:1",
    ],
    { cwd: api, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  dev.stdout!.on("data", (chunk) => (output += chunk));
  dev.stderr!.on("data", (chunk) => (output += chunk));
  const lastResort = () => signalGroup(dev, "SIGKILL");
  process.once("exit", lastResort);

  const teardown = async () => {
    await stop(dev);
    process.off("exit", lastResort);
    rmSync(state, { recursive: true, force: true });
    console.log(`Hallway e2e Worker on port ${port} stopped (process group ${dev.pid}).`);
  };

  try {
    await waitUntilServing(url, dev, () => output);
  } catch (error) {
    await teardown();
    throw error;
  }
  console.log(`Hallway e2e Worker: ${url} (process group ${dev.pid}, D1 in ${state})`);
  project.provide("hallwayUrl", url);
  return teardown;
}
