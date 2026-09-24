/**
 * Error hierarchy for the ePay Business API.
 *
 * Every failure raised by this SDK is an {@link EpayError}. HTTP failures are
 * {@link EpayApiError} subclasses keyed by status code, so callers can branch on
 * `instanceof` instead of inspecting numbers.
 */

/** Base class for every error thrown by the SDK. */
export class EpayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the client is constructed with unusable options. */
export class EpayConfigError extends EpayError {}

/** Thrown when a webhook payload fails signature verification. */
export class EpayWebhookSignatureError extends EpayError {}

/** Thrown when a value fails local validation before a request is sent. */
export class EpayValidationError extends EpayError {}

/** Thrown when the request never produced an HTTP response. */
export class EpayConnectionError extends EpayError {}

/** Thrown when a request exceeded the configured timeout. */
export class EpayTimeoutError extends EpayConnectionError {}

/** Shape of the payloads the API uses to describe a failure. */
export interface EpayErrorPayload {
  message: string;
  raw: unknown;
  /** The `error` field of a Nest-style envelope, e.g. `"Unauthorized"`. */
  error?: string;
}

/** Base class for any non-2xx HTTP response. */
export class EpayApiError extends EpayError {
  /** HTTP status code of the response. */
  readonly status: number;
  /** Parsed response body, or the raw text when it was not JSON. */
  readonly body: unknown;
  /** Response headers, lowercased. */
  readonly headers: Record<string, string>;
  /** Method and path of the originating request, e.g. `POST /transactions/initialize`. */
  readonly request: string;

  constructor(
    message: string,
    init: {
      status: number;
      body: unknown;
      headers: Record<string, string>;
      request: string;
    },
  ) {
    super(message);
    this.status = init.status;
    this.body = init.body;
    this.headers = init.headers;
    this.request = init.request;
  }

  /**
   * Builds the most specific error subclass for a response.
   */
  static from(init: {
    status: number;
    body: unknown;
    headers: Record<string, string>;
    request: string;
  }): EpayApiError {
    const { message } = parseErrorPayload(init.body, init.status);
    const detail = `${init.request} failed with ${init.status}: ${message}`;

    switch (init.status) {
      case 400:
        return new EpayBadRequestError(detail, init);
      case 401:
        return new EpayAuthenticationError(detail, init);
      case 403:
        return new EpayPermissionDeniedError(detail, init);
      case 404:
        return new EpayNotFoundError(detail, init);
      case 409:
        return new EpayConflictError(detail, init);
      case 422:
        return new EpayUnprocessableEntityError(detail, init);
      case 429:
        return new EpayRateLimitError(detail, init);
      default:
        if (init.status >= 500) return new EpayServerError(detail, init);
        return new EpayApiError(detail, init);
    }
  }
}

/** `400` — the request was rejected as invalid. */
export class EpayBadRequestError extends EpayApiError {}

/** `401` — the API key is missing, malformed, invalid, or revoked. */
export class EpayAuthenticationError extends EpayApiError {}

/** `403` — the caller IP is not whitelisted, or the key lacks a permission. */
export class EpayPermissionDeniedError extends EpayApiError {}

/** `404` — no such transaction, or no payment source on the account. */
export class EpayNotFoundError extends EpayApiError {}

/** `409` — the request conflicts with the current state of the resource. */
export class EpayConflictError extends EpayApiError {}

/** `422` — the request was well-formed but semantically rejected. */
export class EpayUnprocessableEntityError extends EpayApiError {}

/** `5xx` — the API failed to process a valid request. */
export class EpayServerError extends EpayApiError {}

/**
 * `429` — the 100 requests / 60s per-key budget is exhausted.
 *
 * Note the SDK already retries these automatically; seeing this error means the
 * retry budget was also exhausted.
 */
export class EpayRateLimitError extends EpayApiError {
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  get retryAfterSeconds(): number | null {
    return parseRetryAfter(this.headers["retry-after"]);
  }
}

/**
 * Extracts a human-readable message from an error body.
 *
 * The API uses two envelopes: `{ status: "error", data: { message } }` on the
 * transaction endpoints and `{ statusCode, message, error }` on the provider
 * endpoints, where `message` may itself be an array of validation strings.
 */
export function parseErrorPayload(
  body: unknown,
  status: number,
): EpayErrorPayload {
  const fallback = `HTTP ${status}`;

  if (typeof body === "string") {
    return { message: body.trim() || fallback, raw: body };
  }
  if (body === null || typeof body !== "object") {
    return { message: fallback, raw: body };
  }

  const record = body as Record<string, unknown>;

  // { status: "error", data: { message } }
  const data = record.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).message;
    const flattened = flattenMessage(nested);
    if (flattened) return { message: flattened, raw: body };
  }

  // { statusCode, message, error }
  const flattened = flattenMessage(record.message);
  if (flattened) {
    const error = typeof record.error === "string" ? record.error : undefined;
    return { message: flattened, raw: body, error };
  }

  if (typeof record.error === "string") {
    return { message: record.error, raw: body, error: record.error };
  }

  return { message: fallback, raw: body };
}

function flattenMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (parts.length) return parts.join("; ");
  }
  return null;
}

/**
 * Parses a `Retry-After` header, which may be a delay in seconds or an
 * HTTP-date. Returns null when absent or unparseable.
 */
export function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, (date - Date.now()) / 1000);
  }
  return null;
}
