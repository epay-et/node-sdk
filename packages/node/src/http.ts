/** HTTP transport: URL building, retries with backoff, and error mapping. */

import type { ResolvedConfig } from "./config.js";
import {
  EpayApiError,
  EpayConnectionError,
  EpayTimeoutError,
  parseRetryAfter,
} from "./errors.js";
import { VERSION } from "./version.js";

/** Status codes worth a second attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

/** Base delay for exponential backoff, in milliseconds. */
const BACKOFF_BASE_MS = 500;

/** Ceiling for a single backoff delay, in milliseconds. */
const BACKOFF_MAX_MS = 8_000;

/** Query values a request may carry; `undefined` and `null` entries are dropped. */
export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

/** A single API call. */
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path relative to the configured base URL, e.g. `/transactions`. */
  path: string;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Whether a failed attempt may be retried. Defaults to true for GET and for
   * requests carrying an idempotency key.
   */
  retryable?: boolean;
  /** Overrides the client-wide timeout for this call. */
  timeout?: number;
}

/** The parsed result of a successful call. */
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

/** Issues API calls against a resolved configuration. */
export class HttpClient {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Sends a request, retrying transient failures, and returns the parsed body.
   *
   * @throws {EpayApiError} for any non-2xx response the retry budget did not clear.
   * @throws {EpayConnectionError} when no response was ever received.
   */
  async request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const label = `${options.method} ${options.path}`;
    const retryable = options.retryable ?? options.method === "GET";
    const attempts = retryable ? this.config.maxRetries + 1 : 1;

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "User-Agent": `epay-node/${VERSION}`,
      ...this.config.defaultHeaders,
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const isLast = attempt === attempts - 1;

      let response: Response;
      try {
        response = await this.dispatch(
          url,
          { method: options.method, headers, body },
          options.timeout,
        );
      } catch (error) {
        lastError = error;
        if (isLast) throw error;
        await sleep(backoffDelay(attempt, null));
        continue;
      }

      if (response.ok) {
        return {
          data: await parseBody<T>(response),
          status: response.status,
          headers: collectHeaders(response),
        };
      }

      const responseHeaders = collectHeaders(response);
      const apiError = EpayApiError.from({
        status: response.status,
        body: await parseBody<unknown>(response),
        headers: responseHeaders,
        request: label,
      });

      if (isLast || !shouldRetryStatus(response.status)) throw apiError;

      lastError = apiError;
      await sleep(
        backoffDelay(attempt, parseRetryAfter(responseHeaders["retry-after"])),
      );
    }

    // Unreachable: the loop either returns or throws on its final attempt.
    throw lastError instanceof Error
      ? lastError
      : new EpayConnectionError(`${label} failed after ${attempts} attempts`);
  }

  /** Runs a single attempt, translating transport failures into SDK errors. */
  private async dispatch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    timeoutOverride?: number,
  ): Promise<Response> {
    const timeout = timeoutOverride ?? this.config.timeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await this.config.fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new EpayTimeoutError(
          `Request to ${url} timed out after ${timeout}ms`,
          { cause: error },
        );
      }
      throw new EpayConnectionError(
        `Could not reach the ePay API at ${url}: ${(error as Error)?.message ?? error}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Joins the base URL, path, and query string. */
  private buildUrl(path: string, query?: QueryParams): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }

    const qs = search.toString();
    return `${this.config.baseUrl}${normalized}${qs ? `?${qs}` : ""}`;
  }
}

/** Whether a status code represents a transient failure. */
function shouldRetryStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

/**
 * Exponential backoff with full jitter, honouring `Retry-After` when the server
 * sent one. Jitter keeps concurrent clients from retrying in lockstep.
 */
function backoffDelay(
  attempt: number,
  retryAfterSeconds: number | null,
): number {
  if (retryAfterSeconds !== null) {
    return Math.min(retryAfterSeconds * 1000, BACKOFF_MAX_MS);
  }
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return ceiling * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lowercases header names so lookups are predictable across runtimes. */
function collectHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers?.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * Parses a response body as JSON, falling back to raw text.
 *
 * `204 No Content` (returned by cancel) and empty bodies resolve to null.
 */
async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return null as T;

  const text = await response.text();
  if (!text) return null as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
