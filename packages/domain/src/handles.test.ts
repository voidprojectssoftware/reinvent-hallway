import { describe, expect, it } from "vitest";
import { handleFromName, isReservedHandle, isValidHandle, normalizeHandle } from "./handles";

describe("normalizeHandle", () => {
  it("trims, drops a leading @, lowercases", () => {
    expect(normalizeHandle("  @Jane-Doe ")).toBe("jane-doe");
  });
});

describe("isValidHandle", () => {
  it.each(["abc", "jane-doe", "j4ne", "a".repeat(30), "a-b-c"])("accepts %s", (h) => {
    expect(isValidHandle(h)).toBe(true);
  });

  it.each(["ab", "a".repeat(31), "-jane", "jane-", "jane--doe", "Jane", "jane_doe", "jané", "jane doe", ""])(
    "rejects %j",
    (h) => {
      expect(isValidHandle(h)).toBe(false);
    },
  );
});

describe("handleFromName", () => {
  it("slugs the name, folding accents and punctuation", () => {
    expect(handleFromName("Zoë O'Brien", new Set())).toBe("zoe-o-brien");
    expect(handleFromName("  José   García  ", new Set())).toBe("jose-garcia");
  });

  it("numbers it while taken", () => {
    expect(handleFromName("Jane Doe", new Set(["jane-doe"]))).toBe("jane-doe-2");
    expect(handleFromName("Jane Doe", new Set(["jane-doe", "jane-doe-2"]))).toBe("jane-doe-3");
  });

  it("cuts a long name to 30 with room for the number, never ending in a hyphen", () => {
    const name = "Maximiliana Wolfeschlegelsteinhausen Bergerdorff";
    const first = handleFromName(name, new Set());
    expect(first.length).toBeLessThanOrEqual(30);
    expect(isValidHandle(first)).toBe(true);
    const second = handleFromName(name, new Set([first]));
    expect(second.endsWith("-2")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(30);
    expect(isValidHandle(second)).toBe(true);
  });

  it("a short name gets a number to reach three characters", () => {
    expect(handleFromName("Al", new Set())).toBe("al-2");
  });

  it("a name with nothing to slug falls back to attendee", () => {
    expect(handleFromName("王伟", new Set())).toBe("attendee");
    expect(handleFromName("王伟", new Set(["attendee"]))).toBe("attendee-2");
  });

  it("skips a reserved word as if taken", () => {
    expect(handleFromName("Admin", new Set())).toBe("admin-2");
    expect(handleFromName("Dev", new Set(["dev-2"]))).toBe("dev-3");
  });
});

describe("isReservedHandle", () => {
  it.each(["api", "mcp", "cal", "settings", "connect", "dev"])("reserves %s", (h) => {
    expect(isReservedHandle(h)).toBe(true);
  });

  it("leaves an ordinary name free", () => {
    expect(isReservedHandle("jane-doe")).toBe(false);
  });
});
