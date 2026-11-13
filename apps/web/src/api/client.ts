// The one way the web app reaches the server (ADR 0005, ADR 0010). Each call
// names its path and the contract schema its answer must match; nothing else
// in apps/web calls fetch.
//
// Every refusal, however it happens, reaches a screen as one error type,
// ApiFailure. Its kind is the handler outcome's kind when the server sent the
// contract's Error resource, so a screen tells "not visible to you" from "not
// signed in" by the same names the handlers use. Two more kinds cover what no
// handler said: the server could not be reached, or it answered with
// something the contract does not describe (a proxy's HTML page, a 500).
// Their messages are for a developer (method, path, status, the exception);
// a screen never shows them, it says what happened in its own words
// (shell/Problem.tsx) and logs this message to the console.
import {
  AgentToken,
  AgentTokenList,
  ApiError,
  AttendeeCard,
  CalendarFeed,
  Connection,
  ConnectionList,
  ContactImport,
  Following,
  GitHubRoundTrip,
  Event,
  IdentityList,
  IssuedAgentToken,
  Invite,
  Me,
  MySchedule,
  PersonSchedule,
  PlanEntry,
  RequestList,
  RequestResult,
  Session,
  SessionList,
  ShareLinks,
  SignInOptions,
  SuggestionList,
  WhoIsGoing,
  type ErrorKind,
  type SignInProvider,
  type UpdateProfileInput,
  type Visibility,
} from "@hallway/contracts";

export type { SignInOptions, SignInProvider };

/** What a contract schema offers here. Structural, so apps/web needs no zod import of its own. */
export interface Schema<T> {
  parse(input: unknown): T;
}

export type FailureKind = ErrorKind | "unreachable" | "unexpected";

