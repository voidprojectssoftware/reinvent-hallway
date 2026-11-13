import { describe, expect, it } from "vitest";
import { Venues } from "@hallway/contracts";
import { anonymous } from "../actor.ts";
import { getVenues } from "./get-venues.ts";

const events = {
  get: async (id: string) =>
    id === "reinvent2026"
      ? { eventId: id, name: "re:Invent 2026", timezone: "America/Los_Angeles", startDate: "2026-11-30T05:30-08:00", endDate: "2026-12-04T23:59-08:00" }
      : undefined,
};

describe("GetVenues", () => {
  it("returns every venue and a walk each way between every two, as the contract says", async () => {
    const outcome = await getVenues(events)(anonymous, { eventId: "reinvent2026" });
    if (!outcome.ok) throw new Error(outcome.error.message);
    const venues = Venues.parse(outcome.value);
    expect(venues.venues.map((v) => v.venueId)).toContain("venetian");
    expect(venues.walks).toHaveLength(venues.venues.length * (venues.venues.length - 1));
    expect(venues.attribution).toContain("OpenStreetMap");
  });

  it("refuses an unknown event as not-found", async () => {
    const outcome = await getVenues(events)(anonymous, { eventId: "summit-nowhere" });
    expect(outcome).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });
});
