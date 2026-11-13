import type { ConnectionList, ConnectionRequest, FollowedPerson, Following, Person, RequestList, SuggestionList } from "@hallway/contracts";
import { describe, expect, it } from "vitest";
import { knownFrom, networkRows } from "./rows.ts";

const person = (id: string): Person => ({ id, handle: id, displayName: id });
const me = person("me");
const at = "2026-11-13T12:00:00.000Z";
const request = (from: Person, to: Person): ConnectionRequest => ({ id: `${from.id}-${to.id}`, from, to, status: "pending", createdAt: at });
const followed = (p: Person): FollowedPerson => ({ person: p, since: at, scheduleVisible: false });

const sofia = person("sofia");
const eli = person("eli");
const dana = person("dana");
const priya = person("priya");
const ben = person("ben");
const lin = person("lin");

const connections: ConnectionList = { connections: [{ person: priya, since: at, via: "request" }] };
const requests: RequestList = { incoming: [request(sofia, me)], outgoing: [request(me, dana)] };
const suggestions: SuggestionList = { suggestions: [{ person: eli, reason: "email" }], contactImport: { importedAt: at, count: 3 } };
const following: Following = {
  github: { linked: true, people: [sofia, eli, dana, priya, ben].map(followed), notOnHallway: 0 },
  linkedinImport: { people: [eli, priya, lin].map(followed) },
};

describe("Network's rows", () => {
  const rows = networkRows(connections, requests, suggestions, following);
  const ids = (list: { person: Person }[]) => list.map(({ person }) => person.id);

  it("shows each person once, in their strongest state", () => {
    const everyone = [
      ...rows.incoming.map((r) => r.from.id),
      ...connections.connections.map(({ person }) => person.id),
      ...rows.outgoing.map((r) => r.to.id),
      ...ids(rows.suggestions),
      ...ids(rows.github),
      ...ids(rows.linkedin),
    ];
    expect(everyone.sort()).toEqual(["ben", "dana", "eli", "lin", "priya", "sofia"]);
  });

  it("never offers Connect to someone whose request waits for my answer", () => {
    expect(rows.incoming.map((r) => r.from.id)).toEqual(["sofia"]);
    expect(ids(rows.github)).not.toContain("sofia");
  });

  it("puts a suggestion I also follow under the suggestion, with both reasons", () => {
    expect(ids(rows.suggestions)).toEqual(["eli"]);
    expect(rows.suggestions[0]?.known).toEqual(["github", "linkedin"]);
    expect(ids(rows.github)).toEqual(["ben"]);
    expect(rows.githubElsewhere).toBe(4);
    expect(ids(rows.linkedin)).toEqual(["lin"]);
  });

  it("keeps a request's reasons", () => {
    expect(rows.incoming[0]?.known).toEqual(["github"]);
  });
});

describe("how I know someone", () => {
  it("says it in a sentence", () => {
    expect(knownFrom(["github", "linkedin"])).toBe("Followed on GitHub and in your LinkedIn file");
    expect(knownFrom(["github"])).toBe("Followed on GitHub");
    expect(knownFrom(["linkedin"])).toBe("In your LinkedIn file");
    expect(knownFrom([])).toBeNull();
  });
});
