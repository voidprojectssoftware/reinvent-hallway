// `npm run tiles`: writes the campus map's base layer as static vector tiles,
// apps/web/public/tiles/{z}/{x}/{y}.mvt (issue #93, ADR 0029). The tiles are
// git-ignored: run this once in a checkout (and before a deploy) and Vite
// copies them into dist/, where the Worker serves them as static assets.
// Without them the map still draws the venues, the path and the pins on a
// plain background.
//
//   node scripts/venues/cut-tiles.mjs [source]
//
// `source` is a Protomaps basemap archive, a URL or a local .pmtiles path. It
// defaults to one pinned daily build of the whole planet, read with HTTP range
// requests, so only the tiles over the Strip are downloaded (about 100
// requests). The data is OpenStreetMap (ODbL), credited on the map.
//
// Adapted from the Halloween weekend map's scripts/make-basemap-tiles.mjs
// (its ADR 0006): one file per tile needs nothing from the server beyond
// serving files, and a layer is dropped by copying the other layers' bytes
// through untouched, so what is kept is byte for byte what Protomaps built.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { PMTiles, FetchSource } from "pmtiles";

const source = process.argv[2] ?? "https://build.protomaps.com/20261110.pmtiles";
// The Strip from Mandalay Bay to the Las Vegas Festival Grounds, with a margin.
// The same box as `campus` in apps/web/src/map/campus.ts.
const south = 36.075;
const west = -115.2;
const north = 36.15;
const east = -115.135;
// protomaps-leaflet draws display zoom z from tiles at z - 1, so the map's
// minZoom of 13 needs z12; z15 (the build's deepest) serves 16 and is
// overzoomed to 18.
const minZ = 12;
const maxZ = 15;
const keep = new Set(["earth", "water", "landuse", "roads", "buildings"]);
const out = new URL("../../apps/web/public/tiles/", import.meta.url);

class FileSource {
  constructor(path) {
    this.path = path;
    this.handle = open(path, "r");
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    const buffer = Buffer.alloc(length);
    await (await this.handle).read(buffer, 0, length, offset);
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + length) };
  }
}

const lng2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function varint(buffer, pos) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const b = buffer[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return [value, pos];
    shift += 7;
  }
}

/** The tile with only the kept layers, still encoded. A layer is field 3 of the tile; its name is the layer's field 1. */
function keepLayers(tile) {
  const parts = [];
  let pos = 0;
  while (pos < tile.length) {
    const start = pos;
    let key;
    [key, pos] = varint(tile, pos);
    if ((key & 7) !== 2) throw new Error(`unexpected wire type at ${start}`);
    let length;
    [length, pos] = varint(tile, pos);
    const body = tile.subarray(pos, pos + length);
    pos += length;
    if (key >> 3 !== 3) continue;
    let [layerKey, layerPos] = varint(body, 0);
    if (layerKey !== 0x0a) throw new Error("layer without a leading name");
    let nameLength;
    [nameLength, layerPos] = varint(body, layerPos);
    const name = Buffer.from(body.subarray(layerPos, layerPos + nameLength)).toString("utf8");
    if (keep.has(name)) parts.push(tile.subarray(start, pos));
  }
  return Buffer.concat(parts);
}

const archive = new PMTiles(/^https?:/.test(source) ? new FetchSource(source) : new FileSource(source));
const header = await archive.getHeader();
if (header.maxZoom < maxZ) throw new Error(`source stops at z${header.maxZoom}`);

rmSync(out, { recursive: true, force: true });
let files = 0;
let bytes = 0;
let largest = 0;
for (let z = minZ; z <= maxZ; z++) {
  const jobs = [];
  for (let x = lng2x(west, z); x <= lng2x(east, z); x++) for (let y = lat2y(north, z); y <= lat2y(south, z); y++) jobs.push([x, y]);
  // A few at a time: polite to a free public build server.
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(
      jobs.slice(i, i + 8).map(async ([x, y]) => {
        const got = await archive.getZxy(z, x, y);
        if (!got) return;
        const tile = keepLayers(new Uint8Array(got.data));
        mkdirSync(new URL(`${z}/${x}/`, out), { recursive: true });
        writeFileSync(new URL(`${z}/${x}/${y}.mvt`, out), tile);
        files++;
        bytes += tile.length;
        largest = Math.max(largest, tile.length);
      }),
    );
  }
  console.log(`z${z}: ${jobs.length} tiles`);
}
console.log(`${files} files, ${(bytes / 1024).toFixed(0)} KiB, largest ${(largest / 1024).toFixed(0)} KiB, from ${source}`);
