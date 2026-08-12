/**
 * Application error taxonomy. Every error surfaced to a user goes through one of
 * these so route handlers can map to a status code and a message that is safe to
 * display. Raw exceptions are logged, never rendered.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "VALIDATION"
  | "GOOGLE_AUTH"
  | "GOOGLE_ADS_API"
  | "AI_PROVIDER"
  | "STRIPE"
  | "DATABASE"
  | "SAFETY_VIOLATION"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  VALIDATION: 422,
  GOOGLE_AUTH: 502,
  GOOGLE_ADS_API: 502,
  AI_PROVIDER: 502,
  STRIPE: 502,
  DATABASE: 500,
  SAFETY_VIOLATION: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Safe to render in the UI. */
  readonly userMessage: string;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options: { details?: unknown; cause?: unknown; internalMessage?: string } = {},
  ) {
    super(options.internalMessage ?? userMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.userMessage = userMessage;
    this.details = options.details;
  }
}

export const errors = {
  unauthorized: (message = "You need to sign in to continue.") =>
    new AppError("UNAUTHORIZED", message),
  forbidden: (message = "You do not have access to this resource.") =>
    new AppError("FORBIDDEN", message),
  notFound: (message = "We could not find what you were looking for.") =>
    new AppError("NOT_FOUND", message),
  badRequest: (message: string, details?: unknown) =>
    new AppError("BAD_REQUEST", message, { details }),
  conflict: (message: string) => new AppError("CONFLICT", message),
  rateLimited: (message = "Too many requests. Please slow down and try again shortly.") =>
    new AppError("RATE_LIMITED", message),
  planLimit: (message: string) => new AppError("PLAN_LIMIT", message),
  validation: (message: string, details?: unknown) =>
    new AppError("VALIDATION", message, { details }),
  safety: (message: string, details?: unknown) =>
    new AppError("SAFETY_VIOLATION", message, { details }),
  stripe: (message: string, options?: { cause?: unknown }) =>
    new AppError("STRIPE", message, options),
  /** A capability the deployment has not been given credentials for. */
  configuration: (message: string) => new AppError("BAD_REQUEST", message),
  internal: (message = "Something went wrong on our side. We have been notified.") =>
    new AppError("INTERNAL", message),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Never leaks internals: unknown errors collapse to a generic message. */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) return error.userMessage;
  return "Something went wrong. Please try again.";
}

export function toErrorPayload(error: unknown): {
  status: number;
  body: { error: { code: ErrorCode; message: string; details?: unknown } };
} {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.userMessage,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
  };
}
