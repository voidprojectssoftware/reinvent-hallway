// Hallway on one machine under Aspire, one copy per worktree (ADR 0017).
//
//   npm run aspire                         start it and print every URL
//   HALLWAY_LAN=1 npm run aspire           the same, reachable from the LAN
//   npm run aspire:stop
//
// (`aspire start --isolated` and `aspire stop --apphost apphost.mts` underneath.)
//
// The pattern is void-crm's (its ADRs 0008 and 0015). Ports: Aspire allocates
// every one, and a tool that would pick its own is handed Aspire's instead; the
// one exception is LAN mode, below. State: everything a resource writes goes
// under `.state/` in this worktree, so two worktrees never share a database.
//
// Resources:
//   web   vite build --watch into apps/web/dist, which wrangler serves (ADR 0010);
//         listed under api, with the same App links (#95)
//   api   wrangler dev: /api, /mcp, /cal, /og, /@handle and the web app's files
//   seed  a one-shot that loads demo people once api is healthy (npm run seed:demo)
//   lan   with HALLWAY_LAN=1 only: the LAN proxy (scripts/lan-proxy.mjs)
//   notes the checkout's note channel for the owner's annotation toolbar
//         (ADR 0028); HALLWAY_NOTES=0 leaves it and the toolbar out
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import {
  createBuilder,
  EndpointProperty,
  refExpr,
  UrlDisplayLocation,
} from "./.aspire/modules/aspire.mjs";
import { channelFor, type Channel } from "./scripts/lib/note-channel.mjs";

const root = import.meta.dirname;
const state = path.join(root, ".state");
const web = path.join(root, "apps/web");

// The vite apps/web declares, never the root one (vitest's peer, #35, #43).
const viteRoot = path.dirname(
  createRequire(path.join(web, "package.json")).resolve("vite/package.json"),
);
const vite = path.join(viteRoot, "bin/vite.js");

const builder = await createBuilder();

// web: the build `npm run dev` keeps running beside wrangler, as its own
// resource so its output has its own log. --no-emptyOutDir because wrangler
// is serving the directory while it rebuilds (#34). No hot reload: reload the
// page after a change (ADR 0010).
const webBuild = await builder.addExecutable("web", "node", web, [
  vite,
  "build",
  "--watch",
  "--no-emptyOutDir",
]);

// api: the Worker through scripts/aspire-api.mjs, which applies the D1
// migrations and waits for web's first build, then runs wrangler dev with the
// arguments below. D1 lives in .state/api.
const api = await builder
  .addExecutable("api", "node", root, ["scripts/aspire-api.mjs"])
  .withHttpEndpoint({ env: "PORT" })
  // wrangler's devtools port. Left alone it probes upward from 9229, which
  // two worktrees starting together can both pick.
  .withEndpoint({ name: "inspector", env: "INSPECTOR_PORT", isProxied: false })
  .withArgsCallback(async (context) => {
    const args = context.args();
    // wrangler picks its own port unless told; it must listen where Aspire's
    // proxy forwards to.
    await args.add("--port");
    await args.add(api.getEndpoint("http").property(EndpointProperty.TargetPort));
    await args.add("--ip");
    await args.add("127.0.0.1");
    await args.add("--inspector-port");
    await args.add(api.getEndpoint("inspector").property(EndpointProperty.TargetPort));
  })
  .withEnvironment("PERSIST_TO", path.join(state, "api"))
  // wrangler's dev registry and debug logs, per worktree instead of per user.
  .withEnvironment("WRANGLER_REGISTRY_PATH", path.join(state, "wrangler-registry"))
  .withEnvironment("WRANGLER_LOG_PATH", path.join(state, "wrangler-logs"))
  .withEnvironment("WRANGLER_SEND_METRICS", "false")
  // Healthy once the Worker answers over a migrated database.
  .withHttpHealthCheck({ path: "/api/events/reinvent2026" })
  .withUrlForEndpoint("http", async (url) => {
    url.displayText = "App";
  })
  // The devtools port is not a page: keep it off the resources list.
  .withUrlForEndpoint("inspector", async (url) => {
    url.displayLocation = UrlDisplayLocation.DetailsOnly;
  });

const apiHttp = await api.getEndpoint("http");
await api.withUrl(refExpr`${apiHttp}/api/docs`, { displayText: "API reference" });
await api.withUrl(refExpr`${apiHttp}/api/openapi.json`, { displayText: "OpenAPI document" });

