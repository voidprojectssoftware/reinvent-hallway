import { describe, expect, it } from "vitest";
import {
  consensus,
  foldText,
  mergeSnapshot,
  sessionUrl,
  toSession,
  unreadableTime,
  type AwsSession,
  type SessionReport,
} from "./sessions";
import { toLocal } from "./time";
import type { Session } from "./types";

const reinvent = { eventId: "reinvent2026", timezone: "America/Los_Angeles" };

function timed(date: string, time: string | undefined, length: string | undefined, extra: Partial<AwsSession> = {}): Session {
  const sessionTime: NonNullable<AwsSession["sessionTime"]> = { date };
  if (time !== undefined) sessionTime.time = time;
  if (length !== undefined) sessionTime.length = length;
  return toSession({ sessionId: "s1", sessionTime, ...extra }, reinvent);
}

describe("toSession: local date, time and length to UTC instants", () => {
  // Each row is a case in the PR's time-conversion table.
  it.each([
    ["morning", "2026-12-01", "08:00", "60", "2026-12-01T16:00:00.000Z", "2026-12-01T17:00:00.000Z"],
    ["16:00 local is UTC midnight", "2026-12-01", "16:00", "60", "2026-12-02T00:00:00.000Z", "2026-12-02T01:00:00.000Z"],
    ["90 minutes across UTC midnight", "2026-12-02", "15:30", "90", "2026-12-02T23:30:00.000Z", "2026-12-03T01:00:00.000Z"],
    ["23:30 local, ends after local midnight", "2026-12-03", "23:30", "60", "2026-12-04T07:30:00.000Z", "2026-12-04T08:30:00.000Z"],
    ["first session of the week", "2026-11-30", "05:30", "30", "2026-11-30T13:30:00.000Z", "2026-11-30T14:00:00.000Z"],
    ["length with spaces", "2026-12-01", "09:15", " 45 ", "2026-12-01T17:15:00.000Z", "2026-12-01T18:00:00.000Z"],
  ])("%s", (_name, date, time, length, startsAt, endsAt) => {
    const session = timed(date, time, length);
    expect(session.startsAt).toBe(startsAt);
    expect(session.endsAt).toBe(endsAt);
  });

  it("uses the zone's rules, not a fixed offset: July is PDT (UTC-7)", () => {
    expect(timed("2026-07-01", "16:00", "60").startsAt).toBe("2026-07-01T23:00:00.000Z");
  });

  it("ignores the abbreviation AWS sends: 'PDT' in December is still PST", () => {
    const session = toSession(
      { sessionId: "s1", sessionTime: { date: "2026-12-01", time: "16:00", length: "60", timezone: "PDT" } },
      reinvent,
    );
    expect(session.startsAt).toBe("2026-12-02T00:00:00.000Z");
  });

  it("places an all-day session from local midnight to the next local midnight", () => {
    const session = timed("2026-12-02", undefined, undefined, { isAllDaySession: true });
    expect(session).toMatchObject({
      isAllDay: true,
      startsAt: "2026-12-02T08:00:00.000Z",
      endsAt: "2026-12-03T08:00:00.000Z",
    });
  });

  it("an all-day flag wins over a time", () => {
    const session = timed("2026-12-02", "10:00", "60", { isAllDaySession: true });
    expect(session.startsAt).toBe("2026-12-02T08:00:00.000Z");
    expect(session.endsAt).toBe("2026-12-03T08:00:00.000Z");
  });

  it("a session with no sessionTime is a catalog entry with no place in a day", () => {
    const session = toSession({ sessionId: "s1", title: "Keynote" }, reinvent);
    expect(session).toEqual({ sessionId: "s1", eventId: "reinvent2026", title: "Keynote" });
  });

  it("no time, or an unreadable date or time, places nothing", () => {
    expect(timed("2026-12-01", undefined, "60").startsAt).toBeUndefined();
    expect(timed("2026-02-30", "10:00", "60").startsAt).toBeUndefined();
    expect(timed("Dec 1", "10:00", "60").startsAt).toBeUndefined();
    expect(timed("2026-12-01", "25:00", "60").startsAt).toBeUndefined();
  });

  it("no or unreadable length gives a start and no end", () => {
    expect(timed("2026-12-01", "10:00", undefined)).toMatchObject({ startsAt: "2026-12-01T18:00:00.000Z" });
    expect(timed("2026-12-01", "10:00", undefined).endsAt).toBeUndefined();
    expect(timed("2026-12-01", "10:00", "an hour").endsAt).toBeUndefined();
  });

  it("round-trips to the local wall clock", () => {
    const session = timed("2026-12-03", "23:30", "60");
    expect(toLocal(session.startsAt!, reinvent.timezone)).toEqual({ date: "2026-12-03", time: "23:30" });
    expect(toLocal(session.endsAt!, reinvent.timezone)).toEqual({ date: "2026-12-04", time: "00:30" });
  });
});

