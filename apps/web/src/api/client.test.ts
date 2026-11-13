import { describe, expect, it } from "vitest";
import { ApiFailure, createApiClient } from "./client.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const event = {
  eventId: "reinvent2026",
  name: "re:Invent 2026",
  timezone: "America/Los_Angeles",
  startDate: "2026-11-30T05:30-08:00",
  endDate: "2026-12-04T23:59-08:00",
};

async function failureOf(promise: Promise<unknown>): Promise<ApiFailure> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiFailure);
  return error as ApiFailure;
}

describe("the API client", () => {
  it("returns the resource the contract describes", async () => {
    const api = createApiClient(async () => json(200, event));
    await expect(api.getEvent("reinvent2026")).resolves.toEqual(event);
  });

  it("puts the path parameter in the path encoded", async () => {
    const asked: string[] = [];
    const api = createApiClient(async (input) => {
      asked.push(String(input));
      return json(200, event);
    });
    await api.getEvent("a/b");
    expect(asked).toEqual(["/api/events/a%2Fb"]);
  });

  it("turns the contract's Error resource into a failure of the same kind", async () => {
    const api = createApiClient(async () => json(404, { kind: "not-found", message: "No such event." }));
    const failure = await failureOf(api.getEvent("nope"));
    expect([failure.kind, failure.message, failure.status]).toEqual(["not-found", "No such event.", 404]);
  });

  it("calls a refusal that is not the contract's Error unexpected", async () => {
    const api = createApiClient(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const failure = await failureOf(api.getEvent("reinvent2026"));
    expect([failure.kind, failure.status]).toEqual(["unexpected", 502]);
  });

  it("calls a success the contract does not describe unexpected", async () => {
    const api = createApiClient(async () => json(200, { eventId: "reinvent2026" }));
    expect((await failureOf(api.getEvent("reinvent2026"))).kind).toBe("unexpected");
  });

  it("calls a network failure unreachable", async () => {
    const api = createApiClient(async () => {
      throw new TypeError("Failed to fetch");
    });
    const failure = await failureOf(api.getEvent("reinvent2026"));
    expect([failure.kind, failure.status]).toEqual(["unreachable", undefined]);
  });

  it("sends dev sign-in's name as a JSON body", async () => {
    const sent: RequestInit[] = [];
    const api = createApiClient(async (_input, init) => {
      sent.push(init ?? {});
      return new Response(null, { status: 204 });
    });
    await api.devSignIn("Jane Doe");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.body).toBe(JSON.stringify({ name: "Jane Doe" }));
  });
});
