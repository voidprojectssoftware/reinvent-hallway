// The campus map's base layer (issue #93, ADR 0029): OpenStreetMap vector
// tiles cut to the Strip by scripts/venues/cut-tiles.mjs and served as files
// from Hallway's own origin. No tile service sees who looks at the map.
// Drawn by protomaps-leaflet, as the Halloween weekend map does (its ADR 0006
// and src/scripts/basemap.ts, which this follows), in the --map-* tokens.
import * as L from "leaflet";
import { LineLabelSymbolizer, LineSymbolizer, PolygonSymbolizer, GeomType, leafletLayer, linear, type Feature, type LabelRule, type PaintRule } from "protomaps-leaflet";
import { campus } from "./campus.ts";

const pal = { land: "", urban: "", park: "", water: "", building: "", road: "", edge: "", label: "", halo: "", font: "" };

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function readPalette() {
  pal.land = token("--map-land");
  pal.urban = token("--map-urban");
  pal.park = token("--map-park");
  pal.water = token("--map-water");
  pal.building = token("--map-building");
  pal.road = token("--map-road");
  pal.edge = token("--map-road-edge");
  pal.label = token("--map-label");
  pal.halo = token("--map-halo");
  pal.font = token("--font") || "system-ui, sans-serif";
}

const kind = (f: Feature) => String(f.props.kind);
const urban = new Set(["residential", "commercial", "industrial", "retail", "railway", "parking"]);
const green = new Set(["park", "garden", "golf_course", "pitch", "playground", "recreation_ground", "grass"]);

// Widths in CSS pixels by display zoom, so streets widen as the map zooms in.
const widths = {
  major: linear([[13, 2], [16, 10], [18, 22]]),
  minor: linear([[13, 0.8], [16, 5], [18, 12]]),
  path: linear([[15, 0.6], [18, 3]]),
};

const road = (id: string, test: (f: Feature) => boolean, width: (z: number) => number, minzoom: number): PaintRule[] => [
  {
    id: `${id}-edge`,
    dataLayer: "roads",
    minzoom,
    filter: (_z, f) => test(f),
    symbolizer: new LineSymbolizer({ color: () => pal.edge, width: (z) => width(z) + 1.5, lineCap: "round", lineJoin: "round" }),
  },
  {
    id,
    dataLayer: "roads",
    minzoom,
    filter: (_z, f) => test(f),
    symbolizer: new LineSymbolizer({ color: () => pal.road, width, lineCap: "round", lineJoin: "round" }),
  },
];

const paintRules: PaintRule[] = [
  { dataLayer: "earth", symbolizer: new PolygonSymbolizer({ fill: () => pal.land }) },
  { dataLayer: "landuse", filter: (_z, f) => urban.has(kind(f)), symbolizer: new PolygonSymbolizer({ fill: () => pal.urban }) },
  { dataLayer: "landuse", filter: (_z, f) => green.has(kind(f)), symbolizer: new PolygonSymbolizer({ fill: () => pal.park }) },
  { dataLayer: "water", filter: (_z, f) => f.geomType === GeomType.Polygon, symbolizer: new PolygonSymbolizer({ fill: () => pal.water }) },
  { dataLayer: "buildings", symbolizer: new PolygonSymbolizer({ fill: () => pal.building }) },
  ...road("path", (f) => kind(f) === "path", widths.path, 15),
  ...road("minor", (f) => kind(f) === "minor_road", widths.minor, 13),
  ...road("major", (f) => kind(f) === "major_road" || kind(f) === "highway", widths.major, 12),
];

const labelRules: LabelRule[] = [
  {
    dataLayer: "roads",
    minzoom: 14,
    filter: (z, f) => kind(f) === "major_road" || (z >= 16 && kind(f) === "minor_road"),
    symbolizer: new LineLabelSymbolizer({
      labelProps: ["name"],
      font: () => `500 12px ${pal.font}`,
      fill: () => pal.label,
      stroke: () => pal.halo,
      width: 2.5,
    }),
  },
];

export type BaseLayer = ReturnType<typeof leafletLayer>;

/** The tile layer, beneath everything else. If the tiles are missing, the land color shows and the rest still draws. */
export function addBaseLayer(map: L.Map): BaseLayer {
  // protomaps-leaflet builds its layer on the global `L`, which Leaflet's ES
  // module build does not set.
  (globalThis as unknown as { L: typeof L }).L = L;
  readPalette();
  const layer = leafletLayer({
    url: "/tiles/{z}/{x}/{y}.mvt",
    maxDataZoom: 15,
    bounds: campus,
    paintRules,
    labelRules,
    backgroundColor: pal.land,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  layer.addTo(map);
  return layer;
}

/** Repaints the tiles in the current scheme's colors. */
export function restyleBase(layer: BaseLayer) {
  readPalette();
  layer.backgroundColor = pal.land;
  layer.clearLayout();
  layer.rerenderTiles();
}
