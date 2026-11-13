import { describe, expect, it } from "vitest";
import { fail, ok, type Credential } from "@hallway/application";
import { resolveActor } from "./resolve-actor.ts";

const request = (url: string, authorization?: string) =>
  new Request(url, authorization ? { headers: { authorization } } : {});
const on = { DEV_SIGN_IN: "1" };
const seen: Credential[] = [];
const authenticate = async (credential: Credential) => {
  seen.push(credential);
  return credential.secret === "hw_good" || credential.secret === "live"
    ? ok({ kind: "attendee" as const, attendeeId: "alice" })
    : fail("unauthenticated", "no");
};

describe("resolveActor", () => {
  it("is anonymous with no credential at all", async () => {
    expect(await resolveActor(request("http://localhost/"), on, undefined, authenticate)).toEqual(
      ok({ kind: "anonymous" }),
    );
  });

  it("hands an hw_ bearer to authenticate as an agent token, and passes its refusal on", async () => {
    expect(await resolveActor(request("https://hallway.example/", "Bearer hw_good"), {}, undefined, authenticate)).toEqual(
      ok({ kind: "attendee", attendeeId: "alice" }),
    );
    expect(seen.at(-1)).toEqual({ kind: "agent-token", secret: "hw_good" });
    expect(await resolveActor(request("https://hallway.example/", "Bearer hw_bad"), {}, undefined, authenticate)).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
  });

  it("prefers the bearer over the session cookie", async () => {
    expect(await resolveActor(request("http://localhost/", "Bearer hw_bad"), on, "live", authenticate)).toMatchObject({ ok: false });
  });

  it("turns an ended session into anonymous rather than an error", async () => {
    expect(await resolveActor(request("http://localhost/"), on, "live", authenticate)).toEqual(
      ok({ kind: "attendee", attendeeId: "alice" }),
    );
    expect(await resolveActor(request("http://localhost/"), on, "ended", authenticate)).toEqual(ok({ kind: "anonymous" }));
  });

  it("believes `dev:<id>` on every loopback spelling when DEV_SIGN_IN is 1", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "hallway.localhost"]) {
      expect(await resolveActor(request(`http://${host}:8787/`, "Bearer dev:alice"), on, undefined, authenticate)).toEqual(
        ok({ kind: "attendee", attendeeId: "alice" }),
      );
    }
  });

  it("refuses `dev:` when DEV_SIGN_IN is anything but 1, or off loopback", async () => {
    for (const bindings of [{}, { DEV_SIGN_IN: "0" }, { DEV_SIGN_IN: "true" }]) {
      expect(await resolveActor(request("http://localhost/", "Bearer dev:alice"), bindings, undefined, authenticate)).toMatchObject({
        ok: false,
        error: { kind: "unauthenticated" },
      });
    }
    expect(await resolveActor(request("https://hallway.example/", "Bearer dev:alice"), on, undefined, authenticate)).toMatchObject({
      ok: false,
    });
  });

  it("refuses any other bearer", async () => {
    expect(await resolveActor(request("http://localhost/", "Bearer abc123"), on, undefined, authenticate)).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
  });
});
