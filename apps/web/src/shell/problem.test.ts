import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/client.ts";
import { describeProblem } from "./problem.ts";

describe("what a person is told when something fails", () => {
  it("never shows a status, a path or an exception name", () => {
    const failures = [
      new ApiFailure("unreachable", "Could not reach Hallway: TypeError: Failed to fetch"),
      new ApiFailure("unexpected", "GET /api/me/connections answered 500.", 500),
      new ApiFailure("invalid", '[ { "code": "too_big", "path": [ "displayName" ] } ]', 400),
      new TypeError("x is undefined"),
    ];
    for (const failure of failures) {
      const { text } = describeProblem(failure);
      expect(text).not.toMatch(/\/api|500|TypeError|undefined|too_big|\[/);
    }
  });

  it("offers Try again for what may pass on its own, and sign-in when signed out", () => {
    expect(describeProblem(new ApiFailure("unreachable", "x")).next).toBe("retry");
    expect(describeProblem(new ApiFailure("unexpected", "x", 502)).next).toBe("retry");
    expect(describeProblem(new ApiFailure("unauthenticated", "Sign in first.", 401))).toEqual({
      text: "You are signed out. Sign in and you come back here.",
      next: "sign-in",
    });
  });

  it("keeps a handler's own sentence, which is written for people", () => {
    expect(describeProblem(new ApiFailure("conflict", "@ben-okafor is taken.", 409))).toEqual({ text: "@ben-okafor is taken.", next: null });
  });
});
