import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areasTouched,
  diagramKinds,
  hasImage,
  missing,
} from "./check-pr-visual.mjs";

const block = (text) => "```mermaid\n" + text + "\n```";

test("a docs-only or test-only change needs no diagram", () => {
  assert.deepEqual(
    missing(["docs/x.md", "packages/domain/src/a/b.test.ts"], ""),
    [],
  );
});

test("a migration without an ER diagram fails, and passes with one", () => {
  const files = ["migrations/0003_x.sql"];
  assert.equal(missing(files, "no picture").length, 1);
  assert.equal(
    missing(files, block("flowchart LR\n a --> b")).length,
    1,
    "a flowchart cannot show tables",
  );
  assert.deepEqual(missing(files, block("erDiagram\n a ||--o{ b : has")), []);
});

test("a domain change needs a class or ER diagram", () => {
  const files = ["packages/domain/src/directory/aggregates/x/x.ts"];
  assert.equal(missing(files, "").length, 1);
  assert.deepEqual(missing(files, block("classDiagram\n class X")), []);
});

test("a new route, tool, use case or CLI command needs a flow or sequence", () => {
  for (const file of [
    "apps/api/src/routes/a.ts",
    "apps/api/src/mcp/tools.ts",
    "packages/application/src/d/x.ts",
    "apps/cli/src/cli.ts",
  ]) {
    assert.equal(
      missing([file], block("erDiagram\n a ||--o{ b : has")).length,
      1,
      file,
    );
    assert.deepEqual(
      missing([file], block("sequenceDiagram\n A->>B: hi")),
      [],
      file,
    );
  }
});

test("every touched area needs its own kind", () => {
  const files = ["migrations/1.sql", "apps/cli/src/cli.ts"];
  assert.equal(missing(files, block("erDiagram\n a ||--o{ b : has")).length, 1);
  assert.deepEqual(
    missing(
      files,
      block("erDiagram\n a ||--o{ b : has") +
        "\n" +
        block("flowchart TD\n a --> b"),
    ),
    [],
  );
  assert.equal(areasTouched(files).length, 2);
});

test("the kind is read past comments and a front-matter fence", () => {
  assert.deepEqual(diagramKinds(block("%% note\n\nflowchart LR\n a-->b")), [
    "flowchart",
  ]);
  assert.deepEqual(
    diagramKinds("```mermaid\n---\ntitle: x\n---\nclassDiagram\n class A\n```"),
    ["classDiagram"],
  );
});

test("a web screen change needs a screenshot as well as a flow", () => {
  const files = ["apps/web/src/routes/dossier.tsx"];
  const flow = block("flowchart LR\n a --> b");
  assert.equal(
    missing(files, flow).length,
    1,
    "a diagram alone is not a screenshot",
  );
  assert.equal(
    missing(
      files,
      "![list](https://github.com/o/r/blob/pr-screenshots/pr/1/list.png?raw=true)",
    ).length,
    1,
    "a screenshot alone is not a flow",
  );
  assert.deepEqual(missing(files, flow + "\n![list](https://x/list.png)"), []);
});

test("an image is Markdown or an img tag, not a plain link", () => {
  assert.equal(hasImage("[list](https://x/list.png)"), false);
  assert.equal(hasImage('<img src="https://x/a.png" width="400">'), true);
});
