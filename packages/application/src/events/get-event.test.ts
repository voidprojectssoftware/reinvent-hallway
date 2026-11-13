import { describe, expect, it } from "vitest";
import type { Event } from "@hallway/contracts";
import { anonymous } from "../actor.ts";
import { getEvent } from "./get-event.ts";

const reinvent: Event = {
  eventId: "reinvent2026",
  name: "re:Invent 2026",
  timezone: "America/Los_Angeles",
  startDate: "2026-11-30T05:30-08:00",
  endDate: "2026-12-04T23:59-08:00",
};

// A stub, not packages/infrastructure's fake: application may not import
// infrastructure (ADR 0002, held by .dependency-cruiser.mjs).
const events = { get: async (id: string) => (id === reinvent.eventId ? reinvent : undefined) };

describe("GetEvent", () => {
  it("returns the event", async () => {
    expect(await getEvent(events)(anonymous, { eventId: "reinvent2026" })).toEqual({
      ok: true,
      value: reinvent,
    });
  });

  it("refuses an unknown event as not-found", async () => {
    const outcome = await getEvent(events)(anonymous, { eventId: "summit-nowhere" });
    expect(outcome).toEqual({
      ok: false,
      error: { kind: "not-found", message: "No event summit-nowhere. Hallway knows re:Invent 2026, `reinvent2026`." },
    });
  });
});
