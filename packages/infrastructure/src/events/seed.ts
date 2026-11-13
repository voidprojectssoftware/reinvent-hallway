import type { Event } from "@hallway/contracts";

/**
 * What migrations/0001_seed_reinvent2026.sql writes, for the in-memory fake.
 * The facts are AWS's `GET /v1/events` on 2026-11-13
 * (docs/discovery/aws-events-api.md). event-repository.test.ts reads the
 * migrated D1 and fails when the two disagree.
 */
export const reinvent2026: Event = {
  eventId: "reinvent2026",
  name: "re:Invent 2026",
  timezone: "America/Los_Angeles",
  startDate: "2026-11-30T05:30-08:00",
  endDate: "2026-12-04T23:59-08:00",
};
