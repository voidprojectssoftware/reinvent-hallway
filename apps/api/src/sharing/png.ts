// The share card's renderer (ADR 0012): Satori lays the card out into an SVG
// with its text as paths, and resvg (WebAssembly) rasterizes that to a PNG.
// Neither can reach a file system or compile WebAssembly from bytes on
// Workers, so the caller hands in the compiled modules and the font files:
// worker-renderer.ts imports them through wrangler's module rules, the tests
// read them from disk.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori, { init as initSatori, type Font } from "satori/standalone";
import { cardHeight, cardWidth, type CardNode } from "./share-card.ts";

/** A compiled module on the Worker, the file's bytes under Node (whose types lack WebAssembly). */
export type WasmSource = Parameters<typeof initWasm>[0];

export interface RendererAssets {
  /** Satori's layout engine, `satori/yoga.wasm`. */
  yoga: WasmSource;
  /** `@resvg/resvg-wasm/index_bg.wasm`. */
  resvg: WasmSource;
  fonts: Font[];
}

export type RenderPng = (card: CardNode) => Promise<Uint8Array>;

// Both WebAssembly modules are global to the isolate and may be initialized
// only once, so every renderer shares this.
let ready: Promise<unknown> | undefined;

export function cardRenderer(assets: RendererAssets): { svg: (card: CardNode) => Promise<string>; png: RenderPng } {
  // Text is drawn as glyph outlines (Satori's embedFont, on by default), so
  // what attendees and their agents typed (names, session titles) reaches the
  // SVG as path data, never as markup. Satori before 0.33.5 escapes some
  // attribute values badly (GHSA-wx4j-mvgx-mqwp); every attribute and style
  // here is a constant of share-card.ts, and sharing.test.ts checks that
  // markup in a title stays out of the SVG.
  const svg = async (card: CardNode) => {
    ready ??= Promise.all([initSatori(assets.yoga), initWasm(assets.resvg)]);
    await ready;
    return satori(card as never, { width: cardWidth, height: cardHeight, fonts: assets.fonts });
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
