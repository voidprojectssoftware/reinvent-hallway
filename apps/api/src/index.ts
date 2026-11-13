// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import {
  connectionsGoing,
  getEvent,
  identityHandlers,
  invitePathOf,
  networkHandlers,
  postingHandlers,
  scheduleHandlers,
  sharingHandlers,
  type AreConnected,
  type IdentityProviders,
  type LinkedInPoster,
} from "@hallway/application";
import {
  agentTokensOnD1,
  attendeesOnD1,
  calendarFeedsOnD1,
  eventsOnD1,
  gitHubOAuth,
  googleOidc,
  linkedInEndpoints,
  linkedInEndpointsAt,
  linkedInOidc,
  linkedInPoster,
  microsoftOidc,
  networkOnD1,
  openDatabase,
  postDraftsOnD1,
  scheduleOnD1,
  webSessionsOnD1,
} from "@hallway/infrastructure";
import { createApp, type Handlers } from "./app.ts";
import { isPersonPage, personPage } from "./person-page.ts";
import { renderPng } from "./sharing/worker-renderer.ts";

const client = (clientId: string | undefined, clientSecret: string | undefined) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;

/**
 * LinkedIn's addresses: LinkedIn's own, or with dev sign-in on and
 * LINKEDIN_FAKE_URL set, the fake LinkedIn `npm run fake:linkedin` serves, so
 * sign-in and posting can be driven locally without calling LinkedIn (ADR 0026).
 */
const linkedInAt = (env: Env) =>
  env.DEV_SIGN_IN === "1" && env.LINKEDIN_FAKE_URL ? linkedInEndpointsAt(env.LINKEDIN_FAKE_URL) : linkedInEndpoints;

/**
 * Each provider is on when both its client id and secret are set (in
 * .dev.vars locally, as Worker secrets when deployed); off, its sign-in
 * answers 404 and `GET /api/auth/options` leaves it out.
 */
function signInProviders(env: Env): IdentityProviders {
  const google = client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const microsoft = client(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
  const linkedin = client(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET);
  const github = client(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  return {
    ...(google && { google: googleOidc(google) }),
    ...(microsoft && { microsoft: microsoftOidc(microsoft) }),
    ...(linkedin && { linkedin: linkedInOidc(linkedin, linkedInAt(env)) }),
    ...(github && { github: gitHubOAuth(github) }),
  };
}

/**
 * Posting to LinkedIn needs the LinkedIn app and its Share on LinkedIn
 * product, which may need LinkedIn's approval (#18), so it is on only when
 * LINKEDIN_POSTING=1 says the app has it. Off, the composer offers the
 * fallback alone (open LinkedIn, copy the text, save the picture).
 */
function linkedInPosting(env: Env): LinkedInPoster | undefined {
  const linkedin = client(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET);
  return linkedin && env.LINKEDIN_POSTING === "1" ? linkedInPoster(linkedin, linkedInAt(env)) : undefined;
}

function handlersFor(env: Env): Handlers {
  const db = openDatabase(env.DB);
  const events = eventsOnD1(db);
  const attendees = attendeesOnD1(db);
  const calendarFeeds = calendarFeedsOnD1(db);
  const schedule = scheduleOnD1(db);
  const network = networkOnD1(db);
  const now = () => new Date();
  // The one answer to "are these two connected" for every read path that
  // asks the visibility rule: identity's card, sharing's page, feed and
  // image, and the network reads (which use the same repository).
  const areConnected: AreConnected = (a, b) => network.areConnected(a, b);
  const poster = linkedInPosting(env);
  const sharing = {
    attendees,
    calendarFeeds,
    events,
    schedule,
    areConnected,
    sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
    invitePath: invitePathOf(network, now),
  };
  return {
    getEvent: getEvent(events),
    identity: identityHandlers({
      attendees,
      agentTokens: agentTokensOnD1(db),
      webSessions: webSessionsOnD1(db),
      calendarFeeds,
      areConnected,
      providers: signInProviders(env),
      // GitHub's following list is dropped until #63 stores follows (ADR 0019).
    }),
    ...scheduleHandlers({
      events,
      schedule,
      sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
      now,
      connectionsGoing: connectionsGoing(network),
    }),
    network: networkHandlers({
      attendees,
      network,
      events,
      schedule,
      sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
      now,
    }),
    sharing: sharingHandlers(sharing),
    posting: postingHandlers({ ...sharing, drafts: postDraftsOnD1(db), now, ...(poster && { poster }) }),
  };
}

const app = createApp<Env>({ handlers: handlersFor, renderPng });

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    return isPersonPage(url)
      ? personPage(url, env.ASSETS, handlersFor(env).sharing.getSharedSchedule)
      : app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
