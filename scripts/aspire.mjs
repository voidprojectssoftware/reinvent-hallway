// `npm run aspire`: start this worktree's AppHost (apphost.mts, ADR 0017),
// wait until the demo data is in, and print every URL.
//
//   npm run aspire                    this machine only
//   HALLWAY_LAN=1 npm run aspire      also reachable from the LAN
//   npm run aspire:stop
//
// Underneath it is `aspire start --isolated`, so every port is Aspire's and
// two worktrees can run at once. LAN mode adds two fixed ports, so a bookmark
// on another machine survives a restart: the app's (HALLWAY_LAN_PORT, default
// 8796, served by the `lan` resource) and the dashboard's
// (HALLWAY_LAN_DASHBOARD_PORT, default 8797). The dashboard keeps its sign-in:
// the login URL printed below carries this run's browser token.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import console from "node:console";
import process from "node:process";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const apphost = join(root, "apphost.mts");
const installed = join(homedir(), ".aspire/bin/aspire");
const aspireBin = existsSync(installed) ? installed : "aspire";

/** Runs the Aspire CLI against this worktree's AppHost and returns its stdout. */
function aspire(args, env = process.env) {
  const run = spawnSync(aspireBin, [...args, "--apphost", apphost, "--non-interactive", "--nologo"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (run.error) throw new Error(`Could not run the Aspire CLI (${aspireBin}): ${run.error.message}`);
  if (run.status !== 0) {
    process.stderr.write(run.stdout);
    throw new Error(`aspire ${args[0]} failed (exit ${run.status}).`);
  }
  return run.stdout;
}

/** The JSON object in the CLI's output; it may print status lines around it. */
export function jsonIn(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`No JSON in the Aspire CLI's output:\n${output}`);
  return JSON.parse(output.slice(start, end + 1));
}

/** The dashboard's login URL as another machine must type it. */
export function lanDashboardUrl(dashboardUrl, lanHost) {
  const url = new URL(dashboardUrl);
  url.hostname = lanHost;
  return url.href;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "stop") {
    aspire(["stop"]);
    console.log("Stopped.");
    process.exit(0);
  }

  const lan = process.env.HALLWAY_LAN === "1";
  const env = { ...process.env };
  if (lan) {
    // The dashboard listens where ASPNETCORE_URLS says, on every interface
    // here, and plain http needs ASPIRE_ALLOW_UNSECURED_TRANSPORT. Its
    // browser-token sign-in stays on (ADR 0017).
    const dashboardPort = process.env.HALLWAY_LAN_DASHBOARD_PORT ?? "8797";
    env.ASPNETCORE_URLS = `http://0.0.0.0:${dashboardPort}`;
    env.ASPIRE_ALLOW_UNSECURED_TRANSPORT = "true";
  }

  try {
    const started = jsonIn(aspire(["start", "--isolated", "--format", "Json"], env));
    aspire(["wait", "api", "--timeout", "300"]);
    aspire(["wait", "seed", "--status", "down", "--timeout", "120"]);
    const { resources } = jsonIn(aspire(["describe", "--format", "Json"]));

    const lanResource = resources.find((resource) => resource.displayName === "lan");
    const lanHost = lanResource ? new URL(lanResource.urls[0].url).hostname : undefined;

    console.log("\nHallway is running under Aspire.\n");
    console.log(`Dashboard (sign-in link, this run's token):`);
    console.log(`  ${started.dashboardUrl}`);
    if (lanHost) console.log(`  ${lanDashboardUrl(started.dashboardUrl, lanHost)}   (LAN)`);
    for (const resource of resources.toSorted((a, b) => a.displayName.localeCompare(b.displayName))) {
      const urls = (resource.urls ?? []).filter((url) => url.url.startsWith("http"));
      console.log(`\n${resource.displayName}: ${resource.state}${resource.healthStatus ? `, ${resource.healthStatus}` : ""}`);
      for (const url of urls) console.log(`  ${(url.displayName ?? url.name).padEnd(24)} ${url.url}`);
    }
    console.log('\nDev sign-in as the owner: open /sign-in and use the name "Blake Hastings".');
    console.log("Stop it with: npm run aspire:stop");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
