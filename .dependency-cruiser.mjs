// The layer boundaries of ADR 0002, run by `npm run boundaries` inside
// `npm run verify`:
//
//   domain <- application <- (api, infrastructure)
//   contracts is imported by application, api and web
//   web imports nothing else from the repo
//
// Paths are matched after resolution, so `import ... from "@hallway/application"`
// and a relative path into packages/application/src arrive as the same file and
// one rule covers both spellings. scripts/boundaries.test.mjs proves every rule
// fails on a violation.

const tests = "\\.test\\.ts$";

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    {
      name: "domain-imports-only-itself",
      comment:
        "packages/domain imports nothing outside itself: no other package, no app, no npm module, no Node builtin (ADR 0002).",
      severity: "error",
      from: { path: "^packages/domain/", pathNot: tests },
      to: { pathNot: "^packages/domain/" },
    },
    {
      name: "domain-tests-import-only-domain-and-vitest",
      comment: "A domain test may add the test runner and nothing else.",
      severity: "error",
      from: { path: `^packages/domain/.*${tests}` },
      to: { pathNot: ["^packages/domain/", "^node_modules/vitest/", "^node_modules/@vitest/"] },
    },
    {
      name: "application-only-domain-and-contracts",
      comment:
        "Handlers depend on the domain, the contracts and the ports they declare, never on the adapters that implement them or an app (ADR 0002).",
      severity: "error",
      from: { path: "^packages/application/" },
      to: { path: "^(apps|packages/infrastructure)/" },
    },
    {
      name: "contracts-is-a-leaf",
      comment:
        "The web app depends on contracts, so contracts pulls in no other package and no app (ADR 0002, ADR 0005).",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { path: "^(apps|packages)/", pathNot: "^packages/contracts/" },
    },
    {
      name: "packages-not-apps",
      comment: "Apps are composition roots; nothing in packages/ imports one (ADR 0002).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "web-imports-only-contracts",
      comment:
        "apps/web knows the resources and nothing else; it reaches the server only over /api (ADR 0002, ADR 0005).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^(apps|packages)/", pathNot: ["^apps/web/", "^packages/contracts/"] },
    },
    {
      name: "apps-not-each-other",
      comment: "Apps share code only through packages/ and talk over HTTP.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-unresolvable",
      comment:
        "An import the cruiser cannot resolve has no path, so no rule above could see it. Fail rather than pass it unchecked.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-dependency",
      comment:
        "Each workspace declares the npm packages its code imports in its own package.json. Tests are exempt: vitest is root tooling.",
      severity: "error",
      from: { pathNot: tests },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    // Type-only imports are erased by the compiler. Without this they would be
    // invisible, and `import type` would be a way around every rule.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    doNotFollow: { path: "node_modules" },
    // wrangler writes bundles under .wrangler/ and Vite under dist/: build
    // output, not source.
    exclude: { path: "(/\\.wrangler/|/dist/)" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs"],
    },
  },
};