describe("toSession: what is kept", () => {
  const full = {
    sessionId: "abc",
    title: "Building agents",
    abbreviation: "AIM3315",
    abstract: "AWS's content, behind a login",
    type: "Chalk talk",
    level: "300 - Advanced",
    venue: "Venetian",
    room: "Level 3, Murano 3201",
    isAllDaySession: false,
    isReservable: true,
    speakers: [{ name: " Priya Rao " }, {}, { name: "Sam Lee" }],
    topics: ["Artificial Intelligence"],
    tracks: ["AI"],
    industries: ["Retail"],
    services: ["Amazon Bedrock"],
    areasOfInterest: ["Generative AI"],
  };

  it("keeps identity and placement, speakers as names, and topics", () => {
    expect(toSession(full, reinvent)).toEqual({
      sessionId: "abc",
      eventId: "reinvent2026",
      code: "AIM3315",
      title: "Building agents",
      type: "Chalk talk",
      level: "300 - Advanced",
      venue: "Venetian",
      room: "Level 3, Murano 3201",
      isAllDay: false,
      speakers: ["Priya Rao", "Sam Lee"],
      topics: ["Artificial Intelligence"],
    });
  });

  it("never carries the abstract or the other taxonomies (ADR 0003)", () => {
    const keys = Object.keys(toSession(full, reinvent));
    for (const dropped of ["abstract", "tracks", "industries", "services", "areasOfInterest", "isReservable"]) {
      expect(keys).not.toContain(dropped);
    }
    expect(JSON.stringify(toSession(full, reinvent))).not.toContain("behind a login");
  });
});

describe("mergeSnapshot", () => {
  const old: Session = {
    sessionId: "s1",
    eventId: "reinvent2026",
    code: "AIM3315",
    title: "Old title",
    room: "Room A",
    startsAt: "2026-12-01T16:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    speakers: ["Priya Rao"],
  };

  it("a newer field replaces the old one; an absent field keeps it", () => {
    const merged = mergeSnapshot(old, { sessionId: "s1", eventId: "reinvent2026", title: "New title" });
    expect(merged).toEqual({ ...old, title: "New title" });
  });

  it("an empty list is a value, not an absence", () => {
    expect(mergeSnapshot(old, { sessionId: "s1", eventId: "reinvent2026", speakers: [] }).speakers).toEqual([]);
  });

  it("a newer start brings its own end, or none, never the old end", () => {
    const moved = mergeSnapshot(old, { sessionId: "s1", eventId: "reinvent2026", startsAt: "2026-12-02T16:00:00.000Z" });
    expect(moved.startsAt).toBe("2026-12-02T16:00:00.000Z");
    expect(moved.endsAt).toBeUndefined();
  });

  it("does not change its inputs", () => {
    const before = JSON.parse(JSON.stringify(old));
    mergeSnapshot(old, { sessionId: "s1", eventId: "reinvent2026", title: "x" });
    expect(old).toEqual(before);
  });
});

describe("sessionUrl", () => {
  it("fills {code}, encoded", () => {
    expect(sessionUrl("AIM3315", "https://example.test/catalog?search={code}")).toBe(
      "https://example.test/catalog?search=AIM3315",
    );
    expect(sessionUrl("A B&C", "https://example.test/s/{code}")).toBe("https://example.test/s/A%20B%26C");
  });

  it("refuses a template that would send every session to one page", () => {
    expect(() => sessionUrl("AIM3315", "https://example.test/catalog")).toThrow(/\{code\}/);
  });
});

