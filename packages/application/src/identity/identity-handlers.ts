// Every identity handler, built over one set of ports. apps/api keeps them as
// one entry (`handlers.identity`), so the slices that run beside this one add
// a line to its Handlers rather than fourteen.
import { authenticate, type Authenticate } from "./authenticate.ts";
import {
  issueAgentToken,
  listAgentTokens,
  revokeAgentToken,
  type IssueAgentToken,
  type ListAgentTokens,
  type RevokeAgentToken,
} from "./agent-tokens.ts";
import {
  getCalendarFeed,
  rotateCalendarFeed,
  type GetCalendarFeed,
  type RotateCalendarFeed,
} from "./calendar-feed.ts";
import type {
  AgentTokenRepository,
  AreConnected,
  AttendeeRepository,
  CalendarFeedRepository,
  IdentityProviders,
  RecordGitHubFollowing,
  WebSessionRepository,
} from "./ports.ts";
import { listIdentities, unlinkIdentity, type ListIdentities, type UnlinkIdentity } from "./identities.ts";
import {
  getAttendee,
  getMe,
  setVisibility,
  updateProfile,
  type GetAttendee,
  type GetMe,
  type SetVisibility,
  type UpdateProfile,
} from "./profile.ts";
import {
  getSignInOptions,
  signInHandlers,
  signOut,
  type BeginSignIn,
  type CompleteSignIn,
  type DevSignIn,
  type GetSignInOptions,
  type SignOut,
} from "./sign-in.ts";

export interface IdentityPorts {
  attendees: AttendeeRepository;
  agentTokens: AgentTokenRepository;
  webSessions: WebSessionRepository;
  calendarFeeds: CalendarFeedRepository;
  areConnected: AreConnected;
  /** The sign-in providers configured here; one without a client id is absent. */
  providers?: IdentityProviders;
  /** Where GitHub's following list goes at sign-in and link time. #63 fills it; a no-op until then. */
  recordGitHubFollowing?: RecordGitHubFollowing;
  now?: () => Date;
}

export interface IdentityHandlers {
  authenticate: Authenticate;
  devSignIn: DevSignIn;
  beginSignIn: BeginSignIn;
  completeSignIn: CompleteSignIn;
  listIdentities: ListIdentities;
  unlinkIdentity: UnlinkIdentity;
  signOut: SignOut;
  getSignInOptions: GetSignInOptions;
  getMe: GetMe;
  updateProfile: UpdateProfile;
  setVisibility: SetVisibility;
  getAttendee: GetAttendee;
  issueAgentToken: IssueAgentToken;
  listAgentTokens: ListAgentTokens;
  revokeAgentToken: RevokeAgentToken;
  rotateCalendarFeed: RotateCalendarFeed;
  getCalendarFeed: GetCalendarFeed;
}

export function identityHandlers(ports: IdentityPorts): IdentityHandlers {
  const now = ports.now ?? (() => new Date());
  const providers = ports.providers ?? {};
  const signIn = signInHandlers(providers, {
    attendees: ports.attendees,
    sessions: ports.webSessions,
    recordGitHubFollowing: ports.recordGitHubFollowing ?? (async () => {}),
    now,
  });
  return {
    authenticate: authenticate(ports.webSessions, ports.agentTokens, now),
    ...signIn,
    listIdentities: listIdentities(ports.attendees),
    unlinkIdentity: unlinkIdentity(ports.attendees),
    signOut: signOut(ports.webSessions),
    getSignInOptions: getSignInOptions(providers),
    getMe: getMe(ports.attendees),
    updateProfile: updateProfile(ports.attendees),
    setVisibility: setVisibility(ports.attendees),
    getAttendee: getAttendee(ports.attendees, ports.areConnected),
    issueAgentToken: issueAgentToken(ports.agentTokens, now),
    listAgentTokens: listAgentTokens(ports.agentTokens),
    revokeAgentToken: revokeAgentToken(ports.agentTokens, now),
    rotateCalendarFeed: rotateCalendarFeed(ports.calendarFeeds, now),
    getCalendarFeed: getCalendarFeed(ports.calendarFeeds),
  };
}
