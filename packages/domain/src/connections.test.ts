import { describe, expect, it } from "vitest";
import { connectionBetween, decideRequest } from "./connections";
import type { ConnectionRequest } from "./types";

const AT = "2026-11-20T12:00:00.000Z";
const pending: ConnectionRequest = { from: "ann", to: "bo", status: "pending", createdAt: "2026-11-19T00:00:00.000Z" };

describe("connectionBetween", () => {
  it("is unordered: either order gives the same pair", () => {
    expect(connectionBetween("bo", "ann", "share-link", AT)).toEqual(connectionBetween("ann", "bo", "share-link", AT));
    expect(connectionBetween("bo", "ann", "share-link", AT)).toEqual({ a: "ann", b: "bo", since: AT, via: "share-link" });
  });
});

describe("decideRequest", () => {
  it("the recipient accepting makes the connection", () => {
    expect(decideRequest(pending, "bo", "accept", AT)).toEqual({
      ok: true,
      request: { ...pending, status: "accepted" },
      connection: { a: "ann", b: "bo", since: AT, via: "request" },
    });
  });

  it("the sender cannot accept their own request", () => {
    expect(decideRequest(pending, "ann", "accept", AT)).toEqual({ ok: false, error: "not-allowed" });
  });

  it("the recipient declines, the sender withdraws, and neither connects", () => {
    expect(decideRequest(pending, "bo", "decline", AT)).toEqual({ ok: true, request: { ...pending, status: "declined" } });
    expect(decideRequest(pending, "ann", "withdraw", AT)).toEqual({ ok: true, request: { ...pending, status: "withdrawn" } });
  });

  it("only the sender withdraws, only the recipient declines, a third party does nothing", () => {
    expect(decideRequest(pending, "bo", "withdraw", AT)).toEqual({ ok: false, error: "not-allowed" });
    expect(decideRequest(pending, "ann", "decline", AT)).toEqual({ ok: false, error: "not-allowed" });
    expect(decideRequest(pending, "cy", "accept", AT)).toEqual({ ok: false, error: "not-allowed" });
  });

  it("a decided request cannot be decided again", () => {
    for (const status of ["accepted", "declined", "withdrawn"] as const) {
      expect(decideRequest({ ...pending, status }, "bo", "accept", AT)).toEqual({ ok: false, error: "not-pending" });
    }
  });
});
