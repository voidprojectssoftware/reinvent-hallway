import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropInvite, heldInvite, holdInviteFrom, returnAfterSignIn, takeReturnPath } from "./invite.ts";

// vitest runs these under Node, which has no window: give it a sessionStorage.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("an invite in a share link", () => {
  it("leaves the URL and is held for that handle only", () => {
    const clean = holdInviteFrom(new URL("https://hallway.example/@sam?invite=s3cret&x=1#top"), "sam");
    expect(clean).toBe("/@sam?x=1#top");
    expect(clean).not.toContain("s3cret");
    expect(heldInvite("sam")).toBe("s3cret");
    expect(heldInvite("jane")).toBeNull();
  });

  it("changes nothing when the URL has none", () => {
    expect(holdInviteFrom(new URL("https://hallway.example/@sam"), "sam")).toBeNull();
    expect(heldInvite("sam")).toBeNull();
  });

  it("is gone once dropped", () => {
    holdInviteFrom(new URL("https://hallway.example/@sam?invite=s3cret"), "sam");
    dropInvite();
    expect(heldInvite("sam")).toBeNull();
  });

  it("is simply not held when the browser refuses storage", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => undefined,
      },
    });
    expect(holdInviteFrom(new URL("https://hallway.example/@sam?invite=s3cret"), "sam")).toBe("/@sam");
    expect(heldInvite("sam")).toBeNull();
  });
});

describe("coming back after sign-in", () => {
  it("returns to the page once, then forgets it", () => {
    returnAfterSignIn("/@sam");
    expect(takeReturnPath()).toBe("/@sam");
    expect(takeReturnPath()).toBeNull();
  });

  it("never goes to another origin", () => {
    returnAfterSignIn("//evil.example/");
    returnAfterSignIn("https://evil.example/");
    expect(takeReturnPath()).toBeNull();
  });
});
