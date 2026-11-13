// GET /api/docs: the Scalar page over the app's own OpenAPI document.
import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { inMemoryHandlers, noPng } from "../testing/in-memory-handlers.ts";

describe("GET /api/docs", () => {
  it("serves the API reference page, signed out, pointing at /api/openapi.json", async () => {
    const { handlers } = inMemoryHandlers();
    const app = createApp({ handlers: () => handlers, renderPng: noPng });
    const response = await app.fetch(new Request("http://127.0.0.1/api/docs"), {});

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    const page = await response.text();
    expect(page).toContain('url: "/api/openapi.json"');
    // Pinned, with an integrity hash: never an unversioned CDN URL.
    expect(page).toMatch(/@scalar\/api-reference@\d+\.\d+\.\d+\/dist\/browser\/standalone\.js" integrity="sha384-/);
  });
});
