import { describe, expect, it } from "vitest";
import { isPersonPage, personPage } from "./person-page.ts";

describe("/@handle", () => {
  it("is taken by the Worker for every handle spelling, and nothing else", () => {
    const paths = ["/@jane", "/@jane-doe", "/@jane.doe", "/api/x", "/network", "/%40jane"];
    expect(paths.filter((path) => isPersonPage(new URL(path, "http://127.0.0.1")))).toEqual([
      "/@jane",
      "/@jane-doe",
      "/@jane.doe",
    ]);
  });

  it("answers with the web app's index.html, not a redirect", async () => {
    const asked: string[] = [];
    const assets = {
      fetch: async (input: string) => {
        asked.push(input);
        return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      },
    };
    const response = await personPage(new URL("http://127.0.0.1:8787/@jane.doe?x=1"), assets);
    expect(asked).toEqual(["http://127.0.0.1:8787/"]);
    expect(response.status).toBe(200);
  });
});
