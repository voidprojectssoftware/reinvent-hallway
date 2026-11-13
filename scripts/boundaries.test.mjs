// Proves the boundary check (.dependency-cruiser.mjs, ADR 0002) fails on each
// violation it exists for, and passes the imports the architecture allows. A
// rule loosened by accident turns this red.
//
// The fixtures are written to a temporary directory, not the repository:
// packages/domain and apps/web belong to other issues, and a committed
// violation would fail `npm run boundaries` itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = join(repo, ".dependency-cruiser.mjs");
const cli = join(repo, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");

const pkg = (name, dependencies = {}) => JSON.stringify({ name, type: "module", dependencies });
const scaffold = {
  "tsconfig.base.json": JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
    },
  }),
  "package.json": JSON.stringify({ name: "fixture", private: true, type: "module" }),
  "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad", main: "index.js" }),
  "node_modules/left-pad/index.js": "export default 1;\n",
  "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", main: "index.js" }),
  "node_modules/vitest/index.js": "export const test = 1;\n",
  "packages/domain/node_modules/nested/package.json": JSON.stringify({ name: "nested", main: "index.js" }),
  "packages/domain/node_modules/nested/index.js": "export default 1;\n",
  // packages/domain pins its own vitest, which npm installs under it.
  "packages/domain/node_modules/vitest/package.json": JSON.stringify({ name: "vitest", main: "index.js" }),
  "packages/domain/node_modules/vitest/index.js": "export const test = 1;\n",
  "packages/domain/package.json": pkg("domain", { nested: "1" }),
  "packages/contracts/package.json": pkg("contracts"),
  "packages/application/package.json": pkg("application"),
  "packages/infrastructure/package.json": pkg("infrastructure", { "left-pad": "1" }),
  "apps/api/package.json": pkg("api"),
  "apps/web/package.json": pkg("web"),
  "packages/domain/src/index.ts": "export const rule = 1;\n",
  "packages/contracts/src/index.ts": "export const Event = 1;\n",
  "packages/application/src/index.ts": "export const handler = 1;\n",
  "packages/infrastructure/src/index.ts": "export const repository = 1;\n",
  "apps/api/src/index.ts": "export const worker = 1;\n",
};

function cruise(files) {
  const root = mkdtempSync(join(tmpdir(), "hallway-boundaries-"));
  try {
    for (const [path, content] of Object.entries({ ...scaffold, ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const run = spawnSync(
      process.execPath,
      [cli, "--config", config, "--output-type", "json", "apps", "packages"],
      { cwd: root, encoding: "utf8" },
    );
    assert.ok(run.stdout, `dependency-cruiser printed nothing: ${run.stderr}`);
    return JSON.parse(run.stdout)
      .summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`)
      .sort();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const from = (target) => `import { x } from "${target}";\nexport const y = x;\n`;

test("each forbidden import is reported under the rule that forbids it", () => {
  const violations = cruise({
    // The domain imports nothing outside itself, types and builtins included.
    "packages/domain/src/a.ts": from("../../contracts/src/index.ts"),
    "packages/domain/src/b.ts": 'import type { X } from "../../application/src/index.ts";\nexport type Y = X;\n',
    "packages/domain/src/c.ts": from("node:crypto"),
    "packages/domain/src/d.ts": from("left-pad"),
    "packages/domain/src/e.test.ts": from("../../infrastructure/src/index.ts"),
    // A package installed under the domain's own node_modules is still outside it.
    "packages/domain/src/f.ts": from("nested"),
    // Application: never infrastructure, never an app.
    "packages/application/src/a.ts": from("../../infrastructure/src/index.ts"),
    "packages/application/src/b.ts": from("../../../apps/api/src/index.ts"),
    // Contracts: a leaf.
    "packages/contracts/src/a.ts": from("../../domain/src/index.ts"),
    // Packages never import an app.
    "packages/infrastructure/src/a.ts": from("../../../apps/api/src/index.ts"),
    // The web app: contracts only.
    "apps/web/src/a.ts": from("../../../packages/application/src/index.ts"),
    "apps/web/src/b.ts": from("../../../packages/domain/src/index.ts"),
    "apps/web/src/c.ts": from("../../api/src/index.ts"),
    // Anything the cruiser cannot see, it refuses.
    "apps/api/src/a.ts": from("./does-not-exist.ts"),
    "apps/api/src/b.ts": from("left-pad"),
  });

  assert.deepEqual(violations, [
    "application-only-domain-and-contracts: packages/application/src/a.ts -> packages/infrastructure/src/index.ts",
    "application-only-domain-and-contracts: packages/application/src/b.ts -> apps/api/src/index.ts",
    "apps-not-each-other: apps/web/src/c.ts -> apps/api/src/index.ts",
    "contracts-is-a-leaf: packages/contracts/src/a.ts -> packages/domain/src/index.ts",
    "domain-imports-only-itself: packages/domain/src/a.ts -> packages/contracts/src/index.ts",
    "domain-imports-only-itself: packages/domain/src/b.ts -> packages/application/src/index.ts",
    "domain-imports-only-itself: packages/domain/src/c.ts -> crypto",
    "domain-imports-only-itself: packages/domain/src/d.ts -> node_modules/left-pad/index.js",
    "domain-imports-only-itself: packages/domain/src/f.ts -> packages/domain/node_modules/nested/index.js",
    "domain-tests-import-only-domain-and-vitest: packages/domain/src/e.test.ts -> packages/infrastructure/src/index.ts",
    "no-undeclared-dependency: apps/api/src/b.ts -> node_modules/left-pad/index.js",
    "no-undeclared-dependency: packages/domain/src/d.ts -> node_modules/left-pad/index.js",
    "no-unresolvable: apps/api/src/a.ts -> ./does-not-exist.ts",
    "packages-not-apps: packages/application/src/b.ts -> apps/api/src/index.ts",
    "packages-not-apps: packages/infrastructure/src/a.ts -> apps/api/src/index.ts",
    "web-imports-only-contracts: apps/web/src/a.ts -> packages/application/src/index.ts",
    "web-imports-only-contracts: apps/web/src/b.ts -> packages/domain/src/index.ts",
    "web-imports-only-contracts: apps/web/src/c.ts -> apps/api/src/index.ts",
  ]);
});

test("the imports ADR 0002 allows pass", () => {
  const violations = cruise({
    "packages/domain/src/a.ts": from("./index.ts"),
    "packages/domain/src/a.test.ts": 'import { test } from "vitest";\nimport { rule } from "./index.ts";\nexport const t = [test, rule];\n',
    "packages/application/src/a.ts": 'import { rule } from "../../domain/src/index.ts";\nimport { Event } from "../../contracts/src/index.ts";\nexport const h = [rule, Event];\n',
    "packages/infrastructure/src/a.ts": 'import { handler } from "../../application/src/index.ts";\nimport pad from "left-pad";\nexport const r = [handler, pad];\n',
    "apps/api/src/a.ts": 'import { repository } from "../../../packages/infrastructure/src/index.ts";\nimport { handler } from "../../../packages/application/src/index.ts";\nexport const w = [repository, handler];\n',
    "apps/web/src/a.ts": from("../../../packages/contracts/src/index.ts"),
  });
  assert.deepEqual(violations, []);
});
