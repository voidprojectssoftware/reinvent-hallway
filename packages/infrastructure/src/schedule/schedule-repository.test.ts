// One contract, both implementations, then what only D1 can show: its
// parameter limit, its atomic batch, and a schema with no abstract in it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { CatalogSession, LastSync, ScheduleRepository, SyncWrite } from "@hallway/application";
import type { PlanEntry, SessionReport, SyncedSession } from "@hallway/domain";
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
const later = "2026-11-13T13:00:00.000Z";
const latest = "2026-11-13T14:00:00.000Z";
let unique = 0;
/** Ids no other test uses, since the D1 tests share one database. */
const fresh = (name: string) => `${name}-${++unique}`;

const report = (attendeeId: string, sessionId: string, extra: Partial<SessionReport> = {}): SessionReport => ({
  sessionId,
  eventId: event,
  attendeeId,
  reportedAt: seen,
  ...extra,
});
/** The catalog row a lone report makes. */
const shown = ({ attendeeId: _a, reportedAt, ...session }: SessionReport): CatalogSession => ({
  ...session,
  lastSeenAt: reportedAt,
});
const entry = (attendeeId: string, sessionId: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({
  attendeeId,
  sessionId,
  intent: "interested",
  source: "agent-sync",
  invited: false,
  hidden: false,
  addedAt: seen,
  ...extra,
});
const favorite = (sessionId: string): SyncedSession => ({ sessionId, intent: "interested", invited: false });
const reserved = (sessionId: string): SyncedSession => ({ sessionId, intent: "reserved", invited: false });
const invited = (sessionId: string): SyncedSession => ({ sessionId, intent: "reserved", invited: true });
const lastSync = (extra: Partial<LastSync> = {}): LastSync => ({
  syncedAt: seen,
  added: 0,
  removed: 0,
  changed: 0,
  unchanged: 0,
  missingSessions: 0,
  ...extra,
});
const sync = (write: Partial<SyncWrite> & Pick<SyncWrite, "attendeeId">): SyncWrite => ({
  eventId: event,
  reports: [],
  synced: [],
  at: seen,
  lastSync: lastSync(),
  ...write,
});
/** Puts sessions in the catalog, reported by someone else, so entries can point at them. */
const catalog = (repository: ScheduleRepository, ...ids: string[]) =>
  repository.applySync(sync({ attendeeId: fresh("reporter"), reports: ids.map((id) => report("x", id)) }));

const implementations: [string, () => ScheduleRepository][] = [
  ["on D1", () => scheduleOnD1(openDatabase(local.d1))],
  ["in memory", () => scheduleInMemory()],
];

describe.each(implementations)("ScheduleRepository %s", (_, make) => {
  it("stores a reported session with every field, and reads it back the same", async () => {
    const repository = make();
    const me = fresh("a");
    const full = report(me, fresh("full"), {
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
    const bare = report(me, fresh("bare"));
    await repository.applySync(sync({ attendeeId: me, reports: [full, bare] }));
    expect(await repository.session(event, full.sessionId)).toEqual(shown(full));
    expect(await repository.session(event, bare.sessionId)).toEqual(shown(bare));
    expect(await repository.session("other-event", full.sessionId)).toBeUndefined();
    expect(await repository.reports(me, event, [full.sessionId, bare.sessionId, fresh("none")])).toEqual(
      expect.arrayContaining([full, bare]),
    );
    expect(await repository.reports(fresh("other"), event, [full.sessionId])).toEqual([]);
  });

  it("a lone reporter's next report replaces their own whole", async () => {
    const repository = make();
    const [me, id] = [fresh("a"), fresh("s")];
    await repository.applySync(sync({ attendeeId: me, reports: [report(me, id, { title: "Old", room: "1" })] }));
    const next = report(me, id, { title: "New", reportedAt: later });
    await repository.applySync(sync({ attendeeId: me, reports: [next] }));
    expect(await repository.session(event, id)).toEqual(shown(next));
    expect(await repository.reports(me, event, [id])).toEqual([next]);
  });

  it("shows, per field, what most reporters agree on; one reporter cannot override two", async () => {
    const repository = make();
    const id = fresh("s");
    const [a, b, c] = [fresh("a"), fresh("b"), fresh("c")];
    const honest = { title: "Building agents", startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T19:00:00.000Z" };
    await repository.applySync(sync({ attendeeId: a, reports: [report(a, id, { ...honest, room: "101" })] }));
    await repository.applySync(sync({ attendeeId: b, reports: [report(b, id, { ...honest, reportedAt: later })] }));
    await repository.applySync(
      sync({
        attendeeId: c,
        reports: [
          report(c, id, {
            title: "CANCELLED, see you at the bar",
            startsAt: "2026-12-04T14:00:00.000Z",
            endsAt: "2026-12-04T14:05:00.000Z",
            venue: "Wynn",
            reportedAt: latest,
          }),
        ],
      }),
    );
    // Two against one on title and time; the room and venue each had one
    // reporter, who decides them; the newest report is when it was last seen.
    expect(await repository.session(event, id)).toEqual({
      sessionId: id,
      eventId: event,
      ...honest,
      room: "101",
      venue: "Wynn",
      lastSeenAt: latest,
    });
  });

  it("breaks a tie by the newest report, and votes on a start and its end as one", async () => {
    const repository = make();
    const id = fresh("s");
    const [a, b] = [fresh("a"), fresh("b")];
    await repository.applySync(
      sync({ attendeeId: a, reports: [report(a, id, { title: "Old title", startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T19:00:00.000Z", reportedAt: later })] }),
    );
    await repository.applySync(
      sync({ attendeeId: b, reports: [report(b, id, { title: "New title", startsAt: "2026-12-01T18:00:00.000Z", reportedAt: latest })] }),
    );
    expect(await repository.session(event, id)).toMatchObject({ title: "New title", startsAt: "2026-12-01T18:00:00.000Z" });
    expect((await repository.session(event, id))!.endsAt).toBeUndefined();
  });

  it("makes the attendee's synced entries exactly what was sent, whatever it read before", async () => {
    const repository = make();
    const [me, other] = [fresh("me"), fresh("other")];
    const [a, b, c, d] = [fresh("a"), fresh("b"), fresh("c"), fresh("d")];
    await catalog(repository, a, b, c, d);
    await repository.applySync(sync({ attendeeId: other, synced: [favorite(a)] }));
    // Two syncs planned from the same empty read: the second is a replace,
    // not an addition to the first (hunt F4).
    await repository.applySync(sync({ attendeeId: me, synced: [favorite(a), favorite(b)] }));
    await repository.applySync(sync({ attendeeId: me, synced: [reserved(b), invited(c)], at: later }));
    expect(await repository.entries(me, event)).toEqual(
      expect.arrayContaining([
        entry(me, b, { intent: "reserved" }),
        entry(me, c, { intent: "reserved", invited: true, addedAt: later }),
      ]),
    );
    expect(await repository.entries(me, event)).toHaveLength(2);
    expect(await repository.entries(other, event)).toEqual([entry(other, a)]);
  });

  it("keeps a manual entry, reserved while a sync says so and the attendee's own intent after", async () => {
    const repository = make();
    const [me, id, gone] = [fresh("me"), fresh("m"), fresh("m")];
    await catalog(repository, id, gone);
    const manual = entry(me, id, { source: "manual" });
    await repository.addEntry(event, manual);
    await repository.addEntry(event, entry(me, gone, { source: "manual" }));
    await repository.applySync(sync({ attendeeId: me, synced: [reserved(id)] }));
    expect(await repository.entry(me, event, id)).toEqual({ ...manual, intent: "reserved" });
    await repository.applySync(sync({ attendeeId: me, synced: [invited(id)] }));
    expect(await repository.entry(me, event, id)).toEqual({ ...manual, intent: "reserved", invited: true });
    await repository.applySync(sync({ attendeeId: me, synced: [favorite(id)] }));
    expect(await repository.entry(me, event, id)).toEqual(manual);
    await repository.applySync(sync({ attendeeId: me, synced: [reserved(id)] }));
    await repository.applySync(sync({ attendeeId: me, synced: [] }));
    expect(await repository.entries(me, event)).toEqual(
      expect.arrayContaining([manual, entry(me, gone, { source: "manual" })]),
    );
  });

  it("adds a manual entry once, even over a synced one, and never fails on it", async () => {
    const repository = make();
    const [me, id] = [fresh("me"), fresh("s")];
    await catalog(repository, id);
    await repository.applySync(sync({ attendeeId: me, synced: [favorite(id)] }));
    await repository.addEntry(event, entry(me, id, { source: "manual" }));
    expect(await repository.entry(me, event, id)).toEqual(entry(me, id));
    await repository.removeEntry(me, event, id);
    expect(await repository.entry(me, event, id)).toBeUndefined();
  });

  it("reads a schedule with its sessions, in start order, unplaced last", async () => {
    const repository = make();
    const me = fresh("me");
    const late = report(me, fresh("late"), { startsAt: "2026-12-03T07:30:00.000Z" });
    const early = report(me, fresh("early"), { startsAt: "2026-11-30T13:30:00.000Z" });
    const unplaced = report(me, fresh("unplaced"));
    await repository.applySync(
      sync({
        attendeeId: me,
        reports: [late, unplaced, early],
        synced: [favorite(late.sessionId), favorite(unplaced.sessionId), favorite(early.sessionId)],
      }),
    );
    await repository.setHidden(me, event, early.sessionId, true);
    expect(await repository.schedule(me, event)).toEqual([
      { entry: entry(me, early.sessionId, { hidden: true }), session: shown(early) },
      { entry: entry(me, late.sessionId), session: shown(late) },
      { entry: entry(me, unplaced.sessionId), session: shown(unplaced) },
    ]);
  });

  it("keeps a hidden session hidden when it leaves the schedule and comes back, until shown (hunt F5)", async () => {
    const repository = make();
    const [me, id] = [fresh("me"), fresh("s")];
    await catalog(repository, id);
    await repository.applySync(sync({ attendeeId: me, synced: [reserved(id)] }));
    await repository.setHidden(me, event, id, true);
    await repository.applySync(sync({ attendeeId: me, synced: [] }));
    expect(await repository.entry(me, event, id)).toBeUndefined();
    await repository.applySync(sync({ attendeeId: me, synced: [reserved(id)] }));
    expect(await repository.entry(me, event, id)).toEqual(entry(me, id, { intent: "reserved", hidden: true }));
    await repository.setHidden(me, event, id, false);
    expect(await repository.entry(me, event, id)).toEqual(entry(me, id, { intent: "reserved" }));
  });

  it("searches by code, title or speaker ignoring case and accents, and by start window", async () => {
    const repository = make();
    const me = fresh("a");
    const tag = fresh("zq").toUpperCase();
    const monday = report(me, fresh("m"), { code: `${tag}1`, title: "Monday thing", startsAt: "2026-11-30T18:00:00.000Z" });
    const tuesday = report(me, fresh("t"), { title: `All about ${tag}`, startsAt: "2026-12-01T18:00:00.000Z" });
    const speaker = report(me, fresh("sp"), { speakers: [`Dr ${tag}`] });
    const accented = report(me, fresh("acc"), { title: `Émilie on ${tag}`, speakers: ["Zoë Ångström", "李小龙"] });
    await repository.applySync(sync({ attendeeId: me, reports: [speaker, tuesday, monday, accented] }));
    const ids = (found: CatalogSession[]) => found.map((s) => s.sessionId);

    expect(ids(await repository.searchSessions(event, { q: tag.toLowerCase(), limit: 50 }))).toEqual([
      monday.sessionId,
      tuesday.sessionId,
      accented.sessionId,
      speaker.sessionId,
    ]);
    for (const q of ["Ångström", "ångström", "ZOË ÅNGSTRÖM", "zoe angstrom", "émilie", "EMILIE", "李小龙"]) {
      expect(ids(await repository.searchSessions(event, { q, limit: 50 })), q).toContain(accented.sessionId);
    }
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

  it("keeps the last sync per attendee and event, each sync replacing the one before", async () => {
    const repository = make();
    const [me, other] = [fresh("me"), fresh("other")];
    expect(await repository.lastSync(me, event)).toBeUndefined();
    const first = lastSync({ syncedAt: "2026-11-13T12:00:00.000Z", added: 3, missingSessions: 1 });
    const second = lastSync({ syncedAt: "2026-11-13T13:00:00.000Z", removed: 1, changed: 1, unchanged: 1 });
    await repository.applySync(sync({ attendeeId: me, lastSync: first }));
    await repository.applySync(sync({ attendeeId: other, lastSync: lastSync({ added: 9 }) }));
    expect(await repository.lastSync(me, event)).toEqual(first);
    await repository.applySync(sync({ attendeeId: me, lastSync: second }));
    expect(await repository.lastSync(me, event)).toEqual(second);
    expect(await repository.lastSync(other, event)).toEqual(lastSync({ added: 9 }));
    expect(await repository.lastSync(me, "other-event")).toBeUndefined();
  });

  it("finds the sessions it has among many ids", async () => {
    const repository = make();
    const ids = Array.from({ length: 250 }, () => fresh("many"));
    await catalog(repository, ...ids.slice(0, 200));
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
  it("writes a 1,000-session sync as one batch of a few statements, none over D1's parameter limit", async () => {
    const { d1, log } = recorded(local.d1);
    const repository = scheduleOnD1(openDatabase(d1));
    const me = fresh("me");
    const ids = Array.from({ length: 1000 }, () => fresh("big"));
    await repository.applySync(
      sync({
        attendeeId: me,
        reports: ids.map((id) =>
          report(me, id, { code: id, title: `Session ${id}`, speakers: ["A", "B"], topics: ["Serverless"] }),
        ),
        synced: ids.map((id, i) => (i % 2 ? reserved(id) : favorite(id))),
      }),
    );
    expect(log.batches).toHaveLength(1);
    expect(log.directRuns).toBe(0);
    expect(Math.max(...log.parameters)).toBeLessThanOrEqual(D1_MAX_PARAMETERS);
    // The last sync; catalog rows, reports, consensus; delete, manual fallback, entries.
    expect(log.batches[0]).toBe(1 + 1 + 1 + 1 + 1 + 1 + 1);
    expect(await repository.entries(me, event)).toHaveLength(1000);

    log.batches.length = 0;
    log.parameters.length = 0;
    await repository.applySync(sync({ attendeeId: me, synced: ids.slice(950).map(reserved) }));
    expect(log.batches).toEqual([4]);
    expect((await repository.entries(me, event)).map((e) => e.intent)).toEqual(Array(50).fill("reserved"));
  });

  it("is all or nothing: a sync whose last statement fails leaves no session, report or entry behind", async () => {
    const repository = scheduleOnD1(openDatabase(local.d1));
    const me = fresh("me");
    const ids = Array.from({ length: 30 }, () => fresh("atomic"));
    const write = sync({
      attendeeId: me,
      reports: ids.map((id) => report(me, id)),
      // The last entry names a session that is in neither the catalog nor
      // this write, so the foreign key refuses it after everything else ran.
      synced: [...ids.map(favorite), favorite(fresh("never-sent"))],
    });
    await expect(repository.applySync(write)).rejects.toThrow();
    expect(await repository.sessions(event, ids)).toEqual([]);
    expect(await repository.reports(me, event, ids)).toEqual([]);
    expect(await repository.entries(me, event)).toEqual([]);
    expect(await repository.lastSync(me, event)).toBeUndefined();
  });

  it("a failed sync leaves the previous last sync as it was", async () => {
    const repository = scheduleOnD1(openDatabase(local.d1));
    const me = fresh("me");
    const kept = fresh("kept");
    const before = lastSync({ syncedAt: "2026-11-13T12:00:00.000Z", added: 1 });
    await repository.applySync(
      sync({ attendeeId: me, reports: [report(me, kept)], synced: [favorite(kept)], lastSync: before }),
    );
    const failing = sync({
      attendeeId: me,
      synced: [favorite(fresh("never-sent"))],
      lastSync: lastSync({ syncedAt: "2026-11-13T13:00:00.000Z", added: 1, removed: 1 }),
    });
    await expect(repository.applySync(failing)).rejects.toThrow();
    expect(await repository.lastSync(me, event)).toEqual(before);
    expect(await repository.entries(me, event)).toEqual([entry(me, kept)]);
  });

  it("has no column an abstract could be kept in (ADR 0003)", async () => {
    const columns = await local.d1
      .prepare(
        "select name from pragma_table_info('sessions') union all select name from pragma_table_info('session_reports') union all select name from pragma_table_info('plan_entries')",
      )
      .all<{ name: string }>();
    const names = columns.results.map((column) => column.name);
    expect(names).toContain("title");
    expect(names.filter((name) => /abstract|description|summary/i.test(name))).toEqual([]);
  });
});
