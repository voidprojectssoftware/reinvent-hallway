// The share card renderer as the Worker builds it. Only index.ts imports this:
// the `.wasm` and `.woff` imports are wrangler module rules (wrangler.jsonc
// "rules"), which Node cannot load; tests build their renderer from files.
//
// Inter (SIL Open Font License 1.1, from @fontsource/inter), Latin and Latin
// Extended, at the three weights the card uses. The system font the app uses
// does not exist on a Worker, and SF Pro may not be redistributed.
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff";
import interExt400 from "@fontsource/inter/files/inter-latin-ext-400-normal.woff";
import interExt600 from "@fontsource/inter/files/inter-latin-ext-600-normal.woff";
import interExt700 from "@fontsource/inter/files/inter-latin-ext-700-normal.woff";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import yoga from "satori/yoga.wasm";
import { cardRenderer } from "./png.ts";

export const { png: renderPng } = cardRenderer({
  yoga,
  resvg,
  fonts: [
    { name: "Inter", data: inter400, weight: 400, style: "normal" },
    { name: "Inter", data: inter600, weight: 600, style: "normal" },
    { name: "Inter", data: inter700, weight: 700, style: "normal" },
    { name: "Inter", data: interExt400, weight: 400, style: "normal" },
    { name: "Inter", data: interExt600, weight: 600, style: "normal" },
    { name: "Inter", data: interExt700, weight: 700, style: "normal" },
  ],
});
