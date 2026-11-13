// One contract, both implementations, then what only D1 can show: the pair
// and pending-request indexes, a 30,000-contact import inside D1's limits as
// one batch, and that nothing from a contact row but its three facts is kept.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  AttendeeRecord,
  AttendeeRepository,
  NetworkRepository,
  ScheduleRepository,
} from "@hallway/application";
import { connectionBetween, hashEmail, parseConnectionsCsv, type SessionReport } from "@hallway/domain";
import { attendeesOnD1 } from "../identity/d1-identity-repositories.ts";
import { attendeesInMemory } from "../identity/in-memory-identity-repositories.ts";
import { openDatabase } from "../persistence/d1/database.ts";
import { startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
import { scheduleOnD1 } from "../schedule/d1-schedule-repository.ts";
import { scheduleInMemory } from "../schedule/in-memory-schedule-repository.ts";
import { contactBytesPerStatement, contactChunks, networkOnD1 } from "./d1-network-repository.ts";
import { networkInMemory } from "./in-memory-network-repository.ts";

let local: LocalD1;
beforeAll(async () => {
  local = await startLocalD1();
});
afterAll(async () => {
  await local.dispose();
});

const event = "reinvent2026";
const at = "2026-11-13T12:00:00.000Z";
let unique = 0;
/** Ids no other test uses, since the D1 tests share one database. */
const fresh = (name: string) => `${name}-${String(++unique).padStart(5, "0")}`;

interface World {
  attendees: AttendeeRepository;
  schedule: ScheduleRepository;
  network: NetworkRepository;
}

const implementations: [string, () => World][] = [
  [
    "on D1",
    () => {
      const db = openDatabase(local.d1);
      return { attendees: attendeesOnD1(db), schedule: scheduleOnD1(db), network: networkOnD1(db) };
    },
  ],
  [
    "in memory",
    () => {
      const attendees = attendeesInMemory();
      const schedule = scheduleInMemory();
      return { attendees, schedule, network: networkInMemory({ attendees, schedule }) };
    },
  ],
];

async function person(world: World, name: string, extra: Partial<AttendeeRecord> = {}): Promise<AttendeeRecord> {
  const id = fresh(name);
  const attendee: AttendeeRecord = {
    id,
    handle: id,
    handlePlaceholder: false,
    displayName: name,
    visibility: "connections",
    linkedinSub: `sub-${id}`,
    createdAt: at,
    ...extra,
  };
  await world.attendees.create(attendee);
  return attendee;
}

const report = (attendeeId: string, sessionId: string, startsAt: string): SessionReport => ({
  sessionId,
  eventId: event,
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  attendeeId,
  reportedAt: at,
});
const favorite = (sessionId: string) => ({ sessionId, intent: "interested" as const, invited: false });

describe.each(implementations)("NetworkRepository %s", (_, make) => {
  it("keeps a pair once whichever side forms it, and answers for either spelling", async () => {
    const world = make();
    const [ana, ben] = [await person(world, "ana"), await person(world, "ben")];
    await world.network.connect(connectionBetween(ben.id, ana.id, "request", at), at);
    await world.network.connect(connectionBetween(ana.id, ben.id, "share-link", at), at);
    expect(await world.network.areConnected(ana.id, ben.id)).toBe(true);
    expect(await world.network.areConnected(ben.id, ana.id)).toBe(true);
    expect((await world.network.connection(ben.id, ana.id))?.via).toBe("request");
    expect((await world.network.connectionsOf(ana.id)).map((c) => c.other.id)).toEqual([ben.id]);
    expect((await world.network.connectionsOf(ben.id)).map((c) => c.other.id)).toEqual([ana.id]);

    await world.network.removeConnection(ben.id, ana.id);
    expect(await world.network.areConnected(ana.id, ben.id)).toBe(false);
  });

  it("makes an invite once, keeps it on later asks, and replaces it on rotation", async () => {
    const world = make();
    const ana = await person(world, "ana");
    expect(await world.network.invite(ana.id)).toBeUndefined();
    const first = fresh("tok");
    expect(await world.network.ensureInvite(ana.id, first, at)).toEqual({ token: first, rotatedAt: at });
    expect(await world.network.ensureInvite(ana.id, fresh("tok"), "2026-11-14T00:00:00.000Z")).toEqual({
      token: first,
      rotatedAt: at,
    });
    const second = fresh("tok");
    await world.network.replaceInvite(ana.id, second, "2026-11-15T00:00:00.000Z");
    expect(await world.network.invite(ana.id)).toEqual({ token: second, rotatedAt: "2026-11-15T00:00:00.000Z" });
  });

  it("allows one pending request per direction, and connecting settles both crossed requests", async () => {
    const world = make();
    const [ana, ben] = [await person(world, "ana"), await person(world, "ben")];
    const request = (id: string, from: string, to: string) =>
      ({ id, from, to, status: "pending", createdAt: at }) as const;
    const there = fresh("r");
    const back = fresh("r");
    await world.network.createRequest(request(there, ana.id, ben.id));
    await expect(world.network.createRequest(request(fresh("r"), ana.id, ben.id))).rejects.toThrow();
    await world.network.createRequest(request(back, ben.id, ana.id));
    expect((await world.network.pendingRequestsOf(ana.id)).map((r) => r.request.id).sort()).toEqual(
      [there, back].sort(),
    );
    expect(await world.network.linkedTo(ana.id)).toEqual(new Set([ben.id]));

    await world.network.connect(connectionBetween(ana.id, ben.id, "request", at), at);
    expect((await world.network.request(there))?.status).toBe("accepted");
    expect((await world.network.request(back))?.status).toBe("accepted");
    expect(await world.network.pendingRequestsOf(ana.id)).toEqual([]);
    expect(await world.network.linkedTo(ben.id)).toEqual(new Set([ana.id]));
  });

  it("closes only a pending request, and a closed one makes room for a new one", async () => {
    const world = make();
    const [ana, ben] = [await person(world, "ana"), await person(world, "ben")];
    const id = fresh("r");
    await world.network.createRequest({ id, from: ana.id, to: ben.id, status: "pending", createdAt: at });
    await world.network.closeRequest(id, "declined", at);
    await world.network.closeRequest(id, "withdrawn", at);
    expect((await world.network.request(id))?.status).toBe("declined");
    expect(await world.network.pendingRequest(ana.id, ben.id)).toBeUndefined();
    await world.network.createRequest({ id: fresh("r"), from: ana.id, to: ben.id, status: "pending", createdAt: at });
    expect(await world.network.pendingRequest(ana.id, ben.id)).toBeDefined();
  });

  it("replaces an import whole, and narrows candidates to attendees a contact points at", async () => {
    const world = make();
    const byEmail = await person(world, "Email Match", { verifiedEmailSha256: await hashEmail("e@example.test") });
    const byUrl = await person(world, "Url Match", { linkedinProfileUrl: "https://www.linkedin.com/in/url-match" });
    await person(world, "Nobody", { linkedinProfileUrl: "https://www.linkedin.com/in/nobody" });
    const me = await person(world, "me");

    await world.network.replaceContacts({ id: fresh("i"), attendeeId: me.id, importedAt: at, count: 1 }, [
      { name: "old row", profileUrl: "linkedin.com/in/nobody" },
    ]);
    const contacts = [
      { name: "email match", emailSha256: await hashEmail("e@example.test") },
      { name: "url match", profileUrl: "linkedin.com/in/url-match" },
      { name: "stranger", profileUrl: "linkedin.com/in/stranger" },
    ];
    const importId = fresh("i");
    await world.network.replaceContacts({ id: importId, attendeeId: me.id, importedAt: at, count: 3 }, contacts);
    expect(await world.network.contactImport(me.id)).toEqual({ id: importId, attendeeId: me.id, importedAt: at, count: 3 });

    const { contacts: matched, candidates } = await world.network.contactMatches(me.id);
    expect(candidates.map((a) => a.id).sort()).toEqual([byEmail.id, byUrl.id].sort());
    expect(matched.map((c) => c.name).sort()).toEqual(["email match", "url match"]);
  });

  it("reads my connections' entries for a list of sessions, a window or the whole event, hidden ones included", async () => {
    const world = make();
    const [me, friend, stranger] = [await person(world, "me"), await person(world, "friend"), await person(world, "stranger")];
    await world.network.connect(connectionBetween(me.id, friend.id, "request", at), at);
    const [morning, afternoon] = [fresh("s"), fresh("s")];
    await world.schedule.applySync({
      attendeeId: friend.id,
      eventId: event,
      reports: [
        report(friend.id, morning, "2026-12-01T17:00:00.000Z"),
        report(friend.id, afternoon, "2026-12-01T22:00:00.000Z"),
      ],
      synced: [favorite(morning), favorite(afternoon)],
      at,
      lastSync: { syncedAt: at, added: 2, removed: 0, changed: 0, unchanged: 0, missingSessions: 0 },
    });
    await world.schedule.setHidden(friend.id, event, afternoon, true);
    await world.schedule.applySync({
      attendeeId: stranger.id,
      eventId: event,
      reports: [],
      synced: [favorite(morning)],
      at,
      lastSync: { syncedAt: at, added: 1, removed: 0, changed: 0, unchanged: 0, missingSessions: 0 },
    });

    const listed = await world.network.connectionPlans(me.id, event, { sessionIds: [morning, afternoon] });
    expect(listed.map((p) => [p.owner.id, p.entry.sessionId, p.entry.hidden]).sort()).toEqual(
      [
        [friend.id, morning, false],
        [friend.id, afternoon, true],
      ].sort(),
    );
    const window = await world.network.connectionPlans(me.id, event, {
      startsFrom: "2026-12-01T20:00:00.000Z",
      startsBefore: "2026-12-02T08:00:00.000Z",
    });
    expect(window.map((p) => p.session.sessionId)).toEqual([afternoon]);
    const whole = await world.network.connectionPlans(me.id, event, { wholeEvent: true });
    expect(whole.map((p) => [p.owner.id, p.entry.sessionId]).sort()).toEqual(
      [
        [friend.id, morning],
        [friend.id, afternoon],
      ].sort(),
    );
    expect(await world.network.connectionPlans(me.id, "other-event", { sessionIds: [morning] })).toEqual([]);
  });
});

/** The D1 binding, with every batch's statement count and every bound string recorded. */
function recorded(d1: D1Database) {
  const log = { batches: [] as number[], parameters: [] as number[], longestString: 0 };
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
                  for (const value of values) {
                    if (typeof value === "string") log.longestString = Math.max(log.longestString, value.length);
                  }
                  return inner.bind(...values);
                };
              }
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

