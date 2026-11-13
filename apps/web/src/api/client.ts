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
import { ApiError, Event, type ErrorKind } from "@hallway/contracts";

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

// What dev sign-in reports, until identity (#12) puts the real resource in
// packages/contracts; then this goes and the contract's schema is used.
export interface SignInOptions {
  devSignIn: boolean;
}
const PendingSignInOptions: Schema<SignInOptions> = {
  parse(input) {
    if (typeof input === "object" && input !== null && "devSignIn" in input) {
      return { devSignIn: input.devSignIn === true };
    }
    throw new TypeError("Expected { devSignIn: boolean }.");
  },
};

/** A schema for calls whose answer the app does not read (the cookie is the point). */
const ignored: Schema<void> = { parse: () => undefined };

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function createApiClient(send: typeof fetch = (input, init) => fetch(input, init)) {
  async function request<T>(method: Method, path: string, schema: Schema<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await send(path, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
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

    /** Pending identity (#12): whether the dev sign-in button may be shown. */
    signInOptions: () => request("GET", "/api/sign-in/options", PendingSignInOptions),

    /** Pending identity (#12): `POST /api/dev/sign-in { name }` sets the session cookie. */
    devSignIn: (name: string) => request("POST", "/api/dev/sign-in", ignored, { name }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient();

/** Pending identity (#12): a page navigation, not a fetch, because it redirects to LinkedIn. */
export const linkedInSignInHref = "/api/sign-in/linkedin";
