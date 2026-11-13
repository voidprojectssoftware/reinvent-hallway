import { describe, expect, it } from "vitest";
import { handleFromSegment } from "./handle.ts";

describe("the /@handle segment", () => {
  it("takes the handle after the @, hyphens and dots included", () => {
    expect(handleFromSegment("@jane-doe")).toBe("jane-doe");
    expect(handleFromSegment("@jane.doe")).toBe("jane.doe");
  });

  it("refuses a segment that is not a handle", () => {
    expect(handleFromSegment("jane")).toBeNull();
    expect(handleFromSegment("@")).toBeNull();
    expect(handleFromSegment(undefined)).toBeNull();
  });
});