describe("consensus", () => {
  const report = (attendeeId: string, reportedAt: string, fields: Partial<Session>): SessionReport => ({
    sessionId: "s",
    eventId: "e",
    attendeeId,
    reportedAt,
    ...fields,
  });
  const honest = { title: "Building agents", startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T19:00:00.000Z" };

  it("a lone report is the session", () => {
    expect(consensus([report("a", "t1", { ...honest, room: "101" })])).toEqual({
      sessionId: "s",
      eventId: "e",
      ...honest,
      room: "101",
    });
  });

  it("per field, the most reports win, so one newer report cannot override two (hunt F6)", () => {
    const poisoned = {
      title: "CANCELLED, see you at the bar",
      startsAt: "2026-12-04T14:00:00.000Z",
      endsAt: "2026-12-04T14:05:00.000Z",
    };
    const session = consensus([
      report("a", "t1", honest),
      report("b", "t2", honest),
      report("c", "t3", { ...poisoned, venue: "Wynn" }),
    ]);
    expect(session).toEqual({ sessionId: "s", eventId: "e", ...honest, venue: "Wynn" });
  });

  it("a tie goes to the value whose latest report is newest", () => {
    expect(consensus([report("a", "t2", { title: "Old" }), report("b", "t3", { title: "New" })]).title).toBe("New");
    expect(consensus([report("a", "t3", { title: "Old" }), report("b", "t2", { title: "New" })]).title).toBe("Old");
  });

  it("a report without a field does not vote on it", () => {
    expect(consensus([report("a", "t1", { title: "Kept" }), report("b", "t2", {}), report("c", "t3", {})]).title).toBe(
      "Kept",
    );
  });

  it("a start and its end are one vote: a newer start never pairs with another report's end", () => {
    const session = consensus([
      report("a", "t1", { startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T19:00:00.000Z" }),
      report("b", "t2", { startsAt: "2026-12-01T18:00:00.000Z" }),
    ]);
    expect(session.startsAt).toBe("2026-12-01T18:00:00.000Z");
    expect(session.endsAt).toBeUndefined();
  });

  it("compares lists whole", () => {
    expect(
      consensus([
        report("a", "t1", { speakers: ["Ada", "Ben"] }),
        report("b", "t2", { speakers: ["Ada", "Ben"] }),
        report("c", "t3", { speakers: ["Ada"] }),
      ]).speakers,
    ).toEqual(["Ada", "Ben"]);
  });
});

describe("foldText", () => {
  it("folds case and accents with Unicode's rules, and leaves other scripts alone (hunt F1)", () => {
    expect(foldText("Zoë Ångström")).toBe("zoe angstrom");
    expect(foldText("ÉMILIE Šimon Özil")).toBe("emilie simon ozil");
    expect(foldText("李小龙")).toBe("李小龙");
  });
});

describe("unreadableTime", () => {
  const at = (sessionTime: AwsSession["sessionTime"], extra: Partial<AwsSession> = {}): AwsSession => ({
    sessionId: "s",
    ...(sessionTime ? { sessionTime } : {}),
    ...extra,
  });
  it("names each sent part toSession cannot read, as sent", () => {
    expect(unreadableTime(at({ date: "2026-12-02", time: "4:00 PM", length: "1h" }))).toEqual({ time: "4:00 PM", length: "1h" });
    expect(unreadableTime(at({ date: "2026-12-1", time: "16:00" }))).toEqual({ date: "2026-12-1" });
  });
  it("is undefined when every sent part reads, or for an all-day session's time", () => {
    expect(unreadableTime(at({ date: "2026-12-02", time: "16:00:00", length: " 60 " }))).toBeUndefined();
    expect(unreadableTime(at({ date: "2026-12-02" }))).toBeUndefined();
    expect(unreadableTime(at({ date: "2026-12-02", time: "all day" }, { isAllDaySession: true }))).toBeUndefined();
    expect(unreadableTime(at(undefined))).toBeUndefined();
  });
});
