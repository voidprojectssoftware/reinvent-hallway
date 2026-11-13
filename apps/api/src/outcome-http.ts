// The one place a handler outcome becomes an HTTP response (ADR 0002).
import type { Outcome } from "@hallway/application";
import { ApiError, type ErrorKind } from "@hallway/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const httpStatus = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "account-exists": 409,
} as const satisfies Record<ErrorKind, ContentfulStatusCode>;

const refusal = (description: string) => ({
  description,
  content: { "application/json": { schema: ApiError } },
});

/**
 * Every status `respond` can answer with when it refuses, for a route's
 * `responses`. A handler may return any error kind, so a route lists them all
 * rather than a subset the types could not hold it to.
 */
export const errorResponses = {
  [httpStatus.invalid]: refusal("The request does not match the contract."),
  [httpStatus.unauthenticated]: refusal("The bearer token was not accepted."),
  [httpStatus.forbidden]: refusal("The actor may not do this."),
  [httpStatus["not-found"]]: refusal("No such resource, or not one the actor may see."),
  [httpStatus.conflict]: refusal(
    "The resource changed in a way that refuses this; `account-exists` when a sign-in's verified email belongs to another account.",
  ),
} as const;

export function respond<T extends object>(c: Context, outcome: Outcome<T>) {
  return outcome.ok
    ? c.json(outcome.value, 200)
    : c.json(outcome.error, httpStatus[outcome.error.kind]);
}

/** A refusal alone, for a route that answers success its own way (a redirect, a cookie). */
export function refuse(c: Context, error: ApiError) {
  return c.json(error, httpStatus[error.kind]);
}
