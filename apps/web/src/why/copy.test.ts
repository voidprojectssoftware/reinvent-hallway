import { describe, expect, it } from "vitest";
import { whyAgentLine, whyNext, whyNoDescription, whySections, whyTitle } from "./copy.ts";

const everything = [
  whyTitle,
  whyAgentLine,
  ...Object.values(whyNext),
  ...Object.values(whyNoDescription),
  ...Object.values(whySections).flatMap((part) => [part.heading, ...part.paragraphs]),
];

describe("the Why? copy (issue #87)", () => {
  it("has no em dash or en dash, which the owner's writing rules forbid", () => {
    for (const text of everything) expect(text, text).not.toMatch(/[–—]/);
  });

  it("says AWS sign-in in the person's terms, never a token or OAuth", () => {
    for (const text of everything) expect(text, text).not.toMatch(/token|oauth|cors/i);
  });

  it("holds at most two sections, each with a sentence-case heading", () => {
    const parts = Object.values(whySections);
    expect(parts.length).toBeLessThanOrEqual(2);
    for (const { heading } of parts) expect(heading).not.toBe(heading.toUpperCase());
  });
});
