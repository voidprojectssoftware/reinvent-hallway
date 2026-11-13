import { UpdateProfileInput } from "@hallway/contracts";
import { describe, expect, it } from "vitest";
import { profileLimits, profileProblems } from "./profile-form.ts";

describe("the profile form", () => {
  it.each(Object.entries(profileLimits))("holds %s to the contract's limit of %i", (field, limit) => {
    expect(UpdateProfileInput.safeParse({ [field]: "a".repeat(limit) }).success).toBe(true);
    expect(UpdateProfileInput.safeParse({ [field]: "a".repeat(limit + 1) }).success).toBe(false);
  });

  it("says what is too long in words, one sentence per field", () => {
    expect(profileProblems({ displayName: "N".repeat(101), headline: "H".repeat(201) })).toEqual({
      displayName: "A name is at most 100 characters.",
      headline: "A headline is at most 200 characters.",
    });
  });

  it("finds nothing wrong with what the contract takes", () => {
    expect(profileProblems({ displayName: "Jane Doe", headline: null, handle: "jane-doe" })).toEqual({});
  });
});
