import { describe, expect, it } from "vitest";
import { venueOf, venues, walks } from "./venues";

describe("venueOf", () => {
  it.each([
    ["Venetian", "venetian"],
    ["The Venetian", "venetian"],
    ["Venetian | Level 2", "venetian"],
    ["Venetian, Level 4, Lando 4201", "venetian"],
    ["VENETIAN EXPO", "venetian"],
    ["Caesars Forum", "caesars-forum"],
    ["Caesars Palace", "caesars-palace"],
    ["MGM Grand", "mgm-grand"],
    ["MGM Grand Conference Center", "mgm-grand"],
    ["Mandalay Bay", "mandalay-bay"],
    ["Mandalay Bay Convention Center | South", "mandalay-bay"],
    ["Wynn", "wynn"],
    ["Wynn Las Vegas", "wynn"],
    ["Encore", "encore"],
    ["Encore at Wynn", "encore"],
  ])("maps %j to %s", (text, venueId) => {
    expect(venueOf(text)).toBe(venueId);
  });

  it.each([
    ["Las Vegas Festival Grounds"],
    ["Caesars"],
    ["Wynnsboro"],
    ["Online"],
    [""],
  ])("maps %j to no venue", (text) => {
    expect(venueOf(text)).toBeUndefined();
  });

  it("has no venue for a session without venue text", () => {
    expect(venueOf(undefined)).toBeUndefined();
  });
});

describe("the measured venues", () => {
  it("has a center and a closed outline for every venue", () => {
    for (const venue of venues) {
      expect(venue.outline.length).toBeGreaterThan(3);
      expect(venue.outline[0]).toEqual(venue.outline.at(-1));
      const [lat, lon] = venue.center;
      expect(lat).toBeGreaterThan(36.08);
      expect(lat).toBeLessThan(36.14);
      expect(lon).toBeGreaterThan(-115.19);
      expect(lon).toBeLessThan(-115.15);
    }
  });

  it("has a walk each way between every two venues, rounded up to the minute", () => {
    for (const a of venues)
      for (const b of venues) {
        if (a === b) continue;
        const walk = walks.find((w) => w.from === a.venueId && w.to === b.venueId);
        expect(walk, `${a.venueId} to ${b.venueId}`).toBeDefined();
        expect(walk!.minutes).toBe(Math.ceil(walk!.seconds / 60));
      }
  });
});
