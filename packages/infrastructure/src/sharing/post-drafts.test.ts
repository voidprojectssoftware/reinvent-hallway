// One contract, both implementations: a draft is found by its state's hash,
// taken once, and not after it expires.
import type { AttendeeRecord, PostDraftRecord, PostDraftRepository } from "@hallway/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendeesOnD1 } from "../identity/d1-identity-repositories.ts";
import { openDatabase } from "../persistence/d1/database.ts";
import { startLocalD1, type LocalD1 } from "../persistence/d1/local-d1.ts";
import { postDraftsInMemory, postDraftsOnD1 } from "./post-drafts.ts";

let local: LocalD1;
beforeAll(async () => {
  local = await startLocalD1();
  const sam: AttendeeRecord = {
    id: "a-sam",
    handle: "sam",
    handlePlaceholder: false,
    displayName: "Sam",
    visibility: "public",
    createdAt: "2026-11-13T00:00:00.000Z",
  };
  await attendeesOnD1(openDatabase(local.d1)).create(sam, {
    attendeeId: sam.id,
    provider: "dev",
    subject: "sam",
    emailVerified: false,
    linkedAt: sam.createdAt,
  });
});
afterAll(async () => {
  await local.dispose();
});

const implementations: [string, () => PostDraftRepository][] = [
  ["on D1", () => postDraftsOnD1(openDatabase(local.d1))],
  ["in memory", () => postDraftsInMemory()],
];

let n = 0;
const draft = (createdAt: string, expiresAt: string): PostDraftRecord => ({
  stateSha256: `hash-${(n += 1)}`,
  attendeeId: "a-sam",
  text: "Where I'll be at re:Invent 2026:",
  selection: { kind: "sessions", sessionIds: ["s1", "s2"] },
  createdAt,
  expiresAt,
});

describe.each(implementations)("post drafts %s", (_name, make) => {
  it("gives a draft back once, selection and all", async () => {
    const drafts = make();
    const waiting = draft("2026-11-13T12:00:00.000Z", "2026-11-13T12:10:00.000Z");
    await drafts.put(waiting);
    expect(await drafts.take(waiting.stateSha256, "2026-11-13T12:05:00.000Z")).toEqual(waiting);
    expect(await drafts.take(waiting.stateSha256, "2026-11-13T12:05:00.000Z")).toBeUndefined();
  });

  it("does not give back a draft that has expired, nor one never put", async () => {
    const drafts = make();
    const waiting = draft("2026-11-13T12:00:00.000Z", "2026-11-13T12:10:00.000Z");
    await drafts.put(waiting);
    expect(await drafts.take(waiting.stateSha256, "2026-11-13T12:10:00.000Z")).toBeUndefined();
    expect(await drafts.take("hash-never", "2026-11-13T12:00:00.000Z")).toBeUndefined();
  });

  it("clears drafts nobody came back for when the next one is put", async () => {
    const drafts = make();
    const abandoned = draft("2026-11-13T09:00:00.000Z", "2026-11-13T09:10:00.000Z");
    await drafts.put(abandoned);
    await drafts.put(draft("2026-11-13T12:00:00.000Z", "2026-11-13T12:10:00.000Z"));
    // Even with a clock that says it is still waiting, it is gone.
    expect(await drafts.take(abandoned.stateSha256, "2026-11-13T09:05:00.000Z")).toBeUndefined();
  });
});
