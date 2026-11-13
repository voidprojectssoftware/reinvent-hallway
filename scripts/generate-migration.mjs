// Generates the next migration from the entities directory, with a name you
// choose: `npm run db:generate -- add_sessions` writes
// migrations/NNNN_add_sessions.sql. drizzle-kit alone would pick random words
// for the name, which tell a reviewer nothing. For data (a seed), pass
// `--custom` after the name: drizzle-kit writes an empty, numbered file into
// its journal for you to fill, so the next generated number does not collide.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import console from "node:console";
import process from "node:process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];

if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error(
    "Usage: npm run db:generate -- <name>, in snake_case, saying what the migration does (for example add_sessions).",
  );
  process.exit(2);
}

const run = spawnSync(
  process.execPath,
  [
    join(repo, "node_modules/drizzle-kit/bin.cjs"),
    "generate",
    "--config=drizzle.config.ts",
    `--name=${name}`,
    ...process.argv.slice(3).filter((arg) => arg === "--custom"),
  ],
  { cwd: join(repo, "packages/infrastructure"), stdio: "inherit" },
);
process.exit(run.status ?? 1);
