/** The ePay client: the single entry point to every resource. */

import {
  resolveConfig,
  type EpayClientOptions,
  type ResolvedConfig,
} from "./config.js";
import { maskSecret } from "./helpers.js";
import { HttpClient, type ApiResponse, type RequestOptions } from "./http.js";
import { PaymentProviders } from "./resources/payment-providers.js";
import { Payments } from "./resources/payments.js";
import { Transactions } from "./resources/transactions.js";
import type { EpayMode } from "./types.js";
import { Webhooks } from "./webhooks.js";

/**
 * Client for the ePay Business API.
 *
 * The key prefix selects the environment — `sk_test_…` hits the sandbox,
 * `sk_live_…` moves real money — so there is no separate mode to configure.
 *
 * ```ts
 * import { Epay } from '@e-pay/node';
 *
 * const epay = new Epay({ apiKey: process.env.EPAY_SECRET_KEY });
 *
 * const session = await epay.payments.initialize({
 *   amount: '250.00',
 *   currencyCode: 'ETB',
 *   customerPhone: '+251911234567',
 *   merchantReference: 'order_123',
 * });
 *
 * redirect(session.checkoutUrl);
 * ```
 *
 * Failed requests throw an {@link import('./errors.js').EpayApiError} subclass.
 * Transient failures — `429`, `5xx`, and network errors — are retried with
 * exponential backoff before surfacing.
 */
export class Epay {
  /** Initialize, verify, and cancel payment sessions. */
  readonly payments: Payments;
  /** List, retrieve, and inspect the timeline of transactions. */
  readonly transactions: Transactions;
  /** Discover which providers and flows your account can use. */
  readonly paymentProviders: PaymentProviders;
  /** Verify webhook signatures and parse events. */
  readonly webhooks: Webhooks;

  private readonly config: ResolvedConfig;
  private readonly http: HttpClient;

  /**
   * @param options Falls back to `EPAY_SECRET_KEY`, `EPAY_WEBHOOK_SECRET`, and
   * `EPAY_BASE_URL` for any option left unset.
   *
   * @throws {import('./errors.js').EpayConfigError} when no API key is
   * available, the key is not a secret key, or an option is out of range.
   */
  constructor(options: EpayClientOptions = {}) {
    this.config = resolveConfig(options);
    this.http = new HttpClient(this.config);

    this.payments = new Payments(this.http);
    this.transactions = new Transactions(this.http);
    this.paymentProviders = new PaymentProviders(this.http);
    this.webhooks = new Webhooks(this.config.webhookSecret);
  }

  /**
   * Which environment the configured key targets, or null for a key whose
   * prefix this SDK version does not recognise.
   */
  get mode(): EpayMode | null {
    return this.config.mode;
  }

  /** Whether the configured key targets the sandbox. */
  get isSandbox(): boolean {
    return this.config.mode === "sandbox";
  }

  /** The API root every request is sent to. */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Escape hatch for endpoints this SDK version does not model yet.
   *
   * Applies the same authentication, timeout, retry, and error handling as the
   * typed methods.
   */
  request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
    return this.http.request<T>(options);
  }

  /** Renders the client without leaking the API key. */
  toString(): string {
    return `Epay(mode=${this.mode ?? "unknown"}, apiKey=${maskSecret(this.config.apiKey)})`;
  }

  /** Keeps `console.log(client)` from printing the API key. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}
