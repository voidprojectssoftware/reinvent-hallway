// What a refused request carries, over REST (as the body) and over MCP (as the
// tool error's text). The kinds are the handler outcome's error kinds (ADR
// 0002); each interface maps them to its own status in one place.
import { z } from "zod";

export const ErrorKind = z.enum([
  "invalid",
  "unauthenticated",
  "forbidden",
  "not-found",
  "conflict",
]);
export type ErrorKind = z.infer<typeof ErrorKind>;

export const ApiError = z
  .object({
    kind: ErrorKind,
    message: z.string(),
  })
  .meta({ id: "Error", description: "Why the request was refused." });
export type ApiError = z.infer<typeof ApiError>;
