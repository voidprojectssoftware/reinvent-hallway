import { describe, expect, it } from "vitest";
import { signInHref } from "../api/client.ts";
import { linkRefusalText, refusalOf, signInRefusalText } from "./providers.ts";

const at = (path: string) => new URL(path, "http://hallway.test");

describe("signInHref", () => {
  it("starts the provider's round trip, keeping the way back and asking to link when told", () => {
    expect(signInHref("google", null)).toBe("/api/auth/google");
    expect(signInHref("github", "/@sam?tab=week")).toBe("/api/auth/github?returnTo=%2F%40sam%3Ftab%3Dweek");
    expect(signInHref("microsoft", "/settings", true)).toBe("/api/auth/microsoft?returnTo=%2Fsettings&link=1");
  });
});

describe("refusalOf", () => {
  it("reads the kind and provider the API's redirect put on the page", () => {
    expect(refusalOf(at("/sign-in?returnTo=%2F%40sam&error=unauthenticated&provider=linkedin"))).toEqual({
      kind: "unauthenticated",
      provider: "linkedin",
    });
  });

  it("is null without an error, and drops a provider it does not know", () => {
    expect(refusalOf(at("/sign-in?provider=google"))).toBeNull();
    expect(refusalOf(at("/settings?error=conflict&provider=myspace"))).toEqual({ kind: "conflict", provider: null });
  });
});

describe("the words for a refused round trip", () => {
  it("names the provider and the next step, never the kind or a status", () => {
    const text = signInRefusalText({ kind: "unauthenticated", provider: "google" });
    expect(text).toBe("Google did not sign you in. Try again, or choose another way.");
    expect(signInRefusalText({ kind: "forbidden", provider: "github" })).toMatch(/Start again/);
    expect(linkRefusalText({ kind: "conflict", provider: "github" })).toBe(
      "That GitHub account already signs in to another Hallway account, so it was not added here. To use that account, sign out and sign in with GitHub.",
    );
  });

  it("still reads as a sentence when the provider is unknown or the kind is new", () => {
    expect(linkRefusalText({ kind: "conflict", provider: null })).toMatch(/^That account already signs in/);
    expect(signInRefusalText({ kind: "unavailable", provider: null })).toBe("Signing in with that account did not work. Try again in a moment.");
    expect(signInRefusalText({ kind: "something-new", provider: "microsoft" })).toMatch(/^Signing in with Microsoft did not work/);
  });
});
