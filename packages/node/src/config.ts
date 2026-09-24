/** Client configuration: option resolution and API-key inspection. */

import { EpayConfigError } from "./errors.js";
import type { EpayMode } from "./types.js";

/** Default API root. */
export const DEFAULT_BASE_URL = "https://api.epayethiopia.com/v1";

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default number of retries after the initial attempt. */
export const DEFAULT_MAX_RETRIES = 2;

/** The subset of `fetch` this SDK relies on, so it can be swapped in tests. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

/** Options accepted by the {@link import('./client.js').Epay} constructor. */
export interface EpayClientOptions {
  /** Secret key, `sk_live_…` or `sk_test_…`. Falls back to `EPAY_SECRET_KEY`. */
  apiKey?: string;
  /** Webhook signing secret. Falls back to `EPAY_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  /** API root. Falls back to `EPAY_BASE_URL`, then {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Retries after the first attempt, for 429/5xx/network failures. Defaults to 2. */
  maxRetries?: number;
  /** Headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Replacement `fetch`, for tests or custom transports. */
  fetch?: FetchLike;
}

/** Fully resolved configuration. */
export interface ResolvedConfig {
  apiKey: string;
  webhookSecret: string | null;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  defaultHeaders: Record<string, string>;
  fetch: FetchLike;
  mode: EpayMode | null;
}

/** Reads an env var without assuming `process` exists (Deno, browsers, edge). */
function env(name: string): string | undefined {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name];
}

/**
 * Derives the traffic mode from a key prefix.
 *
 * Returns null for an `sk_`-prefixed key with an unrecognised environment
 * segment, so a future key format does not break the client.
 */
export function modeFromApiKey(apiKey: string): EpayMode | null {
  if (apiKey.startsWith("sk_live_")) return "live";
  if (apiKey.startsWith("sk_test_")) return "sandbox";
  return null;
}

/**
 * Validates and fills in every option, reading env fallbacks.
 *
 * @throws {EpayConfigError} when no API key is available or the key is clearly
 * not a secret key.
 */
export function resolveConfig(options: EpayClientOptions = {}): ResolvedConfig {
  const apiKey = (options.apiKey ?? env("EPAY_SECRET_KEY") ?? "").trim();

  if (!apiKey) {
    throw new EpayConfigError(
      "Missing ePay API key. Pass { apiKey } or set the EPAY_SECRET_KEY environment variable.",
    );
  }
  if (!apiKey.startsWith("sk_")) {
    throw new EpayConfigError(
      'Invalid ePay API key: expected a secret key beginning with "sk_live_" or "sk_test_". ' +
        "Secret keys are found in the dashboard under Developers → API Keys.",
    );
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new EpayConfigError(
      `timeout must be a positive number of milliseconds, received ${timeout}`,
    );
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new EpayConfigError(
      `maxRetries must be a non-negative integer, received ${maxRetries}`,
    );
  }

  const fetchImpl =
    options.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new EpayConfigError(
      "No global fetch available. Upgrade to Node 18+ or pass a { fetch } implementation.",
    );
  }

  const baseUrl = (
    options.baseUrl ??
    env("EPAY_BASE_URL") ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  return {
    apiKey,
    webhookSecret: options.webhookSecret ?? env("EPAY_WEBHOOK_SECRET") ?? null,
    baseUrl,
    timeout,
    maxRetries,
    defaultHeaders: options.defaultHeaders ?? {},
    fetch: fetchImpl,
    mode: modeFromApiKey(apiKey),
  };
}
