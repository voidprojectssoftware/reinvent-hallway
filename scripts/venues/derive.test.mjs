// The venue data in the domain is exactly what the committed measurements
// derive to (issue #93): nobody edits a coordinate or a walking time by hand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deriveVenueData } from "./derive.mjs";

test("packages/domain/src/venue-data.ts is what derive.mjs writes from docs/discovery/venues/", () => {
  const committed = readFileSync(new URL("../../packages/domain/src/venue-data.ts", import.meta.url), "utf8");
  assert.equal(committed, deriveVenueData(), "run `node scripts/venues/derive.mjs` and commit the result");
});