// web builds the pages but api serves them, so web carries api's App link
// too, and sits under api in the dashboard (#95).
await webBuild
  .withUrl(refExpr`${apiHttp}/`, { displayText: "App" })
  .withParentRelationship(api);

// seed: demo people, schedules and connections, through the public API.
// Idempotent, so it runs on every start.
await builder
  .addExecutable("seed", "node", root, ["scripts/seed-demo.mjs"])
  .withEnvironment("HALLWAY_URL", apiHttp)
  .waitFor(api);

// lan: only when asked. Dev sign-in and the cookie rules trust a loopback
// host only (ADR 0008), so another machine reaches the Worker through this
// proxy, which presents each request as a loopback one. Its port is the one
// fixed port here, so a bookmark on the owner's machine survives restarts;
// HALLWAY_LAN_PORT changes it. HALLWAY_LAN_HOST names the address to show in
// links when this machine's own guess (its first non-internal IPv4) is wrong.
if (process.env.HALLWAY_LAN === "1") {
  const lanPort = Number(process.env.HALLWAY_LAN_PORT ?? "8796");
  const lanHost = process.env.HALLWAY_LAN_HOST ?? lanAddress();
  const lan = `http://${lanHost}:${lanPort}`;
  await webBuild.withUrl(`${lan}/`, { displayText: "App (LAN)" });
  await builder
    .addExecutable("lan", "node", root, ["scripts/lan-proxy.mjs"])
    .withHttpEndpoint({ port: lanPort, targetPort: lanPort, env: "PORT", isProxied: false })
    .withEnvironment("API_URL", apiHttp)
    .withUrlForEndpoint("http", async (url) => {
      url.url = `${lan}/`;
      url.displayText = "App (LAN)";
    })
    .withUrl(`${lan}/api/docs`, { displayText: "API reference (LAN)" })
    .withUrl(`${lan}/api/openapi.json`, { displayText: "OpenAPI document (LAN)" })
    .waitFor(api);
}

// notes: the owner's annotation toolbar (#105, ADR 0028). The checkout's note
// channel (port 4761 for the main checkout and the owner's live preview, a
// port of its own from 4800-4999 for any other worktree) is derived from this
// directory, so web builds the toolbar pointed at the same port this resource
// serves. A server this resource started stops with it; one already running
// (from `npm run dev`, `npm run notes -- serve` or the MCP wrapper) is kept,
// with this run's origins added. `npm run notes -- channel` says which.
let noteChannel: Channel | undefined;
if (process.env.HALLWAY_NOTES !== "0") {
  try {
    noteChannel = await channelFor(root);
  } catch (error) {
    console.error(`No note channel, so no toolbar: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (noteChannel) {
  const { port } = noteChannel;
  const lanPort = process.env.HALLWAY_LAN === "1" ? (process.env.HALLWAY_LAN_PORT ?? "8796") : undefined;
  const lanHost = process.env.HALLWAY_LAN_HOST ?? lanAddress();
  await webBuild.withEnvironment("VITE_NOTES", "1").withEnvironment("VITE_NOTE_PORT", String(port));
  const notes = await builder
    .addExecutable("notes", "node", root, ["scripts/notes.mjs", "serve", "--stay"])
    // The origins the server accepts: the app on Aspire's port and, in LAN
    // mode, on the LAN port, each under every name this machine is reached by.
    .withArgsCallback(async (context) => {
      const args = context.args();
      await args.add("--app-port");
      await args.add(api.getEndpoint("http").property(EndpointProperty.Port));
      if (lanPort) {
        await args.add("--app-port");
        await args.add(lanPort);
      }
    })
    .withUrl(`http://127.0.0.1:${port}/pending`, { displayText: `Notes (${noteChannel.channel} channel)` })
    .withParentRelationship(api);
  if (lanPort) await notes.withUrl(`http://${lanHost}:${port}/pending`, { displayText: "Notes (LAN)" });
}

await builder.build().run();

/** This machine's first IPv4 address that is not loopback or a container bridge. */
function lanAddress(): string {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    const found = addresses?.find((address) => address.family === "IPv4" && !address.internal);
    if (found) return found.address;
  }
  return "127.0.0.1";
}
