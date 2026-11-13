// `npm run seed:demo` (scripts/seed-demo.mjs) against the app over the
// in-memory fakes: it must work through the public API alone, and a second run
// must change nothing (ADR 0017).
import { describe, expect, it } from "vitest";
import type { ConnectionList, MySchedule } from "@hallway/contracts";
import { demoConnections, demoPeople, seedDemo } from "../../../scripts/seed-demo.mjs";
import { createApp } from "./app.ts";
import { inMemoryHandlers, noPng } from "./testing/in-memory-handlers.ts";

const origin = "http://127.0.0.1:8787";

function world() {
  const { handlers } = inMemoryHandlers();
  const app = createApp<{ DEV_SIGN_IN?: string }>({ handlers: () => handlers, renderPng: noPng });
  const fetchFn = async (input: string, init?: RequestInit) => app.fetch(new Request(input, init), { DEV_SIGN_IN: "1" });
  return { fetchFn };
}

async function snapshot(fetchFn: (input: string, init?: RequestInit) => Promise<Response>, cookie: string) {
  const get = async <T>(path: string) => (await (await fetchFn(`${origin}${path}`, { headers: { cookie } })).json()) as T;
  // When a sync ran, what it did last time, and when it last saw each session
  // move on every run by design; the entries and connections must not.
  const { lastSync: _lastSync, ...schedule } = await get<MySchedule>("/api/events/reinvent2026/my-schedule");
  const entries = schedule.entries.map(({ session: { lastSeenAt: _lastSeenAt, ...session }, ...entry }) => ({ ...entry, session }));
  return { schedule: { ...schedule, entries }, connections: await get<ConnectionList>("/api/me/connections") };
}

describe("seed:demo", () => {
  it("signs in each demo person, syncs their schedule and connects the pairs", async () => {
    const { fetchFn } = world();
    const people = await seedDemo(origin, { fetchFn });

    expect([...people.keys()]).toEqual(demoPeople.map((person) => person.name));
    const blake = people.get("Blake Hastings")!;
    const { schedule, connections } = await snapshot(fetchFn, blake.cookie);
    const blakeIds = new Set([...demoPeople[0]!.favorites, ...demoPeople[0]!.reserved]);
    expect(schedule.entries).toHaveLength(blakeIds.size);
    const expected = demoConnections.filter((pair) => pair.includes("Blake Hastings")).length;
    expect(connections.connections).toHaveLength(expected);
  });

  it("run twice, finds the same people and leaves schedules and connections as they were", async () => {
    const { fetchFn } = world();
    const first = await seedDemo(origin, { fetchFn });
    const before = await snapshot(fetchFn, first.get("Blake Hastings")!.cookie);

    const lines: string[] = [];
    const second = await seedDemo(origin, { fetchFn, log: (line) => lines.push(line) });
    const after = await snapshot(fetchFn, second.get("Blake Hastings")!.cookie);

    for (const [name, person] of first) expect(second.get(name)!.id).toBe(person.id);
    expect(after).toEqual(before);
    for (const line of lines.filter((line) => line.includes("sync added"))) {
      expect(line).toMatch(/sync added 0, removed 0$/);
    }
  });
});
