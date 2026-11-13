import { describe, expect, it } from "vitest";
import { handleFromName, isReservedHandle, isValidHandle, normalizeHandle, placeholderHandle } from "./handles";

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
    const first = handleFromName(name, new Set()) ?? "";
    expect(first.length).toBeLessThanOrEqual(30);
    expect(isValidHandle(first)).toBe(true);
    const second = handleFromName(name, new Set([first])) ?? "";
    expect(second.endsWith("-2")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(30);
    expect(isValidHandle(second)).toBe(true);
  });

  it("a short name gets a number to reach three characters", () => {
    expect(handleFromName("Al", new Set())).toBe("al-2");
  });

  it.each([
    ["Łukasz Kowalski", "lukasz-kowalski"],
    ["Søren Ødegård", "soren-odegard"],
    ["Ærøskøbing Đorđević", "aeroskobing-dordevic"],
    ["Hrafn Þórðarson", "hrafn-thordarson"],
    ["Jürgen Großmann", "jurgen-grossmann"],
    ["Œdipe Ilıcalı", "oedipe-ilicali"],
  ])("spells Latin Extended %s in base letters, as %s", (name, handle) => {
    expect(handleFromName(name, new Set())).toBe(handle);
  });

  it.each(["Ольга Петрова", "Γιώργος Παπαδόπουλος", "山田 太郎", "王伟 2", "!!!"])(
    "gives nothing for %j, which has no Latin letter",
    (name) => {
      expect(handleFromName(name, new Set())).toBeUndefined();
    },
  );

  it("keeps the Latin part of a mixed name", () => {
    expect(handleFromName("Ольга (Olga) Petrova", new Set())).toBe("olga-petrova");
  });

  it("skips a reserved word as if taken", () => {
    expect(handleFromName("Admin", new Set())).toBe("admin-2");
    expect(handleFromName("Dev", new Set(["dev-2"]))).toBe("dev-3");
  });
});

describe("placeholderHandle", () => {
  it("is attendee- and four letters or digits from the bytes it is given", () => {
    expect(placeholderHandle(new Uint8Array([0, 25, 26, 35]))).toBe("attendee-az09");
    expect(placeholderHandle(new Uint8Array([36, 255, 1, 2, 99]))).toBe("attendee-adbc");
  });

  it("is a valid handle that is not reserved", () => {
    const handle = placeholderHandle(new Uint8Array([7, 8, 9, 10]));
    expect(isValidHandle(handle)).toBe(true);
    expect(isReservedHandle(handle)).toBe(false);
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
