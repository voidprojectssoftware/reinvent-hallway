import { describe, expect, it } from "vitest";
import { returnPathOf, signInPath } from "./signed-in.ts";

const at = (search: string) => new URL(`https://hallway.example/sign-in${search}`);

describe("coming back after sign-in", () => {
  it("keeps the page that sent me, query and all", () => {
    expect(signInPath("/@sam")).toBe("/sign-in?returnTo=%2F%40sam");
    expect(returnPathOf(at(`?returnTo=${encodeURIComponent("/@sam?day=2026-12-01")}`))).toBe("/@sam?day=2026-12-01");
    expect(returnPathOf(at(""))).toBeNull();
  });

  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/", "/%2F%2Fevil.example", "javascript:alert(1)"])(
    "never goes to %j",
    (path) => {
      expect(returnPathOf(at(`?returnTo=${encodeURIComponent(path)}`))).toBeNull();
    },
  );
});
