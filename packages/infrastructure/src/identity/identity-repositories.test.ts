// One contract, both implementations, as for events: the fakes are only worth
// using in apps/api's tests while they answer exactly as D1 does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentTokenRepository,
  AttendeeRecord,
  AttendeeRepository,
  CalendarFeedRepository,
  IdentityRecord,
  WebSessionRepository,
} from "@hallway/application";
import { openDatabase } from "../persistence/d1/database.ts";
import { applyMigration, startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
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
    visibility: "network",
    createdAt: "2026-11-13T10:00:00.000Z",
    ...overrides,
  };
}

/** The identity an attendee is created with: dev sign-in, unless the test says otherwise. */
function anIdentity(attendee: AttendeeRecord, overrides: Partial<IdentityRecord> = {}): IdentityRecord {
  return {
    attendeeId: attendee.id,
    provider: "dev",
    subject: `subject-${attendee.id}`,
    emailVerified: false,
    linkedAt: attendee.createdAt,
    ...overrides,
  };
}

const created = async (attendees: AttendeeRepository, attendee: AttendeeRecord) =>
  attendees.create(attendee, anIdentity(attendee));

describe.each(implementations)("identity repositories %s", (_, open) => {
  it("stores an attendee with its first identity and finds it by id, handle and identity, without inventing absent fields", async () => {
    const { attendees } = open();
    const jane = anAttendee({ verifiedName: "Jane Doe", email: "jane@example.com" });
    const linkedIn = anIdentity(jane, {
      provider: "linkedin",
      email: "jane@example.com",
      emailVerified: true,
      verifiedEmailSha256: `hash-${jane.id}`,
    });
    await attendees.create(jane, linkedIn);
    expect(await attendees.byId(jane.id)).toEqual(jane);
    expect(await attendees.byHandle(jane.handle)).toEqual(jane);
    expect(await attendees.identity("linkedin", linkedIn.subject)).toEqual(linkedIn);
    expect(await attendees.identity("google", linkedIn.subject)).toBeUndefined();
    expect(await attendees.identityWithVerifiedEmail(`hash-${jane.id}`)).toEqual(linkedIn);
    expect(await attendees.identitiesOf(jane.id)).toEqual([linkedIn]);
    expect(await attendees.byHandle("nobody-here")).toBeUndefined();
  });

  it("links more identities, lists them oldest first, refreshes and unlinks one", async () => {
    const { attendees } = open();
    const jane = anAttendee();
    const first = anIdentity(jane, { provider: "google", linkedAt: "2026-11-13T10:00:00.000Z" });
    await attendees.create(jane, first);
    const gitHub = anIdentity(jane, { provider: "github", username: "jane", linkedAt: "2026-11-13T11:00:00.000Z" });
    await attendees.link(gitHub);
    expect(await attendees.identitiesOf(jane.id)).toEqual([first, gitHub]);

    const renamed = { ...gitHub, username: "jane-doe", email: "j@example.com" };
    await attendees.saveIdentity(renamed);
    expect(await attendees.identity("github", gitHub.subject)).toEqual(renamed);
    const { username: _, ...noLogin } = renamed;
    await attendees.saveIdentity(noLogin);
    expect(await attendees.identity("github", gitHub.subject)).toEqual(noLogin);

    await attendees.unlink(jane.id, "google");
    expect(await attendees.identitiesOf(jane.id)).toEqual([noLogin]);
  });

  it("refuses an identity another attendee holds, and a second of one provider", async () => {
    const { attendees } = open();
    const [one, two] = [anAttendee(), anAttendee()];
    const shared = anIdentity(one, { provider: "github" });
    await attendees.create(one, shared);
    await created(attendees, two);
    await expect(attendees.link({ ...shared, attendeeId: two.id })).rejects.toThrow();
    await expect(attendees.link(anIdentity(one, { provider: "github", subject: `other-${one.id}` }))).rejects.toThrow();
  });

  it("creates no attendee when its first identity is taken", async () => {
    const { attendees } = open();
    const [one, two] = [anAttendee(), anAttendee()];
    const identity = anIdentity(one);
    await attendees.create(one, identity);
    await expect(attendees.create(two, { ...identity, attendeeId: two.id })).rejects.toThrow();
    expect(await attendees.byId(two.id)).toBeUndefined();
  });

  it("keeps whether the handle is a placeholder", async () => {
    const { attendees } = open();
    const olga = anAttendee({ handlePlaceholder: true });
    await created(attendees, olga);
    expect(await attendees.byId(olga.id)).toEqual(olga);
    await attendees.save({ ...olga, handlePlaceholder: false });
    expect((await attendees.byId(olga.id))?.handlePlaceholder).toBe(false);
  });

  it("saves changes, including clearing an optional field", async () => {
    const { attendees } = open();
    const jane = anAttendee({ headline: "Engineer" });
    await created(attendees, jane);
    const { headline: _, ...cleared } = { ...jane, visibility: "public" as const, displayName: "Jane" };
    await attendees.save(cleared);
    expect(await attendees.byId(jane.id)).toEqual(cleared);
  });

  it("refuses a second attendee with a handle already taken", async () => {
    const { attendees } = open();
    const first = anAttendee();
    await created(attendees, first);
    await expect(created(attendees, anAttendee({ handle: first.handle }))).rejects.toThrow();
  });

  it("keeps agent tokens, finds them by hash, lists them oldest first, touches and revokes", async () => {
    const { attendees, tokens } = open();
    const owner = anAttendee();
    await created(attendees, owner);
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
    await created(attendees, owner);
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
    await created(attendees, owner);
    expect(await feeds.get(owner.id)).toBeUndefined();
    await feeds.replace(owner.id, `${owner.id}-old`, "2026-11-13T10:00:00.000Z");
    await feeds.replace(owner.id, `${owner.id}-new`, "2026-11-13T11:00:00.000Z");
    expect(await feeds.get(owner.id)).toEqual({ token: `${owner.id}-new`, rotatedAt: "2026-11-13T11:00:00.000Z" });
  });

  it("finds a feed's owner by its current token only, so a rotated URL opens nothing", async () => {
    const { attendees, feeds } = open();
    const owner = anAttendee();
    await created(attendees, owner);
    await feeds.replace(owner.id, `${owner.id}-old`, "2026-11-13T10:00:00.000Z");
    expect(await feeds.ownerOf(`${owner.id}-old`)).toBe(owner.id);
    await feeds.replace(owner.id, `${owner.id}-new`, "2026-11-13T11:00:00.000Z");
    expect(await feeds.ownerOf(`${owner.id}-old`)).toBeUndefined();
    expect(await feeds.ownerOf(`${owner.id}-new`)).toBe(owner.id);
  });

  it("refuses a feed token another attendee already holds", async () => {
    const { attendees, feeds } = open();
    const [one, two] = [anAttendee(), anAttendee()];
    await created(attendees, one);
    await created(attendees, two);
    await feeds.replace(one.id, `${one.id}-shared`, "2026-11-13T10:00:00.000Z");
    await expect(feeds.replace(two.id, `${one.id}-shared`, "2026-11-13T10:00:00.000Z")).rejects.toThrow();
  });
});

