// The share card's fallback fonts (ADR 0012, issue #40). Inter's Latin subset
// draws almost every card and is always loaded. A name or title with a
// character outside it (Łukasz, Ольга, Γιώργος, 山田, 김민준) needs one more
// file: Inter's own other subsets, then Noto Sans JP, KR and SC for CJK, each
// cut by Fontsource into chunks of a few hundred characters. Satori asks
// (loadAdditionalAsset) only when the text has a character no loaded font
// draws, and this picks the chunks that cover those characters, so a Latin
// card loads nothing extra and a Japanese name loads two or three chunks.
//
// The files are too big for the Worker's bundle (Noto Sans JP alone is 5 MB
// a weight), so they are static assets: scripts/copy-card-fonts.mjs copies
// every file named here into the assets directory before wrangler builds.
import inter from "@fontsource/inter/unicode.json" with { type: "json" };
import notoSansJp from "@fontsource/noto-sans-jp/unicode.json" with { type: "json" };
import notoSansKr from "@fontsource/noto-sans-kr/unicode.json" with { type: "json" };
import notoSansSc from "@fontsource/noto-sans-sc/unicode.json" with { type: "json" };
import type { Font } from "satori/standalone";

type Weight = NonNullable<Font["weight"]>;

/** Where the copied files are served, under the Worker's assets. */
export const fallbackFontPath = "/share-card-fonts/";

/** One Fontsource subset or chunk: a font of its own to Satori, which keeps one file per name and weight. */
export interface FallbackSubset {
  /** The family name Satori knows it by, unique per subset. */
  name: string;
  /** The npm package the files come from. */
  pkg: string;
  /** The file for a weight: `${pkg}/files/${file(weight)}`, and the asset's name. */
  file: (weight: Weight) => string;
  weights: readonly Weight[];
}

// Inter at the card's three weights. CJK at two: Satori takes 700 for the
// card's 600 (CSS's nearest-weight rule), and a third weight would add 5 MB
// of assets a language for a difference no one sees at 17 px.
const cjkWeights = [400, 700] as const;
const interWeights = [400, 600, 700] as const;

/** Fontsource's unicode.json: subset or chunk ("[12]") to a CSS unicode-range. */
type Ranges = Record<string, string>;

function family(slug: string, ranges: Ranges, weights: readonly Weight[], skip: string[] = []) {
  return Object.keys(ranges)
    .filter((key) => !skip.includes(key))
    .map((key) => {
      const subset = key.replace(/^\[(\d+)\]$/, "$1");
      const file = (weight: Weight) => `${slug}-${subset}-${weight}-normal.woff`;
      return { subset: { name: `${slug} ${subset}`, pkg: `@fontsource/${slug}`, file, weights }, range: ranges[key]! };
    });
}

// In order of preference: a character two subsets share is drawn by the first.
// Han characters go to Japanese before Simplified Chinese, so a Japanese name
// is drawn in one face; Chinese-only characters still reach SC. Each Noto
// family repeats Latin, Cyrillic and so on, which Inter has already claimed.
const ordered = [
  ...family("inter", inter, interWeights, ["latin"]),
  ...family("noto-sans-jp", notoSansJp, cjkWeights),
  ...family("noto-sans-kr", notoSansKr, cjkWeights),
  ...family("noto-sans-sc", notoSansSc, cjkWeights),
];

/** Every subset, for the copy script and the tests. */
export const fallbackSubsets: FallbackSubset[] = ordered.map(({ subset }) => subset);

/** "U+0400-045F,U+2116" as [from, to] pairs. */
const parseRange = (range: string) =>
  range.split(",").map((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, "").split("-");
    return [Number.parseInt(from!, 16), Number.parseInt(to!, 16)] as const;
  });

const covers = (ranges: readonly (readonly [number, number])[], code: number) =>
  ranges.some(([from, to]) => code >= from && code <= to);

/** Inter Latin, which is always loaded: its characters never need a fallback. */
const latin = parseRange(inter.latin);

/** Whether Inter Latin draws every character of `text`, as it does on most cards. */
export function latinOnly(text: string): boolean {
  for (const char of text) if (!covers(latin, char.codePointAt(0)!)) return false;
  return true;
}

// Parsed on the first card that needs a fallback, not when the Worker starts:
// most cards never do.
let index: { subset: FallbackSubset; ranges: (readonly [number, number])[] }[] | undefined;

/**
 * The subsets that draw `text`'s characters outside Inter Latin, and the
 * characters none of them draws (emoji, Thai, Hebrew and so on), as code points.
 */
export function fallbacksFor(text: string): { subsets: FallbackSubset[]; uncovered: number[] } {
  index ??= ordered.map(({ subset, range }) => ({ subset, ranges: parseRange(range) }));
  const subsets = new Set<FallbackSubset>();
  const uncovered = new Set<number>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (covers(latin, code)) continue;
    const found = index.find(({ ranges }) => covers(ranges, code));
    if (found) subsets.add(found.subset);
    else uncovered.add(code);
  }
  return { subsets: [...subsets], uncovered: [...uncovered] };
}