/** A synthetic Connections.csv in LinkedIn's layout, notes first. No real person in it. */
function connectionsCsv(rows: number): string {
  const lines = [
    "Notes:",
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    "",
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  ];
  for (let i = 0; i < rows; i++) {
    const email = i % 10 === 0 ? `person${i}@example.test` : "";
    lines.push(
      `Person,Number ${i},https://www.linkedin.com/in/person-${i},${email},"Acme Widgets ${i}, Inc.",Principal Widget Officer ${i},01 Jan 2024`,
    );
  }
  return lines.join("\n");
}

describe("NetworkRepository on D1, at export size", () => {
  it("stores a 30,000-row export as one batch of a few statements, inside D1's limits", async () => {
    const { d1, log } = recorded(local.d1);
    const db = openDatabase(d1);
    const network = networkOnD1(db);
    const me = await person({ attendees: attendeesOnD1(db), schedule: scheduleOnD1(db), network }, "big");
    const parsed = await parseConnectionsCsv(connectionsCsv(30_000));
    if (!parsed.ok) throw new Error("the synthetic CSV did not parse");
    expect(parsed.contacts).toHaveLength(30_000);

    log.batches.length = 0;
    log.parameters.length = 0;
    await network.replaceContacts({ id: fresh("i"), attendeeId: me.id, importedAt: at, count: 30_000 }, parsed.contacts);

    expect(log.batches).toHaveLength(1);
    // Two deletes, the import row, and the contacts in JSON chunks.
    const chunks = contactChunks(parsed.contacts, contactBytesPerStatement).length;
    expect(log.batches[0]).toBe(3 + chunks);
    expect(log.batches[0]).toBeLessThanOrEqual(50); // D1's free-plan queries per invocation
    expect(Math.max(...log.parameters)).toBeLessThanOrEqual(100);
    expect(log.longestString).toBeLessThanOrEqual(contactBytesPerStatement);
    const stored = await local.d1
      .prepare("select count(*) as n from imported_contacts where import_id = (select id from contact_imports where attendee_id = ?)")
      .bind(me.id)
      .first<{ n: number }>();
    expect(stored?.n).toBe(30_000);
  });

  it("is all or nothing: a replacement that fails keeps the previous import", async () => {
    const db = openDatabase(local.d1);
    const world = { attendees: attendeesOnD1(db), schedule: scheduleOnD1(db), network: networkOnD1(db) };
    const me = await person(world, "atomic");
    const first = fresh("i");
    await world.network.replaceContacts({ id: first, attendeeId: me.id, importedAt: at, count: 1 }, [
      { name: "kept", profileUrl: "linkedin.com/in/kept" },
    ]);
    // A contact with no name breaks the NOT NULL after the deletes and the new import row ran.
    const broken = [{ name: null as unknown as string, profileUrl: "linkedin.com/in/x" }];
    await expect(
      world.network.replaceContacts({ id: fresh("i"), attendeeId: me.id, importedAt: at, count: 1 }, broken),
    ).rejects.toThrow();
    expect((await world.network.contactImport(me.id))?.id).toBe(first);
  });

  it("keeps nothing of a contact row but its three facts: no company, position, date or raw email anywhere", async () => {
    const db = openDatabase(local.d1);
    const world = { attendees: attendeesOnD1(db), schedule: scheduleOnD1(db), network: networkOnD1(db) };
    const me = await person(world, "private");
    const csv = connectionsCsv(30);
    const parsed = await parseConnectionsCsv(csv);
    if (!parsed.ok) throw new Error("the synthetic CSV did not parse");
    await world.network.replaceContacts(
      { id: fresh("i"), attendeeId: me.id, importedAt: at, count: parsed.contacts.length },
      parsed.contacts,
    );

    const tables = await local.d1
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'")
      .all<{ name: string }>();
    const everything: string[] = [];
    for (const { name } of tables.results) {
      const rows = await local.d1.prepare(`select * from "${name}"`).all<Record<string, unknown>>();
      for (const row of rows.results) everything.push(...Object.values(row).map(String));
    }
    const text = everything.join("\n");
    expect(text).toContain("linkedin.com/in/person-10");
    expect(text).toContain(await hashEmail("person10@example.test"));
    for (const dropped of ["Acme Widgets", "Principal Widget Officer", "01 Jan 2024", "person10@example.test", "@example.test"]) {
      expect(text).not.toContain(dropped);
    }

    const columns = await local.d1.prepare("select name from pragma_table_info('imported_contacts')").all<{ name: string }>();
    expect(columns.results.map((c) => c.name).sort()).toEqual(["email_sha256", "import_id", "name", "profile_url"]);
  });

  it("refuses a pair spelled the wrong way round", async () => {
    const db = openDatabase(local.d1);
    const world = { attendees: attendeesOnD1(db), schedule: scheduleOnD1(db), network: networkOnD1(db) };
    const [low, high] = [await person(world, "aaa"), await person(world, "zzz")];
    await expect(
      local.d1
        .prepare("insert into connections (a, b, since, via) values (?, ?, ?, 'request')")
        .bind(high.id > low.id ? high.id : low.id, high.id > low.id ? low.id : high.id, at)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});
