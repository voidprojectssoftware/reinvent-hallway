// `npm run seed:demo`: demo people, schedules and connections in a running
// Hallway, so a local run has something to look at (ADR 0017).
//
//   npm run seed:demo                      against HALLWAY_URL
//   npm run seed:demo -- http://127.0.0.1:2xxxx
//
// Under Aspire the `seed` resource runs it once the api is healthy. Without
// Aspire, start `npm run dev` and pass the URL it printed.
//
// Everything goes through the public API, the way a person and their agent
// would: dev sign-in by name, the schedule sync an agent pushes, and the
// share-link connect. Each of those is idempotent on its own, so running the
// seed again changes nothing:
// - dev sign-in by name finds the same attendee every time (ADR 0008);
// - the sync makes an attendee's synced entries equal the lists given, so the
//   same lists twice leave the same schedule;
// - connecting from a share link answers with the connection "new or
//   existing", and the invite is made on first ask and read after that.
// It needs dev sign-in, so a loopback URL with DEV_SIGN_IN=1 (the default in
// .dev.vars).
import { readFileSync } from "node:fs";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

const eventId = "reinvent2026";
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
// AWS-shaped data, as the AWS Events MCP server returns it: the fixture the
// API tests use, and the second one the e2e suite adds.
const awsA = read("../apps/api/src/schedule-fixtures/aws-reinvent2026-schedule.json");
const awsB = read("../e2e/fixtures/aws-reinvent2026-schedule-b.json");
const catalog = new Map([...awsA.sessions, ...awsB.sessions].map((session) => [session.sessionId, session]));

/** The demo people. Fictional, except the owner, who signs in under his own name. */
export const demoPeople = [
  { name: "Blake Hastings", favorites: awsA.schedule.favorites, reserved: awsA.schedule.reserved },
  { name: "Priya Natarajan", favorites: awsB.schedule.favorites, reserved: awsB.schedule.reserved },
  {
    name: "Marcus Webb",
    favorites: ["s-keynote-mon", "s-svs401", "s-arc402", "s-cnt320", "s-ops303", "s-replay"],
    reserved: ["s-sec205", "s-gam301"],
  },
  {
    name: "Sofia Alvarez",
    favorites: ["s-keynote-tue", "s-iot220", "s-net201", "s-dev318", "s-expo-tue"],
    reserved: ["s-dat302"],
  },
];

/** Pairs connected through a share link: the first shares, the second opens it. */
export const demoConnections = [
  ["Blake Hastings", "Priya Natarajan"],
  ["Blake Hastings", "Marcus Webb"],
  ["Priya Natarajan", "Sofia Alvarez"],
];

/**
 * Seeds `baseUrl`. `fetchFn` is the global fetch by default; tests pass the
 * app's own. Returns who was seeded, by name.
 */
export async function seedDemo(baseUrl, { fetchFn = fetch, log = () => {} } = {}) {
  const call = async (method, path, cookie, body) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchFn(new URL(path, baseUrl).href, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response;
  };

  const people = new Map();
  for (const person of demoPeople) {
    const response = await call("POST", "/api/dev/sign-in", undefined, { name: person.name });
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    const me = await response.json();
    const ids = [...new Set([...person.favorites, ...person.reserved])];
    const sessions = ids.map((id) => {
      const session = catalog.get(id);
      if (!session) throw new Error(`The demo fixture has no session ${id}.`);
      return session;
    });
    const sync = await (
      await call("PUT", `/api/events/${eventId}/my-schedule`, cookie, {
        sessions,
        favorites: person.favorites,
        reserved: person.reserved,
      })
    ).json();
    log(`${person.name} (@${me.handle}): ${ids.length} sessions, sync added ${sync.added}, removed ${sync.removed}`);
    people.set(person.name, { ...me, cookie });
  }

  for (const [sharer, opener] of demoConnections) {
    const from = people.get(sharer);
    const to = people.get(opener);
    const invite = await (await call("GET", "/api/me/invite", from.cookie)).json();
    await call("POST", `/api/attendees/${encodeURIComponent(from.handle)}/connect`, to.cookie, { invite: invite.token });
    log(`${sharer} and ${opener} are connected`);
  }

  return people;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = process.argv[2] ?? process.env.HALLWAY_URL;
  if (!baseUrl) {
    console.error("Usage: npm run seed:demo -- <hallway url>, or HALLWAY_URL in the environment.");
    process.exit(2);
  }
  try {
    await seedDemo(baseUrl, { log: (line) => console.log(line) });
    console.log(`Seeded ${demoPeople.length} people and ${demoConnections.length} connections at ${baseUrl}.`);
    console.log('Sign in as the owner with dev sign-in and the name "Blake Hastings".');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