describe("migration 0010_add_identities", () => {
  it("moves each attendee's LinkedIn or dev sign-in into an identity row, keeping the verified email", async () => {
    const old = await startLocalD1({ before: "0010" });
    try {
      const insert = old.d1.prepare(
        "insert into attendees (id, handle, display_name, visibility, linkedin_sub, verified_name, email, verified_email_sha256, created_at) values (?, ?, ?, 'connections', ?, ?, ?, ?, ?)",
      );
      await old.d1.batch([
        insert.bind("a-li", "jane-doe", "Jane", "li-sub-1", "Jane Doe", "jane@example.com", "hash-jane", "2026-11-01T00:00:00.000Z"),
        insert.bind("a-li2", "sam", "Sam", "li-sub-2", "Sam", null, null, "2026-11-02T00:00:00.000Z"),
        insert.bind("a-dev", "dev-person", "Dev", "dev:dev person", "Dev Person", null, null, "2026-11-03T00:00:00.000Z"),
      ]);
      await applyMigration(old.d1, "0010_add_identities.sql");
      const attendees = attendeesOnD1(openDatabase(old.d1));
      expect(await attendees.identitiesOf("a-li")).toEqual([
        {
          attendeeId: "a-li",
          provider: "linkedin",
          subject: "li-sub-1",
          email: "jane@example.com",
          emailVerified: true,
          verifiedEmailSha256: "hash-jane",
          linkedAt: "2026-11-01T00:00:00.000Z",
        },
      ]);
      expect(await attendees.identity("linkedin", "li-sub-2")).toEqual({
        attendeeId: "a-li2",
        provider: "linkedin",
        subject: "li-sub-2",
        emailVerified: false,
        linkedAt: "2026-11-02T00:00:00.000Z",
      });
      expect(await attendees.identity("dev", "dev person")).toMatchObject({ attendeeId: "a-dev", emailVerified: false });
      expect(await attendees.byId("a-li")).toEqual({
        id: "a-li",
        handle: "jane-doe",
        handlePlaceholder: false,
        displayName: "Jane",
        visibility: "connections",
        verifiedName: "Jane Doe",
        email: "jane@example.com",
        createdAt: "2026-11-01T00:00:00.000Z",
      });
    } finally {
      await old.dispose();
    }
  });
});
