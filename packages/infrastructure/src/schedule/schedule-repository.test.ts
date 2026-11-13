// One contract, both implementations, then what only D1 can show: its
// parameter limit, its atomic batch, and a schema with no abstract in it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { CatalogSession, ScheduleRepository, SyncWrite } from "@hallway/application";
import type { PlanEntry } from "@hallway/domain";
import { openDatabase } from "../persistence/d1/database.ts";
import { startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
import { D1_MAX_PARAMETERS, scheduleOnD1 } from "./d1-schedule-repository.ts";
import { scheduleInMemory } from "./in-memory-schedule-repository.ts";

let local: LocalD1;
beforeAll(async () => {
  local = await startLocalD1();
});
afterAll(async () => {
  await local.dispose();
});

const event = "reinvent2026";
const seen = "2026-11-13T12:00:00.000Z";
let unique = 0;
/** Ids no other test uses, since the D1 tests share one database. */
const fresh = (name: string) => `${name}-${++unique}`;

const session = (sessionId: string, extra: Partial<CatalogSession> = {}): CatalogSession => ({
  sessionId,
  eventId: event,
  lastSeenAt: seen,
  ...extra,
});
const entry = (attendeeId: string, sessionId: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({
  attendeeId,
  sessionId,
  intent: "interested",
  source: "agent-sync",
  hidden: false,
  addedAt: seen,
  ...extra,
});
const sync = (write: Partial<SyncWrite> & Pick<SyncWrite, "attendeeId">): SyncWrite => ({
  eventId: event,
  sessions: [],
  add: [],
  remove: [],
  update: [],
  ...write,
});

const implementations: [string, () => ScheduleRepository][] = [
  ["on D1", () => scheduleOnD1(openDatabase(local.d1))],
  ["in memory", () => scheduleInMemory()],
];

describe.each(implementations)("ScheduleRepository %s", (_, make) => {
  it("stores a session with every field, and reads it back the same", async () => {
    const repository = make();
    const full = session(fresh("full"), {
      code: "AIM3315",
      title: "Agents at scale",
      type: "Breakout session",
      level: "300 - Advanced",
      venue: "Venetian",
      room: "Level 3, Lido 3001",
      startsAt: "2026-12-01T16:00:00.000Z",
      endsAt: "2026-12-01T17:00:00.000Z",
      isAllDay: false,
      speakers: ["Priya Raman"],
      topics: ["Artificial Intelligence"],
    });
    const bare = session(fresh("bare"));
    await repository.applySync(sync({ attendeeId: fresh("a"), sessions: [full, bare] }));
    expect(await repository.session(event, full.sessionId)).toEqual(full);
    expect(await repository.session(event, bare.sessionId)).toEqual(bare);
    expect(await repository.session("other-event", full.sessionId)).toBeUndefined();
  });

  it("a stored session is replaced whole by the next write of it", async () => {
    const repository = make();
    const id = fresh("s");
    await repository.applySync(sync({ attendeeId: fresh("a"), sessions: [session(id, { title: "Old", room: "1" })] }));
    await repository.applySync(sync({ attendeeId: fresh("a"), sessions: [session(id, { title: "New" })] }));
    expect(await repository.session(event, id)).toEqual(session(id, { title: "New" }));
  });

  it("adds, updates and removes entries, one attendee's only", async () => {
    const repository = make();
    const [me, other] = [fresh("me"), fresh("other")];
    const [a, b, c] = [fresh("a"), fresh("b"), fresh("c")];
    await repository.applySync(
      sync({
        attendeeId: me,
        sessions: [session(a), session(b), session(c)],
        add: [entry(me, a), entry(me, b), entry(me, c, { source: "manual" })],
      }),
    );
    await repository.applySync(sync({ attendeeId: other, add: [entry(other, a)] }));
    await repository.applySync(
      sync({ attendeeId: me, remove: [a], update: [entry(me, b, { intent: "reserved" })] }),
    );
    expect(await repository.entries(me, event)).toEqual(
      expect.arrayContaining([entry(me, b, { intent: "reserved" }), entry(me, c, { source: "manual" })]),
    );
    expect(await repository.entries(me, event)).toHaveLength(2);
    expect(await repository.entries(other, event)).toEqual([entry(other, a)]);
  });

  it("reads a schedule with its sessions, in start order, unplaced last", async () => {
    const repository = make();
    const me = fresh("me");
    const late = session(fresh("late"), { startsAt: "2026-12-03T07:30:00.000Z" });
    const early = session(fresh("early"), { startsAt: "2026-11-30T13:30:00.000Z" });
    const unplaced = session(fresh("unplaced"));
    await repository.applySync(
      sync({
        attendeeId: me,
        sessions: [late, unplaced, early],
        add: [entry(me, late.sessionId), entry(me, unplaced.sessionId), entry(me, early.sessionId, { hidden: true })],
      }),
    );
    expect(await repository.schedule(me, event)).toEqual([
      { entry: entry(me, early.sessionId, { hidden: true }), session: early },
      { entry: entry(me, late.sessionId), session: late },
      { entry: entry(me, unplaced.sessionId), session: unplaced },
    ]);
  });

  it("adds a manual entry once, hides it, removes it", async () => {
    const repository = make();
    const [me, id] = [fresh("me"), fresh("s")];
    await repository.applySync(sync({ attendeeId: me, sessions: [session(id)] }));
    const manual = entry(me, id, { source: "manual" });
    await repository.addEntry(event, manual);
    await repository.addEntry(event, { ...manual, intent: "reserved" });
    expect(await repository.entry(me, event, id)).toEqual(manual);
    await repository.setHidden(me, event, id, true);
    expect(await repository.entry(me, event, id)).toEqual({ ...manual, hidden: true });
    await repository.removeEntry(me, event, id);
    expect(await repository.entry(me, event, id)).toBeUndefined();
  });

  it("searches by code, title or speaker ignoring case, and by start window", async () => {
    const repository = make();
    const tag = fresh("zq").toUpperCase();
    const monday = session(fresh("m"), {
      code: `${tag}1`,
      title: "Monday thing",
      startsAt: "2026-11-30T18:00:00.000Z",
    });
    const tuesday = session(fresh("t"), {
      title: `All about ${tag}`,
      startsAt: "2026-12-01T18:00:00.000Z",
    });
    const speaker = session(fresh("sp"), { speakers: [`Dr ${tag}`] });
    await repository.applySync(sync({ attendeeId: fresh("a"), sessions: [speaker, tuesday, monday] }));
    const ids = (found: CatalogSession[]) => found.map((s) => s.sessionId);

    expect(ids(await repository.searchSessions(event, { q: tag.toLowerCase(), limit: 50 }))).toEqual([
      monday.sessionId,
      tuesday.sessionId,
      speaker.sessionId,
    ]);
    expect(
      ids(
        await repository.searchSessions(event, {
          q: tag,
          startsFrom: "2026-12-01T08:00:00.000Z",
          startsBefore: "2026-12-02T08:00:00.000Z",
          limit: 50,
        }),
      ),
    ).toEqual([tuesday.sessionId]);
    expect(await repository.searchSessions(event, { q: tag, limit: 1 })).toHaveLength(1);
    expect(await repository.searchSessions(event, { q: "%", limit: 50 })).toEqual([]);
  });

  it("finds the sessions it has among many ids", async () => {
    const repository = make();
    const ids = Array.from({ length: 250 }, () => fresh("many"));
    await repository.applySync(sync({ attendeeId: fresh("a"), sessions: ids.slice(0, 200).map((id) => session(id)) }));
    const found = await repository.sessions(event, ids);
    expect(found.map((s) => s.sessionId).sort()).toEqual(ids.slice(0, 200).sort());
  });
});

/** The D1 binding, with every statement's parameter count and every batch recorded. */
function recorded(d1: D1Database) {
  const log = { parameters: [] as number[], batches: [] as number[], directRuns: 0 };
  const wrapped = new Proxy(d1, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return new Proxy(statement, {
            get(inner, key) {
              if (key === "bind") {
                return (...values: unknown[]) => {
                  log.parameters.push(values.length);
                  return inner.bind(...values);
                };
              }
              if (key === "run" || key === "all" || key === "raw" || key === "first") log.directRuns++;
              const value = Reflect.get(inner, key);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        };
      }
      if (property === "batch") {
        return (statements: unknown[]) => {
          log.batches.push(statements.length);
          return target.batch(statements as Parameters<D1Database["batch"]>[0]);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { d1: wrapped, log };
}

describe("ScheduleRepository on D1, at sync size", () => {
  it("writes a 200-session sync as one batch, no statement over D1's parameter limit", async () => {
    const { d1, log } = recorded(local.d1);
    const repository = scheduleOnD1(openDatabase(d1));
    const me = fresh("me");
    const ids = Array.from({ length: 200 }, () => fresh("big"));
    await repository.applySync(
      sync({
        attendeeId: me,
        sessions: ids.map((id) =>
          session(id, { code: id, title: `Session ${id}`, speakers: ["A", "B"], topics: ["Serverless"] }),
        ),
        add: ids.map((id, i) => entry(me, id, { intent: i % 2 ? "reserved" : "interested" })),
      }),
    );
    expect(log.batches).toHaveLength(1);
    expect(log.directRuns).toBe(0);
    expect(Math.max(...log.parameters)).toBeLessThanOrEqual(D1_MAX_PARAMETERS);
    // 200 sessions of 14 columns, 7 a statement; 200 entries of 7 columns, 14 a statement.
    expect(log.batches[0]).toBe(29 + 15);
    expect(await repository.entries(me, event)).toHaveLength(200);

    // And the next sync of the same size, removing and changing most of it.
    log.batches.length = 0;
    log.parameters.length = 0;
    await repository.applySync(
      sync({
        attendeeId: me,
        remove: ids.slice(0, 150),
        update: ids.slice(150).map((id) => entry(me, id, { intent: "reserved" })),
      }),
    );
    expect(log.batches).toHaveLength(1);
    expect(Math.max(...log.parameters)).toBeLessThanOrEqual(D1_MAX_PARAMETERS);
    expect((await repository.entries(me, event)).map((e) => e.intent)).toEqual(Array(50).fill("reserved"));
  });

  it("is all or nothing: a sync whose last statement fails leaves no session and no entry behind", async () => {
    const repository = scheduleOnD1(openDatabase(local.d1));
    const me = fresh("me");
    const ids = Array.from({ length: 30 }, () => fresh("atomic"));
    const write = sync({
      attendeeId: me,
      sessions: ids.map((id) => session(id)),
      // The last entry names a session that is in neither the catalog nor
      // this write, so the foreign key refuses it after everything else ran.
      add: [...ids.map((id) => entry(me, id)), entry(me, fresh("never-sent"))],
    });
    await expect(repository.applySync(write)).rejects.toThrow();
    expect(await repository.sessions(event, ids)).toEqual([]);
    expect(await repository.entries(me, event)).toEqual([]);
  });

  it("has no column an abstract could be kept in (ADR 0003)", async () => {
    const columns = await local.d1
      .prepare("select name from pragma_table_info('sessions') union all select name from pragma_table_info('plan_entries')")
      .all<{ name: string }>();
    const names = columns.results.map((column) => column.name);
    expect(names).toContain("title");
    expect(names.filter((name) => /abstract|description|summary/i.test(name))).toEqual([]);
  });
});
