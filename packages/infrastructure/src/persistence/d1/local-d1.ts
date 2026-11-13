// A real D1 for tests: Miniflare runs workerd, the engine `wrangler dev` uses.
// Each call gets its own in-memory database with migrations/ applied the way
// `wrangler d1 migrations apply` does: every .sql file, in name order. A data
// migration's test stops `before` one, writes the old shape, then applies it.
import { readdirSync, readFileSync } from "node:fs";
import type { D1Database } from "@cloudflare/workers-types";
import { Miniflare } from "miniflare";

const migrations = new URL("../../../../../migrations/", import.meta.url);

export interface LocalD1 {
  d1: D1Database;
  dispose(): Promise<void>;
}

/** Runs one migration file's statements as one batch, as wrangler does. */
export async function applyMigration(d1: D1Database, file: string) {
  const statements = readFileSync(new URL(file, migrations), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await d1.batch(statements.map((statement) => d1.prepare(statement)));
}

export async function startLocalD1(options: { before?: string } = {}): Promise<LocalD1> {
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "local-d1",
          // Kept equal to apps/api/wrangler.jsonc, so tests run what the Worker runs.
          compatibilityDate: "2026-11-10",
          manifest: {
            mainModule: "index.js",
            modules: { "index.js": { type: "esm", contents: "export default {};" } },
          },
          env: { DB: { type: "d1", id: "local" } },
        },
      },
    ],
  });
  const d1 = (await mf.getD1Database("DB")) as unknown as D1Database;
  const files = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql") && (options.before === undefined || file < options.before))
    .sort();
  for (const file of files) await applyMigration(d1, file);
  return { d1, dispose: () => mf.dispose() };
}
