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
import { rotateCalendarFeed, type RotateCalendarFeed } from "./calendar-feed.ts";
import type {
  AgentTokenRepository,
  AreConnected,
  AttendeeRepository,
  CalendarFeedRepository,
  IdentityProvider,
  WebSessionRepository,
} from "./ports.ts";
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
  beginLinkedInSignIn,
  completeLinkedInSignIn,
  devSignIn,
  signIn,
  signOut,
  type BeginLinkedInSignIn,
  type CompleteLinkedInSignIn,
  type DevSignIn,
  type SignOut,
} from "./sign-in.ts";

export interface IdentityPorts {
  attendees: AttendeeRepository;
  agentTokens: AgentTokenRepository;
  webSessions: WebSessionRepository;
  calendarFeeds: CalendarFeedRepository;
  areConnected: AreConnected;
  /** Absent when LinkedIn sign-in is not configured (no client id). */
  linkedIn?: IdentityProvider | undefined;
  now?: () => Date;
}

export interface IdentityHandlers {
  authenticate: Authenticate;
  devSignIn: DevSignIn;
  beginLinkedInSignIn: BeginLinkedInSignIn;
  completeLinkedInSignIn: CompleteLinkedInSignIn;
  signOut: SignOut;
  getMe: GetMe;
  updateProfile: UpdateProfile;
  setVisibility: SetVisibility;
  getAttendee: GetAttendee;
  issueAgentToken: IssueAgentToken;
  listAgentTokens: ListAgentTokens;
  revokeAgentToken: RevokeAgentToken;
  rotateCalendarFeed: RotateCalendarFeed;
}

export function identityHandlers(ports: IdentityPorts): IdentityHandlers {
  const now = ports.now ?? (() => new Date());
  const signInWith = signIn(ports.attendees, ports.webSessions, now);
  return {
    authenticate: authenticate(ports.webSessions, ports.agentTokens, now),
    devSignIn: devSignIn(signInWith),
    beginLinkedInSignIn: beginLinkedInSignIn(ports.linkedIn),
    completeLinkedInSignIn: completeLinkedInSignIn(ports.linkedIn, signInWith),
    signOut: signOut(ports.webSessions),
    getMe: getMe(ports.attendees),
    updateProfile: updateProfile(ports.attendees),
    setVisibility: setVisibility(ports.attendees),
    getAttendee: getAttendee(ports.attendees, ports.areConnected),
    issueAgentToken: issueAgentToken(ports.agentTokens, now),
    listAgentTokens: listAgentTokens(ports.agentTokens),
    revokeAgentToken: revokeAgentToken(ports.agentTokens, now),
    rotateCalendarFeed: rotateCalendarFeed(ports.calendarFeeds, now),
  };
}
