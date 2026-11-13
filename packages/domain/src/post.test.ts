import { describe, expect, it } from "vitest";
import { postLine, postText, postTextLimit, selectEntries, type PostSession } from "./post";

const tz = "America/Los_Angeles";
const s = (sessionId: string, startsAt?: string, extra: Partial<PostSession> = {}): PostSession => ({
  sessionId,
  code: sessionId.toUpperCase(),
  title: `Session ${sessionId}`,
  venue: "Venetian",
  ...(startsAt && { startsAt }),
  ...extra,
});
// 10:00 on Tuesday 1 December, Las Vegas time (PST, UTC-8).
const tue10 = "2026-12-01T18:00:00.000Z";
// 17:30 on Tuesday 1 December, which is already Wednesday in UTC.
const tueEvening = "2026-12-02T01:30:00.000Z";
const wed9 = "2026-12-02T17:00:00.000Z";
const entries = [s("a", tue10), s("b", tueEvening), s("c", wed9), s("d")].map((session) => ({ session }));
const ids = (list: { session: PostSession }[]) => list.map(({ session }) => session.sessionId);

describe("selectEntries", () => {
  it("takes the whole week, one Las Vegas day, or the chosen sessions in the week's order", () => {
    expect(ids(selectEntries(entries, { kind: "week" }, tz))).toEqual(["a", "b", "c", "d"]);
    expect(ids(selectEntries(entries, { kind: "day", day: "2026-12-01" }, tz))).toEqual(["a", "b"]);
    expect(ids(selectEntries(entries, { kind: "sessions", sessionIds: ["c", "a"] }, tz))).toEqual(["a", "c"]);
  });

  it("selects nothing the entries do not hold, so a hidden session cannot be picked by id", () => {
    expect(ids(selectEntries(entries, { kind: "sessions", sessionIds: ["hidden-one"] }, tz))).toEqual([]);
  });
});

describe("postLine", () => {
  it("says the day and time in Las Vegas time, the title and code, and the venue", () => {
    expect(postLine(s("aim1", tue10), tz)).toBe("Tue 1 Dec, 10:00 AM: Session aim1 (AIM1), Venetian");
    expect(postLine(s("b", tueEvening), tz)).toBe("Tue 1 Dec, 5:30 PM: Session b (B), Venetian");
    expect(postLine(s("x", tue10, { isAllDay: true }), tz)).toBe("Tue 1 Dec, all day: Session x (X), Venetian");
    expect(postLine({ sessionId: "y", code: "Y1" }, tz)).toBe("Y1");
  });
});

describe("postText", () => {
  const base = { eventName: "re:Invent 2026", timezone: tz, pageUrl: "https://hallway.example/@sam" };

  it("opens for the selection, lists each session and ends with the page link", () => {
    const text = postText({ ...base, selection: { kind: "day", day: "2026-12-01" }, sessions: [s("a", tue10)] });
    expect(text).toBe(
      [
        "Where I'll be at re:Invent 2026 on Tuesday 1 December:",
        "",
        "• Tue 1 Dec, 10:00 AM: Session a (A), Venetian",
        "",
        "Times are Las Vegas time. See my week on Hallway: https://hallway.example/@sam",
      ].join("\n"),
    );
    expect(postText({ ...base, selection: { kind: "sessions", sessionIds: ["a"] }, sessions: [s("a", tue10)] })).toMatch(
      /^I'm going to this session at re:Invent 2026:/,
    );
  });

  it("stays within LinkedIn's 3,000 characters by ending the list with 'and N more', keeping the link", () => {
    const many = Array.from({ length: 200 }, (_, i) => s(`s${i}`, tue10, { title: `A long session title number ${i} about agents` }));
    const text = postText({ ...base, selection: { kind: "week" }, sessions: many });
    expect(text.length).toBeLessThanOrEqual(postTextLimit);
    expect(text).toMatch(/\nand \d+ more\n/);
    expect(text.endsWith("https://hallway.example/@sam")).toBe(true);
  });
});
