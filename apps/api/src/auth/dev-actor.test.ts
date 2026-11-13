import { describe, expect, it } from "vitest";
import { resolveDevActor } from "./dev-actor.ts";

const request = (url: string, authorization?: string) =>
  new Request(url, authorization ? { headers: { authorization } } : {});
const on = { DEV_SIGN_IN: "1" };

describe("resolveDevActor (the stand-in)", () => {
  it("is anonymous without an Authorization header, whether or not dev sign-in is on", () => {
    expect(resolveDevActor(request("http://localhost/"), {})).toEqual({
      ok: true,
      value: { kind: "anonymous" },
    });
    expect(resolveDevActor(request("http://localhost/"), on)).toMatchObject({ ok: true });
  });

  it("believes `dev:<id>` on a loopback host when DEV_SIGN_IN is 1", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "hallway.localhost"]) {
      expect(resolveDevActor(request(`http://${host}:8787/`, "Bearer dev:alice"), on)).toEqual({
        ok: true,
        value: { kind: "attendee", attendeeId: "alice" },
      });
    }
  });

  it("refuses a dev token when DEV_SIGN_IN is anything but 1", () => {
    for (const bindings of [{}, { DEV_SIGN_IN: "0" }, { DEV_SIGN_IN: "true" }]) {
      expect(resolveDevActor(request("http://localhost/", "Bearer dev:alice"), bindings)).toMatchObject({
        ok: false,
        error: { kind: "unauthenticated" },
      });
    }
  });

  it("refuses a dev token on a host that is not loopback, even when switched on", () => {
    expect(resolveDevActor(request("https://hallway.example/", "Bearer dev:alice"), on)).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
  });

  it("refuses a bearer token that is not a dev token", () => {
    expect(resolveDevActor(request("http://localhost/", "Bearer hw_abc123"), on)).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
  });
});
