// Copies the share card's fallback fonts (src/sharing/fallback-fonts.ts) into
// the Worker's static assets, with their licences, where worker-renderer.ts
// fetches them. wrangler runs this before every build (wrangler.jsonc
// "build"), for `wrangler dev` and a deploy alike, after apps/web is built
// into the same directory. The fonts are too big for the Worker's bundle
// (ADR 0012).
//
// A file already there at the same size is left alone, because wrangler dev
// runs this again on every change under src/.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fallbackFontPath, fallbackSubsets } from "../src/sharing/fallback-fonts.ts";

const require = createRequire(import.meta.url);
const target = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist", fallbackFontPath);
mkdirSync(target, { recursive: true });

const sameSize = (from, to) => {
  try {
    return statSync(from).size === statSync(to).size;
  } catch {
    return false;
  }
};

let copied = 0;
const copy = (specifier, name) => {
  const from = require.resolve(specifier);
  const to = join(target, name);
  if (sameSize(from, to)) return;
  copyFileSync(from, to);
  copied++;
};

const packages = new Set();
for (const subset of fallbackSubsets) {
  packages.add(subset.pkg);
  for (const weight of subset.weights) copy(`${subset.pkg}/files/${subset.file(weight)}`, subset.file(weight));
}
// The SIL Open Font License travels with the fonts it covers.
for (const pkg of packages) copy(`${pkg}/LICENSE`, `${pkg.replace("@fontsource/", "")}-LICENSE.txt`);

console.log(`share card fonts: ${copied} copied to ${target}`);
