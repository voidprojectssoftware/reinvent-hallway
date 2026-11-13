import { describe, expect, it } from "vitest";
import { goingWords, whoIsGoing } from "./going.ts";

const people = (...names: string[]) => names.map((displayName) => ({ displayName }));

describe("the who-is-going line", () => {
  it("says no one when none of my connections is going", () => {
    expect(goingWords([])).toEqual({ names: "", rest: "No one you know yet" });
  });

  it("names one or two people in full", () => {
    expect(goingWords(people("Tom Becker"))).toEqual({ names: "Tom Becker", rest: "" });
    expect(goingWords(people("Priya Raman", "Marcus Webb"))).toEqual({ names: "Priya Raman and Marcus Webb", rest: "" });
  });

  it("names three by first name, and counts the rest from the total", () => {
    expect(goingWords(people("Priya Raman", "Marcus Webb", "Dana Kowalski"))).toEqual({ names: "Priya, Marcus, Dana", rest: "" });
    expect(goingWords(people("Priya Raman", "Marcus Webb", "Dana Kowalski", "Luis Ortiz", "Hannah Lee"), 12)).toEqual({
      names: "Priya, Marcus, Dana",
      rest: " and 9 more",
    });
  });
});

describe("reading who is going for a week", () => {
  it("asks at most 200 sessions a read, and answers for all of them", async () => {
    const asked: number[] = [];
    const ids = Array.from({ length: 450 }, (_, i) => `s-${i}`);
    const going = await whoIsGoing(
      {
        whoIsGoing: async (_eventId, sessionIds) => {
          asked.push(sessionIds.length);
          return { sessions: sessionIds.map((sessionId) => ({ sessionId, people: [] })) };
        },
      },
      "reinvent2026",
      ids,
    );
    expect(asked).toEqual([200, 200, 50]);
    expect(going.size).toBe(450);
  });
});
