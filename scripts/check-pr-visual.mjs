// Fail a pull request that changes the model or what can be done with it, when
// its description does not show the change as a diagram.
//
// The owner asked for it: "If there is a data model, I want to be able to see
// it. If there is a new relationship, I want to be able to visualize it. If we
// are adding new things like commands, aggregates, whatever, I want to be able
// to visualize it." A diagram in prose instructions gets skipped under time
// pressure, so this checks the result: each area a PR touches needs a Mermaid
// block of a kind that can show it. GitHub renders Mermaid in PR bodies.
//
// It reads the description, not the code, so it checks that a diagram of the
// right kind is there, not that it is right. Reviewing that is the reviewer's.
//
//   PR_BODY=... node scripts/check-pr-visual.mjs <file listing changed paths>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Each area: which changed paths put a PR in it, and which Mermaid diagram
// kinds can show it. Test files never do.
export const AREAS = [
  {
    name: "web screens (screenshots)",
    paths: ["apps/web/src/"],
    kinds: [],
    image: true,
  },
  {
    name: "data model (tables, columns, relationships)",
    paths: [
      "packages/infrastructure/src/persistence/d1/entities/",
      "migrations/",
    ],
    kinds: ["erDiagram"],
  },
  {
    name: "domain model (aggregates, members, value objects, events)",
    paths: ["packages/domain/"],
    kinds: ["classDiagram", "erDiagram"],
  },
  {
    name: "behaviour (use cases, commands, REST routes, MCP tools, CLI commands, web screens)",
    paths: [
      "packages/application/src/",
      "apps/api/src/routes/",
      "apps/api/src/mcp/",
      "apps/cli/src/",
      "apps/web/src/",
    ],
    kinds: [
      "flowchart",
      "graph",
      "sequenceDiagram",
      "stateDiagram",
      "stateDiagram-v2",
    ],
  },
];

const isTest = (file) =>
  /\.test\.[cm]?[jt]s$/.test(file) || file.includes("/__fixtures__/");

export function areasTouched(files) {
  return AREAS.filter((area) =>
    files.some(
      (file) =>
        !isTest(file) && area.paths.some((path) => file.startsWith(path)),
    ),
  );
}

// The kind of each fenced ```mermaid block: its first non-blank, non-comment
// line's first word (`flowchart LR` is `flowchart`).
export function diagramKinds(body) {
  const kinds = [];
  for (const match of (body ?? "").matchAll(
    /```mermaid[^\n]*\n([\s\S]*?)```/g,
  )) {
    // A front-matter block (`---` ... `---`) comes before the kind; skip it.
    const text = match[1].replace(/^\s*---\n[\s\S]*?\n---\n/, "");
    const first = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("%%"));
    if (first) kinds.push(first.split(/\s+/)[0]);
  }
  return kinds;
}

// An image in the body: Markdown `![...](...)` or an <img> tag.
export function hasImage(body) {
  return /!\[[^\]]*\]\([^)\s]+\)|<img\s[^>]*src=/i.test(body ?? "");
}

export function missing(files, body) {
  const kinds = new Set(diagramKinds(body));
  return areasTouched(files).filter((area) =>
    area.image ? !hasImage(body) : !area.kinds.some((kind) => kinds.has(kind)),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readFileSync(process.argv[2], "utf8")
    .split("\n")
    .filter(Boolean);
  const gaps = missing(files, process.env.PR_BODY);
  if (gaps.length === 0) {
    const touched = areasTouched(files);
    console.log(
      touched.length === 0
        ? "No model or behaviour change, so no diagram is needed."
        : `Each changed area has a diagram: ${touched.map((a) => a.name).join("; ")}.`,
    );
    process.exit(0);
  }
  console.error(
    "This pull request changes things the owner wants to see, and its description has no diagram for them:\n",
  );
  for (const gap of gaps)
    console.error(
      gap.image
        ? `  - ${gap.name}: add a screenshot of made-up data (node scripts/attach-screenshots.mjs <pr> <png>...)`
        : `  - ${gap.name}: add a \`\`\`mermaid block of kind ${gap.kinds.join(" or ")}`,
    );
  console.error(
    '\nAdd them under "## Visual" in the PR description (docs/process/working-an-issue.md,\n' +
      '"Make it visual"). Editing the description reruns this check.',
  );
  process.exit(1);
}
