// Fails when the built web app carries the owner's annotation toolbar.
// ADR 0028, run by `npm run verify` straight after `npm run build`.
//
// WHY THIS EXISTS
// The toolbar is not kept out by `import.meta.env.DEV`: the web app is always
// a production build here, under `npm run dev` and Aspire too (ADR 0010, 0017),
// so the only thing between it and a deploy is the VITE_NOTES flag that those
// two set and `npm run build` does not. A refactor that imported
// `src/dev/annotator.tsx` unconditionally, or a deploy run with the flag left
// in the environment, would ship a toolbar that posts the page's DOM to a port
// on whatever host served it. Nothing else would notice.
//
// WHAT THIS DOES NOT COVER
// A deploy that builds somewhere other than `npm run build`. It reads
// apps/web/dist as it is, so run it after the build it is checking.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import console from "node:console";
import process from "node:process";

const root = join(import.meta.dirname, "..");
const dist = join(root, "apps/web/dist");

// Strings only the toolbar puts in a bundle: the package's name (its CSS
// classes and its own messages carry it), the host element annotator.tsx adds,
// and the build variable that names the note port.
const markers = [/agentation/i, /VITE_NOTE_PORT/];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let built;
try {
  built = files(dist).filter((path) => /\.(js|mjs|css|html)$/.test(path));
} catch {
  console.error(`check-no-toolbar: no build at ${relative(root, dist)}. Run npm run build first.`);
  process.exit(1);
}

const found = built.flatMap((path) => {
  const text = readFileSync(path, "utf8");
  return markers.filter((marker) => marker.test(text)).map((marker) => `${relative(root, path)}: ${marker}`);
});

if (found.length > 0) {
  console.error("check-no-toolbar: the built web app carries the annotation toolbar (ADR 0028):");
  for (const line of found) console.error(`  ${line}`);
  console.error("Was VITE_NOTES=1 set for this build, or is src/dev/annotator.tsx imported without it?");
  process.exit(1);
}
console.log(`check-no-toolbar: ${built.length} built files, no annotation toolbar.`);
