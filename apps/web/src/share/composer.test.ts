import { describe, expect, it } from "vitest";
import { linkedInShareUrl, notPostedText, pickFrom, postUrlOf, searchOf } from "./composer.ts";

describe("the composer's address", () => {
  it("round-trips the week, a day, chosen sessions and an empty pick", () => {
    for (const search of ["", "?day=2026-12-01", "?session=a&session=b", "?pick=sessions"]) {
      expect(searchOf(pickFrom(new URLSearchParams(search)))).toBe(search);
    }
  });

  it("asks the API for the week while nothing is picked", () => {
    expect(searchOf({ kind: "sessions", sessionIds: [] }, true)).toBe("");
  });
});

describe("after LinkedIn", () => {
  it("links only to a post URN LinkedIn could have given", () => {
    expect(postUrlOf("urn:li:share:7000000000000000001")).toBe(
      "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7000000000000000001/",
    );
    expect(postUrlOf("javascript:alert(1)")).toBeNull();
    expect(postUrlOf(null)).toBeNull();
  });

  it("says nothing was posted, or how to check, for every refusal", () => {
    for (const kind of ["forbidden", "unauthenticated", "invalid", "not-found", "whatever"]) {
      expect(notPostedText(kind)).toMatch(/^Nothing was posted/);
    }
    expect(notPostedText("unavailable")).toMatch(/Check your LinkedIn feed/);
  });

  it("opens LinkedIn's share dialog on the page link", () => {
    expect(linkedInShareUrl("https://hallway.example/@sam")).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fhallway.example%2F%40sam",
    );
  });
});
