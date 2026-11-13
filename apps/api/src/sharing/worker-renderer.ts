// The share card renderer as the Worker builds it. Only index.ts imports this:
// the `.wasm` and `.woff` imports are wrangler module rules (wrangler.jsonc
// "rules"), which Node cannot load; tests build their renderer from files.
//
// Inter (SIL Open Font License 1.1, from @fontsource/inter), Latin, at the
// three weights the card uses, is in the bundle. The system font the app uses
// does not exist on a Worker, and SF Pro may not be redistributed. Every other
// script's font is a static asset (fallback-fonts.ts), fetched the first time
// a card needs it.
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import { env } from "cloudflare:workers";
import yoga from "satori/yoga.wasm";
import { fallbackFontPath } from "./fallback-fonts.ts";
import { cardRenderer } from "./png.ts";

/** "wOFF", a WOFF file's first four bytes. */
const woff = 0x774f4646;

export const { png: renderPng } = cardRenderer({
  yoga,
  resvg,
  fonts: [
    { name: "Inter", data: inter400, weight: 400, style: "normal" },
    { name: "Inter", data: inter600, weight: 600, style: "normal" },
    { name: "Inter", data: inter700, weight: 700, style: "normal" },
  ],
  async loadFont(file) {
    // The host is ignored: the binding answers from this Worker's own assets.
    const response = await env.ASSETS.fetch(`https://assets.invalid${fallbackFontPath}${file}`);
    const bytes = await response.arrayBuffer();
    // A missing file is not a 404 here: the single-page fallback answers
    // index.html with 200. Satori would throw on it, so say what is missing.
    if (!response.ok || bytes.byteLength < 4 || new DataView(bytes).getUint32(0) !== woff) {
      throw new Error(`share card: font ${file} is not among the static assets; scripts/copy-card-fonts.mjs copies them`);
    }
    return bytes;
  },
});
