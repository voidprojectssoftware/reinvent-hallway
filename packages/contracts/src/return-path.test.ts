import { describe, expect, it } from "vitest";
import { isReturnPath, ReturnPath } from "./return-path.ts";

describe("a return path after sign-in", () => {
  it.each(["/", "/@jane-doe", "/@jane-doe?day=2026-12-01#top", "/sessions/s-aim3315", "/a/%2e%2e/b", "/search?q=a%20b"])(
    "accepts %s, a path on this site",
    (path) => {
      expect(isReturnPath(path)).toBe(true);
      expect(ReturnPath.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["relative without a slash", "@jane-doe"],
    ["another scheme", "https://evil.example/"],
    ["a script", "javascript:alert(1)"],
    ["a data URL", "data:text/html,hi"],
    ["protocol-relative", "//evil.example/"],
    ["three slashes", "///evil.example/"],
    ["slash backslash", "/\\evil.example/"],
    ["a backslash later", "/foo\\bar"],
    ["a tab the parser strips", "/\t/evil.example/"],
    ["a newline the parser strips", "/\n/evil.example/"],
    ["a NUL", "/\u0000/evil.example/"],
    ["encoded slash", "/%2Fevil.example/"],
    ["encoded slash, lower case", "/%2fevil.example/"],
    ["encoded double slash", "%2F%2Fevil.example/"],
    ["encoded backslash", "/%5Cevil.example/"],
    ["encoded tab", "/%09/evil.example/"],
    ["double-encoded slash", "/%252Fevil.example/"],
    ["malformed escape", "/%E0%A4%A"],
    ["too long", `/${"a".repeat(2048)}`],
  ])("refuses %s", (_, path) => {
    expect(isReturnPath(path)).toBe(false);
    expect(ReturnPath.safeParse(path).success).toBe(false);
  });
});
