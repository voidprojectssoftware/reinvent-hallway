// The AppHost's `api` resource (apphost.mts, ADR 0017): wrangler dev for the
// Worker, after the three things `npm run dev` also does first.
//
// 1. Apply the D1 migrations to the local database under PERSIST_TO, because
//    wrangler dev does not, and a Worker over an empty database fails on its
//    first query.
// 2. Wait for the `web` resource's first build to write apps/web/dist/index.html:
//    wrangler refuses an assets directory that does not exist, and serving
//    before the first build answers every page with a 404.
// 3. Copy the share card's fonts into that build (ADR 0012, #85).
//
// It also copies apps/api/.dev.vars.example to .dev.vars when there is none,
// as `npm run dev` does, so dev sign-in works (ADR 0008).
//
// Every argument is passed on to `wrangler dev`: the AppHost supplies the
// port, inspector port and address Aspire allocated. PERSIST_TO comes from
// the AppHost too, and is given to wrangler as --persist-to.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import console from "node:console";
import process from "node:process";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const api = join(root, "apps/api");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const index = join(root, "apps/web/dist/index.html");
const persistTo = process.env.PERSIST_TO;
if (!persistTo) {
  console.error("PERSIST_TO is not set: the AppHost passes the D1 state directory.");
  process.exit(2);
}

const devVars = join(api, ".dev.vars");
if (!existsSync(devVars)) copyFileSync(join(api, ".dev.vars.example"), devVars);

const migrated = spawnSync(
  process.execPath,
  [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo],
  // CI=true answers wrangler's "apply these migrations?" prompt.
  { cwd: api, stdio: "inherit", env: { ...process.env, CI: "true" } },
);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

for (let waited = 0; !existsSync(index); waited++) {
  if (waited === 0) console.log("Waiting for the web resource's first build (apps/web/dist/index.html)...");
  if (waited >= 300) {
    console.error("No apps/web/dist/index.html after five minutes: see the web resource's logs.");
    process.exit(1);
  }
  await sleep(1000);
}

// The share card's fonts (ADR 0012). Not wrangler's
//    "build" command: with one, wrangler never reloads its assets after a web
//    rebuild (#85, apps/api/wrangler.jsonc). web builds with --no-emptyOutDir,
//    so they stay put.
const fonts = spawnSync(process.execPath, [join(api, "scripts/copy-card-fonts.mjs")], { cwd: api, stdio: "inherit" });
if (fonts.status !== 0) process.exit(fonts.status ?? 1);

const dev = spawn(
  process.execPath,
  [wrangler, "dev", "--persist-to", persistTo, "--show-interactive-dev-session=false", ...process.argv.slice(2)],
  { cwd: api, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => dev.kill(signal));
dev.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
