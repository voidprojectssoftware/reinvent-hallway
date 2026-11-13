import { describe, expect, it } from "vitest";
import { shouldAskForHandle } from "./handle-prompt.ts";

describe("asking for a handle", () => {
  it("asks someone with a placeholder handle on their own screens", () => {
    for (const path of ["/", "/network", "/settings", "/connect", "/sessions/abc"]) {
      expect(shouldAskForHandle(true, path, false)).toBe(true);
    }
  });

  it("does not ask once the handle is chosen, or after Not now in this tab", () => {
    expect(shouldAskForHandle(false, "/", false)).toBe(false);
    expect(shouldAskForHandle(true, "/", true)).toBe(false);
  });

  it("does not ask over the profile form or a person's page, which may be an invite", () => {
    expect(shouldAskForHandle(true, "/settings/profile", false)).toBe(false);
    expect(shouldAskForHandle(true, "/@jane-doe", false)).toBe(false);
  });
});
