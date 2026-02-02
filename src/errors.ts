import { Data } from "effect";
import type { Provider } from "./types.js";

/**
 * Base error for git forge operations
 */
export class GitForgeError extends Data.TaggedError("GitForgeError")<{
  /** Provider where the error occurred */
  provider: Provider;
  /** Operation that failed */
  operation: string;
  /** Human-readable error message */
  message: string;
  /** Underlying error if available */
  cause?: unknown;
}> {}

/**
 * Authentication failed (invalid token, expired, insufficient scopes)
 */
export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError"
)<{
  provider: Provider;
  message: string;
}> {}

/**
 * Requested resource was not found
 */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  provider: Provider;
  resource: "repository" | "branch" | "pull-request";
  identifier: string;
}> {}

/**
 * Rate limit exceeded
 */
export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  provider: Provider;
  /** Seconds until rate limit resets (if known) */
  retryAfter?: number;
}> {}

/**
 * Validation error (e.g., branch already exists, invalid input)
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  provider: Provider;
  message: string;
  field?: string;
}> {}

/**
 * Union of all possible forge errors
 */
export type ForgeError =
  | GitForgeError
  | AuthenticationError
  | NotFoundError
  | RateLimitError
  | ValidationError;
