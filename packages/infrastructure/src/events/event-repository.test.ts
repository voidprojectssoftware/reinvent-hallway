// One contract, both implementations: the fake is only worth using in other
// tests while it answers exactly as D1 does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventRepository } from "@hallway/application";
import { openDatabase } from "../persistence/d1/database.ts";
import { startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
import { eventsOnD1 } from "./d1-event-repository.ts";
import { eventsInMemory } from "./in-memory-event-repository.ts";
import { reinvent2026 } from "./seed.ts";

let local: LocalD1;
beforeAll(async () => {
  local = await startLocalD1();
});
afterAll(async () => {
  await local.dispose();
});

const implementations: [string, () => EventRepository][] = [
  ["on D1, migrated and seeded", () => eventsOnD1(openDatabase(local.d1))],
  ["in memory", () => eventsInMemory([reinvent2026])],
];

describe.each(implementations)("EventRepository %s", (_, repository) => {
  it("finds re:Invent 2026", async () => {
    expect(await repository().get("reinvent2026")).toEqual(reinvent2026);
  });

  it("finds nothing for an unknown id", async () => {
    expect(await repository().get("summit-nowhere")).toBeUndefined();
  });
});
