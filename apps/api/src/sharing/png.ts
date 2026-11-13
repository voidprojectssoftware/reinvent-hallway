// The share card's renderer (ADR 0012): Satori lays the card out into an SVG
// with its text as paths, and resvg (WebAssembly) rasterizes that to a PNG.
// Neither can reach a file system or compile WebAssembly from bytes on
// Workers, so the caller hands in the compiled modules and the font files:
// worker-renderer.ts imports them through wrangler's module rules and fetches
// fallback fonts from the Worker's static assets, the tests read them from disk.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori, { init as initSatori, type Font } from "satori/standalone";
import { fallbacksFor, latinOnly } from "./fallback-fonts.ts";
import { cardHeight, cardTexts, cardWidth, type CardNode } from "./share-card.ts";

/** A compiled module on the Worker, the file's bytes under Node (whose types lack WebAssembly). */
export type WasmSource = Parameters<typeof initWasm>[0];

export interface RendererAssets {
  /** Satori's layout engine, `satori/yoga.wasm`. */
  yoga: WasmSource;
  /** `@resvg/resvg-wasm/index_bg.wasm`. */
  resvg: WasmSource;
  /** Inter Latin, always loaded, as the family "Inter". */
  fonts: Font[];
  /** A fallback font file's bytes, by the file name fallback-fonts.ts gives it. */
  loadFont: (file: string) => Promise<ArrayBuffer>;
}

export type RenderPng = (card: CardNode) => Promise<Uint8Array>;

// Both WebAssembly modules are global to the isolate and may be initialized
// only once, so every renderer shares this.
let ready: Promise<unknown> | undefined;

const codePoint = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

export function cardRenderer(assets: RendererAssets): { svg: (card: CardNode) => Promise<string>; png: RenderPng } {
  // One load per file per isolate, shared by cards drawn at the same time.
  // Satori keeps the fonts it is given for as long as `assets.fonts` lives (a
  // WeakMap on that array), so a later card with the same characters asks for
  // nothing at all.
  const files = new Map<string, Promise<ArrayBuffer>>();
  const load = (file: string) => {
    let bytes = files.get(file);
    if (!bytes) {
      bytes = assets.loadFont(file);
      files.set(file, bytes);
      // A failed load is tried again on the next card, not remembered. The
      // caller sees the rejection; this branch only forgets it.
      bytes.catch(() => files.delete(file));
    }
    return bytes;
  };

  // Satori calls this only with the characters no loaded font draws, grouped
  // by the script it guesses. The code points decide which files, not its
  // guess: it calls Cyrillic "unknown" and Han any of four languages.
  const loadAdditionalAsset = async (_script: string, segment: string): Promise<Font[]> => {
    const { subsets, uncovered } = fallbacksFor(segment);
    if (uncovered.length) {
      // These draw as Inter's missing-glyph box. Code points only: the text
      // is someone's name.
      console.warn(`share card: no font draws ${uncovered.map(codePoint).join(" ")}`);
    }
    const loaded = await Promise.allSettled(
      subsets.flatMap((subset) =>
        subset.weights.map(async (weight): Promise<Font> => ({
          name: subset.name,
          data: await load(subset.file(weight)),
          weight,
          style: "normal",
        })),
      ),
    );
    // A font that will not load costs those characters, not the whole card:
    // a preview with a box in a name beats no preview. Said, not swallowed.
    for (const result of loaded) if (result.status === "rejected") console.error(result.reason);
    return loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  };

  // Text is drawn as glyph outlines (Satori's embedFont, on by default), so
  // what attendees and their agents typed (names, session titles) reaches the
  // SVG as path data, never as markup. Satori before 0.33.5 escapes some
  // attribute values badly (GHSA-wx4j-mvgx-mqwp); every attribute and style
  // here is a constant of share-card.ts, and sharing.test.ts checks that
  // markup in a title stays out of the SVG.
  const svg = async (card: CardNode) => {
    ready ??= Promise.all([initSatori(assets.yoga), initWasm(assets.resvg)]);
    await ready;
    // Given a loader, Satori splits every string into graphemes to look for
    // missing glyphs, which costs a Latin card about 2 ms of its 60. So the
    // loader goes only to a card with a character outside Inter Latin.
    const fallback = cardTexts(card).every(latinOnly) ? {} : { loadAdditionalAsset };
    return satori(card as never, { width: cardWidth, height: cardHeight, fonts: assets.fonts, ...fallback });
  };
  const png = async (card: CardNode) => {
    const resvg = new Resvg(await svg(card), { fitTo: { mode: "original" } });
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
      resvg.free();
    }
  };
  return { svg, png };
}
