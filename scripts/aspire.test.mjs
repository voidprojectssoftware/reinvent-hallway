// The two pieces of scripts/aspire.mjs that do not need Aspire running.
import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonIn, lanDashboardUrl } from "./aspire.mjs";

test("the CLI's JSON is found among the status lines it prints around it", () => {
  const output = 'Starting Aspire AppHost in the background...\n{\n  "dashboardUrl": "http://localhost:8797/login?t=abc"\n}\n';
  assert.deepEqual(jsonIn(output), { dashboardUrl: "http://localhost:8797/login?t=abc" });
  assert.throws(() => jsonIn("no json here"), /No JSON/);
});

test("the dashboard login link for the LAN keeps the port and the browser token", () => {
  assert.equal(
    lanDashboardUrl("http://localhost:8797/login?t=abc123", "192.168.0.60"),
    "http://192.168.0.60:8797/login?t=abc123",
  );
});
