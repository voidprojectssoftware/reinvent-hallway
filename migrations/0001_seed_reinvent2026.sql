-- re:Invent 2026 as AWS's public GET /v1/events gave it on 2026-11-13
-- (docs/discovery/aws-events-api.md). Events are seeded, never user-created.
-- packages/infrastructure/src/events/seed.ts holds the same row for the
-- in-memory fake; event-repository.test.ts fails when they disagree.
INSERT INTO `events` (`event_id`, `name`, `timezone`, `start_date`, `end_date`)
VALUES ('reinvent2026', 're:Invent 2026', 'America/Los_Angeles', '2026-11-30T05:30-08:00', '2026-12-04T23:59-08:00');
