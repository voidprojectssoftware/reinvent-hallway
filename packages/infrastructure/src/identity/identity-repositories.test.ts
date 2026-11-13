// One contract, both implementations, as for events: the fakes are only worth
// using in apps/api's tests while they answer exactly as D1 does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentTokenRepository,
  AttendeeRecord,
  AttendeeRepository,
  CalendarFeedRepository,
  WebSessionRepository,
} from "@hallway/application";
import { openDatabase } from "../persistence/d1/database.ts";
import { startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
import { agentTokensOnD1, attendeesOnD1, calendarFeedsOnD1, webSessionsOnD1 } from "./d1-identity-repositories.ts";
import {
  agentTokensInMemory,
  attendeesInMemory,
  calendarFeedsInMemory,
  webSessionsInMemory,
} from "./in-memory-identity-repositories.ts";

let local: LocalD1;
beforeAll(async () => {
  local = await startLocalD1();
});
afterAll(async () => {
  await local.dispose();
});

interface Repositories {
  attendees: AttendeeRepository;
  tokens: AgentTokenRepository;
  sessions: WebSessionRepository;
  feeds: CalendarFeedRepository;
}

const implementations: [string, () => Repositories][] = [
  [
    "on D1",
    () => {
      const db = openDatabase(local.d1);
      return {
        attendees: attendeesOnD1(db),
        tokens: agentTokensOnD1(db),
        sessions: webSessionsOnD1(db),
        feeds: calendarFeedsOnD1(db),
      };
    },
  ],
  [
    "in memory",
    () => ({
      attendees: attendeesInMemory(),
      tokens: agentTokensInMemory(),
      sessions: webSessionsInMemory(),
      feeds: calendarFeedsInMemory(),
    }),
  ],
];

let counter = 0;
/** A fresh attendee per test: the D1 database is shared by every test in the file. */
function anAttendee(overrides: Partial<AttendeeRecord> = {}): AttendeeRecord {
  counter += 1;
  return {
    id: `att-${counter}`,
    handle: `person-${counter}`,
    handlePlaceholder: false,
    displayName: `Person ${counter}`,
    visibility: "connections",
    linkedinSub: `sub-${counter}`,
    createdAt: "2026-11-13T10:00:00.000Z",
    ...overrides,
  };
}

describe.each(implementations)("identity repositories %s", (_, open) => {
  it("stores an attendee and finds it by id, handle and LinkedIn sub, without inventing absent fields", async () => {
    const { attendees } = open();
    const jane = anAttendee({ verifiedName: "Jane Doe", email: "jane@example.com", verifiedEmailSha256: "abc" });
    await attendees.create(jane);
    expect(await attendees.byId(jane.id)).toEqual(jane);
    expect(await attendees.byHandle(jane.handle)).toEqual(jane);
    expect(await attendees.byLinkedinSub(jane.linkedinSub)).toEqual(jane);
    expect(await attendees.byHandle("nobody-here")).toBeUndefined();
  });

  it("keeps whether the handle is a placeholder", async () => {
    const { attendees } = open();
    const olga = anAttendee({ handlePlaceholder: true });
    await attendees.create(olga);
    expect(await attendees.byId(olga.id)).toEqual(olga);
    await attendees.save({ ...olga, handlePlaceholder: false });
    expect((await attendees.byId(olga.id))?.handlePlaceholder).toBe(false);
  });

  it("saves changes, including clearing an optional field", async () => {
    const { attendees } = open();
    const jane = anAttendee({ headline: "Engineer" });
    await attendees.create(jane);
    const { headline: _, ...cleared } = { ...jane, visibility: "public" as const, displayName: "Jane" };
    await attendees.save(cleared);
    expect(await attendees.byId(jane.id)).toEqual(cleared);
  });

  it("refuses a second attendee with a handle already taken", async () => {
    const { attendees } = open();
    const first = anAttendee();
    await attendees.create(first);
    await expect(attendees.create(anAttendee({ handle: first.handle }))).rejects.toThrow();
  });

  it("keeps agent tokens, finds them by hash, lists them oldest first, touches and revokes", async () => {
    const { attendees, tokens } = open();
    const owner = anAttendee();
    await attendees.create(owner);
    const base = { attendeeId: owner.id, label: "laptop", prefix: "hw_abcdefgh" };
    await tokens.create({ ...base, id: `${owner.id}-t2`, secretSha256: `${owner.id}-h2`, createdAt: "2026-11-13T11:00:00.000Z" });
    await tokens.create({ ...base, id: `${owner.id}-t1`, secretSha256: `${owner.id}-h1`, createdAt: "2026-11-13T10:00:00.000Z" });

    expect((await tokens.listFor(owner.id)).map((t) => t.id)).toEqual([`${owner.id}-t1`, `${owner.id}-t2`]);
    expect(await tokens.bySecretSha256(`${owner.id}-h2`)).toMatchObject({ id: `${owner.id}-t2` });
    expect(await tokens.bySecretSha256("no-such-hash")).toBeUndefined();

    await tokens.touch(`${owner.id}-t1`, "2026-11-13T12:00:00.000Z");
    await tokens.revoke(`${owner.id}-t1`, "2026-11-13T13:00:00.000Z");
    expect(await tokens.byId(`${owner.id}-t1`)).toEqual({
      ...base,
      id: `${owner.id}-t1`,
      secretSha256: `${owner.id}-h1`,
      createdAt: "2026-11-13T10:00:00.000Z",
      lastUsedAt: "2026-11-13T12:00:00.000Z",
      revokedAt: "2026-11-13T13:00:00.000Z",
    });
  });

  it("keeps web sessions by hash and forgets one on delete", async () => {
    const { attendees, sessions } = open();
    const owner = anAttendee();
    await attendees.create(owner);
    const session = {
      idSha256: `${owner.id}-session`,
      attendeeId: owner.id,
      createdAt: "2026-11-13T10:00:00.000Z",
      expiresAt: "2026-12-13T10:00:00.000Z",
    };
    await sessions.create(session);
    expect(await sessions.byIdSha256(session.idSha256)).toEqual(session);
    await sessions.delete(session.idSha256);
    expect(await sessions.byIdSha256(session.idSha256)).toBeUndefined();
  });

  it("keeps one readable calendar feed per attendee, the latest rotation winning", async () => {
    const { attendees, feeds } = open();
    const owner = anAttendee();
    await attendees.create(owner);
    expect(await feeds.get(owner.id)).toBeUndefined();
    await feeds.replace(owner.id, `${owner.id}-old`, "2026-11-13T10:00:00.000Z");
    await feeds.replace(owner.id, `${owner.id}-new`, "2026-11-13T11:00:00.000Z");
    expect(await feeds.get(owner.id)).toEqual({ token: `${owner.id}-new`, rotatedAt: "2026-11-13T11:00:00.000Z" });
  });

  it("finds a feed's owner by its current token only, so a rotated URL opens nothing", async () => {
    const { attendees, feeds } = open();
    const owner = anAttendee();
    await attendees.create(owner);
    await feeds.replace(owner.id, `${owner.id}-old`, "2026-11-13T10:00:00.000Z");
    expect(await feeds.ownerOf(`${owner.id}-old`)).toBe(owner.id);
    await feeds.replace(owner.id, `${owner.id}-new`, "2026-11-13T11:00:00.000Z");
    expect(await feeds.ownerOf(`${owner.id}-old`)).toBeUndefined();
    expect(await feeds.ownerOf(`${owner.id}-new`)).toBe(owner.id);
  });

  it("refuses a feed token another attendee already holds", async () => {
    const { attendees, feeds } = open();
    const [one, two] = [anAttendee(), anAttendee()];
    await attendees.create(one);
    await attendees.create(two);
    await feeds.replace(one.id, `${one.id}-shared`, "2026-11-13T10:00:00.000Z");
    await expect(feeds.replace(two.id, `${one.id}-shared`, "2026-11-13T10:00:00.000Z")).rejects.toThrow();
  });
});