export class ApiFailure extends Error {
  override readonly name = "ApiFailure";
  constructor(
    readonly kind: FailureKind,
    message: string,
    /** The HTTP status, when there was a response at all. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A schema for calls whose answer the app does not read (the cookie is the point). */
const ignored: Schema<void> = { parse: () => undefined };

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const myScheduleOf = (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/my-schedule`;
const entryOf = (eventId: string, sessionId: string) =>
  `${myScheduleOf(eventId)}/entries/${encodeURIComponent(sessionId)}`;
const requestOf = (requestId: string) => `/api/me/connection-requests/${encodeURIComponent(requestId)}`;
const attendeeOf = (handle: string) => `/api/attendees/${encodeURIComponent(handle)}`;

/** A body sent as it is, under its own content type (the Connections.csv upload), rather than as JSON. */
class RawBody {
  constructor(
    readonly text: string,
    readonly contentType: string,
  ) {}
}

export function createApiClient(send: typeof fetch = (input, init) => fetch(input, init)) {
  async function request<T>(method: Method, path: string, schema: Schema<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      let sent: string | undefined;
      if (body instanceof RawBody) {
        headers["content-type"] = body.contentType;
        sent = body.text;
      } else if (body !== undefined) {
        headers["content-type"] = "application/json";
        sent = JSON.stringify(body);
      }
      response = await send(path, { method, headers, ...(sent === undefined ? {} : { body: sent }) });
    } catch (cause) {
      throw new ApiFailure("unreachable", `Could not reach Hallway: ${String(cause)}`);
    }

    const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);

    if (!response.ok) {
      const refusal = ApiError.safeParse(payload);
      throw refusal.success
        ? new ApiFailure(refusal.data.kind, refusal.data.message, response.status)
        : new ApiFailure("unexpected", `${method} ${path} answered ${response.status}.`, response.status);
    }
    try {
      return schema.parse(payload);
    } catch {
      throw new ApiFailure("unexpected", `${method} ${path} answered with a shape the contract does not describe.`, response.status);
    }
  }

  return {
    getEvent: (eventId: string) => request("GET", `/api/events/${encodeURIComponent(eventId)}`, Event),

    /** Which ways to sign in the server offers: dev sign-in, and the configured providers in their order. */
    signInOptions: () => request("GET", "/api/auth/options", SignInOptions),

    /** `POST /api/dev/sign-in { name }` sets the session cookie. */
    devSignIn: (name: string) => request("POST", "/api/dev/sign-in", ignored, { name }),

    signOut: () => request("POST", "/api/auth/sign-out", ignored),

    /** The signed-in attendee; an `unauthenticated` failure when no one is. */
    me: () => request("GET", "/api/me", Me),
    updateProfile: (input: UpdateProfileInput) => request("PATCH", "/api/me", Me, input),
    setVisibility: (visibility: Visibility) => request("PUT", "/api/me/visibility", Me, { visibility }),

    agentTokens: () => request("GET", "/api/me/tokens", AgentTokenList),
    issueAgentToken: (label: string) => request("POST", "/api/me/tokens", IssuedAgentToken, { label }),
    revokeAgentToken: (tokenId: string) => request("DELETE", `/api/me/tokens/${encodeURIComponent(tokenId)}`, AgentToken),

    /** The providers I sign in with, oldest first; `dev` among them on a developer's machine. */
    identities: () => request("GET", "/api/me/identities", IdentityList),
    /** Refused (`conflict`) for my last way to sign in. */
    unlinkIdentity: (provider: SignInProvider) =>
      request("DELETE", `/api/me/identities/${encodeURIComponent(provider)}`, IdentityList),

    calendarFeed: () => request("GET", "/api/me/calendar-feed", CalendarFeed),
    rotateCalendarFeed: () => request("POST", "/api/me/calendar-feed/rotate", CalendarFeed),

    attendee: (handle: string) => request("GET", attendeeOf(handle), AttendeeCard),
    /** Their entries I may see; a `forbidden` failure when their visibility does not let me. */
    personSchedule: (handle: string, eventId: string) =>
      request("GET", `${attendeeOf(handle)}/schedule?eventId=${encodeURIComponent(eventId)}`, PersonSchedule),

    /** With an event, each connection carries `sessions` and `sharedWithMe` there. */
    connections: (eventId?: string) =>
      request(
        "GET",
        eventId === undefined ? "/api/me/connections" : `/api/me/connections?eventId=${encodeURIComponent(eventId)}`,
        ConnectionList,
      ),
    removeConnection: (handle: string) => request("DELETE", `/api/me/connections/${encodeURIComponent(handle)}`, Connection),
    requests: () => request("GET", "/api/me/connection-requests", RequestList),
    requestConnection: (handle: string) => request("POST", "/api/me/connection-requests", RequestResult, { handle }),
    acceptRequest: (requestId: string) => request("POST", `${requestOf(requestId)}/accept`, RequestResult),
    declineRequest: (requestId: string) => request("POST", `${requestOf(requestId)}/decline`, RequestResult),
    withdrawRequest: (requestId: string) => request("DELETE", requestOf(requestId), RequestResult),
    /** Connect at once with the invite from their share link. The token goes in the body, never in a path or a message. */
    connectWithInvite: (handle: string, invite: string) => request("POST", `${attendeeOf(handle)}/connect`, Connection, { invite }),
    rotateInvite: () => request("POST", "/api/me/invite/rotate", Invite),

    /** LinkedIn's Connections.csv, as the file reads; it replaces my last upload. */
    importContacts: (csv: string) => request("POST", "/api/me/contacts", ContactImport, new RawBody(csv, "text/csv")),
    suggestions: () => request("GET", "/api/me/suggestions", SuggestionList),
    /** Who I follow, by source; with an event, each carries how many of their sessions I may see there. */
    following: (eventId: string) => request("GET", `/api/me/following?eventId=${encodeURIComponent(eventId)}`, Following),
    /** Starts the GitHub round trip that reads who I follow again; the browser goes to the URL it returns. */
    refreshGitHubFollows: (returnTo: string) =>
      request("POST", "/api/me/following/github/refresh", GitHubRoundTrip, { returnTo }),

    /** Per session, my connections going. At most 200 ids a call (the contract's limit). */
    whoIsGoing: (eventId: string, sessionIds: readonly string[]) =>
      request(
        "GET",
        `/api/events/${encodeURIComponent(eventId)}/who-is-going?sessionIds=${sessionIds.map(encodeURIComponent).join(",")}`,
        WhoIsGoing,
      ),

    shareLinks: () => request("GET", "/api/me/share", ShareLinks),

    mySchedule: (eventId: string) => request("GET", myScheduleOf(eventId), MySchedule),
    addToPlan: (eventId: string, sessionId: string) => request("POST", entryOf(eventId, sessionId), PlanEntry),
    removeFromPlan: (eventId: string, sessionId: string) => request("DELETE", entryOf(eventId, sessionId), PlanEntry),
    setEntryHidden: (eventId: string, sessionId: string, hidden: boolean) =>
      request("PATCH", entryOf(eventId, sessionId), PlanEntry, { hidden }),

    session: (eventId: string, sessionId: string) =>
      request("GET", `/api/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}`, Session),
    /** The catalog agents have synced, matching `q` (code, title, speaker) and starting on `day`; both optional. */
    searchSessions: (eventId: string, filter: { q?: string; day?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (filter.limit) query.set("limit", String(filter.limit));
      if (filter.q) query.set("q", filter.q);
      if (filter.day) query.set("day", filter.day);
      const search = query.size > 0 ? `?${query}` : "";
      return request("GET", `/api/events/${encodeURIComponent(eventId)}/sessions${search}`, SessionList);
    },

    /**
     * The share card as an anonymous visitor gets it, which is what LinkedIn
     * fetches for the link preview (ADR 0012): without the cookie, so the
     * owner sees what others will. It is asked for under its own URL (an
     * extra `view` the server ignores) so the browser's cache never hands
     * this public card to the owner's signed-in `<img>` of the same picture.
     * TODO(#70): a preview URL from ShareLinks would make this a plain `<img>`.
     */
    publicShareCard: async (imageUrl: string): Promise<Blob> => {
      const url = new URL(imageUrl);
      url.searchParams.set("view", "public");
      let response: Response;
      try {
        response = await send(url.pathname + url.search, { credentials: "omit" });
      } catch (cause) {
        throw new ApiFailure("unreachable", `Could not reach Hallway: ${String(cause)}`);
      }
      if (!response.ok) throw new ApiFailure("unexpected", `GET ${url.pathname} answered ${response.status}.`, response.status);
      return response.blob();
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient();

/**
 * Where a sign-in button goes: a page navigation, not a fetch, because it
 * redirects to the provider and back with a cookie (ADR 0018). It lands on
 * `returnTo` (a path the server checks again) or `/`. With `link`, the
 * provider is added to the person signed in instead (Settings).
 */
export function signInHref(provider: SignInProvider, returnTo: string | null, link = false): string {
  const query = new URLSearchParams();
  if (returnTo !== null) query.set("returnTo", returnTo);
  if (link) query.set("link", "1");
  const search = query.size > 0 ? `?${query}` : "";
  return `/api/auth/${encodeURIComponent(provider)}${search}`;
}
