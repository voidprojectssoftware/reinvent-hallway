// The Worker's composition root (ADR 0002): the one place adapters are chosen.
// Each request gets its handlers over D1 from its own bindings.
import {
  connectionsGoing,
  getEvent,
  identityHandlers,
  invitePathOf,
  networkHandlers,
  recordGitHubFollowing,
  scheduleHandlers,
  sharingHandlers,
  type TieBetween,
  type IdentityProviders,
} from "@hallway/application";
import {
  agentTokensOnD1,
  attendeesOnD1,
  calendarFeedsOnD1,
  eventsOnD1,
  gitHubOAuth,
  googleOidc,
  linkedInOidc,
  microsoftOidc,
  networkOnD1,
  openDatabase,
  scheduleOnD1,
  webSessionsOnD1,
} from "@hallway/infrastructure";
import { createApp, type Handlers } from "./app.ts";
import { isPersonPage, personPage } from "./person-page.ts";
import { renderPng } from "./sharing/worker-renderer.ts";

/**
 * Each provider is on when both its client id and secret are set (in
 * .dev.vars locally, as Worker secrets when deployed); off, its sign-in
 * answers 404 and `GET /api/auth/options` leaves it out.
 */
function signInProviders(env: Env): IdentityProviders {
  const client = (clientId: string | undefined, clientSecret: string | undefined) =>
    clientId && clientSecret ? { clientId, clientSecret } : undefined;
  const google = client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  const microsoft = client(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
  const linkedin = client(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET);
  const github = client(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  return {
    ...(google && { google: googleOidc(google) }),
    ...(microsoft && { microsoft: microsoftOidc(microsoft) }),
    ...(linkedin && { linkedin: linkedInOidc(linkedin) }),
    ...(github && { github: gitHubOAuth(github) }),
  };
}

function handlersFor(env: Env): Handlers {
  const db = openDatabase(env.DB);
  const events = eventsOnD1(db);
  const attendees = attendeesOnD1(db);
  const calendarFeeds = calendarFeedsOnD1(db);
  const schedule = scheduleOnD1(db);
  const network = networkOnD1(db);
  const now = () => new Date();
  // The one answer to "how does this viewer stand to this owner" (connected,
  // followed by the owner: ADR 0019) for every read path that asks the
  // visibility rule: identity's card, sharing's page, feed and image, and the
  // network reads, whose bulk reads return the same tie from the same tables.
  const tieBetween: TieBetween = (viewer, owner) => network.tie(viewer, owner);
  return {
    getEvent: getEvent(events),
    identity: identityHandlers({
      attendees,
      agentTokens: agentTokensOnD1(db),
      webSessions: webSessionsOnD1(db),
      calendarFeeds,
      tieBetween,
      providers: signInProviders(env),
      recordGitHubFollowing: recordGitHubFollowing(network, now),
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
      tieBetween,
      sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
      now,
    }),
    sharing: sharingHandlers({
      attendees,
      calendarFeeds,
      events,
      schedule,
      tieBetween,
      sessionUrlTemplate: env.SESSION_URL_TEMPLATE,
      invitePath: invitePathOf(network, now),
    }),
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
