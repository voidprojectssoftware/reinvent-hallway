// `npm run dev`: the Worker on this worktree's own port, with its own local D1.
//
// Several agents run dev servers on this machine at once, each in its own
// worktree, so nothing here may be shared between two checkouts:
// - The port is derived from the checkout's path (a hash into 20000-29999),
//   and the next free one is taken if that is busy. HALLWAY_PORT overrides it.
//   The inspector port is the same offset in 30000-39999, since wrangler's
//   default 9229 collides too.
// - D1 persists under this checkout's .wrangler/state (git-ignored). Migrations
//   are applied there first, because wrangler dev does not apply them and a
//   Worker over an empty database fails on its first query.
//
// The web app (apps/web) is built into apps/web/dist before wrangler starts,
// then rebuilt there on every change while wrangler serves it as the Worker's
// static assets. One origin, and deep links and /api take the same paths they
// will in production (ADR 0010). Reload the page to see a change.
//
// It also copies .dev.vars.example to apps/api/.dev.vars when there is none, so
// the dev bearer token works locally (src/auth/dev-actor.ts). .dev.vars is
// git-ignored and never deployed.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import console from "node:console";
import process from "node:process";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(api, "../..");
const persistTo = join(root, ".wrangler/state");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const vite = join(root, "node_modules/vite/bin/vite.js");
const web = join(root, "apps/web");

export function preferredPort(checkout) {
  const hash = createHash("sha256").update(checkout).digest().readUInt32BE(0);
  return 20000 + (hash % 10000);
}

const free = (port) =>
  new Promise((done) => {
    const probe = createServer()
      .once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true)))
      .listen(port, "127.0.0.1");
  });

async function pickPort() {
  if (process.env.HALLWAY_PORT) return Number(process.env.HALLWAY_PORT);
  const start = preferredPort(root);
  for (let offset = 0; offset < 50; offset++) {
    const port = 20000 + ((start - 20000 + offset) % 10000);
    if ((await free(port)) && (await free(port + 10000))) return port;
  }
  throw new Error(`No free port pair near ${start}; set HALLWAY_PORT.`);
}

// wrangler refuses an assets directory that does not exist, so the first
// build finishes before it starts.
function buildWeb() {
  const built = spawnSync(process.execPath, [vite, "build"], { cwd: web, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

function ensureDevVars() {
  const devVars = join(api, ".dev.vars");
  if (!existsSync(devVars)) copyFileSync(join(api, ".dev.vars.example"), devVars);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = await pickPort();
  buildWeb();
  ensureDevVars();

  const migrated = spawnSync(
    process.execPath,
    [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo],
    // CI=true answers wrangler's "apply these migrations?" prompt.
    { cwd: api, stdio: "inherit", env: { ...process.env, CI: "true" } },
  );
  if (migrated.status !== 0) process.exit(migrated.status ?? 1);

  console.log(`\nHallway dev server: http://127.0.0.1:${port}\n`);
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
      String(port + 10000),
      "--persist-to",
      persistTo,
      ...process.argv.slice(2),
    ],
    { cwd: api, stdio: "inherit" },
  );
  // --logLevel warn: the watcher's rebuild lines would bury wrangler's output.
  const watch = spawn(process.execPath, [vite, "build", "--watch", "--logLevel", "warn"], {
    cwd: web,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      watch.kill(signal);
      dev.kill(signal);
    });
  }
  watch.on("exit", () => dev.kill("SIGTERM"));
  dev.on("exit", (code, signal) => {
    watch.kill("SIGTERM");
    process.exit(code ?? (signal ? 1 : 0));
  });
}
